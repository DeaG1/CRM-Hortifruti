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
    insert into tenants (slug, nome) values ('teste-fornecedores-a', 'Tenant Fornecedores A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-fornecedores-b', 'Tenant Fornecedores B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from fornecedor_produtos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from fornecedores where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('fornecedores', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantA}, 'Fazenda Boa Terra')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from fornecedores`)
    expect(linhas.map(l => l.nome)).toEqual(['Fazenda Boa Terra'])
  })

  it('nao enxerga fornecedor de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantB}, 'Fazenda Sol Nascente')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from fornecedores`)
    expect(linhas.map(l => l.nome)).toEqual(['Fazenda Boa Terra'])
  })

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into fornecedores (tenant_id, nome) values (${tenantA}, 'fazenda boa terra')`)
    ).rejects.toThrow()
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    // Mesma prova que clientes.test.ts ja faz — o molde declarado desta
    // rota. So porque a leitura respeita RLS nao significa que a escrita
    // tambem respeita: e o with check da policy que garante isso.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into fornecedores (tenant_id, nome) values (${tenantB}, 'Invasor via Fornecedores')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo nome em tenants diferentes', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantB}, 'Fazenda Boa Terra')`)
    const linhas = await withTenant(sql, tenantB, tx => tx`select nome from fornecedores order by nome`)
    expect(linhas.map(l => l.nome)).toEqual(['Fazenda Boa Terra', 'Fazenda Sol Nascente'])
  })
})

describe('fornecedor_produtos (relacao "quais produtos este fornecedor entrega")', () => {
  it('vincula produtos a um fornecedor dentro do tenant', async () => {
    const [fornecedor] = await withTenant(sql, tenantA, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantA}, 'Fazenda Vinculo') returning id`)
    const [produto] = await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Tomate Vinculo') returning id`)
    await withTenant(sql, tenantA, tx => tx`
      insert into fornecedor_produtos (tenant_id, fornecedor_id, produto_id)
      values (${tenantA}, ${fornecedor.id}, ${produto.id})`)

    const linhas = await withTenant(sql, tenantA, tx => tx`
      select p.nome from fornecedor_produtos fp
      join produtos p on p.id = fp.produto_id
      where fp.fornecedor_id = ${fornecedor.id}`)
    expect(linhas.map(l => l.nome)).toEqual(['Tomate Vinculo'])
  })

  it('nao enxerga vinculo de outro tenant', async () => {
    const [fornecedorB] = await withTenant(sql, tenantB, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantB}, 'Fazenda Vinculo B') returning id`)
    const [produtoB] = await withTenant(sql, tenantB, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantB}, 'Produto Vinculo B') returning id`)
    await withTenant(sql, tenantB, tx => tx`
      insert into fornecedor_produtos (tenant_id, fornecedor_id, produto_id)
      values (${tenantB}, ${fornecedorB.id}, ${produtoB.id})`)

    const linhas = await withTenant(sql, tenantA, tx => tx`
      select * from fornecedor_produtos where fornecedor_id = ${fornecedorB.id}`)
    expect(linhas).toEqual([])
  })

  it('nao permite gravar vinculo para outro tenant (with check da policy de escrita)', async () => {
    const [fornecedor] = await withTenant(sql, tenantA, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantA}, 'Fazenda Cross') returning id`)
    const [produto] = await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Produto Cross') returning id`)
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into fornecedor_produtos (tenant_id, fornecedor_id, produto_id)
        values (${tenantB}, ${fornecedor.id}, ${produto.id})`)
    ).rejects.toThrow()
  })

  it('apagar o fornecedor remove os vinculos (on delete cascade)', async () => {
    const [fornecedor] = await withTenant(sql, tenantA, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantA}, 'Fazenda Cascade') returning id`)
    const [produto] = await withTenant(sql, tenantA, tx => tx`
      insert into produtos (tenant_id, nome) values (${tenantA}, 'Produto Cascade') returning id`)
    await withTenant(sql, tenantA, tx => tx`
      insert into fornecedor_produtos (tenant_id, fornecedor_id, produto_id)
      values (${tenantA}, ${fornecedor.id}, ${produto.id})`)

    await withTenant(sql, tenantA, tx => tx`delete from fornecedores where id = ${fornecedor.id}`)

    const linhas = await withTenant(sql, tenantA, tx => tx`
      select * from fornecedor_produtos where fornecedor_id = ${fornecedor.id}`)
    expect(linhas).toEqual([])
  })
})
