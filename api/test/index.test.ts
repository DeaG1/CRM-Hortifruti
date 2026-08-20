import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'
// Porta sem nada escutando -> ECONNREFUSED rapido, sem depender de DNS lento.
const URL_INALCANCAVEL = 'postgres://app_crm:senha@localhost:59999/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let tokenAdmin: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)
  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-index', 'Tenant Index')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  await admin`delete from usuarios where tenant_id = ${tenantId}`
  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@index.com', ${hash}, 'Admin', 'admin') returning id`
  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

// Mesmo padrao de sessao.test.ts / clientes.http.test.ts: ExecutionContext
// minimo pra rodar fora do runtime real do Workers.
function contextoDeTeste() {
  const pendentes: Promise<unknown>[] = []
  const exec = {
    waitUntil: (p: Promise<unknown>) => { pendentes.push(p) },
    passThroughOnException: () => {},
  }
  return { exec, aguardar: () => Promise.all(pendentes) }
}

async function pedir(input: string, init: RequestInit | undefined, databaseUrl: string) {
  const { exec, aguardar } = contextoDeTeste()
  const res = await app.request(input, init, { DATABASE_URL: databaseUrl }, exec as never)
  await aguardar()
  return res
}

describe('GET /api/health', () => {
  it('sucesso: devolve so {ok:true}, sem o banner do Postgres', async () => {
    const res = await pedir('/api/health', undefined, URL)
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo).toEqual({ ok: true })
  })

  it('falha de conexao: devolve {ok:false}, sem vazar hostname/detalhe do erro', async () => {
    const res = await pedir('/api/health', undefined, URL_INALCANCAVEL)
    expect(res.status).toBe(500)
    const corpo = await res.json()
    expect(corpo).toEqual({ ok: false })
    // nada no corpo pode conter o host/porta que vazaria infraestrutura
    expect(JSON.stringify(corpo)).not.toMatch(/59999|ECONNREFUSED|localhost/)
  })
})

describe('app.onError — excecao nao tratada vira JSON, nunca texto puro', () => {
  it('JSON malformado no corpo de POST /api/clientes -> 500 JSON {erro}, nao "Internal Server Error" texto puro', async () => {
    const res = await pedir('/api/clientes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${COOKIE_SESSAO}=${tokenAdmin}` },
      body: '{ isto nao e json valido',
    }, URL)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ erro: 'erro interno' })
  })
})
