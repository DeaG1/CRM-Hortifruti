import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { produtos } from '../src/routes/produtos'

// produtos.test.ts cobre isolamento/RLS/constraints direto via withTenant.
// Este arquivo cobre a camada HTTP das rotas em src/routes/produtos.ts —
// sanear() (mass assignment), paraJson() (conversao numerica), a
// autorizacao (exigirSessao/exigirAdmin) e os codigos de status que os
// handlers produzem. Mesmo racional de clientes.http.test.ts, o molde
// declarado desta suite.
//
// Diferenca do molde: clientes.http.test.ts importa o app inteiro de
// src/index.ts. Aqui a rota e montada num Hono local so com `produtos` —
// a tarefa que criou esta rota foi instruida a nao tocar em src/index.ts
// (a montagem final das rotas fica pra outro agente, pra nao conflitar
// com as demais entidades da Fase 1 sendo criadas em paralelo). O app
// local replica o mesmo contrato de erro do index.ts real (app.onError ->
// {erro} JSON, nunca texto puro) para os testes abaixo continuarem validos
// mesmo antes da rota ser montada no app real.
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/produtos', produtos)
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
    insert into tenants (slug, nome) values ('teste-produtos-http', 'Produtos HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-produtos-http-2', 'Produtos HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@produtos-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@produtos-http.com', ${hash}, 'Colab', 'colaborador') returning id`

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
 * de test/sessao.test.ts e clientes.http.test.ts.
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
    const res = await pedir('/api/produtos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  // Este teste ja exigiu 403 tambem na leitura. Mas o colaborador tem acesso a
  // Entradas, Saidas e Estoque, e os tres precisam do seletor de produto — sem
  // ler a lista, ele abria "Nova entrada" e nao conseguia lancar nada. A tela
  // de Produtos continua restrita ao admin; o que mudou e que consultar a lista
  // deixou de ser a mesma coisa que gerenciar o cadastro.
  it('colaborador LE produtos (precisa disso para lancar movimentacao)', async () => {
    const res = await pedir('/api/produtos', comoColab())
    expect(res.status).toBe(200)
  })

  it('colaborador NAO cria produto', async () => {
    const res = await pedir('/api/produtos', {
      ...comoColab(), method: 'POST',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Tentativa do colaborador' }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/produtos', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/produtos', comoAdmin({
      ...json({
        nome: 'Produto Forjado',
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from produtos where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Para Editar' })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ un: 'CX', tenant_id: outroTenantId }),
    }))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.un).toBe('CX')

    const [linha] = await admin`select tenant_id from produtos where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em/alterado_em)', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Sem Tenant Id' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/produtos', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const p of lista) expect(p).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ un: 'UN' }),
    }))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
  })
})

describe('conversao numerica (paraJson)', () => {
  it('GET /, GET /:id, POST e PUT devolvem peso_medio como number', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({
      nome: 'Produto Com Peso', peso_medio: 0.25,
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.peso_medio).toBe('number')
    expect(criado.peso_medio).toBe(0.25)

    const resGetId = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    const lidoPorId = await resGetId.json()
    expect(typeof lidoPorId.peso_medio).toBe('number')

    const resGetLista = await pedir('/api/produtos', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const p of lista) expect(typeof p.peso_medio).toBe('number')

    const resPut = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peso_medio: 0.5 }),
    }))
    const atualizado = await resPut.json()
    expect(typeof atualizado.peso_medio).toBe('number')
    expect(atualizado.peso_medio).toBe(0.5)
  })

  it('POST sem un/peso_medio usa os padroes do banco (KG, 0)', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Padrao' })))
    expect(res.status).toBe(201)
    const criado = await res.json()
    expect(criado.un).toBe('KG')
    expect(criado.peso_medio).toBe(0)
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto CRUD' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).nome).toBe('Produto CRUD')

    const resPut = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ un: 'DZ' }),
    }))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).un).toBe('DZ')

    const resDelete = await pedir(`/api/produtos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem nome -> 400', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ un: 'KG' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com peso_medio negativo -> 400', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: 'Peso Ruim', peso_medio: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'peso medio nao pode ser negativo' })
  })

  it('PUT com peso_medio negativo -> 400, sem alterar o produto', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Peso Ok', peso_medio: 0.5 })))
    const criado = await resPost.json()

    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peso_medio: -1 }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'peso medio nao pode ser negativo' })

    const resGet = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    expect((await resGet.json()).peso_medio).toBe(0.5)
  })

  it('POST com nome so espacos -> 400 (mesma regra de "ausente")', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome com espacos nas bordas -> salva o nome ja trimado', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: '  Manga Trim  ' })))
    expect(res.status).toBe(201)
    expect((await res.json()).nome).toBe('Manga Trim')
  })

  it('PUT com nome vazio -> 400 (antes: 200, gravava o registro com nome vazio)', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Nome Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })

    const resGet = await pedir(`/api/produtos/${criado.id}`, comoAdmin())
    expect((await resGet.json()).nome).toBe('Produto Nome Ok')
  })

  it('PUT com nome so espacos -> 400, sem alterar o produto', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Nome Ok 2' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '   ' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('PUT com nome trimavel -> salva ja trimado', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Renomear' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '  Novo Nome  ' }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).nome).toBe('Novo Nome')
  })

  it('POST com unidade invalida -> 400 com mensagem especifica', async () => {
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: 'Un Ruim', un: 'TON' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'unidade invalida' })
  })

  it('PUT com unidade invalida -> 400 com mensagem especifica', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Un Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ un: 'TON' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'unidade invalida' })
  })

  it('POST com nome duplicado no mesmo tenant -> 409', async () => {
    await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Duplicado' })))
    const res = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Duplicado' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um produto com esse nome' })
  })

  it('PUT renomeando para um nome ja existente no tenant -> 409', async () => {
    await pedir('/api/produtos', comoAdmin(json({ nome: 'Nome Original A' })))
    const resB = await pedir('/api/produtos', comoAdmin(json({ nome: 'Nome Original B' })))
    const b = await resB.json()

    const res = await pedir(`/api/produtos/${b.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Nome Original A' }),
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um produto com esse nome' })
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const resPost = await pedir('/api/produtos', comoAdmin(json({ nome: 'Produto Sem Alteracao' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/produtos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campo_desconhecido: 'x' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/produtos/00000000-0000-0000-0000-000000000000', comoAdmin())
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
      const res = await pedir('/api/produtos/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})
