import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  // Upsert em vez de select: este arquivo precisa rodar isolado, sem
  // depender de outro arquivo de teste ter criado os tenants antes.
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-produtos-a', 'Tenant Produtos A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-produtos-b', 'Tenant Produtos B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('produtos', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Banana Prata')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from produtos`)
    expect(linhas.map(l => l.nome)).toEqual(['Banana Prata'])
  })

  it('nao enxerga produto de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantB}, 'Banana Nanica')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from produtos`)
    expect(linhas.map(l => l.nome)).toEqual(['Banana Prata'])
  })

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into produtos (tenant_id, nome) values (${tenantA}, 'banana prata')`)
    ).rejects.toThrow()
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    // Mesma prova que clientes.test.ts ja faz — o molde declarado desta
    // rota. So porque a leitura respeita RLS nao significa que a escrita
    // tambem respeita: e o with check da policy que garante isso.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into produtos (tenant_id, nome) values (${tenantB}, 'Invasor via Produtos')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo nome em tenants diferentes', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantB}, 'Banana Prata')`)
    const linhas = await withTenant(sql, tenantB, tx => tx`select nome from produtos order by nome`)
    expect(linhas.map(l => l.nome)).toEqual(['Banana Nanica', 'Banana Prata'])
  })

  it('usa KG como unidade padrao quando omitida', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Produto Sem Unidade')`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select un from produtos where nome = 'Produto Sem Unidade'`)
    expect(linha.un).toBe('KG')
  })

  it('rejeita unidade invalida (produtos_un_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into produtos (tenant_id, nome, un) values (${tenantA}, 'Un Invalida', 'TON')`)
    ).rejects.toThrow()
  })

  it('rejeita peso_medio negativo (produtos_peso_medio_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into produtos (tenant_id, nome, peso_medio) values (${tenantA}, 'Peso Negativo', -1)`)
    ).rejects.toThrow()
  })

  it('o driver devolve numeric como string — por isso paraJson existe', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome, peso_medio) values (${tenantA}, 'Com Peso', 0.250)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select peso_medio from produtos where nome = 'Com Peso'`)
    // o driver devolve string — e por isso que paraJson existe
    expect(typeof linha.peso_medio).toBe('string')
    expect(Number(linha.peso_medio)).toBe(0.25)
  })
})
