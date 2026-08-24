import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { perdas } from '../src/routes/perdas'

// perdas.test.ts cobre isolamento/RLS/constraints direto via withTenant.
// Este arquivo cobre a camada HTTP das rotas em src/routes/perdas.ts —
// sanear() (mass assignment), paraJson() (conversao numerica), a
// autorizacao (so exigirSessao — design: colaborador acessa estoque/
// perdas) e os codigos de status que os handlers produzem. Mesmo racional
// de clientes.http.test.ts, o molde declarado desta suite.
//
// Diferenca do molde (clientes.http.test.ts, que importa o app inteiro de
// src/index.ts): aqui a rota e montada num Hono local so com `perdas` — a
// tarefa que criou esta rota foi instruida a nao tocar em src/index.ts (a
// montagem final fica pra outro agente, pra nao conflitar com as demais
// entidades da Fase 1 sendo criadas em paralelo). O app local replica o
// mesmo contrato de erro do index.ts real (app.onError -> {erro} JSON,
// nunca texto puro).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/perdas', perdas)
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
let produtoId: string
let produtoOutroTenantId: string
let produtoCxComPeso: string
let produtoCxSemPeso: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-perdas-http', 'Perdas HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-perdas-http-2', 'Perdas HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from perdas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@perdas-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@perdas-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  const [produto] = await admin`
    insert into produtos (tenant_id, nome) values (${tenantId}, 'Produto Perda Http') returning id`
  produtoId = produto.id

  // Os dois produtos que a conversao de GET / distingue: o mesmo 'CX', um com
  // peso da embalagem cadastrado e outro sem (peso_medio = 0 = "nao
  // informado", ver migration 009).
  const [pCom] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, 'Alface Perda Http', 'CX', 8) returning id`
  produtoCxComPeso = pCom.id
  const [pSem] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, 'Sem Peso Perda Http', 'CX', 0) returning id`
  produtoCxSemPeso = pSem.id

  // Produto de dentro do OUTRO tenant — prova que a FK composta (migration
  // 010_fk_com_tenant.sql) rejeita uma referencia valida mas de fora do
  // tenant, nao so um uuid que nao existe em lugar nenhum.
  const [produtoOutro] = await admin`
    insert into produtos (tenant_id, nome) values (${outroTenantId}, 'Produto Outro Tenant') returning id`
  produtoOutroTenantId = produtoOutro.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes
 * do teste seguinte, para nao vazar conexoes entre casos. Mesmo padrao do
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
const json = (corpo: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})
const put = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})

function umaPerda(sobrescreve: Record<string, unknown> = {}) {
  return { data: '2026-01-10', produto_id: produtoId, un: 'KG', qtd: 3, motivo: 'vencimento', ...sobrescreve }
}

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/perdas')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 200 (design: colaborador acessa estoque/perdas)', async () => {
    const res = await pedir('/api/perdas', comoColab())
    expect(res.status).toBe(200)
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/perdas', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/perdas', comoAdmin({
      ...json({
        ...umaPerda(),
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from perdas where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda())))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({
      obs: 'editado', tenant_id: outroTenantId,
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.obs).toBe('editado')

    const [linha] = await admin`select tenant_id from perdas where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em; nao ha alterado_em nesta tabela)', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda())))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).not.toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/perdas/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/perdas', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const p of lista) expect(p).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ obs: 'x' })))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
  })
})

describe('conversao numerica (paraJson)', () => {
  it('GET /, GET /:id, POST e PUT devolvem qtd como number', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda({ qtd: 4.25 }))))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.qtd).toBe('number')
    expect(criado.qtd).toBe(4.25)

    const resGetId = await pedir(`/api/perdas/${criado.id}`, comoAdmin())
    expect(typeof (await resGetId.json()).qtd).toBe('number')

    const resGetLista = await pedir('/api/perdas', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const p of lista) expect(typeof p.qtd).toBe('number')

    const resPut = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ qtd: 9.5 })))
    const atualizado = await resPut.json()
    expect(typeof atualizado.qtd).toBe('number')
    expect(atualizado.qtd).toBe(9.5)
  })

  it('POST sem un/motivo usa os padroes do banco (KG, não informado)', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json({ data: '2026-01-10', produto_id: produtoId, qtd: 1 })))
    expect(res.status).toBe(201)
    const criado = await res.json()
    expect(criado.un).toBe('KG')
    expect(criado.motivo).toBe('não informado')
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda())))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/perdas/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).motivo).toBe('vencimento')

    const resPut = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ motivo: 'manuseio' })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).motivo).toBe('manuseio')

    const resDelete = await pedir(`/api/perdas/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/perdas/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem data -> 400', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json({ produto_id: produtoId, qtd: 1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data e obrigatoria' })
  })

  it('POST sem produto_id -> 400', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json({ data: '2026-01-10', qtd: 1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto_id invalido' })
  })

  it('POST com produto_id malformado -> 400', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json({
      data: '2026-01-10', produto_id: 'nao-e-um-uuid', qtd: 1,
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto_id invalido' })
  })

  it('POST sem qtd -> 400', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json({ data: '2026-01-10', produto_id: produtoId })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'qtd e obrigatoria e nao pode ser negativa' })
  })

  it('POST com qtd negativa -> 400', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json(umaPerda({ qtd: -1 }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'qtd e obrigatoria e nao pode ser negativa' })
  })

  it('PUT com qtd negativa -> 400, sem alterar o registro', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda({ qtd: 5 }))))
    const criado = await resPost.json()

    const res = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ qtd: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'qtd nao pode ser negativo' })

    const resGet = await pedir(`/api/perdas/${criado.id}`, comoAdmin())
    expect((await resGet.json()).qtd).toBe(5)
  })

  it('POST com motivo invalido -> 400 com mensagem especifica', async () => {
    const res = await pedir('/api/perdas', comoAdmin(json(umaPerda({ motivo: 'sei-la' }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'motivo invalido' })
  })

  it('PUT com motivo invalido -> 400 com mensagem especifica', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda())))
    const criado = await resPost.json()
    const res = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ motivo: 'sei-la' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'motivo invalido' })
  })

  it('POST com produto_id inexistente (uuid valido, mas sem produto) -> 400, nada fica gravado', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    const res = await pedir('/api/perdas', comoAdmin(json(umaPerda({ produto_id: idInexistente }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto nao encontrado' })

    const linhas = await admin`select id from perdas where tenant_id = ${tenantId} and produto_id = ${idInexistente}`
    expect(linhas).toHaveLength(0)
  })

  it('POST com produto_id de OUTRO tenant (existe de verdade, so nao aqui) -> 400, nada fica gravado', async () => {
    // Diferente do teste acima (uuid que nao existe em lugar nenhum): aqui
    // produtoOutroTenantId e real, so pertence ao tenant errado. Antes da
    // migration 010_fk_com_tenant.sql isso passava — a checagem de FK do
    // Postgres roda com os privilegios do dono da tabela e ignora RLS. A FK
    // composta (tenant_id, produto_id) fecha esse furo.
    const res = await pedir('/api/perdas', comoAdmin(json(umaPerda({ produto_id: produtoOutroTenantId }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto nao encontrado' })

    const linhas = await admin`select id from perdas where tenant_id = ${tenantId} and produto_id = ${produtoOutroTenantId}`
    expect(linhas).toHaveLength(0)
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const resPost = await pedir('/api/perdas', comoAdmin(json(umaPerda())))
    const criado = await resPost.json()
    const res = await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ campo_desconhecido: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/perdas/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(put({ qtd: 1 }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/perdas/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})

/**
 * GET / converte `perdas.qtd` para quilos porque quem consome esta listagem
 * SOMA varias perdas e as compara com numeros que ja estao em kg — o indice
 * de perdas do painel (web/src/derive/dashboard.ts) e o relatorio de perdas
 * (web/src/derive/relatorios.ts). Ver o comentario grande do handler em
 * src/routes/perdas.ts.
 *
 * A regra e a MESMA das outras quatro ocorrencias no projeto (entradas.ts,
 * saidas.ts, relatorios.ts, estoque.ts): 'KG' conta `qtd`; outra unidade
 * conta `qtd * produtos.peso_medio`, e so quando peso_medio > 0. Fator
 * ausente NUNCA vira 1 — a perda sai da soma (`qtd_kg` null) e e contada.
 */
describe('conversao para KG (GET /)', () => {
  async function criarELer(corpo: Record<string, unknown>) {
    const res = await pedir('/api/perdas', comoAdmin(json(corpo)))
    expect(res.status).toBe(201)
    const criado = await res.json()
    const lista = await (await pedir('/api/perdas', comoAdmin())).json()
    const linha = lista.find((p: { id: string }) => p.id === criado.id)
    expect(linha, 'a perda criada tem que aparecer na listagem').toBeTruthy()
    return linha
  }

  it('perda em KG: qtd_kg e a propria qtd (conversao no-op) e nada fica de fora', async () => {
    // Prova que a correcao nao mexeu em quem ja estava certo: perda lancada
    // em quilos vale exatamente o que valia antes desta versao.
    const linha = await criarELer(umaPerda({ un: 'KG', qtd: 11, produto_id: produtoId }))
    expect(linha.qtd).toBe(11)
    expect(linha.qtd_kg).toBe(11)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('perda em CX com peso medio cadastrado: qtd_kg = qtd * peso_medio', async () => {
    // 4 caixas de alface de 8 kg sao 32 kg, nunca "4".
    const linha = await criarELer(umaPerda({ un: 'CX', qtd: 4, produto_id: produtoCxComPeso }))
    expect(linha.qtd).toBe(4)
    expect(linha.qtd_kg).toBe(32)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('perda em CX SEM peso medio: qtd_kg e null (fator ausente nunca vira 1) e e contada', async () => {
    const linha = await criarELer(umaPerda({ un: 'CX', qtd: 4, produto_id: produtoCxSemPeso }))
    expect(linha.qtd).toBe(4)
    // Nem 4 (fator 1 inventado) nem 0 (perda que some fingindo nao ter havido
    // perda): null e o unico valor honesto, e o contador diz que existiu.
    expect(linha.qtd_kg).toBeNull()
    expect(linha.itens_sem_conversao).toBe(1)
  })

  it('converte pela unidade da PERDA, nao pela do cadastro do produto', async () => {
    // Produto cadastrado em CX (8 kg/caixa), mas a perda foi lancada em KG:
    // 11 kg sao 11 kg — multiplicar por 8 aqui daria 88.
    const linha = await criarELer(umaPerda({ un: 'KG', qtd: 11, produto_id: produtoCxComPeso }))
    expect(linha.qtd_kg).toBe(11)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('mistura: cada linha converte pela unidade dela, e so a nao convertivel fica de fora', async () => {
    const emKg = await criarELer(umaPerda({ un: 'KG', qtd: 11, produto_id: produtoId }))
    const emCx = await criarELer(umaPerda({ un: 'CX', qtd: 4, produto_id: produtoCxComPeso }))
    const semFator = await criarELer(umaPerda({ un: 'CX', qtd: 4, produto_id: produtoCxSemPeso }))

    const somaKg = [emKg, emCx, semFator].reduce((s, p) => s + (p.qtd_kg ?? 0), 0)
    const semConversao = [emKg, emCx, semFator].reduce((s, p) => s + p.itens_sem_conversao, 0)
    // 11 + 32, e nao 11 + 4 + 4 = 19 (somar caixas com quilos) nem
    // 11 + 32 + 4 = 47 (o nao convertivel entrando por um fator 1).
    expect(somaKg).toBe(43)
    expect(semConversao).toBe(1)
  })

  it('qtd_kg e itens_sem_conversao vem como number (numeric/int do Postgres chegam como string)', async () => {
    const linha = await criarELer(umaPerda({ un: 'CX', qtd: 2.5, produto_id: produtoCxComPeso }))
    expect(typeof linha.qtd_kg).toBe('number')
    expect(typeof linha.itens_sem_conversao).toBe('number')
    expect(linha.qtd_kg).toBe(20)
  })

  it('GET /:id, POST e PUT continuam devolvendo o registro cru, sem qtd_kg', async () => {
    // Divisao deliberada, igual a de entradas.ts (paraJson x paraJsonLista):
    // a verdade de UMA perda e a quantidade na unidade em que ela foi
    // lancada — que e o que o formulario de edicao carrega e o que a tabela
    // de Perdas mostra ("4 CX"). O quilo so aparece quando ela e SOMADA a
    // outras, ou seja, na listagem.
    const resPost = await pedir('/api/perdas', comoAdmin(json(
      umaPerda({ un: 'CX', qtd: 4, produto_id: produtoCxComPeso }),
    )))
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('qtd_kg')
    expect(criado).not.toHaveProperty('itens_sem_conversao')
    expect(criado.qtd).toBe(4)
    expect(criado.un).toBe('CX')

    const doId = await (await pedir(`/api/perdas/${criado.id}`, comoAdmin())).json()
    expect(doId).not.toHaveProperty('qtd_kg')
    expect(doId.qtd).toBe(4)

    const atualizado = await (await pedir(`/api/perdas/${criado.id}`, comoAdmin(put({ qtd: 5 })))).json()
    expect(atualizado).not.toHaveProperty('qtd_kg')
    expect(atualizado.qtd).toBe(5)
  })

  it('a listagem nunca perde uma perda por causa da conversao — so a tira da soma', async () => {
    // `left join produtos`, nao inner: a linha nao convertivel continua
    // aparecendo na tela de Perdas (com "4 CX"), marcada; o que ela nao faz e
    // entrar num total em quilos.
    const linha = await criarELer(umaPerda({ un: 'DZ', qtd: 3, produto_id: produtoCxSemPeso }))
    expect(linha.un).toBe('DZ')
    expect(linha.qtd).toBe(3)
    expect(linha.qtd_kg).toBeNull()
  })
})
