import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import { Hono } from 'hono'
import { descontos, respostaDeErroPg } from '../src/routes/descontos'
import { funcionarios } from '../src/routes/funcionarios'
import type { Vars } from '../src/middleware/sessao'
import type { EnvBanco } from '../src/db'

// Molde: test/lancamentos.http.test.ts + test/funcionarios.http.test.ts.
// Cobre a camada HTTP de src/routes/descontos.ts — sanear() (mass
// assignment), paraJson() (conversao de valor e de data), autorizacao
// (exigirSessao/exigirAdmin, que tem de bater com a tela admin-only) e os
// codigos de status dos handlers.
//
// `funcionarios` e montado no MESMO app de proposito: o teste de cascade
// abaixo exclui o funcionario pela rota real, que e como o dono faz, e nao
// por SQL direto (o par no banco esta em test/descontos_fk.test.ts).

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
let tokenAdminOutro: string
let funcionarioId: string
let funcionarioAlheioId: string

const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/descontos', descontos)
app.route('/api/funcionarios', funcionarios)
app.onError((err, c) => {
  console.error('erro nao tratado:', err)
  return c.json({ erro: 'erro interno' }, 500)
})

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-desc-http', 'Desc HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-desc-http-2', 'Desc HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from descontos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from lancamentos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from funcionarios where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@desc-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@desc-http.com', ${hash}, 'Colab', 'colaborador') returning id`
  const [uAdmin2] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${outroTenantId}, 'admin@desc-http-2.com', ${hash}, 'Admin 2', 'admin') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)
  tokenAdminOutro = await criarSessao(sql, uAdmin2.id, outroTenantId)

  const [f] = await admin`
    insert into funcionarios (tenant_id, nome, salario) values (${tenantId}, 'Joao Da Casa', 2200) returning id`
  const [fAlheio] = await admin`
    insert into funcionarios (tenant_id, nome, salario) values (${outroTenantId}, 'Maria Da Outra', 1800) returning id`
  funcionarioId = f.id
  funcionarioAlheioId = fAlheio.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/** Ver test/funcionarios.http.test.ts: fora do runtime do Workers,
 * c.executionCtx.waitUntil lanca — este ExecutionContext minimo guarda as
 * promises e as aguarda antes do teste seguinte. */
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
const comoAdminDoOutroTenant = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenAdminOutro}` },
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

/** Corpo valido minimo — cada teste sobrescreve o que lhe interessa. */
const desconto = (over: Record<string, unknown> = {}) => ({
  funcionario_id: funcionarioId,
  data: '2026-06-12',
  motivo: 'faltou sem avisar',
  valor: 120.5,
  ...over,
})

describe('autorizacao — tem de bater com a tela (Funcionarios e admin-only)', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/descontos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 403 na LEITURA (ler quanto foi descontado de alguem ja e ler folha)', async () => {
    const res = await pedir('/api/descontos', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('colaborador -> 403 tambem na escrita (POST, PUT e DELETE)', async () => {
    const resPost = await pedir('/api/descontos', comoColab(json(desconto())))
    expect(resPost.status).toBe(403)
    const resPut = await pedir('/api/descontos/00000000-0000-0000-0000-000000000000', comoColab(put({ valor: 1 })))
    expect(resPut.status).toBe(403)
    const resDel = await pedir('/api/descontos/00000000-0000-0000-0000-000000000000', comoColab({ method: 'DELETE' }))
    expect(resDel.status).toBe(403)
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/descontos', comoAdmin())
    expect(res.status).toBe(200)
  })
})

describe('ciclo CRUD completo — criar, listar, editar e apagar', () => {
  it('POST -> GET / -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/descontos', comoAdmin(json(desconto({
      data: '2026-06-12', motivo: 'faltou sem avisar', valor: 120.5,
    }))))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado.data).toBe('2026-06-12')
    expect(criado.motivo).toBe('faltou sem avisar')
    expect(criado.valor).toBe(120.5)
    expect(criado.funcionario_id).toBe(funcionarioId)

    const lista = await (await pedir('/api/descontos', comoAdmin())).json()
    expect(lista.map((d: { id: string }) => d.id)).toContain(criado.id)

    const resGet = await pedir(`/api/descontos/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).motivo).toBe('faltou sem avisar')

    const resPut = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({
      motivo: 'atestado apresentado depois', valor: 60,
    })))
    expect(resPut.status).toBe(200)
    const editado = await resPut.json()
    expect(editado.motivo).toBe('atestado apresentado depois')
    expect(editado.valor).toBe(60)
    expect(editado.data).toBe('2026-06-12') // o que nao foi enviado nao muda

    const resDel = await pedir(`/api/descontos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDel.status).toBe(200)
    expect(await resDel.json()).toEqual({ ok: true })

    const resDepois = await pedir(`/api/descontos/${criado.id}`, comoAdmin())
    expect(resDepois.status).toBe(404)
    expect(await resDepois.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET / ordena do mais recente pro mais antigo (a ordem que o historico da tela mostra)', async () => {
    const antigo = await (await pedir('/api/descontos', comoAdmin(json(desconto({ data: '2026-03-02', motivo: 'falta de marco' }))))).json()
    const novo = await (await pedir('/api/descontos', comoAdmin(json(desconto({ data: '2026-08-20', motivo: 'falta de agosto' }))))).json()

    const lista: { id: string }[] = await (await pedir('/api/descontos', comoAdmin())).json()
    const ids = lista.map(d => d.id)
    expect(ids.indexOf(novo.id)).toBeLessThan(ids.indexOf(antigo.id))

    await pedir(`/api/descontos/${antigo.id}`, comoAdmin({ method: 'DELETE' }))
    await pedir(`/api/descontos/${novo.id}`, comoAdmin({ method: 'DELETE' }))
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({
      tenant_id: outroTenantId,
      id: '00000000-0000-0000-0000-000000000000',
    }))))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from descontos where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto())))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ valor: 10, tenant_id: outroTenantId })))
    expect(res.status).toBe(200)

    const [linha] = await admin`select tenant_id from descontos where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson — tenant_id fora, valor number, data pura', () => {
  it('POST, GET /, GET /:id e PUT nunca expoem tenant_id e sempre devolvem valor number e data AAAA-MM-DD', async () => {
    const resPost = await pedir('/api/descontos', comoAdmin(json(desconto({ valor: 99.9, data: '2026-06-15' }))))
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(typeof criado.valor).toBe('number')
    expect(criado.valor).toBe(99.9)
    // `date` no Postgres vira Date no driver; sem conversao sairia
    // "2026-06-15T00:00:00.000Z" e o <input type="date"> do front ficaria vazio.
    expect(criado.data).toBe('2026-06-15')
    expect(criado).toHaveProperty('criado_em')

    const doId = await (await pedir(`/api/descontos/${criado.id}`, comoAdmin())).json()
    expect(doId).not.toHaveProperty('tenant_id')
    expect(typeof doId.valor).toBe('number')
    expect(doId.data).toBe('2026-06-15')

    const lista = await (await pedir('/api/descontos', comoAdmin())).json()
    expect(lista.length).toBeGreaterThan(0)
    for (const d of lista) {
      expect(d).not.toHaveProperty('tenant_id')
      expect(typeof d.valor).toBe('number')
      expect(d.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }

    const editado = await (await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ valor: 12.34 })))).json()
    expect(editado).not.toHaveProperty('tenant_id')
    expect(editado.valor).toBe(12.34)
    expect(editado.data).toBe('2026-06-15')
  })
})

describe('validacao dos campos', () => {
  it('POST sem data -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json({ ...desconto(), data: undefined })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data e obrigatoria' })
  })

  it('POST com data fora do formato -> 400, nunca 500 do Postgres', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({ data: '12/06/2026' }))))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ erro: 'data invalida' })
  })

  it('POST sem motivo -> 400 (o motivo e metade do registro)', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json({ ...desconto(), motivo: undefined })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'motivo e obrigatorio' })
  })

  it('POST com motivo so espacos -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({ motivo: '   ' }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'motivo e obrigatorio' })
  })

  it('POST com motivo com espacos nas bordas -> salva ja trimado', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({ motivo: '  faltou segunda  ' }))))
    expect(res.status).toBe(201)
    expect((await res.json()).motivo).toBe('faltou segunda')
  })

  it('POST sem valor -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json({ ...desconto(), valor: undefined })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor e obrigatorio' })
  })

  it('POST com valor negativo -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({ valor: -1 }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor nao pode ser negativo' })
  })

  it('PUT com valor negativo -> 400, sem alterar o desconto', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto({ valor: 80 }))))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ valor: -5 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor nao pode ser negativo' })

    const depois = await (await pedir(`/api/descontos/${criado.id}`, comoAdmin())).json()
    expect(depois.valor).toBe(80)
  })

  it('PUT com motivo vazio -> 400 (nao da pra apagar o motivo de um desconto ja gravado)', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto({ motivo: 'faltou' }))))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ motivo: '' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'motivo e obrigatorio' })

    const depois = await (await pedir(`/api/descontos/${criado.id}`, comoAdmin())).json()
    expect(depois.motivo).toBe('faltou')
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto())))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ campo_desconhecido: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id inexistente (uuid valido) -> 404', async () => {
    const res = await pedir('/api/descontos/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(put({ valor: 1 }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/descontos/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })

  it('DELETE de id inexistente -> 404', async () => {
    const res = await pedir('/api/descontos/00000000-0000-0000-0000-000000000000', comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('vinculo com o funcionario', () => {
  it('POST sem funcionario_id -> 400 (desconto sem funcionario nao existe)', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json({ ...desconto(), funcionario_id: undefined })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('POST com funcionario_id malformado -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({ funcionario_id: 'nao-e-uuid' }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('POST com funcionario inexistente -> 400', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({
      funcionario_id: '00000000-0000-0000-0000-000000000000',
    }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('PUT tentando zerar o funcionario -> 400, e a coluna not-null nunca e violada', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto())))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ funcionario_id: null })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })

    const depois = await (await pedir(`/api/descontos/${criado.id}`, comoAdmin())).json()
    expect(depois.funcionario_id).toBe(funcionarioId)
  })
})

/**
 * O PONTO DA 010 EXERCITADO DE VERDADE, com duas empresas reais.
 *
 * A checagem de chave estrangeira do Postgres roda com o privilegio do dono
 * da tabela referenciada e NAO respeita RLS: com uma FK simples
 * (`references funcionarios(id)`), um desconto da empresa B apontando para o
 * funcionario da empresa A seria aceito em silencio — e dinheiro seria
 * abatido do salario de uma pessoa de outra empresa. A FK COMPOSTA de 016
 * torna isso impossivel; a checagem na rota so existe para o erro sair como
 * 400 legivel em vez de 23503 cru.
 */
describe('isolamento entre duas empresas', () => {
  it('POST referenciando funcionario de OUTRO tenant -> 400, e nada e gravado', async () => {
    const res = await pedir('/api/descontos', comoAdmin(json(desconto({
      funcionario_id: funcionarioAlheioId,
    }))))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })

    const linhas = await admin`select id from descontos where funcionario_id = ${funcionarioAlheioId}`
    expect(linhas).toHaveLength(0)
  })

  it('PUT tentando mudar o desconto para funcionario de OUTRO tenant -> 400', async () => {
    const criado = await (await pedir('/api/descontos', comoAdmin(json(desconto())))).json()
    const res = await pedir(`/api/descontos/${criado.id}`, comoAdmin(put({ funcionario_id: funcionarioAlheioId })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })

    const [linha] = await admin`select funcionario_id from descontos where id = ${criado.id}`
    expect(linha.funcionario_id).toBe(funcionarioId)
  })

  it('GET / de uma empresa nao lista os descontos da outra', async () => {
    const meu = await (await pedir('/api/descontos', comoAdmin(json(desconto({ motivo: 'falta da casa' }))))).json()
    const [alheio] = await admin`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${outroTenantId}, ${funcionarioAlheioId}, '2026-06-12', 'falta da outra empresa', 90)
      returning id`

    const daCasa: { id: string }[] = await (await pedir('/api/descontos', comoAdmin())).json()
    expect(daCasa.map(d => d.id)).toContain(meu.id)
    expect(daCasa.map(d => d.id)).not.toContain(alheio.id)

    const daOutra: { id: string }[] = await (await pedir('/api/descontos', comoAdminDoOutroTenant())).json()
    expect(daOutra.map(d => d.id)).toContain(alheio.id)
    expect(daOutra.map(d => d.id)).not.toContain(meu.id)
  })

  it('GET /:id de um desconto alheio -> 404 (existe, mas nao para esta empresa)', async () => {
    const [alheio] = await admin`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${outroTenantId}, ${funcionarioAlheioId}, '2026-06-13', 'outra falta alheia', 40)
      returning id`
    const res = await pedir(`/api/descontos/${alheio.id}`, comoAdmin())
    expect(res.status).toBe(404)
  })

  it('PUT e DELETE nao alcancam desconto de outra empresa -> 404, e a linha continua la', async () => {
    const [alheio] = await admin`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${outroTenantId}, ${funcionarioAlheioId}, '2026-06-14', 'intocavel', 55)
      returning id`

    const resPut = await pedir(`/api/descontos/${alheio.id}`, comoAdmin(put({ valor: 1 })))
    expect(resPut.status).toBe(404)
    const resDel = await pedir(`/api/descontos/${alheio.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDel.status).toBe(404)

    const [linha] = await admin`select valor, motivo from descontos where id = ${alheio.id}`
    expect(linha, 'a linha da outra empresa nao pode ter sido tocada').toBeDefined()
    expect(Number(linha.valor)).toBe(55)
    expect(linha.motivo).toBe('intocavel')
  })
})

describe('excluir o funcionario leva os descontos junto (cascade, 016)', () => {
  it('DELETE /api/funcionarios/:id -> 200, e os descontos daquele funcionario somem', async () => {
    const [f] = await admin`
      insert into funcionarios (tenant_id, nome, salario) values (${tenantId}, 'Demitido Com Falta', 1500) returning id`
    const d1 = await (await pedir('/api/descontos', comoAdmin(json(desconto({
      funcionario_id: f.id, motivo: 'faltou na segunda', valor: 70,
    }))))).json()
    const d2 = await (await pedir('/api/descontos', comoAdmin(json(desconto({
      funcionario_id: f.id, motivo: 'faltou na terca', valor: 70,
    }))))).json()

    // Pela rota real: e assim que o dono exclui, e era exatamente aqui que uma
    // FK `restrict` teria reproduzido o bloqueio permanente da 015 — o unico
    // caminho do produto ate estes descontos e a linha do proprio funcionario.
    const res = await pedir(`/api/funcionarios/${f.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status, 'desconto nao pode barrar a exclusao do funcionario').toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const restantes = await admin`select id from descontos where id in (${d1.id}, ${d2.id})`
    expect(restantes, 'os descontos deveriam ter saido junto com o funcionario').toHaveLength(0)
  })

  it('o cascade nao alcanca o LANCAMENTO: o salario pago continua no financeiro, so desvinculado', async () => {
    // As duas FKs disparam no MESMO delete com decisoes diferentes: o desconto
    // (que nunca moveu dinheiro) sai; o salario efetivamente pago fica, porque
    // o dinheiro saiu de verdade e o caixa nao pode mudar de valor porque
    // alguem arrumou o cadastro da equipe.
    const [f] = await admin`
      insert into funcionarios (tenant_id, nome, salario) values (${tenantId}, 'Demitido Com Salario', 1500) returning id`
    const d = await (await pedir('/api/descontos', comoAdmin(json(desconto({
      funcionario_id: f.id, motivo: 'faltou', valor: 100,
    }))))).json()
    const [lanc] = await admin`
      insert into lancamentos (tenant_id, data, categoria, valor, funcionario_id)
      values (${tenantId}, current_date, 'Salário', 1400, ${f.id}) returning id`

    const res = await pedir(`/api/funcionarios/${f.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(200)

    const [semDesconto] = await admin`select id from descontos where id = ${d.id}`
    expect(semDesconto).toBeUndefined()
    const [depois] = await admin`select funcionario_id, tenant_id, valor from lancamentos where id = ${lanc.id}`
    expect(depois, 'o lancamento nao pode ter sido apagado').toBeDefined()
    expect(depois.funcionario_id).toBeNull()
    expect(depois.tenant_id).toBe(tenantId)
    expect(Number(depois.valor)).toBe(1400)
    await admin`delete from lancamentos where id = ${lanc.id}`
  })
})

describe('respostaDeErroPg (chamada direta — branches nao alcancaveis por HTTP)', () => {
  it('23505 -> 409', () => {
    expect(respostaDeErroPg({ code: '23505' })).toEqual({
      corpo: { erro: 'ja existe um desconto com esses dados' }, status: 409,
    })
  })

  it('23514 mapeia a constraint conhecida', () => {
    expect(respostaDeErroPg({ code: '23514', constraint_name: 'descontos_valor_check' })).toEqual({
      corpo: { erro: 'valor nao pode ser negativo' }, status: 400,
    })
    expect(respostaDeErroPg({ code: '23514', constraint_name: 'descontos_motivo_check' })).toEqual({
      corpo: { erro: 'motivo e obrigatorio' }, status: 400,
    })
  })

  it('23514 de constraint desconhecida cai na mensagem generica', () => {
    expect(respostaDeErroPg({ code: '23514', constraint_name: 'outra_qualquer' })).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' }, status: 400,
    })
  })

  it('erro que nao e do banco -> null (quem chamou deixa subir)', () => {
    expect(respostaDeErroPg(new Error('qualquer outra coisa'))).toBeNull()
    expect(respostaDeErroPg({ code: '23503' })).toBeNull()
  })
})
