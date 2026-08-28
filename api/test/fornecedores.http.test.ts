import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, withTenant, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { fornecedores } from '../src/routes/fornecedores'

// fornecedores.test.ts cobre isolamento/RLS/constraints direto via
// withTenant. Este arquivo cobre a camada HTTP das rotas em
// src/routes/fornecedores.ts — sanear() (mass assignment), paraJson()
// (tenant_id fora da resposta), a autorizacao (exigirSessao/exigirAdmin),
// os codigos de status que os handlers produzem, e o comportamento
// especifico desta entidade: GET /:id trazendo os produtos vinculados e
// PUT sincronizando fornecedor_produtos via `produto_ids`.
//
// Diferenca do molde (clientes.http.test.ts, que importa o app inteiro de
// src/index.ts): aqui a rota e montada num Hono local so com
// `fornecedores` — a tarefa que criou esta rota foi instruida a nao tocar
// em src/index.ts (a montagem final fica pra outro agente, pra nao
// conflitar com as demais entidades da Fase 1 sendo criadas em paralelo).
// O app local replica o mesmo contrato de erro do index.ts real
// (app.onError -> {erro} JSON, nunca texto puro).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/fornecedores', fornecedores)
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
    insert into tenants (slug, nome) values ('teste-fornecedores-http', 'Fornecedores HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-fornecedores-http-2', 'Fornecedores HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from fornecedor_produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from fornecedores where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@fornecedores-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@fornecedores-http.com', ${hash}, 'Colab', 'colaborador') returning id`

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
const put = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})

/** Cria um produto direto no banco (dentro do tenant de teste), pra usar em produto_ids. */
async function criarProduto(nome: string) {
  const [produto] = await withTenant(sql, tenantId, tx => tx`
    insert into produtos (tenant_id, nome) values (${tenantId}, ${nome}) returning id`)
  return produto.id as string
}

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/fornecedores')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  // Este teste ja exigiu 403 tambem na leitura. Mas o colaborador lanca
  // entradas, e o modal de entrada precisa do seletor de fornecedor — sem ler a
  // lista, ele nao conseguia registrar de quem comprou.
  it('colaborador LE fornecedores (precisa disso para lancar entrada)', async () => {
    const res = await pedir('/api/fornecedores', comoColab())
    expect(res.status).toBe(200)
  })

  // O colaborador PASSOU a poder criar e editar fornecedor: quem vai a feira e
  // quem volta com produtor novo e com a lista do que ele entrega.
  // `fornecedores` saiu de ADMIN_ONLY_SCREENS junto — ver
  // src/routes/fornecedores.ts.
  it('colaborador CRIA fornecedor', async () => {
    const res = await pedir('/api/fornecedores', {
      ...comoColab(), method: 'POST',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Sitio do colaborador', regiao: 'Norte' }),
    })
    expect(res.status).toBe(201)
    const corpo = await res.json() as { id: string; nome: string }
    expect(corpo.nome).toBe('Sitio do colaborador')
    await admin`delete from fornecedores where id = ${corpo.id}`
  })

  // O PUT do colaborador inclui `produto_ids`: e justamente a informacao que
  // ele traz da feira ("este produtor tambem entrega alface"), e liberar o
  // cadastro sem liberar o vinculo deixaria a metade util de fora.
  it('colaborador EDITA fornecedor, inclusive os produtos vinculados', async () => {
    const criado = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Para o colaborador editar' })))
    const { id } = await criado.json() as { id: string }
    const produtoId = await criarProduto('Alface do colaborador')

    const res = await pedir(`/api/fornecedores/${id}`, {
      ...comoColab(), method: 'PUT',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({ contato: '44 98888-1111', produto_ids: [produtoId] }),
    })
    expect(res.status).toBe(200)
    const corpo = await res.json() as { contato: string; produtos: { id: string }[] }
    expect(corpo.contato).toBe('44 98888-1111')
    expect(corpo.produtos.map(p => p.id)).toEqual([produtoId])

    await admin`delete from fornecedor_produtos where fornecedor_id = ${id}`
    await admin`delete from fornecedores where id = ${id}`
    await admin`delete from produtos where id = ${produtoId}`
  })

  /**
   * Excluir continua so do admin, e aqui o estrago e silencioso:
   * `entradas.fornecedor_id` e ON DELETE SET NULL, entao apagar nao da erro —
   * so desliga todas as coletas daquele produtor do preco medio. A recusa
   * precisa vir do SERVIDOR; esconder o botao nao impediria a chamada.
   */
  it('colaborador NAO exclui fornecedor -> 403', async () => {
    const criado = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Nao deve sumir' })))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/fornecedores/${id}`, { ...comoColab(), method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })

    const [ainda] = await admin`select id from fornecedores where id = ${id}`
    expect(ainda).toBeDefined()
    await admin`delete from fornecedores where id = ${id}`
  })

  it('admin exclui fornecedor -> 200', async () => {
    const criado = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Admin pode apagar' })))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/fornecedores/${id}`, { ...comoAdmin(), method: 'DELETE' })
    expect(res.status).toBe(200)
    const [sumiu] = await admin`select id from fornecedores where id = ${id}`
    expect(sumiu).toBeUndefined()
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/fornecedores', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/fornecedores', comoAdmin({
      ...json({
        nome: 'Fornecedor Forjado',
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from fornecedores where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Para Editar' })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({
      regiao: 'Norte', tenant_id: outroTenantId,
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.regiao).toBe('Norte')

    const [linha] = await admin`select tenant_id from fornecedores where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em/alterado_em)', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Sem Tenant Id' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/fornecedores', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const f of lista) expect(f).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ contato: 'x' })))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor CRUD' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).nome).toBe('Fornecedor CRUD')

    const resPut = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ contato: 'atualizado' })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).contato).toBe('atualizado')

    const resDelete = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('produtos vinculados (GET /:id e PUT /:id com produto_ids)', () => {
  it('GET /:id sem vinculos devolve produtos: []', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Sem Produtos' })))
    const criado = await resPost.json()
    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).produtos).toEqual([])
  })

  it('PUT com produto_ids vincula, GET /:id devolve os produtos vinculados', async () => {
    const produtoId1 = await criarProduto('Produto Vinculo 1')
    const produtoId2 = await criarProduto('Produto Vinculo 2')

    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Com Produtos' })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(
      put({ produto_ids: [produtoId1, produtoId2] }),
    ))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.produtos.map((p: { nome: string }) => p.nome).sort())
      .toEqual(['Produto Vinculo 1', 'Produto Vinculo 2'])

    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    const lido = await resGet.json()
    expect(lido.produtos.map((p: { nome: string }) => p.nome).sort())
      .toEqual(['Produto Vinculo 1', 'Produto Vinculo 2'])
    for (const p of lido.produtos) {
      expect(p).not.toHaveProperty('tenant_id')
      expect(typeof p.peso_medio).toBe('number')
    }
  })

  it('PUT com produto_ids sincroniza: remove os que saem, mantem/insere os que entram', async () => {
    const produtoId1 = await criarProduto('Produto Sync 1')
    const produtoId2 = await criarProduto('Produto Sync 2')
    const produtoId3 = await criarProduto('Produto Sync 3')

    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Sync' })))
    const criado = await resPost.json()

    await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ produto_ids: [produtoId1, produtoId2] })))

    const resPut2 = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(
      put({ produto_ids: [produtoId2, produtoId3] }),
    ))
    expect(resPut2.status).toBe(200)
    const atualizado = await resPut2.json()
    expect(atualizado.produtos.map((p: { id: string }) => p.id).sort())
      .toEqual([produtoId2, produtoId3].sort())
  })

  it('PUT com produto_ids: [] remove todos os vinculos', async () => {
    const produtoId1 = await criarProduto('Produto Limpar 1')

    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Limpar' })))
    const criado = await resPost.json()
    await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ produto_ids: [produtoId1] })))

    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ produto_ids: [] })))
    expect(res.status).toBe(200)
    expect((await res.json()).produtos).toEqual([])

    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect((await resGet.json()).produtos).toEqual([])
  })

  it('PUT so com produto_ids (sem outros campos) sincroniza sem exigir mais nada', async () => {
    const produtoId1 = await criarProduto('Produto So Vinculo')
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor So Vinculo' })))
    const criado = await resPost.json()

    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ produto_ids: [produtoId1] })))
    expect(res.status).toBe(200)
    expect((await res.json()).nome).toBe('Fornecedor So Vinculo')
  })

  it('PUT com produto_ids contendo um id inexistente -> 400, nao altera o vinculo existente', async () => {
    const produtoId1 = await criarProduto('Produto Existe')
    const idInexistente = '00000000-0000-0000-0000-000000000000'

    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Produto Ruim' })))
    const criado = await resPost.json()
    await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ produto_ids: [produtoId1] })))

    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(
      put({ produto_ids: [produtoId1, idInexistente] }),
    ))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto nao encontrado' })

    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    const lido = await resGet.json()
    expect(lido.produtos.map((p: { id: string }) => p.id)).toEqual([produtoId1])
  })

  it('PUT com produto_ids malformado (nao e lista de uuids) -> 400', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Produto Malformado' })))
    const criado = await resPost.json()

    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(
      put({ produto_ids: ['nao-e-um-uuid'] }),
    ))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto_ids deve ser uma lista de ids validos' })
  })

  it('PUT com produto_ids que nao e uma lista -> 400', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Produto Nao Lista' })))
    const criado = await resPost.json()

    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(
      put({ produto_ids: 'nao-e-lista' }),
    ))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto_ids deve ser uma lista de ids validos' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem nome -> 400', async () => {
    const res = await pedir('/api/fornecedores', comoAdmin(json({ regiao: 'sem nome' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome so espacos -> 400 (mesma regra de "ausente")', async () => {
    const res = await pedir('/api/fornecedores', comoAdmin(json({ nome: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome com espacos nas bordas -> salva o nome ja trimado', async () => {
    const res = await pedir('/api/fornecedores', comoAdmin(json({ nome: '  Fazenda Trim  ' })))
    expect(res.status).toBe(201)
    expect((await res.json()).nome).toBe('Fazenda Trim')
  })

  it('PUT com nome vazio -> 400 (antes: 200, gravava o registro com nome vazio)', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Nome Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ nome: '' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })

    const resGet = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin())
    expect((await resGet.json()).nome).toBe('Fornecedor Nome Ok')
  })

  it('PUT com nome so espacos -> 400, sem alterar o fornecedor', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Nome Ok 2' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ nome: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('PUT com nome trimavel -> salva ja trimado', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Renomear' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ nome: '  Novo Nome  ' })))
    expect(res.status).toBe(200)
    expect((await res.json()).nome).toBe('Novo Nome')
  })

  it('POST com nome duplicado no mesmo tenant -> 409', async () => {
    await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Duplicado' })))
    const res = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Duplicado' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um fornecedor com esse nome' })
  })

  it('PUT renomeando para um nome ja existente no tenant -> 409', async () => {
    await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Nome Original A' })))
    const resB = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Nome Original B' })))
    const b = await resB.json()

    const res = await pedir(`/api/fornecedores/${b.id}`, comoAdmin(put({ nome: 'Nome Original A' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um fornecedor com esse nome' })
  })

  it('PUT com corpo vazio (so campos desconhecidos, sem produto_ids) -> 400', async () => {
    const resPost = await pedir('/api/fornecedores', comoAdmin(json({ nome: 'Fornecedor Sem Alteracao' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/fornecedores/${criado.id}`, comoAdmin(put({ campo_desconhecido: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/fornecedores/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('PUT com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/fornecedores/00000000-0000-0000-0000-000000000000', comoAdmin(
      put({ nome: 'x' }),
    ))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(put({ nome: 'x' }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/fornecedores/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})
