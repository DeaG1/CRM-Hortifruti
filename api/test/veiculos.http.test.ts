import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { criarPool, type EnvBanco } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO, type Vars } from '../src/middleware/sessao'
import { veiculos } from '../src/routes/veiculos'

// Molde: test/produtos.http.test.ts. Cobre a camada HTTP das rotas em
// src/routes/veiculos.ts — sanear(), paraJson(), autorizacao e os codigos de
// status dos handlers. veiculos.test.ts cobre isolamento/RLS/constraints
// direto via withTenant. A rota e montada num Hono local, igual ao molde
// (index.ts nao e tocado por este arquivo de teste).
const app = new Hono<{ Bindings: EnvBanco; Variables: Vars }>()
app.route('/api/veiculos', veiculos)
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
let funcionarioId: string
let funcionarioId2: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-veiculos-http', 'Veiculos HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-veiculos-http-2', 'Veiculos HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  await admin`delete from veiculo_usos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from veiculos where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from funcionarios where tenant_id in (${tenantId}, ${outroTenantId})`
  await admin`delete from usuarios where tenant_id in (${tenantId}, ${outroTenantId})`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@veiculos-http.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@veiculos-http.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  const [f] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantId}, 'João Motorista') returning id`
  const [f2] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantId}, 'Maria Motorista') returning id`
  funcionarioId = f.id
  funcionarioId2 = f2.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/**
 * As rotas chamam c.executionCtx.waitUntil(...) para fechar pools sem
 * atrasar a resposta — fora do runtime real do Workers isso lanca, entao
 * fornecemos um ExecutionContext minimo e aguardamos as promises antes do
 * teste seguinte. Mesmo padrao de test/produtos.http.test.ts.
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
const post = (corpo?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
})

describe('autorizacao — cadastro (admin) vs leitura (qualquer sessao)', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/veiculos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador LE veiculos', async () => {
    const res = await pedir('/api/veiculos', comoColab())
    expect(res.status).toBe(200)
  })

  it('colaborador NAO cria veiculo', async () => {
    const res = await pedir('/api/veiculos', {
      ...comoColab(), ...post({ placa: 'XYZ-0001' }),
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('admin cria veiculo -> 201', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: 'ADM-0001', modelo: 'Fiorino' })))
    expect(res.status).toBe(201)
  })

  it('colaborador NAO edita veiculo', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'EDT-0001' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}`, {
      ...comoColab(),
      method: 'PUT',
      headers: { ...comoColab().headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelo: 'Kombi' }),
    })
    expect(res.status).toBe(403)
  })

  it('colaborador NAO exclui veiculo', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'DEL-0001' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}`, { ...comoColab(), method: 'DELETE' })
    expect(res.status).toBe(403)
  })
})

describe('autorizacao — pegar/devolver (colaborador tambem faz)', () => {
  it('colaborador PEGA um veiculo (POST /:id/pegar) -> 201', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'PEG-0001' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    expect(res.status).toBe(201)
  })

  it('colaborador DEVOLVE um veiculo (POST /:id/devolver) -> 200', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'DEV-0001' })))).json()
    await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    const res = await pedir(`/api/veiculos/${criado.id}/devolver`, comoColab(post()))
    expect(res.status).toBe(200)
  })

  it('admin tambem pega e devolve (sem exigencia de ser colaborador)', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'ADM-0002' })))).json()
    const resPegar = await pedir(`/api/veiculos/${criado.id}/pegar`, comoAdmin(post({ funcionario_id: funcionarioId })))
    expect(resPegar.status).toBe(201)
    const resDevolver = await pedir(`/api/veiculos/${criado.id}/devolver`, comoAdmin(post()))
    expect(resDevolver.status).toBe(200)
  })

  it('sem cookie -> 401 tambem em pegar/devolver', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'SEM-0001' })))).json()
    const resPegar = await pedir(`/api/veiculos/${criado.id}/pegar`, post({ funcionario_id: funcionarioId }))
    expect(resPegar.status).toBe(401)
    const resDevolver = await pedir(`/api/veiculos/${criado.id}/devolver`, post())
    expect(resDevolver.status).toBe(401)
  })
})

describe('mass assignment', () => {
  it('POST ignora tenant_id e id enviados no corpo', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({
      placa: 'MAS-0001',
      tenant_id: outroTenantId,
      id: '00000000-0000-0000-0000-000000000000',
    })))
    expect(res.status).toBe(201)
    const corpo = await res.json()
    expect(corpo.id).not.toBe('00000000-0000-0000-0000-000000000000')

    const [linha] = await admin`select tenant_id from veiculos where id = ${corpo.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })

  it('PUT ignora tenant_id enviado no corpo', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'MAS-0002' })))).json()
    const resPut = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelo: 'Saveiro', tenant_id: outroTenantId }),
    }))
    expect(resPut.status).toBe(200)
    expect((await resPut.json()).modelo).toBe('Saveiro')

    const [linha] = await admin`select tenant_id from veiculos where id = ${criado.id}`
    expect(linha.tenant_id).toBe(tenantId)
  })
})

describe('paraJson nao expõe tenant_id', () => {
  it('POST, GET /:id, GET / e PUT nunca incluem tenant_id', async () => {
    const resPost = await pedir('/api/veiculos', comoAdmin(post({ placa: 'PJS-0001' })))
    const criado = await resPost.json()
    expect(criado).not.toHaveProperty('tenant_id')
    expect(criado).toHaveProperty('criado_em')
    expect(criado).toHaveProperty('alterado_em')

    const resGetId = await pedir(`/api/veiculos/${criado.id}`, comoAdmin())
    expect(await resGetId.json()).not.toHaveProperty('tenant_id')

    const resGetLista = await pedir('/api/veiculos', comoAdmin())
    const lista = await resGetLista.json()
    expect(lista.length).toBeGreaterThan(0)
    for (const v of lista) expect(v).not.toHaveProperty('tenant_id')

    const resPut = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelo: 'Novo' }),
    }))
    expect(await resPut.json()).not.toHaveProperty('tenant_id')
  })
})

describe('normalizacao de placa', () => {
  it('placa e gravada em maiuscula, com espacos nas bordas removidos', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: '  cba-4321  ' })))
    expect(res.status).toBe(201)
    expect((await res.json()).placa).toBe('CBA-4321')
  })
})

describe('codigos de status dos handlers', () => {
  it('POST sem placa -> 400', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({ modelo: 'Sem placa' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'placa e obrigatoria' })
  })

  it('POST com placa so espacos -> 400', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: '   ' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'placa e obrigatoria' })
  })

  it('POST com ano fracionario -> 400', async () => {
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: 'ANO-0001', ano: 2020.5 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'ano deve ser um numero inteiro' })
  })

  it('POST com placa duplicada no mesmo tenant -> 409', async () => {
    await pedir('/api/veiculos', comoAdmin(post({ placa: 'DUP-0002' })))
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: 'DUP-0002' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ erro: 'ja existe um veiculo com essa placa' })
  })

  it('POST com placa duplicada (case-insensitive) -> 409', async () => {
    await pedir('/api/veiculos', comoAdmin(post({ placa: 'CAS-0001' })))
    const res = await pedir('/api/veiculos', comoAdmin(post({ placa: 'cas-0001' })))
    expect(res.status).toBe(409)
  })

  it('GET /:id com id inexistente (mas uuid valido) -> 404', async () => {
    const res = await pedir('/api/veiculos/00000000-0000-0000-0000-000000000000', comoAdmin())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })

  it('GET/PUT/DELETE com id malformado -> 400 JSON, nunca 500 texto puro', async () => {
    for (const [metodo, init] of [
      ['GET', comoAdmin()],
      ['PUT', comoAdmin({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelo: 'x' }),
      })],
      ['DELETE', comoAdmin({ method: 'DELETE' })],
    ] as const) {
      const res = await pedir('/api/veiculos/nao-e-um-uuid', init)
      expect(res.status, `${metodo} com id malformado`).toBe(400)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      expect(await res.json()).toEqual({ erro: 'id invalido' })
    }
  })

  it('POST /:id/pegar com funcionario_id ausente -> 400', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'PEG-0002' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({})))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario_id invalido' })
  })

  it('POST /:id/pegar com funcionario_id malformado -> 400', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'PEG-0003' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: 'nao-e-uuid' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario_id invalido' })
  })

  it('POST /:id/pegar com funcionario_id inexistente -> 400 (FK)', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'PEG-0004' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({
      funcionario_id: '00000000-0000-0000-0000-000000000000',
    })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'funcionario nao encontrado' })
  })

  it('POST /:id/pegar em veiculo inexistente -> 404', async () => {
    const res = await pedir('/api/veiculos/00000000-0000-0000-0000-000000000000/pegar', comoColab(post({
      funcionario_id: funcionarioId,
    })))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'veiculo nao encontrado' })
  })

  it('POST /:id/devolver sem uso em aberto -> 404', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'DEV-0002' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/devolver`, comoColab(post()))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao ha uso em aberto para este veiculo' })
  })
})

describe('check-in duplicado via HTTP — 409 (a mesma regra do banco, vista pela API)', () => {
  it('duas tentativas concorrentes de pegar o MESMO carro: uma 201, a outra 409', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'CCR-0001' })))).json()

    const [r1, r2] = await Promise.all([
      pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId }))),
      pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId2 }))),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 409])

    const respostaConflito = r1.status === 409 ? r1 : r2
    expect(await respostaConflito.json()).toEqual({ erro: 'este veiculo ja esta em uso' })

    // so um uso aberto sobrevive, nunca dois
    const abertos = await admin`
      select id from veiculo_usos where veiculo_id = ${criado.id} and volta_em is null`
    expect(abertos.length).toBe(1)
  })

  it('sequencial (nao concorrente): pegar o mesmo carro duas vezes -> segunda 409', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'CCR-0002' })))).json()
    const r1 = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    expect(r1.status).toBe(201)
    const r2 = await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId2 })))
    expect(r2.status).toBe(409)
    expect(await r2.json()).toEqual({ erro: 'este veiculo ja esta em uso' })
  })
})

describe('devolver fecha o uso certo', () => {
  it('devolver fecha o uso em aberto (volta_em preenchido) e GET / deixa de mostrar uso_aberto', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'FEC-0001' })))).json()
    await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))

    const listaAntes = await (await pedir('/api/veiculos', comoAdmin())).json()
    const linhaAntes = listaAntes.find((v: { id: string }) => v.id === criado.id)
    expect(linhaAntes.uso_aberto).not.toBeNull()
    expect(linhaAntes.uso_aberto.funcionario_nome).toBe('João Motorista')

    const resDevolver = await pedir(`/api/veiculos/${criado.id}/devolver`, comoColab(post()))
    expect(resDevolver.status).toBe(200)
    const usoFechado = await resDevolver.json()
    expect(usoFechado.volta_em).not.toBeNull()
    expect(usoFechado.funcionario_id).toBe(funcionarioId)

    const listaDepois = await (await pedir('/api/veiculos', comoAdmin())).json()
    const linhaDepois = listaDepois.find((v: { id: string }) => v.id === criado.id)
    expect(linhaDepois.uso_aberto).toBeNull()
  })

  it('devolver nao mexe no uso aberto de OUTRO carro', async () => {
    const carroA = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'FEC-0002' })))).json()
    const carroB = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'FEC-0003' })))).json()
    await pedir(`/api/veiculos/${carroA.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    await pedir(`/api/veiculos/${carroB.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId2 })))

    await pedir(`/api/veiculos/${carroA.id}/devolver`, comoColab(post()))

    const lista = await (await pedir('/api/veiculos', comoAdmin())).json()
    const linhaA = lista.find((v: { id: string }) => v.id === carroA.id)
    const linhaB = lista.find((v: { id: string }) => v.id === carroB.id)
    expect(linhaA.uso_aberto).toBeNull()
    expect(linhaB.uso_aberto).not.toBeNull()
    expect(linhaB.uso_aberto.funcionario_id).toBe(funcionarioId2)
  })
})

describe('o mesmo funcionario com dois carros abertos (permitido)', () => {
  it('funcionario pega dois carros diferentes -> ambos 201, ambos aparecem abertos', async () => {
    const carro1 = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'MFC-0001' })))).json()
    const carro2 = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'MFC-0002' })))).json()

    const r1 = await pedir(`/api/veiculos/${carro1.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    const r2 = await pedir(`/api/veiculos/${carro2.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const lista = await (await pedir('/api/veiculos', comoAdmin())).json()
    const linha1 = lista.find((v: { id: string }) => v.id === carro1.id)
    const linha2 = lista.find((v: { id: string }) => v.id === carro2.id)
    expect(linha1.uso_aberto.funcionario_id).toBe(funcionarioId)
    expect(linha2.uso_aberto.funcionario_id).toBe(funcionarioId)
  })
})

describe('GET /:id/historico', () => {
  it('lista os usos do veiculo, do mais recente pro mais antigo, com o nome do funcionario', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'HIS-0001' })))).json()
    await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId })))
    await pedir(`/api/veiculos/${criado.id}/devolver`, comoColab(post()))
    await pedir(`/api/veiculos/${criado.id}/pegar`, comoColab(post({ funcionario_id: funcionarioId2 })))

    const res = await pedir(`/api/veiculos/${criado.id}/historico`, comoColab())
    expect(res.status).toBe(200)
    const historico = await res.json()
    expect(historico.length).toBe(2)
    expect(historico[0].funcionario_nome).toBe('Maria Motorista')
    expect(historico[0].volta_em).toBeNull()
    expect(historico[1].funcionario_nome).toBe('João Motorista')
    expect(historico[1].volta_em).not.toBeNull()
    for (const u of historico) expect(u).not.toHaveProperty('tenant_id')
  })

  it('historico de veiculo inexistente -> 404', async () => {
    const res = await pedir('/api/veiculos/00000000-0000-0000-0000-000000000000/historico', comoColab())
    expect(res.status).toBe(404)
  })

  it('historico com id malformado -> 400', async () => {
    const res = await pedir('/api/veiculos/nao-e-um-uuid/historico', comoColab())
    expect(res.status).toBe(400)
  })
})
