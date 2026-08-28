import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

// estoque.test.ts cobre o calculo (buscarEstoque) direto contra o banco.
// Este arquivo cobre a camada HTTP de src/routes/estoque.ts — autorizacao
// (so exigirSessao: colaborador acessa, igual entradas/saidas/perdas),
// forma do JSON e conversao numerica. Mesmo racional de clientes.http.test.ts
// (o molde), importando o app inteiro de src/index.ts porque esta rota ja
// esta montada la.

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
    insert into tenants (slug, nome) values ('teste-estoque-http', 'Estoque HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-estoque-http-2', 'Estoque HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from saidas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from entradas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from perdas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@estoque-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@estoque-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  // Produto CX com peso_medio, movimentado, para a linha de equivalente_un.
  const [produtoCx] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, 'Melancia HTTP', 'CX', 15) returning id`
  const [entrada] = await admin`
    insert into entradas (tenant_id, numero, data) values (${tenantId}, 'E-HTTP-1', '2026-08-01') returning id`
  await admin`
    insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco, perda_kg)
    values (${tenantId}, ${entrada.id}, ${produtoCx.id}, 'CX', 10, 20, 1)`
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes do
 * teste seguinte, para nao vazar conexoes entre casos. Mesmo padrao do
 * molde (clientes.http.test.ts).
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

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/estoque')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 200 (design: colaborador acessa estoque)', async () => {
    const res = await pedir('/api/estoque', comoColab())
    expect(res.status).toBe(200)
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('forma da resposta', () => {
  it('devolve um array com nome, un, entrou, perda, saiu, saldo e peso_medio numericos, na unidade lancada', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(Array.isArray(corpo)).toBe(true)
    expect(corpo.length).toBeGreaterThan(0)

    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')
    expect(linha).toBeDefined()
    expect(linha).not.toHaveProperty('tenant_id')
    expect(typeof linha.entrou).toBe('number')
    expect(typeof linha.perda).toBe('number')
    expect(typeof linha.saiu).toBe('number')
    expect(typeof linha.saldo).toBe('number')
    expect(typeof linha.peso_medio).toBe('number')
    expect(typeof linha.itens_sem_conversao).toBe('number')
    // `un` e a unidade LANCADA (a chave da linha) — e agora tambem a unidade
    // das quantidades: 10 CX entraram, e a linha diz 10, nao 150. O perda_kg
    // do item (1 kg, por contrato) nao cabe em caixas e viaja separado.
    expect(linha.un).toBe('CX')
    expect(linha.entrou).toBe(10)
    expect(linha.perda).toBe(0)
    expect(linha.saiu).toBe(0)
    expect(linha.saldo).toBe(10) // 10 - 0 - 0, em CX
    expect(linha.perda_fora_da_unidade).toBe(1) // 1 kg de coleta, em quilos
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('expoe movimentada, e o produto so cadastrado vem na lista com saldo zero', async () => {
    const [parado] = await admin`
      insert into produtos (tenant_id, nome, un, peso_medio)
      values (${tenantId}, 'Parado HTTP', 'UN', 0) returning id`
    expect(parado.id).toBeTruthy()

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()

    const linha = corpo.find((l: { nome: string }) => l.nome === 'Parado HTTP')
    expect(linha).toBeDefined()
    expect(linha.movimentada).toBe(false)
    expect(linha.un).toBe('UN')
    expect(linha.saldo).toBe(0)

    // A linha movimentada continua dizendo que foi movimentada.
    const melancia = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')
    expect(melancia.movimentada).toBe(true)
  })

  it('expoe em_kg como leitura secundaria — a mesma conta em quilos, para somar entre linhas', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')

    // O kg continua existindo e continua sendo a unica unidade em que a conta
    // fecha ENTRE linhas — 10 CX de 15 kg = 150, e o perda_kg do item entra
    // como 1, nunca como 15. Sao exatamente os numeros que a resposta trazia
    // como principais antes desta mudanca; o que mudou e o alcance deles.
    expect(linha.em_kg).toEqual({ entrou: 150, perda: 1, saiu: 0, saldo: 149 })
    // A quantidade da linha nao e essa: ela e exata, em CX.
    expect(linha.entrou).toBe(10)
    // Os dois campos antigos sairam: equivalente_kg multiplicava o bolo
    // inteiro por peso_medio; equivalente_un dividia o kg de volta pelo mesmo
    // fator para reconstruir aproximadamente o que agora chega exato.
    expect(linha).not.toHaveProperty('equivalente_kg')
    expect(linha).not.toHaveProperty('equivalente_un')
  })

  it('linha em KG: quantidade e em_kg sao o MESMO numero (a conversao e no-op)', async () => {
    const [produtoKg] = await admin`
      insert into produtos (tenant_id, nome, un, peso_medio)
      values (${tenantId}, 'Produto KG HTTP', 'KG', 0) returning id`
    const [entrada] = await admin`
      insert into entradas (tenant_id, numero, data) values (${tenantId}, 'E-HTTP-2', '2026-08-01') returning id`
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${entrada.id}, ${produtoKg.id}, 'KG', 5, 3)`

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Produto KG HTTP')
    // Produto so em KG sai com os mesmos numeros de sempre, e a leitura
    // secundaria e identica a principal — nao ha fator no meio.
    expect(linha.entrou).toBe(5)
    expect(linha.saldo).toBe(5)
    expect(linha.em_kg).toEqual({ entrou: 5, perda: 0, saiu: 0, saldo: 5 })
    expect(linha.perda_fora_da_unidade).toBe(0)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('linha em CX sem peso_medio: a quantidade lancada aparece inteira, e em_kg e null', async () => {
    const [produtoSemFator] = await admin`
      insert into produtos (tenant_id, nome, un, peso_medio)
      values (${tenantId}, 'Caixa Sem Fator HTTP', 'CX', 0) returning id`
    const [entrada] = await admin`
      insert into entradas (tenant_id, numero, data) values (${tenantId}, 'E-HTTP-3', '2026-08-01') returning id`
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco, perda_kg)
      values (${tenantId}, ${entrada.id}, ${produtoSemFator.id}, 'CX', 12, 30, 2)`

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Caixa Sem Fator HTTP')
    // 12 caixas entraram. Sem peso medio nao ha como dizer quantos quilos
    // sao, mas as 12 caixas continuam sendo 12 caixas — antes desta mudanca
    // esta linha exibia 0, apagando a mercadoria da tela.
    expect(linha.entrou).toBe(12)
    expect(linha.saldo).toBe(12)
    expect(linha.perda).toBe(0)                // nao ha perda EM CAIXAS
    expect(linha.perda_fora_da_unidade).toBe(2) // os 2 kg de coleta, em kg
    // Fator ausente nao vira 1: a leitura em quilos simplesmente nao existe.
    // `null`, e nao um objeto de zeros — quem soma entre linhas tem de
    // decidir o que dizer, em vez de somar zero em silencio.
    expect(linha.em_kg).toBeNull()
    expect(linha.itens_sem_conversao).toBe(1)
  })

  it('o caso real: quatro produtos lancados em UN sem peso medio somam 138 unidades, nao quatro zeros', async () => {
    // O lancamento que revelou o defeito: entrada com quatro itens, todos em
    // UN, de produtos cadastrados em KG e sem peso_medio. A tela mostrava
    // "0 *" nas quatro linhas e nas quatro colunas — 138 unidades de
    // mercadoria real exibidas como deposito vazio. Alface e rucula se vendem
    // por unidade ou maco: "quantos quilos" nem e a pergunta certa aqui.
    const nomes = ['Alface Hidro RE', 'Alface Roxa RE', 'Escarola RE', 'Rucula RE']
    const qtds = [45, 45, 18, 30]
    const [entradaReal] = await admin`
      insert into entradas (tenant_id, numero, data)
      values (${tenantId}, 'E-HTTP-REAL', '2026-08-25') returning id`
    for (let i = 0; i < nomes.length; i += 1) {
      const [p] = await admin`
        insert into produtos (tenant_id, nome, un, peso_medio)
        values (${tenantId}, ${nomes[i]}, 'KG', 0) returning id`
      await admin`
        insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco)
        values (${tenantId}, ${entradaReal.id}, ${p.id}, 'UN', ${qtds[i]}, 3)`
    }

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const doCaso = nomes.map(n => corpo.find((l: { nome: string }) => l.nome === n))

    doCaso.forEach((linha, i) => {
      expect(linha.un).toBe('UN')       // a unidade LANCADA, nao produtos.un
      expect(linha.entrou).toBe(qtds[i])
      expect(linha.saldo).toBe(qtds[i]) // nada saiu: o deposito tem tudo
      expect(linha.em_kg).toBeNull()    // e nao ha leitura em quilos, e tudo bem
    })
    expect(doCaso.reduce((s, l) => s + l.saldo, 0)).toBe(138)
  })

  it('tenant so ve suas proprias linhas (isolamento tambem na camada HTTP)', async () => {
    const [produtoOutro] = await admin`
      insert into produtos (tenant_id, nome) values (${outroTenantId}, 'Produto Outro Tenant HTTP') returning id`
    const [entradaOutro] = await admin`
      insert into entradas (tenant_id, numero, data) values (${outroTenantId}, 'E-HTTP-OUTRO', '2026-08-01') returning id`
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco)
      values (${outroTenantId}, ${entradaOutro.id}, ${produtoOutro.id}, 'KG', 999, 1)`

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    expect(corpo.some((l: { nome: string }) => l.nome === 'Produto Outro Tenant HTTP')).toBe(false)
  })
})

// =========================================== movimentacao (camada HTTP)

describe('GET /api/estoque — datas da ultima movimentacao', () => {
  it('devolve as tres datas como texto AAAA-MM-DD, ou null quando a fonte nunca movimentou', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')

    // A entrada do beforeAll e de 2026-08-01; nao ha saida nem perda.
    expect(linha.ultima_entrada).toBe('2026-08-01')
    expect(linha.ultima_saida).toBeNull()
    expect(linha.ultima_perda).toBeNull()
    // Texto puro: um Date serializado pelo Hono chegaria como
    // '2026-08-01T00:00:00.000Z' e o front teria de reformatar (e errar o
    // dia em fuso positivo).
    expect(typeof linha.ultima_entrada).toBe('string')
    expect(linha.ultima_entrada).not.toContain('T')
  })

  it('a data da saida e a entrega, e saida Cancelada nao produz data nenhuma', async () => {
    const [prod] = await admin`
      insert into produtos (tenant_id, nome, un, peso_medio)
      values (${tenantId}, 'Giro HTTP', 'KG', 0) returning id`
    // data_pedido e entrega DIFERENTES: sem isso o teste nao prova nada.
    const [entregue] = await admin`
      insert into saidas (tenant_id, numero, data_pedido, entrega, status)
      values (${tenantId}, 'S-HTTP-1', '2026-07-01', '2026-07-19', 'Entregue') returning id`
    await admin`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${entregue.id}, ${prod.id}, 'KG', 4, 2)`
    const [cancelada] = await admin`
      insert into saidas (tenant_id, numero, data_pedido, entrega, status)
      values (${tenantId}, 'S-HTTP-2', '2026-07-20', '2026-12-25', 'Cancelado') returning id`
    await admin`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${cancelada.id}, ${prod.id}, 'KG', 4, 2)`

    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Giro HTTP')
    expect(linha.ultima_saida).toBe('2026-07-19')
    expect(linha.ultima_saida).not.toBe('2026-07-01')  // nao e a data_pedido
    expect(linha.ultima_saida).not.toBe('2026-12-25')  // nem a saida cancelada
  })
})

describe('GET /api/estoque/movimentacoes', () => {
  it('sem cookie -> 401 (mesma exigencia de sessao da listagem)', async () => {
    const res = await pedir('/api/estoque/movimentacoes')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 200: quem ve o saldo ve quando ele mexeu', async () => {
    const res = await pedir('/api/estoque/movimentacoes', comoColab())
    expect(res.status).toBe(200)
  })

  it('devolve as movimentacoes com tipo, data, quantidade em kg e total, tudo numerico na borda', async () => {
    const res = await pedir('/api/estoque/movimentacoes', comoAdmin())
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(Array.isArray(corpo)).toBe(true)

    type Mov = { produto_id: string; un: string; tipo: string; data: string; qtd_kg: number | null; total: number }
    const daMelancia = corpo.filter((m: Mov) => m.un === 'CX' && m.qtd_kg === 150)
    expect(daMelancia.length).toBe(1)
    const mov = daMelancia[0] as Mov
    expect(mov.tipo).toBe('entrada')
    expect(mov.data).toBe('2026-08-01')
    expect(typeof mov.qtd_kg).toBe('number')  // 10 CX * 15 kg
    expect(typeof mov.total).toBe('number')
    expect(mov).not.toHaveProperty('tenant_id')
  })

  it('lancamento nao convertivel chega com qtd_kg null, nunca zero', async () => {
    const res = await pedir('/api/estoque/movimentacoes', comoAdmin())
    const corpo = await res.json()
    // 'Caixa Sem Fator HTTP': 12 CX sem peso_medio (criado na suite acima).
    type Mov = { referencia: string; qtd_kg: number | null }
    const mov = corpo.find((m: Mov) => m.referencia === 'E-HTTP-3')
    expect(mov).toBeDefined()
    expect(mov.qtd_kg).toBeNull()
  })

  it('tenant so ve as proprias movimentacoes', async () => {
    const res = await pedir('/api/estoque/movimentacoes', comoAdmin())
    const corpo = await res.json()
    type Mov = { referencia: string }
    expect(corpo.some((m: Mov) => m.referencia === 'E-HTTP-OUTRO')).toBe(false)
  })
})

// ============================== posicao num dia passado (camada HTTP)
//
// `?posicao_em=AAAA-MM-DD` e um PONTO no tempo, nao o intervalo `de`/`ate` do
// filtro de periodo global (relatorios.ts) — esta tela continua fora dele. O
// calculo em si esta coberto em estoque.test.ts; aqui cobrimos a borda HTTP:
// validacao do parametro e o corte chegando de fato na resposta.

describe('GET /api/estoque?posicao_em=', () => {
  it('sem o parametro devolve a posicao atual (comportamento de sempre)', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    expect(corpo.some((l: { nome: string }) => l.nome === 'Melancia HTTP')).toBe(true)
  })

  it('corte antes da entrada: a linha NAO aparece — nem com saldo zero', async () => {
    // 'Melancia HTTP' so tem a entrada de 2026-08-01 (beforeAll). Em 31/07
    // ela ainda nao existia no deposito, e ausencia nao e "0 kg".
    const res = await pedir('/api/estoque?posicao_em=2026-07-31', comoAdmin())
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo.some((l: { nome: string }) => l.nome === 'Melancia HTTP')).toBe(false)
    // ...e a linha que JA existia em 31/07 continua la, com o numero dela.
    const giro = corpo.find((l: { nome: string }) => l.nome === 'Giro HTTP')
    expect(giro).toBeDefined()
    expect(giro.saiu).toBe(4)
    expect(giro.ultima_saida).toBe('2026-07-19')
  })

  it('corte NA data da entrada ja a inclui — o corte e inclusivo', async () => {
    const res = await pedir('/api/estoque?posicao_em=2026-08-01', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')
    expect(linha).toBeDefined()
    expect(linha.entrou).toBe(10)   // 10 CX, na unidade lancada
    expect(linha.saldo).toBe(10)
    expect(linha.em_kg.entrou).toBe(150) // e 150 kg na leitura secundaria
  })

  it('parametro vazio conta como ausente (campo limpo = sem corte)', async () => {
    const vazio = await pedir('/api/estoque?posicao_em=', comoAdmin())
    expect(vazio.status).toBe(200)
    const semParam = await pedir('/api/estoque', comoAdmin())
    expect(await vazio.json()).toEqual(await semParam.json())
  })

  it('data fora do formato -> 400, nao 500', async () => {
    const res = await pedir('/api/estoque?posicao_em=ontem', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'posicao_em invalida (use AAAA-MM-DD)' })
  })

  it('data que casa com o formato mas nao existe no calendario -> 400, nao erro de banco', async () => {
    // 31 de fevereiro passa no regex e derrubaria o ::date da query com um
    // 500 por causa de uma entrada do usuario, que e 400.
    const res = await pedir('/api/estoque?posicao_em=2026-02-31', comoAdmin())
    expect(res.status).toBe(400)
  })

  it('a linha traz itens_saida_sem_data numerico, para a tela poder explicar o corte', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')
    expect(typeof linha.itens_saida_sem_data).toBe('number')
    expect(linha.itens_saida_sem_data).toBe(0)
  })

  it('saida sem entrega desconta do saldo tambem num corte anterior a ela, e a linha diz quantas sao', async () => {
    const [prod] = await admin`
      insert into produtos (tenant_id, nome, un, peso_medio)
      values (${tenantId}, 'Sem Entrega HTTP', 'KG', 0) returning id`
    const [entrada] = await admin`
      insert into entradas (tenant_id, numero, data)
      values (${tenantId}, 'E-HTTP-SD', '2026-06-01') returning id`
    await admin`
      insert into entrada_itens (tenant_id, entrada_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${entrada.id}, ${prod.id}, 'KG', 40, 2)`
    const [saida] = await admin`
      insert into saidas (tenant_id, numero, data_pedido, entrega, status)
      values (${tenantId}, 'S-HTTP-SD', '2026-08-20', null, 'Em rota') returning id`
    await admin`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tenantId}, ${saida.id}, ${prod.id}, 'KG', 7, 3)`

    const res = await pedir('/api/estoque?posicao_em=2026-06-30', comoAdmin())
    const linha = (await res.json()).find((l: { nome: string }) => l.nome === 'Sem Entrega HTTP')
    // Junho e ANTERIOR ao pedido, e a quantidade continua descontada: sem
    // data nao da para posiciona-la, e exclui-la afirmaria que ela nao tinha
    // saido. O contador e o que a tela usa para nao deixar isso sem resposta.
    expect(linha.saiu).toBe(7)
    expect(linha.saldo).toBe(33)
    expect(linha.itens_saida_sem_data).toBe(1)
    expect(linha.ultima_saida).toBeNull()
  })
})

describe('GET /api/estoque/movimentacoes?posicao_em=', () => {
  it('o historico respeita o mesmo corte da listagem', async () => {
    const res = await pedir('/api/estoque/movimentacoes?posicao_em=2026-07-31', comoAdmin())
    expect(res.status).toBe(200)
    const corpo = await res.json()
    type Mov = { referencia: string }
    // A entrada de 2026-08-01 fica fora...
    expect(corpo.some((m: Mov) => m.referencia === 'E-HTTP-1')).toBe(false)
    // ...e a saida entregue em 19/07 continua dentro.
    expect(corpo.some((m: Mov) => m.referencia === 'S-HTTP-1')).toBe(true)
  })

  it('sem corte, a entrada de agosto volta a aparecer', async () => {
    const res = await pedir('/api/estoque/movimentacoes', comoAdmin())
    const corpo = await res.json()
    type Mov = { referencia: string }
    expect(corpo.some((m: Mov) => m.referencia === 'E-HTTP-1')).toBe(true)
  })

  it('data invalida -> 400 (mesma validacao da listagem)', async () => {
    const res = await pedir('/api/estoque/movimentacoes?posicao_em=15-08-2026', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'posicao_em invalida (use AAAA-MM-DD)' })
  })
})
