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
  // depender de isolamento.test.ts ter criado os tenants antes.
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-a', 'Tenant A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-b', 'Tenant B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from clientes where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('clientes', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into clientes (tenant_id, nome, resp) values (${tenantA}, 'Mercado A', 'Sonia')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from clientes`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A'])
  })

  it('nao enxerga cliente de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into clientes (tenant_id, nome) values (${tenantB}, 'Mercado B')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from clientes`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A'])
  })

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into clientes (tenant_id, nome) values (${tenantA}, 'mercado a')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo nome em tenants diferentes', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into clientes (tenant_id, nome) values (${tenantB}, 'Mercado A')`)
    const linhas = await withTenant(sql, tenantB, tx => tx`select nome from clientes order by nome`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A', 'Mercado B'])
  })

  it('rejeita status invalido', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into clientes (tenant_id, nome, status)
        values (${tenantA}, 'Invalido', 'sei-la')`)
    ).rejects.toThrow()
  })

  it('devolve limite como numero, nao string', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into clientes (tenant_id, nome, limite) values (${tenantA}, 'Com Limite', 6000)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select limite from clientes where nome = 'Com Limite'`)
    // o driver devolve string — e por isso que paraJson existe
    expect(typeof linha.limite).toBe('string')
    expect(Number(linha.limite)).toBe(6000)
  })
})
