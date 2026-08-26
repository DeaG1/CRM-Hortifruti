import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import { Hono } from 'hono'
import { lancamentos, CATEGORIAS } from '../src/routes/lancamentos'
import type { Vars } from '../src/middleware/sessao'
import type { EnvBanco } from '../src/db'

// Molde: test/clientes.http.test.ts. Cobre a camada HTTP das rotas em
// src/routes/lancamentos.ts — sanear() (mass assignment), paraJson()
// (conversao numerica e de data), autorizacao (exigirSessao/exigirAdmin),
// validacao de categoria e as regras de negocio de funcionario_id e de
// veiculo_id (que sao a mesma regra com sujeitos diferentes).
//
// index.ts nao pode ser modificado por este agente (montagem e feita por
// outro), entao aqui a rota e montada num app minimo local so para o
// teste — mesmo efeito de app.route('/api/lancamentos', lancamentos) em
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
let funcionarioId: string
let funcionarioOutroTenantId: string
let veiculoId: string
let veiculoOutroTenantId: string

const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/lancamentos', lancamentos)
app.onError((err, c) => {
  console.error('erro nao tratado:', err)
  return c.json({ erro: 'erro interno' }, 500)
})

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-lanc-http', 'Lanc HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-lanc-http-2', 'Lanc HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from lancamentos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from veiculo_usos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from veiculos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from funcionarios where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@lanc-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@lanc-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  const [func] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantId}, 'Funcionario Do Tenant') returning id`
  funcionarioId = func.id
  const [funcOutro] = await admin`
    insert into funcionarios (tenant_id, nome) values (${outroTenantId}, 'Funcionario De Outro Tenant') returning id`
  funcionarioOutroTenantId = funcOutro.id

  // Dois tenants DE VERDADE, cada um com o seu carro: e com estes dois que a
  // FK composta de 013 e exercitada mais abaixo.
  const [veic] = await admin`
    insert into veiculos (tenant_id, placa) values (${tenantId}, 'LHT-0001') returning id`
  veiculoId = veic.id
  const [veicOutro] = await admin`
    insert into veiculos (tenant_id, placa) values (${outroTenantId}, 'LHT-9999') returning id`
  veiculoOutroTenantId = veicOutro.id
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
const jsonPut = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})

const LANCAMENTO_BASE = { data: '2024-05-10', categoria: 'Gasolina', valor: 100 }

describe('autorizacao', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/lancamentos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador -> 403 (design: colaborador nao enxerga financeiro)', async () => {
    const res = await pedir('/api/lancamentos', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin -> 200', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin())
    expect(res.status).toBe(200)
  })

  /**
   * A restricao do badge "SALDO EM CAIXA" do cabecalho (achado S-4 da
   * auditoria) e REAL, nao so o badge escondido no front: a terceira parcela
   * do saldo (lancamentos pagos) e servida so pra admin. Um colaborador que
   * chamasse a rota na mao — ou uma versao futura do front que esquecesse o
   * `isAdmin` no Shell — recebe 403 aqui, e o saldo vira travessao em vez de
   * vazar o caixa da empresa. Ver web/src/derive/caixa.ts e
   * web/src/components/SaldoCaixa.tsx.
   *
   * Este teste duplica de proposito o "colaborador -> 403" acima: aquele
   * protege a TELA de lancamentos, este protege o caixa. Se algum dia
   * lancamentos deixar de ser admin-only, os dois tem de ser revisados
   * separadamente, com decisoes separadas.
   */
  it('colaborador nao consegue somar o caixa por fora: GET /api/lancamentos -> 403', async () => {
    const res = await pedir('/api/lancamentos', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })

    // E o corpo nunca traz valor nenhum — nem parcial.
    const texto = JSON.stringify(await pedir('/api/lancamentos', comoColab()).then(r => r.json()))
    expect(texto).not.toContain('valor')
  })
})

describe('GET /categorias', () => {
  it('devolve a lista fechada de categorias (mesma fonte que a validacao do POST/PUT)', async () => {
    const res = await pedir('/api/lancamentos/categorias', comoAdmin())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(CATEGORIAS)
  })

  it('sem cookie -> 401 (mesma exigencia de admin das demais rotas)', async () => {
    const res = await pedir('/api/lancamentos/categorias')
    expect(res.status).toBe(401)
  })

  it('colaborador -> 403', async () => {
    const res = await pedir('/api/lancamentos/categorias', comoColab())
    expect(res.status).toBe(403)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin({
      ...json({
        ...LANCAMENTO_BASE,
        tenant_id: outroTenantId,
        id: '00000000-0000-0000-0000-000000000000',
      }),
    }))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from lancamentos where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    const criado = await resPost.json()

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(
      jsonPut({ descricao: 'Reabastecimento', tenant_id: outroTenantId }),
    ))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).descricao).toBe('Reabastecimento')

    const [linha] = await admin`select tenant_id from lancamentos where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id (mas mantêm criado_em/alterado_em)', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/lancamentos', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const l of lista) expect(l).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ descricao: 'x' })))
    const atualizado = await resPut.json()
    expect(atualizado).not.toHaveProperty('tenant_id')
    expect(atualizado).toHaveProperty('alterado_em')
  })
})

describe('conversao numerica e de data (paraJson)', () => {
  it('GET /, GET /:id, POST e PUT devolvem valor como number', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, valor: 250.75 })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(typeof criado.valor).toBe('number')
    expect(criado.valor).toBe(250.75)

    const resGetId = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect(typeof (await resGetId.json()).valor).toBe('number')

    const resGetLista = await pedir('/api/lancamentos', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const l of lista) expect(typeof l.valor).toBe('number')

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ valor: 300 })))
    const atualizado = await resPut.json()
    expect(typeof atualizado.valor).toBe('number')
    expect(atualizado.valor).toBe(300)
  })

  it('data volta como "AAAA-MM-DD", nunca como timestamp completo', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, data: '2024-07-01' })))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()
    expect(criado.data).toBe('2024-07-01')
    expect(criado.data).not.toContain('T')

    const resGetId = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect((await resGetId.json()).data).toBe('2024-07-01')
  })
})

describe('ciclo CRUD completo', () => {
  it('POST -> GET /:id -> PUT /:id -> DELETE /:id -> GET /:id (404)', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    expect(resPost.status).toBe(201)
    const criado = await resPost.json()

    const resGet = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect(resGet.status).toBe(200)
    expect((await resGet.json()).categoria).toBe('Gasolina')

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ descricao: 'atualizado' })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).descricao).toBe('atualizado')

    const resDelete = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(resDelete.status).toBe(200)
    expect(await resDelete.json()).toEqual({ ok: true })

    const resGetDepois = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect(resGetDepois.status).toBe(404)
    expect(await resGetDepois.json()).toEqual({ erro: 'nao encontrado' })
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem data -> 400', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ categoria: 'Gasolina', valor: 10 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data e obrigatoria' })
  })

  it('POST com data em formato invalido -> 400, nunca 500', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, data: '10/05/2024' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'data invalida' })
  })

  it('POST sem categoria -> 400', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ data: '2024-05-10', valor: 10 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'categoria e obrigatoria' })
  })

  it('POST com categoria invalida -> 400 (categoria livre corromperia os agrupamentos do relatorio)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, categoria: 'Nao Existe' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'categoria invalida' })
  })

  it('POST sem valor -> 400', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ data: '2024-05-10', categoria: 'Gasolina' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor e obrigatorio' })
  })

  it('POST com valor negativo -> 400', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, valor: -5 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor nao pode ser negativo' })
  })

  it('PUT com valor negativo -> 400, sem alterar o lancamento', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, valor: 80 })))
    const criado = await resPost.json()
    const res = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ valor: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor nao pode ser negativo' })

    const resGet = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin())
    expect((await resGet.json()).valor).toBe(80)
  })

  it('PUT com valor null -> 400 (valor e NOT NULL sem default)', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    const criado = await resPost.json()
    const res = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ valor: null })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'valor e obrigatorio' })
  })

  it('PUT com categoria invalida -> 400', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    const criado = await resPost.json()
    const res = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ categoria: 'Nao Existe' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'categoria invalida' })
  })

  it('PUT com corpo vazio (so campos desconhecidos) -> 400', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json(LANCAMENTO_BASE)))
    const criado = await resPost.json()
    const res = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ campo_desconhecido: 'x' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'nada a alterar' })
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/lancamentos/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin(jsonPut({ descricao: 'x' }))],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/lancamentos/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })
})

describe('regra de negocio: funcionario_id so em Salario/Adiantamento', () => {
  it('POST categoria Salário com funcionario_id do proprio tenant -> grava o vinculo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500, funcionario_id: funcionarioId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).funcionario_id).toBe(funcionarioId)
  })

  it('POST categoria Adiantamento de salário com funcionario_id -> grava o vinculo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Adiantamento de salário', valor: 300, funcionario_id: funcionarioId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).funcionario_id).toBe(funcionarioId)
  })

  it('POST categoria fora de Salario/Adiantamento com funcionario_id -> ignora (nao rejeita), grava nulo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      ...LANCAMENTO_BASE, categoria: 'Frete', funcionario_id: funcionarioId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).funcionario_id).toBeNull()
  })

  it('POST categoria Salário com funcionario_id que nao existe -> 400 funcionario invalido', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500,
      funcionario_id: '00000000-0000-0000-0000-000000000000',
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('POST categoria Salário com funcionario_id malformado -> 400 funcionario invalido', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500, funcionario_id: 'nao-e-um-uuid',
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('POST categoria Salário com funcionario_id de outro tenant -> 400 funcionario invalido (guarda contra FK cross-tenant)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500, funcionario_id: funcionarioOutroTenantId,
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario invalido' })
  })

  it('PUT trocando categoria de Salário para Frete -> zera funcionario_id automaticamente', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500, funcionario_id: funcionarioId,
    })))
    const criado = await resPost.json()
    expect(criado.funcionario_id).toBe(funcionarioId)

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ categoria: 'Frete' })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).funcionario_id).toBeNull()
  })

  it('PUT so enviando funcionario_id numa categoria que ja nao e Salario/Adiantamento -> ignora, mantem nulo', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({ ...LANCAMENTO_BASE, categoria: 'Frete' })))
    const criado = await resPost.json()
    expect(criado.funcionario_id).toBeNull()

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ funcionario_id: funcionarioId })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).funcionario_id).toBeNull()
  })

  it('PUT enviando funcionario_id numa categoria ja existente Salário -> grava o vinculo', async () => {
    const resPost = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500,
    })))
    const criado = await resPost.json()
    expect(criado.funcionario_id).toBeNull()

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ funcionario_id: funcionarioId })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).funcionario_id).toBe(funcionarioId)
  })
})

/**
 * Espelho exato do describe de funcionario_id acima — mesma regra, outro
 * sujeito (ver CATEGORIAS_COM_VEICULO em src/routes/lancamentos.ts). As
 * categorias que aceitam veiculo sao as tres despesas do PROPRIO carro:
 * Gasolina, Manutencao dos Carros e Multa. 'Frete' fica de fora de proposito
 * — e transporte comprado de terceiro, e atribui-lo a uma placa da frota
 * afirmaria que aquele carro custou um dinheiro pago a outra empresa.
 */
describe('regra de negocio: veiculo_id so em Gasolina/Manutencao/Multa', () => {
  it('POST categoria Gasolina com veiculo_id do proprio tenant -> grava o vinculo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 320, veiculo_id: veiculoId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).veiculo_id).toBe(veiculoId)
  })

  it('POST categoria Manutenção dos Carros com veiculo_id -> grava o vinculo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Manutenção dos Carros', valor: 890, veiculo_id: veiculoId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).veiculo_id).toBe(veiculoId)
  })

  it('POST categoria Multa com veiculo_id -> grava o vinculo (categoria nova, pedida pelo dono)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Multa', valor: 130.16, veiculo_id: veiculoId,
    })))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.veiculo_id).toBe(veiculoId)
    expect(corpo.categoria).toBe('Multa')
  })

  it('POST categoria Frete com veiculo_id -> IGNORA (nao rejeita), grava nulo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Frete', valor: 400, veiculo_id: veiculoId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).veiculo_id).toBeNull()
  })

  it('POST categoria Salário com veiculo_id -> ignora, grava nulo (e o funcionario continua valendo)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500,
      veiculo_id: veiculoId, funcionario_id: funcionarioId,
    })))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.veiculo_id).toBeNull()
    expect(corpo.funcionario_id).toBe(funcionarioId)
  })

  it('POST categoria Outros com veiculo_id -> ignora, grava nulo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Outros', valor: 25, veiculo_id: veiculoId,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).veiculo_id).toBeNull()
  })

  it('POST categoria Gasolina com veiculo_id inexistente -> 400 veiculo invalido', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 300,
      veiculo_id: '00000000-0000-0000-0000-000000000000',
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'veiculo invalido' })
  })

  it('POST categoria Gasolina com veiculo_id malformado -> 400 veiculo invalido', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 300, veiculo_id: 'nao-e-um-uuid',
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'veiculo invalido' })
  })

  it('POST com veiculo_id de OUTRO TENANT -> 400 veiculo invalido (guarda contra FK cross-tenant)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 300, veiculo_id: veiculoOutroTenantId,
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'veiculo invalido' })

    // E nada foi gravado apontando pro carro alheio — nem com valor zero.
    const [linha] = await admin`select id from lancamentos where veiculo_id = ${veiculoOutroTenantId}`
    expect(linha).toBeUndefined()
  })

  it('PUT trocando categoria de Gasolina para Frete -> zera veiculo_id automaticamente', async () => {
    const criado = await (await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 300, veiculo_id: veiculoId,
    })))).json()
    expect(criado.veiculo_id).toBe(veiculoId)

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ categoria: 'Frete' })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).veiculo_id).toBeNull()
  })

  it('PUT so enviando veiculo_id numa categoria que nao aceita veiculo -> ignora, mantem nulo', async () => {
    const criado = await (await pedir('/api/lancamentos', comoAdmin(json({
      ...LANCAMENTO_BASE, categoria: 'Frete',
    })))).json()
    expect(criado.veiculo_id).toBeNull()

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ veiculo_id: veiculoId })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).veiculo_id).toBeNull()
  })

  it('PUT enviando veiculo_id numa categoria ja existente Gasolina -> grava o vinculo', async () => {
    const criado = await (await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 300,
    })))).json()
    expect(criado.veiculo_id).toBeNull()

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ veiculo_id: veiculoId })))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).veiculo_id).toBe(veiculoId)
  })

  it('PUT enviando veiculo_id de outro tenant numa categoria que aceita -> 400', async () => {
    const criado = await (await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Multa', valor: 130,
    })))).json()
    const resPut = await pedir(`/api/lancamentos/${criado.id}`,
      comoAdmin(jsonPut({ veiculo_id: veiculoOutroTenantId })))
    expect(resPut.status).toBe(400)
    expect(await resPut.json()).toEqual({ erro: 'veiculo invalido' })
  })

  it('PUT que so mexe no veiculo NAO derruba o funcionario de um lancamento de folha', async () => {
    // Ramo `else if` do PUT: quando a categoria nao vem no corpo, so o campo
    // ENVIADO e reavaliado. Zerar o outro apagaria um vinculo que ninguem
    // pediu para apagar.
    const criado = await (await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Salário', valor: 1500, funcionario_id: funcionarioId,
    })))).json()
    expect(criado.funcionario_id).toBe(funcionarioId)

    const resPut = await pedir(`/api/lancamentos/${criado.id}`, comoAdmin(jsonPut({ veiculo_id: veiculoId })))
    expect(resPut.status).toBe(200)
    const depois = await resPut.json()
    expect(depois.veiculo_id).toBeNull()
    expect(depois.funcionario_id).toBe(funcionarioId)
  })

  it('sanear ignora tenant_id forjado sem perder o veiculo_id legitimo', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Gasolina', valor: 50,
      veiculo_id: veiculoId, tenant_id: outroTenantId,
    })))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.veiculo_id).toBe(veiculoId)
    const [linha] = await admin`select tenant_id from lancamentos where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('GET /categorias — a lista e fonte unica, e Multa entrou nela', () => {
  it("inclui 'Multa' (o front nunca fixa nome de categoria; ele le daqui)", async () => {
    const res = await pedir('/api/lancamentos/categorias', comoAdmin())
    const lista = await res.json()
    expect(lista).toContain('Multa')
  })

  it('inclui as tres categorias que aceitam veiculo, e Frete continua na lista', async () => {
    const lista = await (await pedir('/api/lancamentos/categorias', comoAdmin())).json()
    expect(lista).toEqual(expect.arrayContaining(['Gasolina', 'Manutenção dos Carros', 'Multa', 'Frete']))
  })

  it('POST aceita Multa como categoria valida (o enum fechado foi mesmo ampliado)', async () => {
    const res = await pedir('/api/lancamentos', comoAdmin(json({
      data: '2024-05-10', categoria: 'Multa', valor: 88.5,
    })))
    expect(res.status).toBe(201)
    expect((await res.json()).categoria).toBe('Multa')
  })
})
