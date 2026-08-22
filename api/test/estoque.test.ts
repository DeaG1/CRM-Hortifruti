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

/**
 * `opts.perda_kg`: perda no CABECALHO da entrada (entradas.perda_kg,
 * distinta de `it.perda_kg` em cada item) — opcional, default 0 (mesmo
 * default do banco), pra nao quebrar os testes que ja existiam antes da
 * correcao de dupla contagem (ver comentario em buscarEstoque/estoque.ts).
 */
async function criarEntrada(
  tenantId: string, itens: ItemEntrada[], opts: { perda_kg?: number } = {},
): Promise<string> {
  seq += 1
  const [e] = await withTenant(sql, tenantId, tx => tx`
    insert into entradas (tenant_id, numero, data, perda_kg)
    values (${tenantId}, ${'E-' + seq}, '2026-08-01', ${opts.perda_kg ?? 0})
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

type ItemSaida = { produto_id: string; un?: string; qtd: number; preco?: number; perda_kg?: number }

async function criarSaida(tenantId: string, status: string, itens: ItemSaida[]): Promise<string> {
  seq += 1
  const [s] = await withTenant(sql, tenantId, tx => tx`
    insert into saidas (tenant_id, numero, data_pedido, status)
    values (${tenantId}, ${'S-' + seq}, '2026-08-03', ${status})
    returning id`)
  for (const it of itens) {
    await withTenant(sql, tenantId, tx => tx`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco, perda_kg)
      values (${tenantId}, ${s.id}, ${it.produto_id}, ${it.un ?? 'KG'}, ${it.qtd}, ${it.preco ?? 2}, ${it.perda_kg ?? 0})`)
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

  // ---- correcao autorizada pelo cliente: as duas perdas que o prototipo
  // nunca descontava (entradas.perda_kg no cabecalho, saida_itens.perda_kg)
  // — ver o comentario grande em buscarEstoque/estoque.ts para o raciocinio
  // completo, inclusive por que coleta usa MAX em vez de SOMA.

  it('perda no cabecalho da entrada (entradas.perda_kg) desconta do saldo quando os itens nao cobrem o total', async () => {
    const produtoId = await criarProduto(tenantA, 'Manga Cabecalho')
    // cabecalho=8, item nao registra nenhuma perda propria: os 8kg do
    // cabecalho sao uma perda real (de transporte) que os itens ainda nao
    // mostram, e o unico item da entrada fica com a totalidade dela.
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 100, perda_kg: 0 }], { perda_kg: 8 })

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(Number(linha.entrou)).toBe(100)
    expect(Number(linha.perda)).toBe(8)
    const saldo = Number(linha.entrou) - Number(linha.perda) - Number(linha.saiu)
    expect(saldo).toBe(92)
  })

  it('dupla contagem: cabecalho igual a soma dos itens NAO soma os dois (usa o maior, nao a soma)', async () => {
    const produtoA = await criarProduto(tenantA, 'Batata Dupla Contagem')
    const produtoB = await criarProduto(tenantA, 'Cebola Dupla Contagem')
    // Mesmo padrao do prototipo (saveDraft): cabecalho == soma dos itens
    // (85 + 55 = 140) — as DUAS colunas descrevem o MESMO evento de perda,
    // so em granularidades diferentes. Somar daria 280 (perda inflada,
    // saldo menor que a realidade); a correcao usa 140.
    await criarEntrada(tenantA, [
      { produto_id: produtoA, qtd: 1500, perda_kg: 85 },
      { produto_id: produtoB, qtd: 750, perda_kg: 55 },
    ], { perda_kg: 140 })

    const linhas = await buscarEstoque(sql, tenantA)
    const linhaA = linhas.find(l => l.produto_id === produtoA)!
    const linhaB = linhas.find(l => l.produto_id === produtoB)!
    // Cabecalho nao acrescenta nada: cada item fica exatamente com a perda
    // que ele mesmo registrou.
    expect(Number(linhaA.perda)).toBe(85)
    expect(Number(linhaB.perda)).toBe(55)
    // E o total bate com o cabecalho (140), nunca com a soma dos dois (280).
    expect(Number(linhaA.perda) + Number(linhaB.perda)).toBe(140)
  })

  it('cabecalho maior que a soma dos itens: a diferenca e rateada proporcional ao peso (qtd) de cada item', async () => {
    const produtoA = await criarProduto(tenantA, 'Alface Rateio')
    const produtoB = await criarProduto(tenantA, 'Tomate Rateio')
    // Nenhum item registrou perda propria, so o cabecalho (200kg) — o caso
    // mais provavel no dia a dia (colaborador so preenche o total do
    // transporte, sem detalhar por produto). Qtd total = 2000 (1500+500);
    // produtoA leva 75% do peso, produtoB 25%.
    await criarEntrada(tenantA, [
      { produto_id: produtoA, qtd: 1500, perda_kg: 0 },
      { produto_id: produtoB, qtd: 500, perda_kg: 0 },
    ], { perda_kg: 200 })

    const linhas = await buscarEstoque(sql, tenantA)
    const linhaA = linhas.find(l => l.produto_id === produtoA)!
    const linhaB = linhas.find(l => l.produto_id === produtoB)!
    expect(Number(linhaA.perda)).toBe(150) // 200 * 1500/2000
    expect(Number(linhaB.perda)).toBe(50)  // 200 * 500/2000
    expect(Number(linhaA.perda) + Number(linhaB.perda)).toBe(200)
  })

  it('entrada com todos os itens em qtd=0 nao quebra o rateio (divisao por zero evitada)', async () => {
    const produtoId = await criarProduto(tenantA, 'Zero Qtd')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 0, perda_kg: 0 }], { perda_kg: 50 })

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    // Sem peso nenhum pra ratear, o excedente do cabecalho fica sem
    // atribuicao (limitacao documentada em buscarEstoque) — o importante
    // aqui e nao lancar erro de divisao por zero.
    expect(Number(linha.perda)).toBe(0)
  })

  it('perda no item da saida (saida_itens.perda_kg) desconta do saldo, alem da qtd que saiu', async () => {
    const produtoId = await criarProduto(tenantA, 'Manga Entrega')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 100 }])
    // qtd=20 chegou ao cliente (faturado), perda_kg=5 saiu do deposito mas
    // nao chegou — as duas juntas saem do deposito, nao so a qtd.
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 20, perda_kg: 5 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(Number(linha.saiu)).toBe(20)
    expect(Number(linha.perda)).toBe(5)
    const saldo = Number(linha.entrou) - Number(linha.perda) - Number(linha.saiu)
    expect(saldo).toBe(75) // 100 - 5 - 20
  })

  it('perda no item de uma saida Cancelada/Devolvida nao conta (mesmo filtro de status do "saiu")', async () => {
    const produtoId = await criarProduto(tenantA, 'Manga Cancelada')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 100 }])
    await criarSaida(tenantA, 'Cancelado', [{ produto_id: produtoId, qtd: 999, perda_kg: 999 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(Number(linha.saiu)).toBe(0)
    expect(Number(linha.perda)).toBe(0)
  })
})
