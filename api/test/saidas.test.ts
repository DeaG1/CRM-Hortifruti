import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string
let produtoA: string, produtoB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  // Upsert em vez de select: este arquivo precisa rodar isolado, sem
  // depender de outro arquivo ter criado os tenants antes (mesmo padrao de
  // clientes.test.ts).
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-saidas-a', 'Tenant Saidas A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-saidas-b', 'Tenant Saidas B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from saida_itens where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from saidas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`

  // saida_itens.produto_id e FK restrict — precisa de um produto real para
  // gravar qualquer item.
  const [pa] = await admin`
    insert into produtos (tenant_id, nome) values (${tenantA}, 'Produto A') returning id`
  const [pb] = await admin`
    insert into produtos (tenant_id, nome) values (${tenantB}, 'Produto B') returning id`
  produtoA = pa.id; produtoB = pb.id
})

afterAll(async () => { await sql?.end(); await admin?.end() })

/** Insere uma saida com um item, direto via SQL (sem passar pela rota HTTP
 * — a camada HTTP e coberta em saidas.http.test.ts). */
async function inserirSaidaComItem(
  tenantId: string, produtoId: string, numero: string,
  extra: Record<string, unknown> = {},
) {
  return withTenant(sql, tenantId, async (tx) => {
    const [saida] = await tx`
      insert into saidas ${tx({
        tenant_id: tenantId, numero, data_pedido: '2026-08-01', ...extra,
      })} returning *`
    await tx`
      insert into saida_itens ${tx({
        tenant_id: tenantId, saida_id: saida.id, produto_id: produtoId,
        un: 'KG', qtd: 10, preco: 5,
      })}`
    return saida
  })
}

describe('saidas', () => {
  it('cria e lista dentro do tenant', async () => {
    await inserirSaidaComItem(tenantA, produtoA, 'S-0001')
    const linhas = await withTenant(sql, tenantA, tx => tx`select numero from saidas`)
    expect(linhas.map(l => l.numero)).toEqual(['S-0001'])
  })

  it('nao enxerga saida de outro tenant', async () => {
    await inserirSaidaComItem(tenantB, produtoB, 'S-0002')
    const linhas = await withTenant(sql, tenantA, tx => tx`select numero from saidas`)
    expect(linhas.map(l => l.numero)).toEqual(['S-0001'])
  })

  it('rejeita numero duplicado no mesmo tenant', async () => {
    await expect(
      inserirSaidaComItem(tenantA, produtoA, 'S-0001'),
    ).rejects.toThrow()
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into saidas (tenant_id, numero, data_pedido)
        values (${tenantB}, 'S-invasor', '2026-08-01')`),
    ).rejects.toThrow()
  })

  it('permite o mesmo numero em tenants diferentes', async () => {
    await inserirSaidaComItem(tenantB, produtoB, 'S-0001')
    const linhas = await withTenant(sql, tenantB, tx => tx`select numero from saidas order by numero`)
    expect(linhas.map(l => l.numero)).toEqual(['S-0001', 'S-0002'])
  })

  it('rejeita status invalido (saidas_status_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into saidas (tenant_id, numero, data_pedido, status)
        values (${tenantA}, 'S-status', '2026-08-01', 'sei-la')`),
    ).rejects.toThrow()
  })

  it('rejeita perda_kg negativo no cabecalho (saidas_perda_kg_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into saidas (tenant_id, numero, data_pedido, perda_kg)
        values (${tenantA}, 'S-perda', '2026-08-01', -1)`),
    ).rejects.toThrow()
  })

  it('rejeita qtd negativa em saida_itens (saida_itens_qtd_check)', async () => {
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [saida] = await tx`
          insert into saidas (tenant_id, numero, data_pedido)
          values (${tenantA}, 'S-qtd-neg', '2026-08-01') returning id`
        await tx`
          insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
          values (${tenantA}, ${saida.id}, ${produtoA}, 'KG', -5, 1)`
      }),
    ).rejects.toThrow()
  })

  it('rejeita preco negativo em saida_itens (saida_itens_preco_check)', async () => {
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [saida] = await tx`
          insert into saidas (tenant_id, numero, data_pedido)
          values (${tenantA}, 'S-preco-neg', '2026-08-01') returning id`
        await tx`
          insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
          values (${tenantA}, ${saida.id}, ${produtoA}, 'KG', 5, -1)`
      }),
    ).rejects.toThrow()
  })

  it('produto_id de saida_itens e RESTRICT: nao deixa apagar um produto referenciado', async () => {
    const [prod] = await admin`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Produto Restrito') returning id`
    await inserirSaidaComItem(tenantA, prod.id, 'S-restrict')
    await expect(admin`delete from produtos where id = ${prod.id}`).rejects.toThrow()
  })

  it('saida_id de saida_itens e CASCADE: apagar a saida apaga os itens', async () => {
    const saida = await inserirSaidaComItem(tenantA, produtoA, 'S-cascade')
    const antes = await withTenant(sql, tenantA, tx => tx`
      select id from saida_itens where saida_id = ${saida.id}`)
    expect(antes.length).toBeGreaterThan(0)

    await withTenant(sql, tenantA, tx => tx`delete from saidas where id = ${saida.id}`)
    const depois = await withTenant(sql, tenantA, tx => tx`
      select id from saida_itens where saida_id = ${saida.id}`)
    expect(depois).toEqual([])
  })

  it('o driver devolve numeric como string — por isso paraJson existe', async () => {
    const saida = await inserirSaidaComItem(tenantA, produtoA, 'S-numeric', { perda_kg: 2.5 })
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select perda_kg from saidas where id = ${saida.id}`)
    expect(typeof linha.perda_kg).toBe('string')
    expect(Number(linha.perda_kg)).toBe(2.5)

    const [item] = await withTenant(sql, tenantA, tx => tx`
      select qtd, preco from saida_itens where saida_id = ${saida.id}`)
    expect(typeof item.qtd).toBe('string')
    expect(typeof item.preco).toBe('string')
  })
})
