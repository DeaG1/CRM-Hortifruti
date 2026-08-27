import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import {
  buscarEstoque,
  paraJson,
  buscarMovimentacoesEstoque,
  paraJsonMovimentacao,
  LIMITE_HISTORICO,
} from '../src/routes/estoque'

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
  tenantId: string, itens: ItemEntrada[], opts: { perda_kg?: number; data?: string; id?: string } = {},
): Promise<string> {
  seq += 1
  const [e] = await withTenant(sql, tenantId, tx => tx`
    insert into entradas (tenant_id, id, numero, data, perda_kg)
    values (${tenantId}, ${opts.id ?? sql`gen_random_uuid()`}, ${'E-' + seq},
            ${opts.data ?? '2026-08-01'}, ${opts.perda_kg ?? 0})
    returning id`)
  for (const it of itens) {
    await withTenant(sql, tenantId, tx => tx`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco, perda_kg)
      values (${tenantId}, ${e.id}, ${it.produto_id}, ${it.un ?? 'KG'}, ${it.qtd}, ${it.preco ?? 1}, ${it.perda_kg ?? 0})`)
  }
  return e.id as string
}

async function criarPerda(
  tenantId: string, produtoId: string, qtd: number, un = 'KG', data = '2026-08-02',
): Promise<void> {
  await withTenant(sql, tenantId, tx => tx`
    insert into perdas (tenant_id, data, produto_id, un, qtd)
    values (${tenantId}, ${data}, ${produtoId}, ${un}, ${qtd})`)
}

type ItemSaida = { produto_id: string; un?: string; qtd: number; preco?: number; perda_kg?: number }

/**
 * `opts.entrega` fica NULL por padrao — e o que os testes anteriores a esta
 * mudanca ja gravavam, e o que a API grava quando o formulario nao preenche
 * a entrega. As datas de movimentacao sao testadas passando as DUAS
 * (data_pedido e entrega) com valores diferentes: sem isso, nenhum teste
 * provaria qual das duas a query escolheu.
 */
async function criarSaida(
  tenantId: string,
  status: string,
  itens: ItemSaida[],
  opts: { data_pedido?: string; entrega?: string | null } = {},
): Promise<string> {
  seq += 1
  const [s] = await withTenant(sql, tenantId, tx => tx`
    insert into saidas (tenant_id, numero, data_pedido, entrega, status)
    values (${tenantId}, ${'S-' + seq}, ${opts.data_pedido ?? '2026-08-03'},
            ${opts.entrega ?? null}, ${status})
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
    // As duas linhas continuam separadas (a chave e produto+unidade lancada),
    // mas as quantidades das DUAS saem em kg: 10 CX de 12 kg = 120.
    expect(Number(cx.entrou)).toBe(120)
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

  // ---- tudo em kg: cada parcela convertida pela regra da SUA unidade
  // (ver o comentario "tudo em kg desde a origem" em estoque.ts). Antes
  // desta correcao `entrou`/`saiu` ficavam na unidade do item, `perda`
  // somava kg (coleta e entrega) com a unidade da perda de deposito na mesma
  // coluna, e `equivalente_kg` multiplicava o bolo inteiro por peso_medio —
  // convertendo DE NOVO o que ja era kg.

  it('produto so em KG: a conversao e no-op, os numeros sao os mesmos de antes', async () => {
    const produtoId = await criarProduto(tenantA, 'Batata So Kg', { un: 'KG', peso_medio: 0 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'KG', qtd: 100, perda_kg: 5 }])
    await criarPerda(tenantA, produtoId, 10, 'KG')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, un: 'KG', qtd: 30, perda_kg: 2 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const l = linhas.find(x => x.produto_id === produtoId)!
    expect(Number(l.entrou)).toBe(100)
    expect(Number(l.perda)).toBe(17) // 5 coleta + 10 deposito + 2 entrega
    expect(Number(l.saiu)).toBe(30)
    expect(Number(l.itens_sem_conversao)).toBe(0)
  })

  it('produto em CX com peso_medio: entrou e saiu convertem, as duas perda_kg (kg por contrato) nao', async () => {
    const produtoId = await criarProduto(tenantA, 'Melancia Convertida', { un: 'CX', peso_medio: 10 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 10, perda_kg: 3 }])
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, un: 'CX', qtd: 4, perda_kg: 2 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const l = linhas.find(x => x.produto_id === produtoId)!
    expect(Number(l.entrou)).toBe(100) // 10 CX * 10 kg — nao 10
    expect(Number(l.saiu)).toBe(40)    // 4 CX * 10 kg — nao 4
    // perda_kg do item de entrada e do item de saida sao KG para item de
    // QUALQUER unidade: 3 + 2 = 5, jamais 5 * 10.
    expect(Number(l.perda)).toBe(5)
    expect(Number(l.entrou) - Number(l.perda) - Number(l.saiu)).toBe(55)
    expect(Number(l.itens_sem_conversao)).toBe(0)
  })

  it('produto em CX SEM peso_medio: as quantidades ficam de fora (fator ausente nao vira 1) e sao contadas', async () => {
    const produtoId = await criarProduto(tenantA, 'Caixa Sem Fator', { un: 'CX', peso_medio: 0 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 10, perda_kg: 3 }])
    await criarPerda(tenantA, produtoId, 2, 'CX')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, un: 'CX', qtd: 4, perda_kg: 1 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const l = linhas.find(x => x.produto_id === produtoId)!
    // Uma caixa nao pesa um quilo: sem fator, nada de qtd entra na conta.
    expect(Number(l.entrou)).toBe(0)
    expect(Number(l.saiu)).toBe(0)
    // Sobram so as parcelas que ja eram kg por contrato (coleta + entrega).
    expect(Number(l.perda)).toBe(4)
    // Um por lancamento fora: item de entrada, perda de deposito e item de saida.
    expect(Number(l.itens_sem_conversao)).toBe(3)
  })

  it('perda de deposito converte pela unidade DA PERDA, nao pela do item de entrada', async () => {
    const produtoId = await criarProduto(tenantA, 'Alface Perda Unidade', { un: 'CX', peso_medio: 8 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 10, perda_kg: 0 }])
    await criarPerda(tenantA, produtoId, 4, 'CX')  // 4 caixas = 32 kg
    await criarPerda(tenantA, produtoId, 11, 'KG') // 11 quilos = 11 kg, nao 88

    const linhas = await buscarEstoque(sql, tenantA)
    const cx = linhas.find(x => x.produto_id === produtoId && x.un === 'CX')!
    const kg = linhas.find(x => x.produto_id === produtoId && x.un === 'KG')!
    expect(Number(cx.perda)).toBe(32)
    expect(Number(kg.perda)).toBe(11)
    expect(Number(kg.entrou)).toBe(0)
  })

  it('o caso medido: 11 kg de coleta + 4 CX de 8 kg = 43 kg de perda, nao 15 nem 120', async () => {
    const produtoId = await criarProduto(tenantA, 'Alface Medida', { un: 'CX', peso_medio: 8 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 90, perda_kg: 6 }])
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 75, perda_kg: 5 }])
    await criarPerda(tenantA, produtoId, 4, 'CX')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, un: 'CX', qtd: 150 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const l = linhas.find(x => x.produto_id === produtoId)!
    // 15 era a soma de tres unidades diferentes na mesma coluna; 120 era
    // esse 15 multiplicado por 8, convertendo de novo os 11 kg de coleta.
    expect(Number(l.perda)).toBe(43)
    expect(Number(l.entrou)).toBe(1320) // 165 CX * 8
    expect(Number(l.saiu)).toBe(1200)   // 150 CX * 8
    // O dano operacional: a tela dizia 0 (nao ha alface na camara fria).
    expect(Number(l.entrou) - Number(l.perda) - Number(l.saiu)).toBe(77)
  })

  it('itens_sem_conversao e count() — bigint no Postgres, numero na borda (paraJson)', async () => {
    const produtoId = await criarProduto(tenantA, 'Bigint Contador', { un: 'CX', peso_medio: 0 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 7 }])

    const linhas = await buscarEstoque(sql, tenantA)
    const crua = linhas.find(x => x.produto_id === produtoId)!
    expect(typeof crua.itens_sem_conversao).toBe('string')
    expect(paraJson(crua).itens_sem_conversao).toBe(1)
  })
})

// ============================================================ movimentacao
//
// "Quanto tem" a tela ja dizia; estas duas suites cobrem "quando mexeu".
// As datas da ULTIMA movimentacao saem dos mesmos `max(...)` das CTEs de
// buscarEstoque (sem consulta nova); o HISTORICO por item sai de
// buscarMovimentacoesEstoque, uma consulta so para a tela inteira.

describe('buscarEstoque — datas da ultima movimentacao', () => {
  it('traz a data mais recente de cada fonte, cada uma da sua propria CTE', async () => {
    const produtoId = await criarProduto(tenantA, 'Cenoura Datas')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 50 }], { data: '2026-06-01' })
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 30 }], { data: '2026-06-09' })
    await criarPerda(tenantA, produtoId, 4, 'KG', '2026-06-11')
    await criarPerda(tenantA, produtoId, 2, 'KG', '2026-06-03')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 10 }], { entrega: '2026-06-14' })
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 5 }], { entrega: '2026-06-07' })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(l.ultima_entrada).toBe('2026-06-09')
    expect(l.ultima_perda).toBe('2026-06-11')
    expect(l.ultima_saida).toBe('2026-06-14')
  })

  it('a data da saida e a ENTREGA, nao a data_pedido (as duas diferentes de proposito)', async () => {
    const produtoId = await criarProduto(tenantA, 'Batata Entrega')
    // Pedido lancado em julho, entregue em setembro: as duas datas existem e
    // sao diferentes — sem isso o teste nao provaria qual delas foi escolhida.
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 12 }], {
      data_pedido: '2026-07-02', entrega: '2026-09-20',
    })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(l.ultima_saida).toBe('2026-09-20')
    expect(l.ultima_saida).not.toBe('2026-07-02')
  })

  it('saida sem entrega registrada nao vira data — e nao cai para data_pedido', async () => {
    const produtoId = await criarProduto(tenantA, 'Cebola Sem Entrega')
    await criarSaida(tenantA, 'Em rota', [{ produto_id: produtoId, qtd: 8 }], {
      data_pedido: '2026-07-05', entrega: null,
    })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    // A QUANTIDADE continua descontada (so Cancelado/Devolvido sai da conta)...
    expect(Number(l.saiu)).toBe(8)
    // ...mas QUANDO ela saiu ninguem registrou, e isso se diz com travessao.
    expect(l.ultima_saida).toBeNull()
  })

  it('saida Cancelada/Devolvida nao produz data (mesmo filtro de status da quantidade)', async () => {
    const produtoId = await criarProduto(tenantA, 'Abobrinha Cancelada')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 3 }], { entrega: '2026-08-05' })
    await criarSaida(tenantA, 'Cancelado', [{ produto_id: produtoId, qtd: 3 }], { entrega: '2026-09-30' })
    await criarSaida(tenantA, 'Devolvido', [{ produto_id: produtoId, qtd: 3 }], { entrega: '2026-10-30' })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    // Sem o filtro herdado, a tela diria "saiu em 30/10" de mercadoria que
    // nunca saiu do deposito.
    expect(l.ultima_saida).toBe('2026-08-05')
  })

  it('item so com entrada: as outras duas datas ficam null (nunca a data da entrada)', async () => {
    const produtoId = await criarProduto(tenantA, 'Manga So Entrada')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 20 }], { data: '2026-05-04' })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(l.ultima_entrada).toBe('2026-05-04')
    expect(l.ultima_saida).toBeNull()
    expect(l.ultima_perda).toBeNull()
  })

  it('item so com perda de deposito: a perda e a movimentacao, e a data e dela', async () => {
    const produtoId = await criarProduto(tenantA, 'Uva So Perda')
    await criarPerda(tenantA, produtoId, 12, 'KG', '2026-05-19')

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(l.ultima_perda).toBe('2026-05-19')
    expect(l.ultima_entrada).toBeNull()
    expect(l.ultima_saida).toBeNull()
  })

  it('linha sem NENHUMA data: as tres saem null — nunca hoje, nunca a epoch', async () => {
    const produtoId = await criarProduto(tenantA, 'Pera Sem Data')
    await criarSaida(tenantA, 'Pendente', [{ produto_id: produtoId, qtd: 6 }], { entrega: null })

    const l = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(l.ultima_entrada).toBeNull()
    expect(l.ultima_saida).toBeNull()
    expect(l.ultima_perda).toBeNull()
    // E o null atravessa a borda: nenhuma das tres pode ganhar um default no
    // paraJson — nem 'hoje' (que diria que o item acabou de mexer), nem a
    // epoch (que o front formataria como 01/01, uma data que ninguem viveu).
    const json = paraJson(l)
    expect(json.ultima_entrada).toBeNull()
    expect(json.ultima_saida).toBeNull()
    expect(json.ultima_perda).toBeNull()
    const hoje = new Date().toISOString().slice(0, 10)
    const todas = [json.ultima_entrada, json.ultima_saida, json.ultima_perda]
    expect(todas).not.toContain(hoje)
    expect(todas).not.toContain('1970-01-01')
  })

  it('as datas saem como texto AAAA-MM-DD, nao como Date (to_char, sem fuso no caminho)', async () => {
    const produtoId = await criarProduto(tenantA, 'Limao Texto')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 5 }], { data: '2026-01-01' })

    const crua = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === produtoId)!
    expect(typeof crua.ultima_entrada).toBe('string')
    // Um `Date` serializado pelo Hono viraria '2026-01-01T00:00:00.000Z' e,
    // em fuso positivo, '2025-12-31' na volta.
    expect(crua.ultima_entrada).toBe('2026-01-01')
    expect(paraJson(crua).ultima_entrada).toBe('2026-01-01')
    expect(paraJson(crua).ultima_saida).toBeNull()
  })

  it('isolamento entre tenants: a data de um tenant nao vaza para o outro', async () => {
    const pA = await criarProduto(tenantA, 'Repolho Iso Data')
    const pB = await criarProduto(tenantB, 'Repolho Iso Data')
    await criarEntrada(tenantA, [{ produto_id: pA, qtd: 10 }], { data: '2026-04-01' })
    await criarEntrada(tenantB, [{ produto_id: pB, qtd: 10 }], { data: '2026-04-25' })

    const a = (await buscarEstoque(sql, tenantA)).find(x => x.produto_id === pA)!
    const b = (await buscarEstoque(sql, tenantB)).find(x => x.produto_id === pB)!
    expect(a.ultima_entrada).toBe('2026-04-01')
    expect(b.ultima_entrada).toBe('2026-04-25')
  })
})

describe('buscarMovimentacoesEstoque', () => {
  it('lista entrada, saida e perda do item, da mais recente para a mais antiga', async () => {
    const produtoId = await criarProduto(tenantA, 'Tomate Historico')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 100 }], { data: '2026-03-01' })
    await criarPerda(tenantA, produtoId, 5, 'KG', '2026-03-05')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 40 }], { entrega: '2026-03-09' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs.map(m => [m.tipo, m.data])).toEqual([
      ['saida', '2026-03-09'],
      ['perda', '2026-03-05'],
      ['entrada', '2026-03-01'],
    ])
  })

  it('perda aparece com tipo proprio — nunca disfarcada de saida', async () => {
    const produtoId = await criarProduto(tenantA, 'Alface Perda Tipo')
    await criarPerda(tenantA, produtoId, 12, 'KG', '2026-03-20')

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs).toHaveLength(1)
    expect(movs[0].tipo).toBe('perda')
    expect(Number(movs[0].qtd_kg)).toBe(12)
  })

  it('a data da saida no historico e a entrega, nao a data_pedido', async () => {
    const produtoId = await criarProduto(tenantA, 'Beterraba Hist Entrega')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 7 }], {
      data_pedido: '2026-02-02', entrega: '2026-02-27',
    })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs.map(m => m.data)).toEqual(['2026-02-27'])
  })

  it('saida Cancelada/Devolvida fica fora do historico', async () => {
    const produtoId = await criarProduto(tenantA, 'Couve Hist Cancelada')
    await criarSaida(tenantA, 'Entregue', [{ produto_id: produtoId, qtd: 2 }], { entrega: '2026-02-10' })
    await criarSaida(tenantA, 'Cancelado', [{ produto_id: produtoId, qtd: 2 }], { entrega: '2026-02-20' })
    await criarSaida(tenantA, 'Devolvido', [{ produto_id: produtoId, qtd: 2 }], { entrega: '2026-02-25' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs.map(m => m.data)).toEqual(['2026-02-10'])
  })

  it('saida sem entrega fica fora do historico (nao ha data para listar nem para ordenar)', async () => {
    const produtoId = await criarProduto(tenantA, 'Pimentao Hist Sem Entrega')
    await criarSaida(tenantA, 'Em rota', [{ produto_id: produtoId, qtd: 9 }], {
      data_pedido: '2026-02-14', entrega: null,
    })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs).toHaveLength(0)
  })

  // Duas movimentacoes no mesmo dia sao comuns (o fornecedor que entrega de
  // manha e de tarde; a mesma rota com duas saidas) e sem desempate explicito
  // a ordem fica por conta do plano de execucao, podendo variar entre
  // carregamentos — o defeito que f8e2954 corrigiu em derive/fornecedores.ts.
  //
  // Os dois testes abaixo sao DETERMINISTICOS de proposito: os ids sao
  // escolhidos a mao para que a ordem por `id desc` CONTRADIGA a ordem
  // esperada. Com uuid aleatorio, um desempate quebrado passaria por sorte
  // metade das vezes, e o teste nao provaria nada.
  const ID_MENOR = '00000000-0000-4000-8000-000000000001'
  const ID_MAIOR = 'ffffffff-0000-4000-8000-000000000002'

  it('empate no mesmo dia: criado_em desempata — a registrada depois vem primeiro', async () => {
    const produtoId = await criarProduto(tenantA, 'Mandioca Empate')
    // Gravada PRIMEIRO, com o id MAIOR: por `id desc` viria na frente, por
    // `criado_em desc` vem atras. A ordem certa e a segunda.
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 10 }], { data: '2026-01-15', id: ID_MAIOR })
    const numeroDoPrimeiro = 'E-' + seq
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 20 }], { data: '2026-01-15', id: ID_MENOR })
    const numeroDoSegundo = 'E-' + seq

    const uma = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    const outra = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(uma.map(m => m.referencia)).toEqual([numeroDoSegundo, numeroDoPrimeiro])
    // E a ordem e a MESMA nos dois carregamentos: estavel, nao sorteada.
    expect(outra.map(m => m.referencia)).toEqual(uma.map(m => m.referencia))
  })

  it('empate ate no criado_em (mesma entrada): o id do item fecha a ordem, sem sobrar sorteio', async () => {
    const produtoId = await criarProduto(tenantA, 'Inhame Empate Total')
    const entradaId = '00000000-0000-4000-8000-0000000000e1'
    // Cinco itens da MESMA entrada: mesma data e mesmo criado_em (a entrada e
    // uma so), entao nada alem do id do item pode desempatar. Os ids sao
    // crescentes e a qtd identifica cada um; inseridos em ordem CRESCENTE, a
    // ordem esperada (id desc) e a inversa da insercao. Cinco, e nao dois,
    // porque com dois um desempate ausente acerta metade das vezes por sorte.
    const itens = [1, 2, 3, 4, 5].map(n => ({
      id: `${'0'.repeat(7)}${n}-0000-4000-8000-00000000000${n}`,
      qtd: n,
    }))
    await withTenant(sql, tenantA, async tx => {
      await tx`
        insert into entradas (tenant_id, id, numero, data)
        values (${tenantA}, ${entradaId}, 'E-EMP-TOTAL', '2026-01-16')`
      for (const it of itens) {
        await tx`
          insert into entrada_itens (tenant_id, id, entrada_id, produto_id, un, qtd, preco)
          values (${tenantA}, ${it.id}, ${entradaId}, ${produtoId}, 'KG', ${it.qtd}, 1)`
      }
    })

    const uma = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    const outra = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(uma.map(m => Number(m.qtd_kg))).toEqual([5, 4, 3, 2, 1])
    expect(outra.map(m => Number(m.qtd_kg))).toEqual([5, 4, 3, 2, 1])
  })

  it('limita as N mais recentes por linha e informa quantas existem (total)', async () => {
    const produtoId = await criarProduto(tenantA, 'Goiaba Limite')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 1 }], { data: '2026-01-01' })
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 1 }], { data: '2026-01-02' })
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 1 }], { data: '2026-01-03' })
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 1 }], { data: '2026-01-04' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA, 2)).filter(m => m.produto_id === produtoId)
    expect(movs.map(m => m.data)).toEqual(['2026-01-04', '2026-01-03'])
    // O total nao e o que veio: e o que existe, para a tela dizer "2 de 4"
    // em vez de truncar calada.
    expect(movs.every(m => Number(m.total) === 4)).toBe(true)
  })

  it('o teto padrao e LIMITE_HISTORICO', async () => {
    const produtoId = await criarProduto(tenantA, 'Kiwi Teto')
    for (let i = 1; i <= LIMITE_HISTORICO + 3; i += 1) {
      await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 1 }], {
        data: `2026-04-${String(i).padStart(2, '0')}`,
      })
    }

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs).toHaveLength(LIMITE_HISTORICO)
    expect(Number(movs[0].total)).toBe(LIMITE_HISTORICO + 3)
  })

  it('qtd_kg converte pela unidade do lancamento (mesma convencao em quilos da tela)', async () => {
    const produtoId = await criarProduto(tenantA, 'Melancia Hist CX', { un: 'CX', peso_medio: 15 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 4 }], { data: '2026-05-02' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(Number(movs[0].qtd_kg)).toBe(60) // 4 CX * 15 kg
  })

  it('lancamento nao convertivel: qtd_kg vira null, nunca zero nem fator inventado', async () => {
    const produtoId = await criarProduto(tenantA, 'Maracuja Hist Sem Peso', { un: 'CX', peso_medio: 0 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 4 }], { data: '2026-05-03' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs[0].qtd_kg).toBeNull()
    expect(paraJsonMovimentacao(movs[0]).qtd_kg).toBeNull()
  })

  it('agrupa por produto E unidade — CX e KG do mesmo produto sao historicos separados', async () => {
    const produtoId = await criarProduto(tenantA, 'Laranja Hist Duas Un', { un: 'CX', peso_medio: 10 })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'CX', qtd: 3 }], { data: '2026-06-01' })
    await criarEntrada(tenantA, [{ produto_id: produtoId, un: 'KG', qtd: 7 }], { data: '2026-06-02' })

    const movs = (await buscarMovimentacoesEstoque(sql, tenantA)).filter(m => m.produto_id === produtoId)
    expect(movs.filter(m => m.un === 'CX').map(m => Number(m.total))).toEqual([1])
    expect(movs.filter(m => m.un === 'KG').map(m => Number(m.total))).toEqual([1])
  })

  it('isolamento entre tenants: nao devolve movimentacao de outro tenant', async () => {
    const pB = await criarProduto(tenantB, 'Figo Iso Hist')
    await criarEntrada(tenantB, [{ produto_id: pB, qtd: 10 }], { data: '2026-07-01' })

    const movsA = await buscarMovimentacoesEstoque(sql, tenantA)
    expect(movsA.some(m => m.produto_id === pB)).toBe(false)
    const movsB = await buscarMovimentacoesEstoque(sql, tenantB)
    expect(movsB.some(m => m.produto_id === pB)).toBe(true)
  })

  it('numeric e bigint viram number na borda (paraJsonMovimentacao)', async () => {
    const produtoId = await criarProduto(tenantA, 'Ameixa Borda')
    await criarEntrada(tenantA, [{ produto_id: produtoId, qtd: 33 }], { data: '2026-07-08' })

    const crua = (await buscarMovimentacoesEstoque(sql, tenantA)).find(m => m.produto_id === produtoId)!
    expect(typeof crua.qtd_kg).toBe('string')
    expect(typeof crua.total).toBe('string')
    const json = paraJsonMovimentacao(crua)
    expect(json.qtd_kg).toBe(33)
    expect(json.total).toBe(1)
    expect(json.data).toBe('2026-07-08')
  })
})
