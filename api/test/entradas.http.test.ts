import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { entradas } from '../src/routes/entradas'

// entradas.test.ts cobre isolamento/RLS/constraints direto via withTenant.
// Este arquivo cobre a camada HTTP das rotas em src/routes/entradas.ts —
// sanear() (mass assignment), paraJson() (conversao numerica), a
// autorizacao (so exigirSessao — design: colaborador acessa entradas), os
// codigos de status que os handlers produzem, e o comportamento especifico
// desta entidade: cabecalho + itens gravados na mesma transacao, e GET /
// trazendo totais agregados em vez dos itens.
//
// Diferenca do molde (clientes.http.test.ts, que importa o app inteiro de
// src/index.ts): aqui a rota e montada num Hono local so com `entradas` —
// a tarefa que criou esta rota foi instruida a nao tocar em src/index.ts
// (a montagem final fica pra outro agente, pra nao conflitar com as
// demais entidades da Fase 1 sendo criadas em paralelo). O app local
// replica o mesmo contrato de erro do index.ts real (app.onError -> {erro}
// JSON, nunca texto puro).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/entradas', entradas)
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
let produtoId: string
let fornecedorId: string
let produtoOutroTenantId: string
let fornecedorOutroTenantId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-entradas-http', 'Entradas HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-entradas-http-2', 'Entradas HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  // Ordem por causa das FKs: itens antes de entradas, entradas antes de
  // produtos/fornecedores (produto_id/fornecedor_id sao RESTRICT/SET NULL).
  await admin`delete from entrada_itens where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from entradas where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from produtos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from fornecedores where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@entradas-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@entradas-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  const [produto] = await admin`
    insert into produtos (tenant_id, nome) values (${tenantId}, 'Produto Entrada Http') returning id`
  produtoId = produto.id
  const [fornecedor] = await admin`
    insert into fornecedores (tenant_id, nome) values (${tenantId}, 'Fornecedor Entrada Http') returning id`
  fornecedorId = fornecedor.id

  // Fixtures de dentro do OUTRO tenant, para provar que a FK composta
  // (migration 010_fk_com_tenant.sql) rejeita uma referencia valida mas de
  // fora do tenant — nao so um uuid que nao existe em lugar nenhum.
  const [produtoOutro] = await admin`
    insert into produtos (tenant_id, nome) values (${outroTenantId}, 'Produto Outro Tenant') returning id`
  produtoOutroTenantId = produtoOutro.id
  const [fornecedorOutro] = await admin`
    insert into fornecedores (tenant_id, nome) values (${outroTenantId}, 'Fornecedor Outro Tenant') returning id`
  fornecedorOutroTenantId = fornecedorOutro.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes
 * do teste seguinte, para nao vazar conexoes entre casos. Mesmo padrao do
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

function umItem(sobrescreve: Record<string, unknown> = {}) {
  return { produto_id: produtoId, un: 'KG', qtd: 10, preco: 2.5, perda_kg: 0, ...sobrescreve }
}

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/entradas')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 200 (design: colaborador acessa entradas)', async () => {
    const res = await pedir('/api/entradas', comoColab())
    expect(res.status).toBe(200)
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/entradas', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/entradas', comoAdmin({
      ...json({
        numero: 'MA-1', data: '2026-01-10', itens: [umItem()],
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from entradas where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'MA-2', data: '2026-01-10', itens: [umItem()],
    })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      obs: 'editado', tenant_id: outroTenantId, itens: [umItem()],
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.obs).toBe('editado')

    const [linha] = await admin`select tenant_id from entradas where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('item com tenant_id/entrada_id/id forjados no corpo -> ignorados, gravados com os valores reais', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'MA-3', data: '2026-01-10',
      itens: [umItem({
        tenant_id: outroTenantId,
        entrada_id: '00000000-0000-0000-0000-000000000000',
        id: '00000000-0000-0000-0000-000000000000',
      })],
    })))
    expect(res.status).toBe(201)
    const criado = await res.json()
    expect(criado.itens[0].id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [item] = await admin`select tenant_id, entrada_id from entrada_itens where entrada_id = ${criado.id}`
    expect(item.tenant_id).toBe(tenantId)
    expect(item.entrada_id).toBe(criado.id)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (cabecalho e itens), mas mantêm criado_em/alterado_em', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'PJ-1', data: '2026-01-10', itens: [umItem()],
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')
    for (const item of criado.itens) expect(item).not.toHaveProperty('tenant_id')

    const resGetId = await pedir(`/api/entradas/${criado.id}`, comoAdmin())
    const lidoPorId = await resGetId.json()
    expect(lidoPorId).not.toHaveProperty('tenant_id')
    for (const item of lidoPorId.itens) expect(item).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/entradas', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const e of lista) {
      expect(e).not.toHaveProperty('tenant_id')
      expect(e).not.toHaveProperty('itens')
    }

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      obs: 'x', itens: [umItem()],
    })))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
  })
})

describe('conversao numerica (paraJson)', () => {
  it('perda_kg (cabecalho) vem como number em POST/GET/PUT', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'NUM-1', data: '2026-01-10', perda_kg: 1.5, itens: [umItem()],
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.perda_kg).toBe('number')
    expect(criado.perda_kg).toBe(1.5)

    const resGetId = await pedir(`/api/entradas/${criado.id}`, comoAdmin())
    expect(typeof (await resGetId.json()).perda_kg).toBe('number')

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      perda_kg: 2.25, itens: [umItem()],
    })))
    const atualizado = await resPut.json()
    expect(typeof atualizado.perda_kg).toBe('number')
    expect(atualizado.perda_kg).toBe(2.25)
  })

  it('qtd/preco/perda_kg de cada item vem como number', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'NUM-2', data: '2026-01-10',
      itens: [umItem({ qtd: 3.5, preco: 9.99, perda_kg: 0.25 })],
    })))
    expect(res.status).toBe(201)
    const criado = await res.json()
    const [item] = criado.itens
    expect(typeof item.qtd).toBe('number')
    expect(item.qtd).toBe(3.5)
    expect(typeof item.preco).toBe('number')
    expect(item.preco).toBe(9.99)
    expect(typeof item.perda_kg).toBe('number')
    expect(item.perda_kg).toBe(0.25)
  })

  it('GET / devolve valor_total e peso_total como number, calculados a partir dos itens', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'NUM-3', data: '2026-01-10',
      itens: [umItem({ qtd: 10, preco: 2 }), umItem({ qtd: 5, preco: 4 })],
    })))
    const criado = await res.json()

    const resLista = await pedir('/api/entradas', comoAdmin())
    const lista = await resLista.json()
    const linha = lista.find((e: { id: string }) => e.id === criado.id)
    expect(linha).toBeDefined()
    expect(typeof linha.valor_total).toBe('number')
    expect(typeof linha.peso_total).toBe('number')
    // 10*2 + 5*4 = 40; peso = 10 + 5 = 15
    expect(linha.valor_total).toBe(40)
    expect(linha.peso_total).toBe(15)
  })
})

describe('ciclo CRUD completo (com itens)', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'CRUD-1', data: '2026-01-10', fornecedor_id: fornecedorId,
      itens: [umItem({ qtd: 4, preco: 3 })],
    })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado.itens).toHaveLength(1)

    const resGet = await pedir(`/api/entradas/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    const lido = await resGet.json()
    expect(lido.numero).toBe('CRUD-1')
    expect(lido.itens).toHaveLength(1)

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      obs: 'atualizado',
      itens: [umItem({ qtd: 1, preco: 1 }), umItem({ qtd: 2, preco: 2 })],
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.obs).toBe('atualizado')
    expect(atualizado.itens).toHaveLength(2)

    const resDelete = await pedir(`/api/entradas/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/entradas/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('PUT substitui a lista de itens inteira (apaga os antigos, grava so os novos)', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'CRUD-2', data: '2026-01-10',
      itens: [umItem({ qtd: 1, preco: 1 }), umItem({ qtd: 2, preco: 2 })],
    })))
    const criado = await resPost.json()
    expect(criado.itens).toHaveLength(2)

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      itens: [umItem({ qtd: 9, preco: 9 })],
    })))
    expect(resPut.status).toBe(200)
    const atualizado = await resPut.json()
    expect(atualizado.itens).toHaveLength(1)
    expect(atualizado.itens[0].qtd).toBe(9)

    const itensNoBanco = await admin`select id from entrada_itens where entrada_id = ${criado.id}`
    expect(itensNoBanco).toHaveLength(1)
  })
})

describe('o caso da transacao: entrada + itens sao atomicos', () => {
  it('POST com item de produto_id inexistente -> 400, e a entrada NAO fica gravada', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'TX-1', data: '2026-01-10',
      itens: [umItem(), umItem({ produto_id: idInexistente })],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto nao encontrado' })

    // A prova central: nem a entrada, nem o item valido do meio da lista,
    // podem ter sobrado gravados — cabecalho e itens sao a mesma transacao.
    const linhas = await admin`select id from entradas where tenant_id = ${tenantId} and numero = 'TX-1'`
    expect(linhas).toHaveLength(0)
    const itens = await admin`
      select ei.id from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      where e.tenant_id = ${tenantId} and e.numero = 'TX-1'`
    expect(itens).toHaveLength(0)
  })

  it('POST com item de produto_id de OUTRO tenant (existe de verdade, so nao aqui) -> 400, nada fica gravado', async () => {
    // Diferente do teste acima (uuid que nao existe em lugar nenhum): aqui
    // produtoOutroTenantId e real, so pertence ao tenant errado. Antes da
    // migration 010_fk_com_tenant.sql isso passava — a checagem de FK do
    // Postgres roda com os privilegios do dono da tabela e ignora RLS. A FK
    // composta (tenant_id, produto_id) fecha esse furo.
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'TX-4', data: '2026-01-10',
      itens: [umItem({ produto_id: produtoOutroTenantId })],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto nao encontrado' })

    const linhas = await admin`select id from entradas where tenant_id = ${tenantId} and numero = 'TX-4'`
    expect(linhas).toHaveLength(0)
  })

  it('POST com fornecedor_id de OUTRO tenant (existe de verdade, so nao aqui) -> 400, nada fica gravado', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'TX-5', data: '2026-01-10', fornecedor_id: fornecedorOutroTenantId,
      itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'fornecedor nao encontrado' })

    const linhas = await admin`select id from entradas where tenant_id = ${tenantId} and numero = 'TX-5'`
    expect(linhas).toHaveLength(0)
  })

  it('POST com fornecedor_id inexistente -> 400, e a entrada NAO fica gravada', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'TX-2', data: '2026-01-10', fornecedor_id: idInexistente,
      itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'fornecedor nao encontrado' })

    const linhas = await admin`select id from entradas where tenant_id = ${tenantId} and numero = 'TX-2'`
    expect(linhas).toHaveLength(0)
  })

  it('PUT com item de produto_id inexistente -> 400, entrada e itens ficam como estavam antes', async () => {
    const idInexistente = '00000000-0000-0000-0000-000000000000'
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'TX-3', data: '2026-01-10', obs: 'original',
      itens: [umItem({ qtd: 7, preco: 7 })],
    })))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({
      obs: 'tentativa de mudanca',
      itens: [umItem({ produto_id: idInexistente })],
    })))
    expect(resPut.status).toBe(400)
    expect(await resPut.json()).toEqual({ erro: 'produto nao encontrado' })

    // Nem o cabecalho (obs) nem os itens podem ter mudado — o delete dos
    // itens antigos e o update do cabecalho rodam na mesma transacao que o
    // insert que falhou, entao o Postgres desfaz tudo junto.
    const [linha] = await admin`select obs from entradas where id = ${criado.id}`
    expect(linha.obs).toBe('original')
    const itens = await admin`select qtd, preco from entrada_itens where entrada_id = ${criado.id}`
    expect(itens).toHaveLength(1)
    expect(Number(itens[0].qtd)).toBe(7)
    expect(Number(itens[0].preco)).toBe(7)
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem numero -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({ data: '2026-01-10', itens: [umItem()] })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'numero e obrigatorio' })
  })

  it('POST com numero so espacos -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: '   ', data: '2026-01-10', itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'numero e obrigatorio' })
  })

  it('POST com numero com espacos nas bordas -> salva ja trimado', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: '  ST-1  ', data: '2026-01-10', itens: [umItem()],
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).numero).toBe('ST-1')
  })

  it('POST sem data -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({ numero: 'ST-2', itens: [umItem()] })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data e obrigatoria' })
  })

  it('POST sem itens -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({ numero: 'ST-3', data: '2026-01-10' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'entrada precisa de pelo menos um item' })
  })

  it('POST com itens: [] -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-4', data: '2026-01-10', itens: [],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'entrada precisa de pelo menos um item' })
  })

  it('POST com item sem produto_id -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-5', data: '2026-01-10',
      itens: [{ un: 'KG', qtd: 1, preco: 1 }],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'produto_id invalido em um item' })
  })

  it('POST com qtd negativa num item -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-6', data: '2026-01-10', itens: [umItem({ qtd: -1 })],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'qtd invalida em um item' })
  })

  it('POST com preco negativo num item -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-7', data: '2026-01-10', itens: [umItem({ preco: -1 })],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'preco invalido em um item' })
  })

  it('POST com perda_kg negativo no cabecalho -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-8', data: '2026-01-10', perda_kg: -1, itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'perda_kg nao pode ser negativo' })
  })

  it('POST com pago invalido -> 400 com mensagem especifica', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-9', data: '2026-01-10', pago: 'sei-la', itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'pago invalido' })
  })

  it('POST com numero duplicado no mesmo tenant -> 409', async () => {
    await pedir('/api/entradas', comoAdmin(json({
      numero: 'DUP-1', data: '2026-01-10', itens: [umItem()],
    })))
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'DUP-1', data: '2026-01-11', itens: [umItem()],
    })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe uma entrada com esse numero' })
  })

  it('fornecedor_id vazio ("") e tratado como sem fornecedor', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'FORN-1', data: '2026-01-10', fornecedor_id: '', itens: [umItem()],
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).fornecedor_id).toBeNull()
  })

  it('fornecedor_id malformado -> 400', async () => {
    const res = await pedir('/api/entradas', comoAdmin(json({
      numero: 'FORN-2', data: '2026-01-10', fornecedor_id: 'nao-e-um-uuid', itens: [umItem()],
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'fornecedor_id invalido' })
  })

  it('PUT com corpo sem itens -> 400 (itens e sempre obrigatorio no PUT, ver comentario na rota)', async () => {
    const resPost = await pedir('/api/entradas', comoAdmin(json({
      numero: 'ST-10', data: '2026-01-10', itens: [umItem()],
    })))
    const criado = await resPost.json()
    const res = await pedir(`/api/entradas/${criado.id}`, comoAdmin(put({ obs: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'entrada precisa de pelo menos um item' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/entradas/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(put({ obs: 'x', itens: [umItem()] }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/entradas/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})
