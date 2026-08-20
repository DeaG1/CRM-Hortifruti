import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

// clientes.test.ts cobre isolamento/RLS/constraints direto via withTenant.
// Este arquivo cobre a camada HTTP das rotas em src/routes/clientes.ts —
// sanear() (mass assignment), paraJson() (conversao numerica), a
// autorizacao (exigirSessao/exigirAdmin) e os codigos de status que os
// handlers produzem. Sem isto, uma regressao em qualquer um desses pontos
// nao quebraria nenhum teste (achado da revisao da Task 6, fix round 1).

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
    insert into tenants (slug, nome) values ('teste-clientes-http', 'Clientes HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-clientes-http-2', 'Clientes HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from clientes where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@clientes-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@clientes-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes
 * do teste seguinte, para nao vazar conexoes entre casos. Mesmo padrao
 * de test/sessao.test.ts.
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

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/clientes')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 403 (design: colaborador nao enxerga clientes)', async () => {
    const res = await pedir('/api/clientes', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/clientes', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/clientes', comoAdmin({
      ...json({
        nome: 'Cliente Forjado',
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.tenant_id).toBe(tenantId)
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Para Editar' })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'inadimplente', tenant_id: outroTenantId }),
    }))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.status).toBe('inadimplente')
    expect(atualizado.tenant_id).toBe(tenantId)
  })
})

describe('conversao numerica (paraJson)', () => {
  it('GET /, GET /:id, POST e PUT devolvem limite e prazo como number', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({
      nome: 'Cliente Com Limite', limite: 6000, prazo: 30,
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.limite).toBe('number')
    expect(criado.limite).toBe(6000)
    expect(typeof criado.prazo).toBe('number')
    expect(criado.prazo).toBe(30)

    const resGetId = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    const lidoPorId = await resGetId.json()
    expect(typeof lidoPorId.limite).toBe('number')

    const resGetLista = await pedir('/api/clientes', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const c of lista) expect(typeof c.limite).toBe('number')

    const resPut = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limite: 9999.5 }),
    }))
    const atualizado = await resPut.json()
    expect(typeof atualizado.limite).toBe('number')
    expect(atualizado.limite).toBe(9999.5)
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente CRUD' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).nome).toBe('Cliente CRUD')

    const resPut = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ obs: 'atualizado' }),
    }))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).obs).toBe('atualizado')

    const resDelete = await pedir(`/api/clientes/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem nome -> 400', async () => {
    const res = await pedir('/api/clientes', comoAdmin(json({ resp: 'sem nome' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome duplicado no mesmo tenant -> 409', async () => {
    await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Duplicado' })))
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Duplicado' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um cliente com esse nome' })
  })

  it('PUT renomeando para um nome ja existente no tenant -> 409', async () => {
    await pedir('/api/clientes', comoAdmin(json({ nome: 'Nome Original A' })))
    const resB = await pedir('/api/clientes', comoAdmin(json({ nome: 'Nome Original B' })))
    const b = await resB.json()

    const res = await pedir(`/api/clientes/${b.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Nome Original A' }),
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um cliente com esse nome' })
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Sem Alteracao' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campo_desconhecido: 'x' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/clientes/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: 'x' }),
      })],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/clientes/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})
