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
let funcionarioId: string

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
  // `historico_cadastros` nao tem FK para os cadastros (017), entao a ordem
  // nao e imposta pelo banco — mas limpar aqui deixa cada execucao partindo
  // de zero. `funcionarios` sai depois dele so por clareza de leitura: a FK do
  // autor e `set null`, nao barra nada.
  await admin`delete from historico_cadastros where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from funcionarios where tenant_id in (${tenantId}, ${outroTenantId})`
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

  // O COLABORADOR PRECISA DECLARAR QUEM E ao criar/editar cadastro
  // (historico de alteracoes, migration 017): o autor vem de uma LISTA
  // FECHADA de funcionarios, nunca de texto livre. Sem uma linha em
  // `funcionarios` para escolher, nao ha declaracao possivel.
  const [decl] = await admin`
    insert into funcionarios (tenant_id, nome, salario)
    values (${tenantId}, 'Funcionario Declarante Clientes', 1500) returning id`
  funcionarioId = decl.id
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

  // Este teste ja exigiu 403 tambem na leitura, seguindo o design que poe
  // `clientes` em ADMIN_ONLY_SCREENS. Mas isso quebrava o colaborador: ele
  // lanca vendas, e nao existe venda sem escolher para quem — o modal de saida
  // abria sem conseguir preencher o seletor de cliente, e a tela a que ele tem
  // direito ficava inutil.
  it('colaborador LE clientes (precisa disso para lancar venda)', async () => {
    const res = await pedir('/api/clientes', comoColab())
    expect(res.status).toBe(200)
  })

  // O colaborador PASSOU a poder criar e editar cliente (decisao do dono:
  // quem atende o estabelecimento e quem descobre que o telefone mudou).
  // `clientes` saiu de ADMIN_ONLY_SCREENS junto — ver o comentario da
  // autorizacao em src/routes/clientes.ts.
  // O colaborador DECLARA quem e e por que a cada escrita (`declarado_por` +
  // `motivo`) — exigido pelo servidor desde o historico de alteracoes
  // (migration 017). O que a rota recusa sem isso esta coberto em
  // test/historico.http.test.ts; aqui os dois casos so provam que a permissao
  // continua sendo dele.
  it('colaborador CRIA cliente', async () => {
    const res = await pedir('/api/clientes', {
      ...comoColab(), method: 'POST',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Mercado do Colaborador', declarado_por: funcionarioId, motivo: 'cliente novo da rota',
      }),
    })
    expect(res.status).toBe(201)
    const corpo = await res.json() as { id: string; nome: string }
    expect(corpo.nome).toBe('Mercado do Colaborador')
    await admin`delete from clientes where id = ${corpo.id}`
  })

  it('colaborador EDITA cliente', async () => {
    const criado = await pedir('/api/clientes', comoAdmin(json({ nome: 'Para o colaborador editar' })))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/clientes/${id}`, {
      ...comoColab(), method: 'PUT',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        tel: '44 99999-0000', declarado_por: funcionarioId, motivo: 'trocou de telefone',
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tel: '44 99999-0000' })
    await admin`delete from clientes where id = ${id}`
  })

  /**
   * A assimetria que sobrou, e a que importa: cadastro errado se corrige
   * editando, cadastro apagado leva junto o vinculo do historico sem erro
   * nenhum (`saidas.cliente_id` e ON DELETE SET NULL). Esconder o botao na
   * tela nao seria protecao — quem quisesse bastava chamar o endpoint. Este
   * teste e o que prova que a recusa e do SERVIDOR.
   */
  it('colaborador NAO exclui cliente -> 403', async () => {
    const criado = await pedir('/api/clientes', comoAdmin(json({ nome: 'Nao deve sumir' })))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/clientes/${id}`, { ...comoColab(), method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })

    // O 403 nao pode ser so a resposta: o registro tem que continuar la.
    const [ainda] = await admin`select id from clientes where id = ${id}`
    expect(ainda).toBeDefined()
    await admin`delete from clientes where id = ${id}`
  })

  it('admin exclui cliente -> 200', async () => {
    const criado = await pedir('/api/clientes', comoAdmin(json({ nome: 'Admin pode apagar' })))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/clientes/${id}`, { ...comoAdmin(), method: 'DELETE' })
    expect(res.status).toBe(200)
    const [sumiu] = await admin`select id from clientes where id = ${id}`
    expect(sumiu).toBeUndefined()
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/clientes', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  // O JSON de resposta nao expõe mais `tenant_id` (Task 10, fix round 1 —
  // identificador interno que nao precisa vazar). A protecao contra mass
  // assignment continua existindo — so nao da mais pra confirmar lendo o
  // corpo da resposta, entao confere direto no banco via pool `admin`
  // (bypassa RLS) que o tenant_id gravado foi o da sessao, nao o forjado.
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
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from clientes where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
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

    const [linha] = await admin`select tenant_id from clientes where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em/alterado_em)', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Sem Tenant Id' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/clientes', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const c of lista) expect(c).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ obs: 'x' }),
    }))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
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

  it('POST com limite negativo -> 400', async () => {
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Limite Ruim', limite: -100 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'limite nao pode ser negativo' })
  })

  it('POST com prazo negativo -> 400', async () => {
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Prazo Ruim', prazo: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'prazo nao pode ser negativo' })
  })

  it('PUT com limite negativo -> 400, sem alterar o cliente', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Limite Ok', limite: 500 })))
    const criado = await resPost.json()

    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limite: -1 }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'limite nao pode ser negativo' })

    const resGet = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect((await resGet.json()).limite).toBe(500)
  })

  it('POST com prazo fracionario -> 400, nunca 500 (campo "Prazo" no front e number sem step, form noValidate)', async () => {
    // Cenario alcancavel pela UI: digitar "1.5" no campo de prazo. Sem esta
    // validacao, o valor batia direto no `integer` do Postgres e estourava
    // "invalid input syntax for type integer", nao coberto por
    // respostaDeErroPg (23514) — 500 texto puro antes do app.onError,
    // "erro interno" generico depois. Nenhum dos dois e tao claro quanto
    // recusar o valor aqui, na borda da API.
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Prazo Fracionario', prazo: 1.5 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'prazo deve ser um numero inteiro de dias' })
  })

  it('PUT com prazo fracionario -> 400, sem alterar o cliente', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Prazo Ok', prazo: 14 })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prazo: 2.5 }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'prazo deve ser um numero inteiro de dias' })

    const resGet = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect((await resGet.json()).prazo).toBe(14)
  })

  it('POST com nome so espacos -> 400 (mesma regra de "ausente")', async () => {
    // Verificado ao vivo antes da correcao: POST {"nome":"   "} respondia
    // 201 — a checagem antiga (`if (!dados.nome)`) so testava truthy, e uma
    // string de espacos e truthy.
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('POST com nome com espacos nas bordas -> salva o nome ja trimado', async () => {
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: '  Mercado Trim  ' })))
    expect(res.status).toBe(201)
    expect((await res.json()).nome).toBe('Mercado Trim')
  })

  it('PUT com nome vazio -> 400 (antes: 200, gravava o registro com nome vazio)', async () => {
    // Verificado ao vivo antes da correcao: PUT {"nome":""} respondia 200 e
    // o registro ficava com nome vazio — o PUT nao validava nome nenhum.
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Nome Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })

    const resGet = await pedir(`/api/clientes/${criado.id}`, comoAdmin())
    expect((await resGet.json()).nome).toBe('Cliente Nome Ok')
  })

  it('PUT com nome so espacos -> 400, sem alterar o cliente', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Nome Ok 2' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '   ' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nome e obrigatorio' })
  })

  it('PUT com nome trimavel -> salva ja trimado', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Renomear' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: '  Novo Nome  ' }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).nome).toBe('Novo Nome')
  })

  it('POST com status invalido -> 400 com mensagem especifica (nao a de limite/prazo)', async () => {
    // Reproduz ao vivo o bug relatado: POST {"nome":"x","status":"sei-la"}
    // respondia 400 {"erro":"limite e prazo nao podem ser negativos"} —
    // respostaDeErroPg mapeava todo 23514 pra essa mensagem fixa.
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Status Ruim', status: 'sei-la' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'status invalido' })
  })

  it('POST com tendencia invalida -> 400 com mensagem especifica', async () => {
    const res = await pedir('/api/clientes', comoAdmin(json({ nome: 'Tendencia Ruim', tend: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'tendencia invalida' })
  })

  it('PUT com status invalido -> 400 com mensagem especifica', async () => {
    const resPost = await pedir('/api/clientes', comoAdmin(json({ nome: 'Cliente Status Ok' })))
    const criado = await resPost.json()
    const res = await pedir(`/api/clientes/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'sei-la' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'status invalido' })
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
