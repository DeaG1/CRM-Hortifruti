import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string
let tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-a', 'Tenant A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-b', 'Tenant B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from usuarios where tenant_id in (${tenantA}, ${tenantB})`
  await admin`insert into usuarios (tenant_id, email, senha_hash, nome, papel)
              values (${tenantA}, 'a@teste.com', 'x', 'Usuario A', 'admin')`
  await admin`insert into usuarios (tenant_id, email, senha_hash, nome, papel)
              values (${tenantB}, 'b@teste.com', 'x', 'Usuario B', 'admin')`

  sql = criarPool(URL)
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('isolamento por RLS', () => {
  it('tenant A nao enxerga usuarios do tenant B', async () => {
    const linhas = await withTenant(sql, tenantA, tx => tx`select email from usuarios`)
    expect(linhas.map(l => l.email)).toEqual(['a@teste.com'])
  })

  it('sem tenant definido, nada e visivel', async () => {
    const linhas = await sql`select email from usuarios`
    expect(linhas).toHaveLength(0)
  })

  it('nao permite gravar para outro tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into usuarios (tenant_id, email, senha_hash, nome, papel)
        values (${tenantB}, 'invasor@teste.com', 'x', 'Invasor', 'admin')`)
    ).rejects.toThrow()
  })

  it('o tenant nao vaza entre transacoes na mesma conexao', async () => {
    await withTenant(sql, tenantA, tx => tx`select 1`)
    const linhas = await sql`select email from usuarios`
    expect(linhas).toHaveLength(0)
  })
})
