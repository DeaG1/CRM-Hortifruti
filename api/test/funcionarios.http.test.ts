import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import { Hono } from 'hono'
import { funcionarios } from '../src/routes/funcionarios'
import type { Vars } from '../src/middleware/sessao'
import type { EnvBanco } from '../src/db'

// Molde: test/clientes.http.test.ts. Cobre a camada HTTP das rotas em
// src/routes/funcionarios.ts — sanear() (mass assignment), paraJson()
// (conversao numerica), autorizacao (exigirSessao/exigirAdmin) e os
// codigos de status que os handlers produzem.
//
// index.ts nao pode ser modificado por este agente (montagem e feita por
// outro), entao aqui a rota e montada num app minimo local so para o
// teste — mesmo efeito de app.route('/api/funcionarios', funcionarios) em
// src/index.ts, sem tocar naquele arquivo.

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

const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/funcionarios', funcionarios)
app.onError((err, c) => {
  console.error('erro nao tratado:', err)
  return c.json({ erro: 'erro interno' }, 500)
})

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-func-http', 'Func HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-func-http-2', 'Func HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from funcionarios where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@func-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@func-http.com', ${hash}, 'Colab', 'colaborador') returning id`

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
 * do teste seguinte. Mesmo padrao de test/clientes.http.test.ts.
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
    const res = await pedir('/api/funcionarios')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 403 (design: colaborador nao enxerga funcionarios)', async () => {
    const res = await pedir('/api/funcionarios', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin())
    expect(res.status).toBe(200)
  })
})

// GET /opcoes: adicionado junto da feature de Veiculos (web/src/screens/
// VeiculosLista.tsx), que e visivel pro colaborador e precisa de um seletor
// de funcionario em "Pegar". Continua sem enxergar a rota GET / completa
// (com salario) — so este resumo.
describe('GET /opcoes — resumo liberado pro colaborador', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/funcionarios/opcoes')
    expect(res.status).toBe(401)
  })

  it('colaborador LE /opcoes (precisa disso pro seletor de Veiculos)', async () => {
    const res = await pedir('/api/funcionarios/opcoes', comoColab())
    expect(res.status).toBe(200)
  })

  it('devolve so id e nome, nunca salario/cargo/tel', async () => {
    const criado = await (await pedir('/api/funcionarios', comoAdmin(json({
      nome: 'Funcionario Opcoes', salario: 9999, cargo: 'Confidencial',
    })))).json()

    const res = await pedir('/api/funcionarios/opcoes', comoColab())
    expect(res.status).toBe(200)
    const lista = await res.json()
    const linha = lista.find((f: { id: string }) => f.id === criado.id)
    expect(linha).toBeDefined()
    expect(linha).toEqual({ id: criado.id, nome: 'Funcionario Opcoes' })
    expect(linha).not.toHaveProperty('salario')
    expect(linha).not.toHaveProperty('cargo')
  })

  it('nao inclui funcionario inativo', async () => {
    const criado = await (await pedir('/api/funcionarios', comoAdmin(json({
      nome: 'Funcionario Inativo Opcoes', ativo: false,
    })))).json()

    const res = await pedir('/api/funcionarios/opcoes', comoColab())
    const lista = await res.json()
    expect(lista.find((f: { id: string }) => f.id === criado.id)).toBeUndefined()
  })

  it('admin tambem acessa /opcoes', async () => {
    const res = await pedir('/api/funcionarios/opcoes', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin({
      ...json({
        nome: 'Funcionario Forjado',
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from funcionarios where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Para Editar' })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cargo: 'Gerente', tenant_id: outroTenantId }),
    }))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).cargo).toBe('Gerente')

    const [linha] = await admin`select tenant_id from funcionarios where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em/alterado_em)', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Sem Tenant Id' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/funcionarios', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const f of lista) expect(f).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tel: '11999999999' }),
    }))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
  })
})

describe('conversao numerica (paraJson)', () => {
  it('GET /, GET /:id, POST e PUT devolvem salario e dia_pag como number', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({
      nome: 'Funcionario Com Salario', salario: 3500, dia_pag: 10,
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.salario).toBe('number')
    expect(criado.salario).toBe(3500)
    expect(typeof criado.dia_pag).toBe('number')
    expect(criado.dia_pag).toBe(10)

    const resGetId = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect(typeof (await resGetId.json()).salario).toBe('number')

    const resGetLista = await pedir('/api/funcionarios', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const f of lista) expect(typeof f.salario).toBe('number')

    const resPut = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ salario: 4000.5 }),
    }))
    const atualizado = await resPut.json()
    expect(typeof atualizado.salario).toBe('number')
    expect(atualizado.salario).toBe(4000.5)
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario CRUD' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).nome).toBe('Funcionario CRUD')

    const resPut = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ativo: false }),
    }))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).ativo).toBe(false)

    const resDelete = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem nome -> 400', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin(json({ cargo: 'sem nome' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome so espacos -> 400', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin(json({ nome: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome com espacos nas bordas -> salva o nome ja trimado', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin(json({ nome: '  Maria Trim  ' })))
    expect(res.status).toBe(201)
    expect((await res.json()).nome).toBe('Maria Trim')
  })

  it('PUT com nome vazio -> 400', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Nome Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com salario negativo -> 400', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Salario Ruim', salario: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'salario nao pode ser negativo' })
  })

  it('PUT com salario negativo -> 400, sem alterar o funcionario', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Salario Ok', salario: 1000 })))
    const criado = await resPost.json()
    const res = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ salario: -1 }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'salario nao pode ser negativo' })

    const resGet = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect((await resGet.json()).salario).toBe(1000)
  })

  it('POST com dia_pag fracionario -> 400', async () => {
    const res = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Dia Pag Fracionario', dia_pag: 1.5 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'dia_pag deve ser um numero inteiro' })
  })

  it('POST com dia_pag fora de 1..28 -> 400', async () => {
    const res29 = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Dia Pag 29', dia_pag: 29 })))
    expect(res29.status).toBe(400)
    expect(await res29.json()).toEqual({ erro: 'dia_pag deve estar entre 1 e 28' })

    const res0 = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Dia Pag 0', dia_pag: 0 })))
    expect(res0.status).toBe(400)
    expect(await res0.json()).toEqual({ erro: 'dia_pag deve estar entre 1 e 28' })
  })

  it('PUT com dia_pag fora de 1..28 -> 400, sem alterar o funcionario', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Dia Pag Ok', dia_pag: 15 })))
    const criado = await resPost.json()
    const res = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dia_pag: 31 }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'dia_pag deve estar entre 1 e 28' })

    const resGet = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin())
    expect((await resGet.json()).dia_pag).toBe(15)
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const resPost = await pedir('/api/funcionarios', comoAdmin(json({ nome: 'Funcionario Sem Alteracao' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/funcionarios/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campo_desconhecido: 'x' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/funcionarios/00000000-0000-0000-0000-000000000000', comoAdmin())
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
      const res = await pedir('/api/funcionarios/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})
