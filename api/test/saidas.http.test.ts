import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { saidas } from '../src/routes/saidas'

// saidas.test.ts cobre isolamento/RLS/constraints direto via withTenant.
// Este arquivo cobre a camada HTTP — sanear() (mass assignment), paraJson()
// (conversao numerica), a autorizacao, os codigos de status, a transacao
// cabecalho+itens e o calculo automatico de vencimento. Mesmo padrao de
// clientes.http.test.ts.
//
// api/src/index.ts ainda nao monta esta rota (outro agente faz a
// montagem — fora do escopo desta tarefa). Para exercitar a camada HTTP
// sem tocar em index.ts, este arquivo monta seu proprio Hono minimo com
// so o router de saidas, replicando aqui o mesmo app.onError de index.ts
// (json {erro} para excecao nao mapeada, nunca texto puro).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/saidas', saidas)
app.onError((err, c) => {
  console.error('erro nao tratado (teste):', err)
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
let produtoCaixaComPeso: string
let produtoCaixaSemPeso: string
let clienteId: string // prazo = 10 dias
let clienteSemPrazoId: string // prazo = 0 dias, so pra variar o calculo
// Um cliente por cenario da memoria de preco (ver comentario no beforeAll).
let clienteMemoriaId: string
let clienteDesempateId: string
let clienteSemHistoricoId: string
let clienteStatusId: string
let clientePrecoZeroId: string
let clienteUnidadesId: string
// Segundo tenant, com sessao propria — isolamento de verdade.
let tokenOutroTenant: string
let produtoOutroTenantId: string
let clienteOutroTenantId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-saidas-http', 'Saidas HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-saidas-http-2', 'Saidas HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from saida_itens where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from saidas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from clientes where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@saidas-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@saidas-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  const [produto] = await admin`
    insert into produtos (tenant_id, nome) values (${tenantId}, 'Tomate') returning id`
  produtoId = produto.id

  // Fixtures da conversao para KG do `peso` (GET /): um produto vendido em
  // caixa COM peso medio cadastrado (1 CX = 20 kg) e outro em caixa sem peso
  // medio (0 = "nao informado", ver migration 009) — o segundo nao e
  // convertivel e por isso fica de fora do total, contado em
  // itens_sem_conversao. `produtoId` acima fica com o default (un 'KG',
  // peso_medio 0) de proposito: e o caso "so KG", onde a conversao e no-op.
  // Mesmas fixtures de entradas.http.test.ts, pela mesma regra.
  const [produtoCx] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, 'Caixa Com Peso Saida', 'CX', 20) returning id`
  produtoCaixaComPeso = produtoCx.id
  const [produtoCxSemPeso] = await admin`
    insert into produtos (tenant_id, nome, un, peso_medio)
    values (${tenantId}, 'Caixa Sem Peso Saida', 'CX', 0) returning id`
  produtoCaixaSemPeso = produtoCxSemPeso.id

  const [cliente] = await admin`
    insert into clientes (tenant_id, nome, prazo) values (${tenantId}, 'Mercado Prazo 10', 10) returning id`
  clienteId = cliente.id
  const [cliente2] = await admin`
    insert into clientes (tenant_id, nome, prazo) values (${tenantId}, 'Mercado Prazo 0', 0) returning id`
  clienteSemPrazoId = cliente2.id

  // ---- fixtures da memoria de preco (GET /ultimos-precos/:clienteId) ----
  // Um cliente POR CENARIO: a consulta e "tudo o que este cliente ja
  // comprou", entao dois cenarios no mesmo cliente se contaminariam (e um
  // teste passaria a depender da ordem de execucao do outro).
  const nomesMemoria = [
    'Memoria Historico', 'Memoria Desempate', 'Memoria Sem Historico',
    'Memoria Status', 'Memoria Preco Zero', 'Memoria Unidades',
  ]
  const criados = await Promise.all(nomesMemoria.map(nome => admin`
    insert into clientes (tenant_id, nome) values (${tenantId}, ${nome}) returning id`))
  ;[
    clienteMemoriaId, clienteDesempateId, clienteSemHistoricoId,
    clienteStatusId, clientePrecoZeroId, clienteUnidadesId,
  ] = criados.map(([c]) => c.id as string)

  // Segundo tenant COM SESSAO PROPRIA — sem isso o teste de isolamento
  // provaria so que um id inexistente devolve vazio, nao que o dado do
  // vizinho existe e mesmo assim nao vaza.
  const [uOutro] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${outroTenantId}, 'admin@saidas-http-2.com', ${hash}, 'Admin 2', 'admin') returning id`
  tokenOutroTenant = await criarSessao(sql, uOutro.id, outroTenantId)
  const [pOutro] = await admin`
    insert into produtos (tenant_id, nome) values (${outroTenantId}, 'Tomate Vizinho') returning id`
  produtoOutroTenantId = pOutro.id
  const [cOutro] = await admin`
    insert into clientes (tenant_id, nome) values (${outroTenantId}, 'Mercado Vizinho') returning id`
  clienteOutroTenantId = cOutro.id
})

/**
 * Semeia uma venda direto via `admin` (superusuario, fora da RLS) em vez de
 * pelo POST da rota: estes testes leem a memoria de preco, e precisam
 * controlar com exatidao `numero`, `data_pedido`, `status` e o preco de
 * cada item — inclusive combinacoes que o POST calcularia sozinho (venc) ou
 * que so existem no historico ja gravado. A camada HTTP de POST ja e
 * coberta pelos blocos acima deste arquivo.
 */
async function semearVenda(
  tenant: string,
  clienteAlvo: string,
  numero: string,
  dataPedido: string,
  status: string,
  itens: { produto: string; un?: string; preco: number; qtd?: number }[],
) {
  const [s] = await admin`
    insert into saidas (tenant_id, cliente_id, numero, data_pedido, status)
    values (${tenant}, ${clienteAlvo}, ${numero}, ${dataPedido}, ${status}) returning id`
  for (const it of itens) {
    await admin`
      insert into saida_itens (tenant_id, saida_id, produto_id, un, qtd, preco)
      values (${tenant}, ${s.id}, ${it.produto}, ${it.un ?? 'KG'}, ${it.qtd ?? 10}, ${it.preco})`
  }
  return s.id as string
}

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fornecemos um ExecutionContext minimo e aguardamos
 * as promises antes do teste seguinte. Mesmo padrao de clientes.http.test.ts.
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
const jsonPut = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})
const jsonPatch = (corpo: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})

/** Payload minimo valido de POST — numero precisa ser unico por teste. */
function corpoValido(numero: string, extra: Record<string, unknown> = {}) {
  return {
    numero,
    data_pedido: '2026-08-01',
    itens: [{ produto_id: produtoId, un: 'KG', qtd: 10, preco: 5 }],
    ...extra,
  }
}

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/saidas')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 200 (design: pedidos nao e ADMIN_ONLY_SCREENS, ao contrario de clientes)', async () => {
    const res = await pedir('/api/saidas', comoColab())
    expect(res.status).toBe(200)
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/saidas', comoAdmin())
    expect(res.status).toBe(200)
  })

  it('colaborador consegue criar uma saida (nao so ler)', async () => {
    const res = await pedir('/api/saidas', comoColab(json(corpoValido('S-HTTP-COLAB'))))
    expect(res.status).toBe(201)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo (cabecalho)', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-HTTP-0001', {
      tenant_id: outroTenantId,
      id: '00000000-0000-0000-0000-000000000000',
    }))))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from saidas where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('POST ignora tenant_id/saida_id/id forjados dentro de um item', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-HTTP-0002',
      data_pedido: '2026-08-01',
      itens: [{
        produto_id: produtoId, un: 'KG', qtd: 1, preco: 1,
        tenant_id: outroTenantId,
        saida_id: '00000000-0000-0000-0000-000000000000',
        id: '00000000-0000-0000-0000-000000000000',
      }],
    })))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.itens[0].id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [item] = await admin`select tenant_id, saida_id from saida_itens where id = ${corpo.itens[0].id}`
    expect(item.tenant_id).toBe(tenantId)
    expect(item.saida_id).toBe(corpo.id)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-HTTP-0003'))))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({
      status: 'Em rota',
      tenant_id: outroTenantId,
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 2, preco: 3 }],
    })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).status).toBe('Em rota')

    const [linha] = await admin`select tenant_id from saidas where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id no cabecalho nem nos itens', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-HTTP-0004'))))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado.itens[0]).not.toHaveProperty('tenant_id')

    const resGetId = await pedir(`/api/saidas/${criado.id}`, comoAdmin())
    const lido = await resGetId.json()
    expect(lido).not.toHaveProperty('tenant_id')
    expect(lido.itens[0]).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/saidas', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const s of lista) expect(s).not.toHaveProperty('tenant_id')
  })
})

describe('conversao numerica (paraJson)', () => {
  it('perda_kg do cabecalho e qtd/preco/perda_kg dos itens voltam como number', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-HTTP-0005', {
      perda_kg: 1.5,
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 3.25, preco: 9.9, perda_kg: 0.1 }],
    }))))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.perda_kg).toBe('number')
    expect(criado.perda_kg).toBe(1.5)
    expect(typeof criado.itens[0].qtd).toBe('number')
    expect(criado.itens[0].qtd).toBe(3.25)
    expect(typeof criado.itens[0].preco).toBe('number')
    expect(typeof criado.itens[0].perda_kg).toBe('number')

    const resGetId = await pedir(`/api/saidas/${criado.id}`, comoAdmin())
    const lido = await resGetId.json()
    expect(typeof lido.perda_kg).toBe('number')
    expect(typeof lido.itens[0].qtd).toBe('number')
  })

  it('GET / devolve valor (sum qtd*preco) e peso (sum qtd) agregados, como number, sem itens', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-HTTP-0006', {
      itens: [
        { produto_id: produtoId, un: 'KG', qtd: 2, preco: 10 },
        { produto_id: produtoId, un: 'KG', qtd: 3, preco: 4 },
      ],
    }))))
    const criado = await resPost.json()

    const resLista = await pedir('/api/saidas', comoAdmin())
    const lista = await resLista.json()
    const linha = lista.find((s: { id: string }) => s.id === criado.id)
    expect(linha).toBeTruthy()
    expect(linha.itens).toBeUndefined()
    expect(typeof linha.valor).toBe('number')
    expect(typeof linha.peso).toBe('number')
    // 2*10 + 3*4 = 32; 2 + 3 = 5
    expect(linha.valor).toBe(32)
    expect(linha.peso).toBe(5)
  })
})

describe('calculo automatico de vencimento (P1 do To Do do cliente)', () => {
  it('sem venc no corpo, com cliente_id e entrega -> venc = entrega + prazo do cliente', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0001', {
      cliente_id: clienteId, // prazo = 10
      entrega: '2026-08-10',
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()
    expect(criado.venc).toBe('2026-08-20')
  })

  it('venc explicito no corpo -> respeita o valor enviado, mesmo divergindo do calculo', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0002', {
      cliente_id: clienteId, // calcularia 2026-08-20
      entrega: '2026-08-10',
      venc: '2026-09-01', // negociado manualmente, diferente do prazo padrao
    }))))
    expect(res.status).toBe(201)
    expect((await res.json()).venc).toBe('2026-09-01')
  })

  it('sem cliente_id -> venc nao e calculado (fica null)', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0003', {
      entrega: '2026-08-10',
    }))))
    expect(res.status).toBe(201)
    expect((await res.json()).venc).toBeNull()
  })

  it('sem entrega -> venc nao e calculado (fica null)', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0004', {
      cliente_id: clienteId,
    }))))
    expect(res.status).toBe(201)
    expect((await res.json()).venc).toBeNull()
  })

  it('prazo 0 -> venc = a propria data de entrega', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0005', {
      cliente_id: clienteSemPrazoId,
      entrega: '2026-08-15',
    }))))
    expect(res.status).toBe(201)
    expect((await res.json()).venc).toBe('2026-08-15')
  })

  it('PUT sem venc, so mudando entrega -> recalcula usando o cliente_id ja gravado na saida', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0006', {
      cliente_id: clienteId, // prazo = 10
      entrega: '2026-08-10',
    }))))
    const criado = await resPost.json()
    expect(criado.venc).toBe('2026-08-20')

    const resPut = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({
      entrega: '2026-09-01',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).venc).toBe('2026-09-11')
  })

  it('PUT com venc explicito -> respeita o valor enviado, nao recalcula', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-VENC-0007', {
      cliente_id: clienteId,
      entrega: '2026-08-10',
    }))))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({
      venc: '2026-12-25',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).venc).toBe('2026-12-25')
  })
})

describe('transacao cabecalho + itens (rollback)', () => {
  it('POST com item invalido (qtd negativa) -> 400, e nao deixa a saida gravada pela metade', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-ROLLBACK-0001',
      data_pedido: '2026-08-01',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: -5, preco: 1 }],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'qtd de um item nao pode ser negativa' })

    const linhas = await admin`select id from saidas where tenant_id = ${tenantId} and numero = 'S-ROLLBACK-0001'`
    expect(linhas).toEqual([])
  })

  it('POST com preco negativo em um item entre varios -> 400, nenhum item fica gravado', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-ROLLBACK-0002',
      data_pedido: '2026-08-01',
      itens: [
        { produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 },
        { produto_id: produtoId, un: 'KG', qtd: 1, preco: -1 },
      ],
    })))
    expect(res.status).toBe(400)

    const linhas = await admin`select id from saidas where tenant_id = ${tenantId} and numero = 'S-ROLLBACK-0002'`
    expect(linhas).toEqual([])
  })

  it('PUT com item invalido -> 400, e os itens antigos continuam intactos (delete+insert da mesma transacao volta)', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-ROLLBACK-0003', {
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 7, preco: 2 }],
    }))))
    const criado = await resPost.json()
    expect(criado.itens).toHaveLength(1)

    const resPut = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({
      itens: [{ produto_id: produtoId, un: 'KG', qtd: -1, preco: 2 }],
    })))
    expect(resPut.status).toBe(400)

    const itensDepois = await admin`select qtd, preco from saida_itens where saida_id = ${criado.id}`
    expect(itensDepois).toHaveLength(1)
    expect(Number(itensDepois[0].qtd)).toBe(7)
    expect(Number(itensDepois[0].preco)).toBe(2)
  })

  it('POST sem itens -> 400, sem tocar o banco', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-SEM-ITEM', data_pedido: '2026-08-01', itens: [],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pelo menos um item e obrigatorio' })
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id (com itens) -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-CRUD-0001'))))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado.itens).toHaveLength(1)

    const resGet = await pedir(`/api/saidas/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    const lido = await resGet.json()
    expect(lido.numero).toBe('S-CRUD-0001')
    expect(lido.itens).toHaveLength(1)

    const resPut = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({
      obs: 'atualizado',
      itens: [{ produto_id: produtoId, un: 'CX', qtd: 4, preco: 8 }],
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.obs).toBe('atualizado')
    expect(atualizado.itens).toHaveLength(1)
    expect(atualizado.itens[0].un).toBe('CX')

    const resDelete = await pedir(`/api/saidas/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/saidas/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem numero -> 400', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      data_pedido: '2026-08-01',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'numero e obrigatorio' })
  })

  it('POST sem data_pedido -> 400', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-SEM-DATA',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data_pedido e obrigatoria' })
  })

  it('POST com data em formato invalido -> 400 JSON, nunca 500 texto puro', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-DATA-RUIM', {
      data_pedido: '01/08/2026',
    }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data_pedido invalida (use AAAA-MM-DD)' })
  })

  it('POST com cliente_id malformado -> 400, nunca 500', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-CLI-RUIM', {
      cliente_id: 'nao-e-um-uuid',
    }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'cliente_id invalido' })
  })

  it('POST com produto_id malformado dentro do item -> 400, nunca 500', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json({
      numero: 'S-PROD-RUIM',
      data_pedido: '2026-08-01',
      itens: [{ produto_id: 'nao-e-um-uuid', un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'item 0: produto_id invalido' })
  })

  it('POST com status invalido -> 400 com mensagem especifica', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-STATUS-RUIM', {
      status: 'sei-la',
    }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'status invalido' })
  })

  it('POST com numero duplicado no mesmo tenant -> 409', async () => {
    await pedir('/api/saidas', comoAdmin(json(corpoValido('S-DUP-0001'))))
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-DUP-0001'))))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe uma saida com esse numero' })
  })

  it('PUT renomeando numero para um ja existente no tenant -> 409', async () => {
    await pedir('/api/saidas', comoAdmin(json(corpoValido('S-DUP-A'))))
    const resB = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-DUP-B'))))
    const b = await resB.json()

    const res = await pedir(`/api/saidas/${b.id}`, comoAdmin(jsonPut({
      numero: 'S-DUP-A',
      itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe uma saida com esse numero' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/saidas/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(jsonPut({ itens: [{ produto_id: produtoId, un: 'KG', qtd: 1, preco: 1 }] }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/saidas/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })

  it('PUT sem itens -> 400', async () => {
    const resPost = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-PUT-SEM-ITEM'))))
    const criado = await resPost.json()
    const res = await pedir(`/api/saidas/${criado.id}`, comoAdmin(jsonPut({ obs: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pelo menos um item e obrigatorio' })
  })
})

// Chip de pagamento editável direto na linha da tabela (SaidasLista) —
// atalho pra acao mais repetida da tela, sem reenviar `itens` (que o PUT
// completo sempre exige, ver "PUT sem itens -> 400" acima).
describe('PATCH /:id/pag — atalho de pagamento sem reenviar itens', () => {
  async function criarSaida(numero: string, extra: Record<string, unknown> = {}) {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido(numero, extra))))
    return res.json()
  }

  it('marcar Pago grava pag=Pago e data_pag=hoje (data do servidor)', async () => {
    const criada = await criarSaida('PATCH-S-1', { pag: 'Pendente' })
    expect(criada.data_pag).toBeNull()

    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({ pag: 'Pago' })))
    expect(res.status).toBe(200)
    const atualizada = await res.json()
    expect(atualizada.pag).toBe('Pago')
    const hoje = new Date().toISOString().slice(0, 10)
    expect(atualizada.data_pag).toBe(hoje)

    const [linha] = await admin`select pag, data_pag from saidas where id = ${criada.id}`
    expect(linha.pag).toBe('Pago')
    expect((linha.data_pag as Date).toISOString().slice(0, 10)).toBe(hoje)
  })

  it('voltar para Pendente LIMPA data_pag (nao deixa um pendente com data de pagamento gravada)', async () => {
    const criada = await criarSaida('PATCH-S-2', { pag: 'Pago', data_pag: '2026-01-15' })
    expect(criada.data_pag).toBe('2026-01-15')

    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({ pag: 'Pendente' })))
    expect(res.status).toBe(200)
    const atualizada = await res.json()
    expect(atualizada.pag).toBe('Pendente')
    expect(atualizada.data_pag).toBeNull()

    const [linha] = await admin`select pag, data_pag from saidas where id = ${criada.id}`
    expect(linha.pag).toBe('Pendente')
    expect(linha.data_pag).toBeNull()
  })

  it('nao mexe em venc nem nos itens da saida', async () => {
    const criada = await criarSaida('PATCH-S-3', { venc: '2026-03-01' })
    expect(criada.itens).toHaveLength(1)
    const idItemAntes = criada.itens[0].id

    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({ pag: 'Pago' })))
    const atualizada = await res.json()
    expect(atualizada.venc).toBe('2026-03-01')

    const itensDepois = await admin`select id from saida_itens where saida_id = ${criada.id}`
    expect(itensDepois).toHaveLength(1)
    expect(itensDepois[0].id).toBe(idItemAntes)
  })

  it('pag="Atrasado" -> 400 (nao e mais uma escolha por este atalho, so pelo PUT completo)', async () => {
    const criada = await criarSaida('PATCH-S-4')
    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({ pag: 'Atrasado' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pag deve ser "Pago" ou "Pendente"' })
  })

  it('pag="—" -> 400 (nao e mais uma escolha por este atalho)', async () => {
    const criada = await criarSaida('PATCH-S-5')
    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({ pag: '—' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pag deve ser "Pago" ou "Pendente"' })
  })

  it('pag invalido/ausente -> 400', async () => {
    const criada = await criarSaida('PATCH-S-6')
    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoAdmin(jsonPatch({})))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pag deve ser "Pago" ou "Pendente"' })
  })

  it('id inexistente (uuid valido) -> 404', async () => {
    const res = await pedir(
      '/api/saidas/00000000-0000-0000-0000-000000000000/pag',
      comoAdmin(jsonPatch({ pag: 'Pago' })),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('id malformado -> 400 JSON, nunca 500', async () => {
    const res = await pedir('/api/saidas/nao-e-um-uuid/pag', comoAdmin(jsonPatch({ pag: 'Pago' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'id invalido' })
  })

  it('colaborador tambem pode usar o atalho (mesma permissao de escrita da tela)', async () => {
    const criada = await criarSaida('PATCH-S-7')
    const res = await pedir(`/api/saidas/${criada.id}/pag`, comoColab(jsonPatch({ pag: 'Pago' })))
    expect(res.status).toBe(200)
  })

  it('sem cookie -> 401', async () => {
    const res = await pedir(
      '/api/saidas/00000000-0000-0000-0000-000000000000/pag',
      jsonPatch({ pag: 'Pago' }),
    )
    expect(res.status).toBe(401)
  })
})

/**
 * `peso` de GET / sai em KG, nao na soma crua das qtd. `saida_itens.un`
 * aceita as mesmas unidades de produtos.un ('KG','CX','UN','DZ','MC') e somar
 * tudo junto produzia um numero sem significado fisico (30 KG + 12 CX = "42")
 * que alimenta `qtdEntregueKg` na aba Pedidos do relatorio (uma coluna que ja
 * se chamava "Kg") e, o mais grave, o lado direito da subtracao
 * `qEnt - qPer - qSai` de diasEstoque (web/src/derive/financeiro.ts) — giro de
 * estoque e ciclo de caixa do Dashboard. A regra e a mesma de
 * api/src/routes/entradas.ts (peso_total) e api/src/routes/estoque.ts
 * (paraJson/equivalente_kg): 'KG' conta qtd, o resto conta
 * qtd * produtos.peso_medio, e so quando peso_medio > 0.
 */
describe('peso em KG (conversao por produtos.peso_medio)', () => {
  async function linhaDaLista(id: string) {
    const res = await pedir('/api/saidas', comoAdmin())
    const lista = await res.json()
    return lista.find((s: { id: string }) => s.id === id)
  }

  it('so KG: peso e a soma crua das qtd (a conversao e no-op) e nada fica de fora', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-KG-1', {
      itens: [
        { produto_id: produtoId, un: 'KG', qtd: 30, preco: 2 },
        { produto_id: produtoId, un: 'KG', qtd: 12, preco: 3 },
      ],
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()

    const linha = await linhaDaLista(criado.id)
    // Identico ao que a rota ja devolvia antes da conversao existir: quem
    // lanca tudo em KG nao pode ver numero nenhum mudar.
    expect(linha.peso).toBe(42)
    expect(linha.valor).toBe(96)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('CX com peso medio cadastrado: peso = qtd * peso_medio (1 CX = 20 kg)', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-CX-1', {
      itens: [{ produto_id: produtoCaixaComPeso, un: 'CX', qtd: 12, preco: 45 }],
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()

    const linha = await linhaDaLista(criado.id)
    // 12 caixas x 20 kg = 240 kg — nao "12".
    expect(linha.peso).toBe(240)
    expect(linha.itens_sem_conversao).toBe(0)
    // valor nao muda com unidade nenhuma: reais sao reais.
    expect(linha.valor).toBe(540)
  })

  it('CX com peso medio zero: o item fica FORA do peso e e contado em itens_sem_conversao', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-CX-SEM-1', {
      itens: [{ produto_id: produtoCaixaSemPeso, un: 'CX', qtd: 12, preco: 45 }],
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()

    const linha = await linhaDaLista(criado.id)
    // Sem peso_medio nao ha como converter caixa em quilo — e o fator NAO e
    // inventado como 1 (uma caixa nao pesa um quilo). A contribuicao sai do
    // total e o contador denuncia a falta.
    expect(linha.peso).toBe(0)
    expect(linha.itens_sem_conversao).toBe(1)
    // O valor continua inteiro: o que falta e o peso, nao o dinheiro.
    expect(linha.valor).toBe(540)
  })

  it('mistura KG + CX na mesma saida: soma so depois de converter cada item', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-MIX-1', {
      itens: [
        { produto_id: produtoId, un: 'KG', qtd: 30, preco: 2 },
        { produto_id: produtoCaixaComPeso, un: 'CX', qtd: 12, preco: 45 },
      ],
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()

    const linha = await linhaDaLista(criado.id)
    // 30 kg + (12 CX x 20 kg) = 270 kg. Antes da correcao: 30 + 12 = "42".
    expect(linha.peso).toBe(270)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('mistura convertivel + nao convertivel: soma o que da e conta o que ficou de fora', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-MIX-2', {
      itens: [
        { produto_id: produtoId, un: 'KG', qtd: 30, preco: 2 },
        { produto_id: produtoCaixaComPeso, un: 'CX', qtd: 12, preco: 45 },
        { produto_id: produtoCaixaSemPeso, un: 'CX', qtd: 5, preco: 40 },
      ],
    }))))
    expect(res.status).toBe(201)
    const criado = await res.json()

    const linha = await linhaDaLista(criado.id)
    // 30 + 240 = 270 kg; as 5 caixas sem peso medio nao entram (e nao viram
    // 5 "quilos"), mas o R$ 200 delas continua no valor.
    expect(linha.peso).toBe(270)
    expect(linha.itens_sem_conversao).toBe(1)
    expect(linha.valor).toBe(30 * 2 + 12 * 45 + 5 * 40)
  })

  it('itens_sem_conversao sai como number (count e bigint no Postgres)', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-TIPO-1', {
      itens: [{ produto_id: produtoCaixaSemPeso, un: 'CX', qtd: 1, preco: 1 }],
    }))))
    const criado = await res.json()
    const linha = await linhaDaLista(criado.id)
    expect(typeof linha.itens_sem_conversao).toBe('number')
  })

  it('perda_kg do cabecalho NAO e convertida — e KG por contrato, em item de qualquer unidade', async () => {
    const res = await pedir('/api/saidas', comoAdmin(json(corpoValido('S-PERDA-CX', {
      perda_kg: 6,
      itens: [{ produto_id: produtoCaixaComPeso, un: 'CX', qtd: 10, preco: 45 }],
    }))))
    const criado = await res.json()
    const linha = await linhaDaLista(criado.id)
    // Multiplicar por peso_medio aqui viraria 6*20=120 e estragaria um numero
    // que ja esta certo. So o peso muda de unidade.
    expect(linha.perda_kg).toBe(6)
    expect(linha.peso).toBe(200)
  })
})

/**
 * A MEMORIA DE PRECO POR CLIENTE — GET /ultimos-precos/:clienteId.
 *
 * O que a rota promete: para UM cliente, o ultimo preco cobrado dele em cada
 * (produto, unidade) que ele ja comprou, com a data daquela venda, numa
 * consulta so. O raciocinio completo (por que um endpoint agregado, por que
 * a data vai junto, por que a chave inclui a unidade, o desempate e o filtro
 * de status) esta no comentario da rota em src/routes/saidas.ts.
 */
describe('GET /ultimos-precos/:clienteId — memoria de preco por cliente', () => {
  const comoOutroTenant = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenOutroTenant}` },
  })

  async function memoriaDe(clienteAlvo: string, comoQuem = comoAdmin) {
    const res = await pedir(`/api/saidas/ultimos-precos/${clienteAlvo}`, comoQuem())
    expect(res.status).toBe(200)
    return await res.json() as {
      produto_id: string; un: string; preco: number; data: string; numero: string
    }[]
  }

  it('cliente com historico: devolve o ultimo preco daquele produto E a data da venda', async () => {
    await semearVenda(tenantId, clienteMemoriaId, 'S-MEM-01', '2026-05-10', 'Entregue',
      [{ produto: produtoId, preco: 3.5 }])
    await semearVenda(tenantId, clienteMemoriaId, 'S-MEM-02', '2026-08-12', 'Entregue',
      [{ produto: produtoId, preco: 4.2 }])

    const memoria = await memoriaDe(clienteMemoriaId)
    expect(memoria).toEqual([
      { produto_id: produtoId, un: 'KG', preco: 4.2, data: '2026-08-12', numero: 'S-MEM-02' },
    ])
    // preco e numeric e data e `date`: sem conversao na borda o primeiro
    // voltaria como string ("4.2000") e a segunda como ISO completo
    // ("2026-08-12T00:00:00.000Z"), que nao e o formato que o resto da API
    // usa nem o que a tela sabe formatar.
    expect(typeof memoria[0].preco).toBe('number')
  })

  it('duas vendas do MESMO cliente na MESMA data: desempate estavel pelo numero da saida', async () => {
    // Mesma data — sem um segundo criterio de ordenacao, qual das duas o
    // `distinct on` escolhe fica a criterio do plano de execucao, e o preco
    // devolvido muda conforme a ordem em que o banco entrega as linhas. Este
    // bug exato ja apareceu no projeto (variacao de preco por fornecedor,
    // commit f8e2954).
    //
    // DOIS PARES ESPELHADOS, de proposito. Um par so nao prova nada: sem o
    // desempate o banco devolve UMA das duas linhas empatadas, e se calhar
    // de ser justo a esperada o teste passa por sorte (medido — foi o que
    // aconteceu na primeira versao deste teste). Com dois pares gravados em
    // ordens opostas, o vencedor correto e a linha gravada PRIMEIRO num par
    // e a gravada POR ULTIMO no outro: qualquer criterio implicito que o
    // plano use (a primeira linha do grupo, a ultima, a ordem fisica no
    // heap) acerta no maximo um dos dois pares. So a regra explicita —
    // maior numero vence — acerta os dois ao mesmo tempo.
    await semearVenda(tenantId, clienteDesempateId, 'S-DES-2', '2026-08-20', 'Entregue',
      [{ produto: produtoId, preco: 9 }])
    await semearVenda(tenantId, clienteDesempateId, 'S-DES-1', '2026-08-20', 'Entregue',
      [{ produto: produtoId, preco: 7 }])
    await semearVenda(tenantId, clienteDesempateId, 'S-DES-3', '2026-08-20', 'Entregue',
      [{ produto: produtoCaixaComPeso, un: 'CX', preco: 70 }])
    await semearVenda(tenantId, clienteDesempateId, 'S-DES-4', '2026-08-20', 'Entregue',
      [{ produto: produtoCaixaComPeso, un: 'CX', preco: 90 }])

    const primeira = await memoriaDe(clienteDesempateId)
    expect(primeira).toEqual([
      { produto_id: produtoCaixaComPeso, un: 'CX', preco: 90, data: '2026-08-20', numero: 'S-DES-4' },
      { produto_id: produtoId, un: 'KG', preco: 9, data: '2026-08-20', numero: 'S-DES-2' },
      // Ordenado como a consulta ordena (por produto_id), sem depender de
      // qual uuid o Postgres sorteou pra cada produto neste run.
    ].sort((a, b) => (a.produto_id < b.produto_id ? -1 : 1)))

    // Repetido: o valor nao pode variar entre chamadas identicas.
    const segunda = await memoriaDe(clienteDesempateId)
    const terceira = await memoriaDe(clienteDesempateId)
    expect(segunda).toEqual(primeira)
    expect(terceira).toEqual(primeira)
  })

  it('o mesmo produto+unidade duas vezes DENTRO da mesma saida tambem desempata sozinho', async () => {
    // `numero` nao separa estas duas: e a mesma saida. Sem o `i.id desc` no
    // fim do order by, o `distinct on` escolheria uma das duas linhas sem
    // criterio nenhum. O valor devolvido tem de ser sempre o mesmo.
    await semearVenda(tenantId, clienteDesempateId, 'S-DES-9', '2026-08-21', 'Entregue',
      [{ produto: produtoCaixaSemPeso, un: 'CX', preco: 11 },
       { produto: produtoCaixaSemPeso, un: 'CX', preco: 13 }])

    const linhas = await Promise.all([1, 2, 3].map(() => memoriaDe(clienteDesempateId)))
    const doProduto = linhas.map(l => l.find(x => x.produto_id === produtoCaixaSemPeso)?.preco)
    expect(doProduto[0]).toBeDefined()
    expect(new Set(doProduto).size).toBe(1)
  })

  it('cliente sem nenhuma venda: devolve vazio (nao inventa preco de outro cliente nem media)', async () => {
    // clienteMemoriaId acima ja tem historico do MESMO produto — se a rota
    // caisse em "preco de qualquer cliente" ou numa media, este array viria
    // preenchido.
    expect(await memoriaDe(clienteSemHistoricoId)).toEqual([])
  })

  it('produto que ESTE cliente nunca comprou nao aparece, mesmo tendo sido vendido a outro', async () => {
    await semearVenda(tenantId, clienteSemPrazoId, 'S-MEM-20', '2026-08-01', 'Entregue',
      [{ produto: produtoCaixaComPeso, un: 'CX', preco: 55 }])

    const memoria = await memoriaDe(clienteMemoriaId)
    expect(memoria.map(l => l.produto_id)).not.toContain(produtoCaixaComPeso)
  })

  it('venda CANCELADA nao entra na memoria — e a memoria cai no ultimo preco que de fato foi cobrado', async () => {
    // Uma venda cancelada nunca aconteceu: o preco dela nunca foi cobrado de
    // ninguem. Ela tambem nao pode "sombrear" o historico real — o preco
    // devolvido tem de ser o da ultima venda VALIDA, nao vazio.
    await semearVenda(tenantId, clienteStatusId, 'S-MEM-30', '2026-07-01', 'Entregue',
      [{ produto: produtoId, preco: 2.5 }])
    await semearVenda(tenantId, clienteStatusId, 'S-MEM-31', '2026-08-25', 'Cancelado',
      [{ produto: produtoId, preco: 99 }])

    const memoria = await memoriaDe(clienteStatusId)
    expect(memoria).toEqual([
      { produto_id: produtoId, un: 'KG', preco: 2.5, data: '2026-07-01', numero: 'S-MEM-30' },
    ])
  })

  it('produto comprado SO em venda cancelada nao aparece', async () => {
    await semearVenda(tenantId, clienteStatusId, 'S-MEM-32', '2026-08-26', 'Cancelado',
      [{ produto: produtoCaixaSemPeso, un: 'CX', preco: 40 }])

    const memoria = await memoriaDe(clienteStatusId)
    expect(memoria.map(l => l.produto_id)).not.toContain(produtoCaixaSemPeso)
  })

  it('venda DEVOLVIDA entra: a venda aconteceu e o preco foi acordado', async () => {
    // Decisao deliberada, e diferente de estoque.ts / diasEstoque, que
    // excluem Cancelado E Devolvido: la a pergunta e quanta mercadoria se
    // moveu (a devolvida voltou pra prateleira); aqui e qual preco foi
    // acordado com este cliente, e a devolucao nao desfaz o acordo.
    await semearVenda(tenantId, clienteStatusId, 'S-MEM-33', '2026-08-27', 'Devolvido',
      [{ produto: produtoId, preco: 6.75 }])

    const memoria = await memoriaDe(clienteStatusId)
    expect(memoria).toContainEqual(
      { produto_id: produtoId, un: 'KG', preco: 6.75, data: '2026-08-27', numero: 'S-MEM-33' },
    )
  })

  it('pedido ainda Pendente entra — e costuma ser o preco mais atual que existe', async () => {
    await semearVenda(tenantId, clienteStatusId, 'S-MEM-34', '2026-08-28', 'Pendente',
      [{ produto: produtoId, preco: 8.1 }])

    const memoria = await memoriaDe(clienteStatusId)
    expect(memoria).toContainEqual(
      { produto_id: produtoId, un: 'KG', preco: 8.1, data: '2026-08-28', numero: 'S-MEM-34' },
    )
  })

  it('item gravado com preco 0 nao vira memoria — cai no ultimo preco de verdade', async () => {
    // O modal converte campo de preco vazio em 0 no envio, entao 0 aqui quase
    // sempre e "ninguem preencheu". Devolve-lo abriria o campo com "R$ 0,00"
    // ja escrito — o defeito do zero pre-preenchido que o projeto ja corrigiu.
    await semearVenda(tenantId, clientePrecoZeroId, 'S-MEM-40', '2026-08-05', 'Entregue',
      [{ produto: produtoId, preco: 5.25 }])
    await semearVenda(tenantId, clientePrecoZeroId, 'S-MEM-41', '2026-08-22', 'Entregue',
      [{ produto: produtoId, preco: 0 }])

    const memoria = await memoriaDe(clientePrecoZeroId)
    expect(memoria).toEqual([
      { produto_id: produtoId, un: 'KG', preco: 5.25, data: '2026-08-05', numero: 'S-MEM-40' },
    ])
  })

  it('mesmo produto em KG e em CX sao memorias separadas — preco por unidade', async () => {
    // "R$ 30,00" de uma caixa e "R$ 30,00" de um quilo sao numeros
    // diferentes; colapsar os dois numa chave so entregaria a tela um preco
    // que ela nao teria como aplicar sem trocar caixa por quilo.
    await semearVenda(tenantId, clienteUnidadesId, 'S-MEM-50', '2026-08-10', 'Entregue',
      [{ produto: produtoId, un: 'KG', preco: 4 }, { produto: produtoId, un: 'CX', preco: 80 }])

    const memoria = await memoriaDe(clienteUnidadesId)
    expect(memoria).toEqual([
      { produto_id: produtoId, un: 'CX', preco: 80, data: '2026-08-10', numero: 'S-MEM-50' },
      { produto_id: produtoId, un: 'KG', preco: 4, data: '2026-08-10', numero: 'S-MEM-50' },
    ])
  })

  it('isolamento: o tenant vizinho tem memoria propria, e ela nao vaza para ca', async () => {
    await semearVenda(outroTenantId, clienteOutroTenantId, 'S-MEM-60', '2026-08-15', 'Entregue',
      [{ produto: produtoOutroTenantId, preco: 12.5 }])

    // O vizinho enxerga a propria memoria (prova que a fixture existe — sem
    // isto o teste abaixo passaria mesmo com a tabela vazia).
    const doVizinho = await memoriaDe(clienteOutroTenantId, comoOutroTenant)
    expect(doVizinho).toEqual([
      { produto_id: produtoOutroTenantId, un: 'KG', preco: 12.5, data: '2026-08-15', numero: 'S-MEM-60' },
    ])

    // Mesma rota, mesmo id de cliente, sessao daqui: a RLS nao devolve nada.
    expect(await memoriaDe(clienteOutroTenantId, comoAdmin)).toEqual([])
  })

  it('colaborador pode consultar — e ele quem lanca saida e abre o modal', async () => {
    const memoria = await memoriaDe(clienteMemoriaId, comoColab)
    expect(memoria.length).toBeGreaterThan(0)
  })

  it('sem cookie -> 401', async () => {
    const res = await pedir(`/api/saidas/ultimos-precos/${clienteMemoriaId}`)
    expect(res.status).toBe(401)
  })

  it('clienteId malformado -> 400 (nao deixa o uuid invalido chegar ao Postgres)', async () => {
    const res = await pedir('/api/saidas/ultimos-precos/nao-e-uuid', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'clienteId invalido' })
  })
})
