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
  // depender de outro arquivo ter criado os tenants antes.
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-entradas-a', 'Entradas A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-entradas-b', 'Entradas B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  // Ordem por causa das FKs: entrada_itens antes de entradas (o cascade de
  // entradas cobriria sozinho, mas fica explicito), entradas antes de
  // produtos (produto_id e ON DELETE RESTRICT).
  await admin`delete from entrada_itens where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from entradas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`

  const [pA] = await admin`insert into produtos (tenant_id, nome) values (${tenantA}, 'Tomate') returning id`
  const [pB] = await admin`insert into produtos (tenant_id, nome) values (${tenantB}, 'Tomate') returning id`
  produtoA = pA.id; produtoB = pB.id
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('entradas', () => {
  it('cria entrada com item e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, async (tx) => {
      const [entrada] = await tx`
        insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-1', '2026-01-10') returning id`
      await tx`
        insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
        values (${tenantA}, ${entrada.id}, ${produtoA}, 10, 2.5)`
    })
    const linhas = await withTenant(sql, tenantA, tx => tx`select numero from entradas`)
    expect(linhas.map(l => l.numero)).toEqual(['E-1'])
  })

  it('nao enxerga entrada de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into entradas (tenant_id, numero, data) values (${tenantB}, 'E-1', '2026-01-10')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select numero from entradas`)
    expect(linhas.map(l => l.numero)).toEqual(['E-1'])
  })

  it('rejeita numero duplicado no mesmo tenant', async () => {
    // Diferente de clientes (unique index em lower(nome)), a unicidade de
    // `numero` em entradas e case-sensitive (migration 009: unique index
    // sem lower()) — por isso o duplicado aqui usa a mesma capitalizacao.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-1', '2026-01-11')`)
    ).rejects.toThrow()
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    // Mesma prova que clientes.test.ts ja faz — o molde declarado desta
    // rota. Confirma que a policy de escrita tambem protege `entradas`.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into entradas (tenant_id, numero, data) values (${tenantB}, 'Invasor', '2026-01-10')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo numero em tenants diferentes', async () => {
    // tenantA e tenantB ja tem, cada um, uma entrada 'E-1' dos testes
    // anteriores — a unicidade e por (tenant_id, numero), nao por numero
    // sozinho.
    const linhasA = await withTenant(sql, tenantA, tx => tx`select numero from entradas`)
    const linhasB = await withTenant(sql, tenantB, tx => tx`select numero from entradas`)
    expect(linhasA.map(l => l.numero)).toEqual(['E-1'])
    expect(linhasB.map(l => l.numero)).toEqual(['E-1'])
  })

  it('rejeita pago invalido (entradas_pago_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into entradas (tenant_id, numero, data, pago)
        values (${tenantA}, 'E-Pago-Ruim', '2026-01-10', 'sei-la')`)
    ).rejects.toThrow()
  })

  it('rejeita perda_kg negativo no cabecalho (entradas_perda_kg_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into entradas (tenant_id, numero, data, perda_kg)
        values (${tenantA}, 'E-Perda-Ruim', '2026-01-10', -1)`)
    ).rejects.toThrow()
  })

  // Nas quatro provas abaixo, o insert que deve falhar e o SEGUNDO statement
  // de uma mesma transacao (cabecalho antes, item depois) — por isso todo o
  // `withTenant(...)` entra dentro do `expect(...).rejects.toThrow()`, e nao
  // so o insert do item. Um `await expect(tx\`...\`).rejects.toThrow()` DE
  // DENTRO do callback consome a rejeicao ali mesmo; o callback entao
  // resolve normalmente e `sql.begin()` tenta um COMMIT que o Postgres
  // recusa (a transacao ja estava abortada pelo insert que falhou) — o erro
  // reaparece, sem tratamento, num ponto que o teste nao esperava. Isso nao
  // e um detalhe de teste: e a mesma mecanica de atomicidade que as rotas
  // (entradas.ts) dependem para garantir que cabecalho+itens nunca ficam
  // gravados pela metade.
  it('rejeita qtd negativa num item (entrada_itens_qtd_check)', async () => {
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [entrada] = await tx`
          insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-Item-Qtd', '2026-01-10') returning id`
        await tx`insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
           values (${tenantA}, ${entrada.id}, ${produtoA}, -5, 2.5)`
      }),
    ).rejects.toThrow()
  })

  it('rejeita preco negativo num item (entrada_itens_preco_check)', async () => {
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [entrada] = await tx`
          insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-Item-Preco', '2026-01-10') returning id`
        await tx`insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
           values (${tenantA}, ${entrada.id}, ${produtoA}, 5, -2.5)`
      }),
    ).rejects.toThrow()
  })

  it('rejeita item com produto_id inexistente (FK restrict)', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [entrada] = await tx`
          insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-Item-FK', '2026-01-10') returning id`
        await tx`insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
           values (${tenantA}, ${entrada.id}, ${idInexistente}, 5, 2.5)`
      }),
    ).rejects.toThrow()
  })

  it('rejeita item apontando pra produto de outro tenant (FK composta, id valido mas de fora)', async () => {
    // produtoB existe de verdade no banco, mas pertence ao tenant B. Uma FK
    // simples (produto_id -> produtos(id)) NAO pegaria isso — a checagem de
    // FK do Postgres roda com os privilegios do DONO da tabela referenciada,
    // nao do role da sessao, entao ignora a RLS e so confirma que o id
    // existe em algum tenant. migration 010_fk_com_tenant.sql fechou esse
    // furo trocando por uma FK composta: (tenant_id, produto_id) references
    // produtos(tenant_id, id) — agora o par inteiro precisa bater.
    await expect(
      withTenant(sql, tenantA, async (tx) => {
        const [entrada] = await tx`
          insert into entradas (tenant_id, numero, data) values (${tenantA}, 'E-Item-Cross', '2026-01-10') returning id`
        await tx`insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
           values (${tenantA}, ${entrada.id}, ${produtoB}, 5, 2.5)`
      }),
    ).rejects.toThrow()
  })

  it('o driver devolve numeric como string — por isso paraJson existe (cabecalho e item)', async () => {
    await withTenant(sql, tenantA, async (tx) => {
      const [entrada] = await tx`
        insert into entradas (tenant_id, numero, data, perda_kg)
        values (${tenantA}, 'E-Numeric', '2026-01-10', 1.5) returning id`
      await tx`insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco)
        values (${tenantA}, ${entrada.id}, ${produtoA}, 3.25, 9.9)`
    })
    const [entrada] = await withTenant(sql, tenantA, tx => tx`
      select perda_kg from entradas where numero = 'E-Numeric'`)
    expect(typeof entrada.perda_kg).toBe('string')
    expect(Number(entrada.perda_kg)).toBe(1.5)

    const [item] = await withTenant(sql, tenantA, tx => tx`
      select qtd, preco from entrada_itens i
      join entradas e on e.id = i.entrada_id
      where e.numero = 'E-Numeric'`)
    expect(typeof item.qtd).toBe('string')
    expect(Number(item.qtd)).toBe(3.25)
    expect(typeof item.preco).toBe('string')
    expect(Number(item.preco)).toBe(9.9)
  })
})
