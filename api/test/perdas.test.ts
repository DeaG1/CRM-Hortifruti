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
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-perdas-a', 'Perdas A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-perdas-b', 'Perdas B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from perdas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`

  const [pA] = await admin`insert into produtos (tenant_id, nome) values (${tenantA}, 'Alface') returning id`
  const [pB] = await admin`insert into produtos (tenant_id, nome) values (${tenantB}, 'Alface') returning id`
  produtoA = pA.id; produtoB = pB.id
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('perdas', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into perdas (tenant_id, data, produto_id, qtd, motivo)
      values (${tenantA}, '2026-01-10', ${produtoA}, 2, 'vencimento')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select motivo from perdas`)
    expect(linhas.map(l => l.motivo)).toEqual(['vencimento'])
  })

  it('nao enxerga perda de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into perdas (tenant_id, data, produto_id, qtd, motivo)
      values (${tenantB}, '2026-01-10', ${produtoB}, 1, 'armazenagem')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select motivo from perdas`)
    expect(linhas.map(l => l.motivo)).toEqual(['vencimento'])
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into perdas (tenant_id, data, produto_id, qtd)
        values (${tenantB}, '2026-01-10', ${produtoA}, 1)`)
    ).rejects.toThrow()
  })

  it('rejeita motivo invalido (perdas_motivo_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into perdas (tenant_id, data, produto_id, qtd, motivo)
        values (${tenantA}, '2026-01-10', ${produtoA}, 1, 'sei-la')`)
    ).rejects.toThrow()
  })

  it('rejeita qtd negativa (perdas_qtd_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into perdas (tenant_id, data, produto_id, qtd)
        values (${tenantA}, '2026-01-10', ${produtoA}, -3)`)
    ).rejects.toThrow()
  })

  it('rejeita produto_id inexistente (FK restrict)', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into perdas (tenant_id, data, produto_id, qtd)
        values (${tenantA}, '2026-01-10', ${idInexistente}, 1)`)
    ).rejects.toThrow()
  })

  it('rejeita produto de outro tenant (FK composta, id valido mas de fora)', async () => {
    // produtoB existe de verdade, mas pertence ao tenant B. Uma FK simples
    // (produto_id -> produtos(id)) nao pegaria isso, porque a checagem de FK
    // do Postgres roda com os privilegios do DONO da tabela referenciada e
    // ignora RLS. migration 010_fk_com_tenant.sql trocou por uma FK composta
    // — (tenant_id, produto_id) references produtos(tenant_id, id) — que
    // exige o par inteiro batendo. Mesma mecanica em entradas.test.ts.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into perdas (tenant_id, data, produto_id, qtd)
        values (${tenantA}, '2026-01-10', ${produtoB}, 1)`)
    ).rejects.toThrow()
  })

  it('usa o default de motivo quando nao informado', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into perdas (tenant_id, data, produto_id, qtd)
      values (${tenantA}, '2026-01-11', ${produtoA}, 1)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select motivo from perdas where data = '2026-01-11'`)
    expect(linha.motivo).toBe('não informado')
  })

  it('o driver devolve numeric como string — por isso paraJson existe', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into perdas (tenant_id, data, produto_id, qtd)
      values (${tenantA}, '2026-01-12', ${produtoA}, 4.25)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select qtd from perdas where data = '2026-01-12'`)
    expect(typeof linha.qtd).toBe('string')
    expect(Number(linha.qtd)).toBe(4.25)
  })
})
