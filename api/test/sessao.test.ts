import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { exigirSessao, exigirAdmin, COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import app from '../src/index'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

const SENHA = 'segredo123'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let usuarioAdminId: string
let usuarioColabId: string
let tokenAdmin: string
let tokenColab: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-sessao', 'Tenant Sessao')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id

  await admin`delete from usuarios where tenant_id = ${tenantId}`
  const hash = await hashSenha(SENHA)
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@sessao.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@sessao.com', ${hash}, 'Colab', 'colaborador') returning id`
  usuarioAdminId = uAdmin.id
  usuarioColabId = uColab.id

  sql = criarPool(URL)
  tokenAdmin = await criarSessao(sql, usuarioAdminId, tenantId)
  tokenColab = await criarSessao(sql, usuarioColabId, tenantId)
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes
 * do teste seguinte, para nao vazar conexoes entre casos.
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

function appDeTeste() {
  const testApp = new Hono<{ Bindings: { DATABASE_URL: string }; Variables: Vars }>()
  testApp.get('/protegida', exigirSessao, (c) =>
    c.json({ tenantId: c.get('tenantId'), usuarioId: c.get('usuarioId'), papel: c.get('papel') }))
  testApp.get('/admin', exigirSessao, exigirAdmin, (c) => c.json({ ok: true }))
  return testApp
}

async function pedirTeste(input: string, init?: RequestInit) {
  const { exec, aguardar } = contextoDeTeste()
  const res = await appDeTeste().request(input, init, { DATABASE_URL: URL }, exec as never)
  await aguardar()
  return res
}

describe('middleware exigirSessao / exigirAdmin', () => {
  it('rejeita sem cookie', async () => {
    const res = await pedirTeste('/protegida')
    expect(res.status).toBe(401)
  })

  it('rejeita token invalido', async () => {
    const res = await pedirTeste('/protegida', {
      headers: { cookie: `${COOKIE_SESSAO}=token-que-nao-existe` },
    })
    expect(res.status).toBe(401)
  })

  it('aceita token valido e injeta tenantId/usuarioId/papel no contexto', async () => {
    const res = await pedirTeste('/protegida', {
      headers: { cookie: `${COOKIE_SESSAO}=${tokenAdmin}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId, usuarioId: usuarioAdminId, papel: 'admin' })
  })

  it('exigirAdmin barra colaborador com 403', async () => {
    const res = await pedirTeste('/admin', {
      headers: { cookie: `${COOKIE_SESSAO}=${tokenColab}` },
    })
    expect(res.status).toBe(403)
  })

  it('exigirAdmin deixa admin passar', async () => {
    const res = await pedirTeste('/admin', {
      headers: { cookie: `${COOKIE_SESSAO}=${tokenAdmin}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/login', () => {
  it('senha errada responde 401 generico', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-sessao', email: 'admin@sessao.com', senha: 'errada' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'credenciais invalidas' })
  })

  it('usuario inexistente responde o mesmo 401 generico (nao revela o e-mail)', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-sessao', email: 'fantasma@sessao.com', senha: 'qualquer' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'credenciais invalidas' })
  })

  it('tenant inexistente responde o mesmo 401 generico (nao revela o slug)', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'nao-existe', email: 'admin@sessao.com', senha: SENHA }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'credenciais invalidas' })
  })

  it('credenciais corretas devolvem 200 e cookie httpOnly/secure/SameSite=Lax', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-sessao', email: 'admin@sessao.com', senha: SENHA }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_SESSAO}=`))
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//i)
  })
})

describe('fluxo completo: login -> /api/eu -> logout -> /api/eu (deve falhar)', () => {
  it('logout de fato invalida a sessao no banco, nao so apaga o cookie', async () => {
    const resLogin = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-sessao', email: 'colab@sessao.com', senha: SENHA }),
    })
    expect(resLogin.status).toBe(200)
    const token = (resLogin.headers.get('set-cookie') ?? '')
      .match(new RegExp(`${COOKIE_SESSAO}=([^;]+)`))?.[1]
    expect(token).toBeTruthy()

    const resEuAntes = await pedir('/api/eu', { headers: { cookie: `${COOKIE_SESSAO}=${token}` } })
    expect(resEuAntes.status).toBe(200)
    expect(await resEuAntes.json()).toEqual({ usuarioId: usuarioColabId, papel: 'colaborador' })

    const resLogout = await pedir('/api/logout', {
      method: 'POST',
      headers: { cookie: `${COOKIE_SESSAO}=${token}` },
    })
    expect(resLogout.status).toBe(200)
    expect(await resLogout.json()).toEqual({ ok: true })

    // Prova de que o logout apagou a sessao no banco (nao so o cookie no
    // navegador): a mesma chamada com o mesmo token agora falha.
    const resEuDepois = await pedir('/api/eu', { headers: { cookie: `${COOKIE_SESSAO}=${token}` } })
    expect(resEuDepois.status).toBe(401)

    // E a sessao some mesmo quando consultada com o role admin, direto,
    // sem depender de RLS ou de resolver_sessao.
    // `token!`: ja verificado truthy na linha 182 (o match() e que deixa o
    // tipo declarado como `string | undefined`; postgres.js nao aceita
    // `undefined` como parametro de query, mesmo que em runtime aqui nunca
    // chegue vazio).
    const [linha] = await admin`select 1 from sessoes where token = ${token!}`
    expect(linha).toBeUndefined()
  })
})
