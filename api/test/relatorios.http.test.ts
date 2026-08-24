import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { relatorios } from '../src/routes/relatorios'

// Cobre a camada HTTP de src/routes/relatorios.ts: autorização (admin-only),
// validação do período (de/ate) e — o que importa de verdade aqui — que a
// soma por produto (GET /api/relatorios/produtos) bate com os itens de
// entrada/saída inseridos direto no banco, incluindo os casos que a soma em
// memória do front NUNCA vê porque GET /api/entradas e GET /api/saidas não
// trazem itens (essa é a razão de existir desta rota — ver o comentário no
// topo de src/routes/relatorios.ts).
//
// Fixtures vão direto por SQL (via `admin`), não pelas rotas de POST — mais
// rápido e dá controle exato sobre status/pago/data de cada linha, que é o
// que os casos de borda abaixo testam.
//
// Mesmo padrão de entradas.http.test.ts: rota montada num Hono local (a
// tarefa que criou esta rota foi instruída a não tocar em src/index.ts).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/relatorios', relatorios)
app.onError((err, c) => {
  console.error('erro nao tratado:', err)
  return c.json({ erro: 'erro interno' }, 500)
})

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let outroTenantId: string
let tokenAdmin: string
let tokenColab: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-relatorios-http', 'Relatorios HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-relatorios-http-2', 'Relatorios HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  // Ordem por causa das FKs: itens antes de cabecalhos, cabecalhos antes de
  // produtos/fornecedores/clientes.
  for (const tid of [tenantId, outroTenantId]) {
    await admin`delete from saida_itens where tenant_id = ${tid}`
    await admin`delete from saidas where tenant_id = ${tid}`
    await admin`delete from entrada_itens where tenant_id = ${tid}`
    await admin`delete from entradas where tenant_id = ${tid}`
    await admin`delete from perdas where tenant_id = ${tid}`
    await admin`delete from produtos where tenant_id = ${tid}`
    await admin`delete from clientes where tenant_id = ${tid}`
    await admin`delete from usuarios where tenant_id = ${tid}`
  }

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@relatorios-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@relatorios-http.com', ${hash}, 'Colab', 'colaborador') returning id`
  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lança, então
 * fornecemos um ExecutionContext mínimo e aguardamos as promises antes do
 * teste seguinte. Mesmo padrão do molde (entradas.http.test.ts).
 */
function contextoDeTeste() {
  const pendentes: Promise<unknown>[] = []
  const exec = {
    waitUntil: (p: Promise<unknown>) => { pendentes.push(p) },
    passThroughOnException: () => {},
  }
  return { exec, aguardar: () => Promise.all(pendentes) }
}

async function pedir(input: string, init?: RequestInit) {
  const { exec, aguardar } = contextoDeTeste()
  const res = await app.request(input, init, { DATABASE_URL: URL }, exec as never)
  await aguardar()
  return res
}

const comoAdmin = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenAdmin}` },
})
const comoColab = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenColab}` },
})

async function criarProduto(tid: string, nome: string) {
  const [p] = await admin`insert into produtos (tenant_id, nome) values (${tid}, ${nome}) returning id`
  return p.id as string
}

async function criarEntradaComItem(
  tid: string,
  opts: { numero: string; data: string; produtoId: string; qtd: number; preco: number; perdaKg?: number },
) {
  const [e] = await admin`
    insert into entradas (tenant_id, numero, data) values (${tid}, ${opts.numero}, ${opts.data}) returning id`
  await admin`
    insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco, perda_kg)
    values (${tid}, ${e.id}, ${opts.produtoId}, ${opts.qtd}, ${opts.preco}, ${opts.perdaKg ?? 0})`
  return e.id as string
}

/**
 * Uma entrada com VARIOS itens e perda no CABECALHO (entradas.perda_kg) —
 * usada pra cobrir a mesma regra de max/rateio de buscarEstoque
 * (api/src/routes/estoque.ts), agora tambem em GET /api/relatorios/produtos.
 */
async function criarEntradaComItens(
  tid: string,
  opts: {
    numero: string; data: string; perdaKgCabecalho?: number
    itens: { produtoId: string; qtd: number; preco: number; perdaKg?: number }[]
  },
) {
  const [e] = await admin`
    insert into entradas (tenant_id, numero, data, perda_kg)
    values (${tid}, ${opts.numero}, ${opts.data}, ${opts.perdaKgCabecalho ?? 0}) returning id`
  for (const it of opts.itens) {
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, qtd, preco, perda_kg)
      values (${tid}, ${e.id}, ${it.produtoId}, ${it.qtd}, ${it.preco}, ${it.perdaKg ?? 0})`
  }
  return e.id as string
}

async function criarSaidaComItem(
  tid: string,
  opts: { numero: string; entrega: string; status: string; produtoId: string; qtd: number; preco: number },
) {
  const [s] = await admin`
    insert into saidas (tenant_id, numero, data_pedido, entrega, status)
    values (${tid}, ${opts.numero}, ${opts.entrega}, ${opts.entrega}, ${opts.status}) returning id`
  await admin`
    insert into saida_itens (tenant_id, saida_id, produto_id, qtd, preco)
    values (${tid}, ${s.id}, ${opts.produtoId}, ${opts.qtd}, ${opts.preco})`
  return s.id as string
}

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/relatorios/produtos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 403 (relatorios e tela admin-only)', async () => {
    const res = await pedir('/api/relatorios/produtos', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/relatorios/produtos', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('validacao do periodo', () => {
  it('de invalido -> 400', async () => {
    const res = await pedir('/api/relatorios/produtos?de=2026-6', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'periodo invalido (use AAAA-MM)' })
  })

  it('ate invalido -> 400', async () => {
    const res = await pedir('/api/relatorios/produtos?ate=junho', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'periodo invalido (use AAAA-MM)' })
  })

  it('sem de/ate -> sem filtro, 200', async () => {
    const res = await pedir('/api/relatorios/produtos', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('soma por produto', () => {
  it('agrega compra (entrada_itens) e venda (saida_itens, so Entregue) do mesmo produto', async () => {
    const produtoId = await criarProduto(tenantId, 'Produto Soma A')
    await criarEntradaComItem(tenantId, {
      numero: 'REL-E1', data: '2026-06-08', produtoId, qtd: 100, preco: 2, perdaKg: 5,
    })
    await criarSaidaComItem(tenantId, {
      numero: 'REL-S1', entrega: '2026-06-10', status: 'Entregue', produtoId, qtd: 80, preco: 4,
    })

    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    expect(res.status).toBe(200)
    const linhas = await res.json() as Array<Record<string, unknown>>
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(linha).toBeDefined()
    expect(linha.compra_qtd).toBe(100)
    expect(linha.compra_valor).toBe(200)
    expect(linha.perda_coleta_qtd).toBe(5)
    expect(linha.venda_qtd).toBe(80)
    expect(linha.venda_valor).toBe(320)
    for (const campo of ['compra_qtd', 'compra_valor', 'perda_coleta_qtd', 'venda_qtd', 'venda_valor', 'perda_deposito_qtd']) {
      expect(typeof linha[campo]).toBe('number')
    }
  })

  it('saida que nao esta Entregue nao conta para venda_qtd/venda_valor', async () => {
    const produtoId = await criarProduto(tenantId, 'Produto Nao Entregue')
    await criarSaidaComItem(tenantId, {
      numero: 'REL-S2', entrega: '2026-06-10', status: 'Em rota', produtoId, qtd: 50, preco: 10,
    })

    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    const linha = linhas.find(l => l.produto_id === produtoId)
    // Sem compra/venda/perda "contável" no periodo (a saida existe mas nao e
    // Entregue), o produto nao aparece no relatorio — mesmo comportamento do
    // prototipo (prodAgg so ganha entrada quando algo bate no produto).
    expect(linha).toBeUndefined()
  })

  it('perda de deposito (tabela perdas) soma em perda_deposito_qtd, separada da perda de coleta', async () => {
    const produtoId = await criarProduto(tenantId, 'Produto Perda Deposito')
    await criarEntradaComItem(tenantId, {
      numero: 'REL-E3', data: '2026-06-05', produtoId, qtd: 200, preco: 1, perdaKg: 10,
    })
    await admin`
      insert into perdas (tenant_id, data, produto_id, qtd, motivo)
      values (${tenantId}, '2026-06-15', ${produtoId}, 15, 'armazenagem')`

    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    const linha = linhas.find(l => l.produto_id === produtoId)!
    expect(linha.perda_coleta_qtd).toBe(10)
    expect(linha.perda_deposito_qtd).toBe(15)
  })

  it('produto sem nenhuma movimentacao no periodo nao aparece na resposta', async () => {
    const produtoId = await criarProduto(tenantId, 'Produto Parado')
    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    expect(linhas.find(l => l.produto_id === produtoId)).toBeUndefined()
  })

  it('filtra pelo periodo (de/ate): entrada fora do intervalo nao entra na soma', async () => {
    const produtoId = await criarProduto(tenantId, 'Produto Fora Do Periodo')
    await criarEntradaComItem(tenantId, {
      numero: 'REL-E4', data: '2026-05-20', produtoId, qtd: 999, preco: 1,
    })
    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    expect(linhas.find(l => l.produto_id === produtoId)).toBeUndefined()
  })

  it('isolamento entre tenants: produto/entrada de outro tenant nunca aparece', async () => {
    const produtoOutro = await criarProduto(outroTenantId, 'Produto Outro Tenant Rel')
    await criarEntradaComItem(outroTenantId, {
      numero: 'REL-OUTRO-1', data: '2026-06-08', produtoId: produtoOutro, qtd: 500, preco: 9,
    })
    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    expect(linhas.find(l => l.produto_id === produtoOutro)).toBeUndefined()
  })

  // ---- perda_coleta_qtd: mesma regra de max/rateio de buscarEstoque (ver
  // comentario no topo de src/routes/relatorios.ts) — unifica com o que a
  // tela de Estoque mostra, em vez de olhar so os itens.

  it('cabecalho igual a soma dos itens da entrada NAO soma os dois (usa o maior, nao a soma)', async () => {
    const produtoA = await criarProduto(tenantId, 'Produto Dupla Contagem A')
    const produtoB = await criarProduto(tenantId, 'Produto Dupla Contagem B')
    await criarEntradaComItens(tenantId, {
      numero: 'REL-DUPLA-1', data: '2026-06-08', perdaKgCabecalho: 140,
      itens: [
        { produtoId: produtoA, qtd: 1500, preco: 2, perdaKg: 85 },
        { produtoId: produtoB, qtd: 750, preco: 2, perdaKg: 55 },
      ],
    })

    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    const linhaA = linhas.find(l => l.produto_id === produtoA)!
    const linhaB = linhas.find(l => l.produto_id === produtoB)!
    expect(linhaA.perda_coleta_qtd).toBe(85)
    expect(linhaB.perda_coleta_qtd).toBe(55)
  })

  it('cabecalho maior que a soma dos itens: a diferenca e rateada proporcional ao peso (qtd)', async () => {
    const produtoA = await criarProduto(tenantId, 'Produto Rateio A')
    const produtoB = await criarProduto(tenantId, 'Produto Rateio B')
    await criarEntradaComItens(tenantId, {
      numero: 'REL-RATEIO-1', data: '2026-06-08', perdaKgCabecalho: 200,
      itens: [
        { produtoId: produtoA, qtd: 1500, preco: 2 },
        { produtoId: produtoB, qtd: 500, preco: 2 },
      ],
    })

    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    const linhas = await res.json() as Array<Record<string, unknown>>
    const linhaA = linhas.find(l => l.produto_id === produtoA)!
    const linhaB = linhas.find(l => l.produto_id === produtoB)!
    expect(linhaA.perda_coleta_qtd).toBe(150) // 200 * 1500/2000
    expect(linhaB.perda_coleta_qtd).toBe(50)  // 200 * 500/2000
  })
})

// ---------------------------------------------------------------------------
// As tres quantidades saem em KG
// ---------------------------------------------------------------------------
//
// compra_qtd, venda_qtd e perda_deposito_qtd somavam `qtd` cru agrupando so
// por produto_id, sem olhar a unidade de cada lancamento: um produto comprado
// ora em caixa ora em quilo tinha os dois no mesmo total, e
// `cm = compra_valor / compra_qtd` (derivarRelatorioProdutos) dividia reais
// por "caixas mais quilos" — o mesmo defeito de preco medio que
// api/src/routes/entradas.ts corrigiu nas compras. Esta rota alimenta a tela
// de Produtos, que e onde o dono decide preco de venda.
//
// A regra e a MESMA de entradas.ts (peso_total) e estoque.ts
// (paraJson/equivalente_kg): 'KG' conta qtd, o resto conta
// qtd * produtos.peso_medio, e so quando peso_medio > 0.

/** Produto em unidade nao-KG. `pesoMedio` 0 = "nao informado" (migration 009),
 * o caso nao convertivel. */
async function criarProdutoUn(tid: string, nome: string, un: string, pesoMedio: number) {
  const [p] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tid}, ${nome}, ${un}, ${pesoMedio}) returning id`
  return p.id as string
}

/** Igual a criarEntradaComItens, mas com `un` por item — os helpers antigos
 * omitem a coluna e caem no default 'KG' (que e o caso "so KG", no-op). */
async function criarEntradaComUn(
  tid: string,
  opts: {
    numero: string; data: string; perdaKgCabecalho?: number
    itens: { produtoId: string; un: string; qtd: number; preco: number; perdaKg?: number }[]
  },
) {
  const [e] = await admin`
    insert into entradas (tenant_id, numero, data, perda_kg)
    values (${tid}, ${opts.numero}, ${opts.data}, ${opts.perdaKgCabecalho ?? 0}) returning id`
  for (const it of opts.itens) {
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco, perda_kg)
      values (${tid}, ${e.id}, ${it.produtoId}, ${it.un}, ${it.qtd}, ${it.preco}, ${it.perdaKg ?? 0})`
  }
  return e.id as string
}

async function criarSaidaComUn(
  tid: string,
  opts: {
    numero: string; entrega: string; status: string
    itens: { produtoId: string; un: string; qtd: number; preco: number }[]
  },
) {
  const [s] = await admin`
    insert into saidas (tenant_id, numero, data_pedido, entrega, status)
    values (${tid}, ${opts.numero}, ${opts.entrega}, ${opts.entrega}, ${opts.status}) returning id`
  for (const it of opts.itens) {
    await admin`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tid}, ${s.id}, ${it.produtoId}, ${it.un}, ${it.qtd}, ${it.preco})`
  }
  return s.id as string
}

async function criarPerdaDeposito(
  tid: string,
  opts: { data: string; produtoId: string; un: string; qtd: number },
) {
  await admin`
    insert into perdas (tenant_id, data, produto_id, un, qtd, motivo)
    values (${tid}, ${opts.data}, ${opts.produtoId}, ${opts.un}, ${opts.qtd}, 'armazenagem')`
}

describe('quantidades em KG (conversao por produtos.peso_medio)', () => {
  async function linhaDoProduto(produtoId: string) {
    const res = await pedir('/api/relatorios/produtos?de=2026-06&ate=2026-06', comoAdmin())
    expect(res.status).toBe(200)
    const linhas = await res.json() as Array<Record<string, unknown>>
    return linhas.find(l => l.produto_id === produtoId)!
  }

  it('so KG: as tres quantidades sao a soma crua (conversao no-op) e nada fica de fora', async () => {
    const produtoId = await criarProduto(tenantId, 'Conv So KG')
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-KG', data: '2026-06-08',
      itens: [{ produtoId, un: 'KG', qtd: 100, preco: 2, perdaKg: 5 }],
    })
    await criarSaidaComUn(tenantId, {
      numero: 'CONV-S-KG', entrega: '2026-06-10', status: 'Entregue',
      itens: [{ produtoId, un: 'KG', qtd: 80, preco: 4 }],
    })
    await criarPerdaDeposito(tenantId, { data: '2026-06-15', produtoId, un: 'KG', qtd: 7 })

    const linha = await linhaDoProduto(produtoId)
    // Identico ao que a rota devolvia antes da conversao existir: quem lanca
    // tudo em KG nao pode ver numero nenhum mudar.
    expect(linha.compra_qtd).toBe(100)
    expect(linha.compra_valor).toBe(200)
    expect(linha.perda_coleta_qtd).toBe(5)
    expect(linha.venda_qtd).toBe(80)
    expect(linha.venda_valor).toBe(320)
    expect(linha.perda_deposito_qtd).toBe(7)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('CX com peso medio cadastrado: compra, venda e perda de deposito viram kg', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv CX Com Peso', 'CX', 20)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-CX', data: '2026-06-08',
      itens: [{ produtoId, un: 'CX', qtd: 10, preco: 45 }],
    })
    await criarSaidaComUn(tenantId, {
      numero: 'CONV-S-CX', entrega: '2026-06-10', status: 'Entregue',
      itens: [{ produtoId, un: 'CX', qtd: 6, preco: 80 }],
    })
    await criarPerdaDeposito(tenantId, { data: '2026-06-15', produtoId, un: 'CX', qtd: 2 })

    const linha = await linhaDoProduto(produtoId)
    expect(linha.compra_qtd).toBe(200) // 10 CX x 20 kg — nao "10"
    expect(linha.venda_qtd).toBe(120)  // 6 CX x 20 kg — nao "6"
    expect(linha.perda_deposito_qtd).toBe(40) // 2 CX x 20 kg
    // Valores em reais nao mudam com unidade nenhuma; o preco medio e que
    // passa a ser por quilo: 450/200 = R$ 2,25/kg (antes 450/10 = R$ 45).
    expect(linha.compra_valor).toBe(450)
    expect(linha.venda_valor).toBe(480)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('CX sem peso medio: os lancamentos ficam FORA das quantidades e sao contados', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv CX Sem Peso', 'CX', 0)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-SEM', data: '2026-06-08',
      itens: [{ produtoId, un: 'CX', qtd: 10, preco: 45 }],
    })
    await criarSaidaComUn(tenantId, {
      numero: 'CONV-S-SEM', entrega: '2026-06-10', status: 'Entregue',
      itens: [{ produtoId, un: 'CX', qtd: 6, preco: 80 }],
    })
    await criarPerdaDeposito(tenantId, { data: '2026-06-15', produtoId, un: 'CX', qtd: 2 })

    const linha = await linhaDoProduto(produtoId)
    // Sem peso_medio nao ha como converter caixa em quilo — e o fator NAO e
    // inventado como 1 (uma caixa nao pesa um quilo).
    expect(linha.compra_qtd).toBe(0)
    expect(linha.venda_qtd).toBe(0)
    expect(linha.perda_deposito_qtd).toBe(0)
    // Os reais continuam inteiros: o que falta e o peso, nao o dinheiro.
    expect(linha.compra_valor).toBe(450)
    expect(linha.venda_valor).toBe(480)
    // Um de cada fonte: compra, venda e perda de deposito.
    expect(linha.itens_sem_conversao).toBe(3)
  })

  it('mesmo produto comprado ora em KG ora em CX: soma so depois de converter cada lancamento', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv Mistura KG CX', 'CX', 20)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-MIX', data: '2026-06-08',
      itens: [
        { produtoId, un: 'KG', qtd: 30, preco: 2 },
        { produtoId, un: 'CX', qtd: 12, preco: 45 },
      ],
    })

    const linha = await linhaDoProduto(produtoId)
    // 30 kg + (12 CX x 20 kg) = 270 kg. Antes da correcao: 30 + 12 = "42",
    // e o preco medio saia 600/42 = R$ 14,29 de "alguma coisa" em vez de
    // 600/270 = R$ 2,22 por quilo.
    expect(linha.compra_qtd).toBe(270)
    expect(linha.compra_valor).toBe(30 * 2 + 12 * 45)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('mistura convertivel + nao convertivel no mesmo produto: soma o que da e conta o resto', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv Mistura Parcial', 'CX', 0)
    const produtoConvertivel = await criarProdutoUn(tenantId, 'Conv Parceiro Convertivel', 'CX', 20)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-PARCIAL', data: '2026-06-08',
      itens: [
        { produtoId, un: 'KG', qtd: 30, preco: 2 },
        { produtoId, un: 'CX', qtd: 5, preco: 40 },
        { produtoId: produtoConvertivel, un: 'CX', qtd: 3, preco: 40 },
      ],
    })

    const linha = await linhaDoProduto(produtoId)
    // As 5 caixas sem peso medio nao entram (e nao viram 5 "quilos"), mas os
    // R$ 200 delas continuam no valor.
    expect(linha.compra_qtd).toBe(30)
    expect(linha.compra_valor).toBe(30 * 2 + 5 * 40)
    expect(linha.itens_sem_conversao).toBe(1)
    // O contador e por produto: o vizinho convertivel da mesma entrada nao
    // e contaminado.
    const outra = await linhaDoProduto(produtoConvertivel)
    expect(outra.compra_qtd).toBe(60)
    expect(outra.itens_sem_conversao).toBe(0)
  })

  it('perda_coleta_qtd NAO e convertida — perda_kg e KG por contrato, em item de qualquer unidade', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv Perda Coleta CX', 'CX', 20)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-PERDA', data: '2026-06-08',
      itens: [{ produtoId, un: 'CX', qtd: 10, preco: 45, perdaKg: 6 }],
    })

    const linha = await linhaDoProduto(produtoId)
    // Multiplicar por peso_medio aqui viraria 6*20=120 e estragaria um numero
    // que ja esta certo — o rotulo em ModalEntrada.tsx diz kg. So a
    // quantidade muda de unidade. De quebra, perdaPct (perda / compra_qtd)
    // passa a comparar kg com kg: 6/200.
    expect(linha.perda_coleta_qtd).toBe(6)
    expect(linha.compra_qtd).toBe(200)
  })

  it('itens_sem_conversao sai como number (count e bigint no Postgres)', async () => {
    const produtoId = await criarProdutoUn(tenantId, 'Conv Tipo Contador', 'CX', 0)
    await criarEntradaComUn(tenantId, {
      numero: 'CONV-E-TIPO', data: '2026-06-08',
      itens: [{ produtoId, un: 'CX', qtd: 1, preco: 1 }],
    })
    const linha = await linhaDoProduto(produtoId)
    expect(typeof linha.itens_sem_conversao).toBe('number')
    expect(linha.itens_sem_conversao).toBe(1)
  })
})
