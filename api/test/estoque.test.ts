import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { buscarEstoque } from '../src/routes/estoque'

// estoque.http.test.ts cobre a camada HTTP (autorizacao, forma do JSON,
// conversao numerica). Este arquivo cobre o calculo em si — direto contra
// `buscarEstoque`, a query que agrega entradas, perdas e saidas — porque e
// aqui que a regra que "nao pode quebrar em nenhuma alteracao futura"
// (saldo = entradas − perda na coleta − perdas de deposito − saidas) vive.

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string
let seq = 0

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-estoque-a', 'Tenant Estoque A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-estoque-b', 'Tenant Estoque B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  // Ordem por causa das FKs: saidas/entradas primeiro (cascade cuida dos
  // itens), perdas e produtos por ultimo.
  await admin`delete from saidas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from entradas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from perdas where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from produtos where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

async function criarProduto(
  tenantId: string, nome: string, opts: { un?: string; peso_medio?: number } = {},
): Promise<string> {
  const [p] = await withTenant(sql, tenantId, tx => tx`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, ${nome}, ${opts.un ?? 'KG'}, ${opts.peso_medio ?? 0})
    returning id`)
  return p.id as string
}

type ItemEntrada = { produto_id: string; un?: string; qtd: number; preco?: number; perda_kg?: number }

async function criarEntrada(tenantId: string, itens: ItemEntrada[]): Promise<string> {
  seq += 1
  const [e] = await withTenant(sql, tenantId, tx => tx`
    insert into entradas (tenant_id, numero, data) values (${tenantId}, ${'E-' + seq}, '2026-08-01')
    returning id`)
  for (const it of itens) {
    await withTenant(sql, tenantId, tx => tx`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco, perda_kg)
      values (${tenantId}, ${e.id}, ${it.produto_id}, ${it.un ?? 'KG'}, ${it.qtd}, ${it.preco ?? 1}, ${it.perda_kg ?? 0})`)
  }
  return e.id as string
}

async function criarPerda(tenantId: string, produtoId: string, qtd: number, un = 'KG'): Promise<void> {
  await withTenant(sql, tenantId, tx => tx`
    insert into perdas (tenant_id, data, produto_id, un, qtd)
    values (${tenantId}, '2026-08-02', ${produtoId}, ${un}, ${qtd})`)
}

type ItemSaida = { produto_id: string; un?: string; qtd: number; preco?: number }

async function criarSaida(tenantId: string, status: string, itens: ItemSaida[]): Promise<string> {
  seq += 1
  const [s] = await withTenant(sql, tenantId, tx => tx`
    insert into saidas (tenant_id, numero, data_pedido, status)
    values (${tenantId}, ${'S-' + seq}, '2026-08-03', ${status})
    returning id`)
  for (const it of itens) {
    await withTenant(sql, tenantId, tx => tx`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${s.id}, ${it.produto_id}, ${it.un ?? 'KG'}, ${it.qtd}, ${it.preco ?? 2})`)
  }
  return s.id as string
}

describe('buscarEstoque', () => {
  it('calcula saldo = entradas - perda na coleta - perdas de deposito - saidas, do mesmo produto', async () => {
    const produtoId = await criarProduto(tenantA, 'Tomate Saldo')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 100, perda_kg: 5 }])
    await criarPerda(tenantA, produtoId, 10)
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 30 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)
    expect(linha).toBeDefined()
    expect(Number(linha!.entrou)).toBe(100)
    // perda combina coleta (entrada_itens.perda_kg = 5) + deposito (perdas.qtd = 10)
    expect(Number(linha!.perda)).toBe(15)
    expect(Number(linha!.saiu)).toBe(30)
    const saldo = Number(linha!.entrou) - Number(linha!.perda) - Number(linha!.saiu)
    expect(saldo).toBe(55) // 100 - 15 - 30
  })

  it('saldo negativo quando saidas + perdas superam entradas', async () => {
    const produtoId = await criarProduto(tenantA, 'Alface Negativo')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 10 }])
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 25 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    const saldo = Number(linha.entrou) - Number(linha.perda) - Number(linha.saiu)
    expect(saldo).toBe(-15)
  })

  it('exclui saidas Canceladas e Devolvidas do total de saidas (mesmo filtro do prototipo)', async () => {
    const produtoId = await criarProduto(tenantA, 'Pepino Cancelado')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 50 }])
    await criarSaida(tenantA, 'Cancelado', [{ produto_id: produtoId, qtd: 999 }])
    await criarSaida(tenantA, 'Devolvido', [{ produto_id: produtoId, qtd: 999 }])
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 5 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(Number(linha.saiu)).toBe(5)
  })

  it('agrupa por produto E unidade — CX e KG do mesmo produto ficam em linhas separadas', async () => {
    const produtoId = await criarProduto(tenantA, 'Melancia Cx Kg', { un: 'CX', peso_medio: 12 })
    await criarEntrada(tenantA, [
      { produto_id: produtoId, un: 'CX', qtd: 10 },
      { produto_id: produtoId, un: 'KG', qtd: 20 },
    ])

    const linhas = await buscarEstoque(sql, tenantA)
    const doProduto = linhas.filter(l => l.produto_id === produtoId)
    expect(doProduto).toHaveLength(2)
    const cx = doProduto.find(l => l.un === 'CX')!
    const kg = doProduto.find(l => l.un === 'KG')!
    expect(Number(cx.entrou)).toBe(10)
    expect(Number(kg.entrou)).toBe(20)
  })

  it('isolamento entre tenants no agregado: nao ve movimentacao de outro tenant', async () => {
    const produtoA = await criarProduto(tenantA, 'Isolamento A')
    const produtoB = await criarProduto(tenantB, 'Isolamento B')
    await criarEntrada(tenantA, [{ produto_id: produtoA, qtd: 40 }])
    await criarEntrada(tenantB, [{ produto_id: produtoB, qtd: 999 }])

    const linhasA = await buscarEstoque(sql, tenantA)
    expect(linhasA.some(l => l.produto_id === produtoB)).toBe(false)
    const linhaA = linhasA.find(l => l.produto_id === produtoA)
    expect(linhaA).toBeDefined()
    expect(Number(linhaA!.entrou)).toBe(40)

    const linhasB = await buscarEstoque(sql, tenantB)
    expect(linhasB.some(l => l.produto_id === produtoA)).toBe(false)
  })

  it('produto sem nenhuma movimentacao nao aparece no resultado (fidelidade ao prototipo)', async () => {
    const produtoId = await criarProduto(tenantA, 'Produto Parado')
    const linhas = await buscarEstoque(sql, tenantA)
    expect(linhas.some(l => l.produto_id === produtoId)).toBe(false)
  })

  it('produto com perda de deposito mas sem NUNCA ter tido entrada ainda aparece (LEFT JOIN, nao INNER)', async () => {
    const produtoId = await criarProduto(tenantA, 'So Perda')
    await criarPerda(tenantA, produtoId, 3)

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)
    expect(linha).toBeDefined()
    expect(Number(linha!.entrou)).toBe(0)
    expect(Number(linha!.perda)).toBe(3)
    expect(Number(linha!.saiu)).toBe(0)
  })
})
