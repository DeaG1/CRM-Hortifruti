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

  // Produto CX com peso_medio, movimentado, para a linha de equivalente_kg.
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
  it('devolve um array com nome, un, entrou, perda, saiu, saldo e peso_medio numericos', async () => {
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
    expect(linha.un).toBe('CX')
    expect(linha.entrou).toBe(10)
    expect(linha.perda).toBe(1)
    expect(linha.saiu).toBe(0)
    expect(linha.saldo).toBe(9) // 10 - 1 - 0
  })

  it('expoe equivalente_kg quando un != KG e peso_medio > 0, sem misturar com a coluna original', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')

    // peso_medio = 15 kg por CX
    expect(linha.equivalente_kg).toEqual({ entrou: 150, perda: 15, saiu: 0, saldo: 135 })
    // a coluna original continua na unidade lancada (CX), nao em kg
    expect(linha.entrou).toBe(10)
  })

  it('equivalente_kg e null quando un = KG (nao ha conversao a fazer)', async () => {
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
    expect(linha.equivalente_kg).toBeNull()
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
