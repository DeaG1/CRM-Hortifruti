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
  it('devolve um array com nome, un, entrou, perda, saiu, saldo e peso_medio numericos, em kg', async () => {
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
    // `un` continua sendo a unidade LANCADA (a chave da linha); as
    // quantidades saem em kg: 10 CX de 15 kg = 150, e o perda_kg do item
    // (1 kg, por contrato) entra como 1 — nunca como 15.
    expect(linha.un).toBe('CX')
    expect(linha.entrou).toBe(150)
    expect(linha.perda).toBe(1)
    expect(linha.saiu).toBe(0)
    expect(linha.saldo).toBe(149) // 150 - 1 - 0
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('expoe equivalente_un quando un != KG e peso_medio > 0, como leitura secundaria em embalagens', async () => {
    const res = await pedir('/api/estoque', comoAdmin())
    const corpo = await res.json()
    const linha = corpo.find((l: { nome: string }) => l.nome === 'Melancia HTTP')

    // Mesmo fator (15 kg por CX), direcao oposta: o kg e o numero principal,
    // a contagem de embalagens e a leitura secundaria. `entrou` volta exato
    // ao que foi lancado (10 CX); `perda` e `saldo` saem fracionarios porque
    // carregam parcelas que nasceram em kg (perda_kg do item).
    expect(linha.equivalente_un.entrou).toBe(10)
    expect(linha.equivalente_un.saiu).toBe(0)
    expect(linha.equivalente_un.perda).toBeCloseTo(1 / 15, 10)
    expect(linha.equivalente_un.saldo).toBeCloseTo(149 / 15, 10)
    // A coluna principal continua em kg, nao em CX.
    expect(linha.entrou).toBe(150)
    // O campo antigo, que multiplicava o bolo inteiro por peso_medio
    // (inclusive as parcelas que ja eram kg), nao existe mais.
    expect(linha).not.toHaveProperty('equivalente_kg')
  })

  it('equivalente_un e null quando un = KG (o numero principal ja e a propria unidade)', async () => {
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
    expect(linha.equivalente_un).toBeNull()
    // No-op: produto so em KG sai com os mesmos numeros de sempre.
    expect(linha.entrou).toBe(5)
    expect(linha.itens_sem_conversao).toBe(0)
  })

  it('linha em CX sem peso_medio: quantidades ficam de fora, itens_sem_conversao marca a linha', async () => {
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
    expect(linha.entrou).toBe(0)     // fator ausente nao vira 1
    expect(linha.perda).toBe(2)      // perda_kg do item ja era kg
    expect(linha.itens_sem_conversao).toBe(1)
    expect(linha.equivalente_un).toBeNull()
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
