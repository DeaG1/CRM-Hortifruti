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
//
// ENCOLHEU JUNTO COM A ROTA: os describes de pegar, devolver, check-in
// duplicado, "mesmo funcionario com dois carros" e GET /:id/historico sairam
// — as rotas que eles exercitavam nao existem mais. Entraram no lugar: a
// leitura agora exigindo admin, e os dois destinos possiveis de um DELETE
// (lancamento nao barra, historico de uso legado barra).
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

  await admin`delete from lancamentos where tenant_id in (${tenantId}, ${outroTenantId})`
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

  // So o `veiculo_usos` legado ainda precisa de funcionario (a coluna e NOT
  // NULL na tabela orfa) — nenhuma rota deste arquivo cria funcionario.
  const [f] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantId}, 'João Motorista') returning id`
  funcionarioId = f.id
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

// A tela de Veiculos passou a mostrar dinheiro (quanto cada carro custou no
// periodo, de GET /api/lancamentos, admin-only) e perdeu a acao operacional
// que justificava o colaborador ver a tela. Estes testes sao o lado da API
// do 'veiculos' que entrou em ADMIN_ONLY_SCREENS: se um dia alguem reabrir a
// rota sem reabrir a tela (ou o contrario), um dos dois lados quebra aqui.
describe('autorizacao — a rota inteira e admin (mudou: a leitura era aberta)', () => {
  it('sem cookie -> 401', async () => {
    const res = await pedir('/api/veiculos')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ erro: 'nao autenticado' })
  })

  it('colaborador NAO LE a lista de veiculos', async () => {
    const res = await pedir('/api/veiculos', comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('colaborador NAO LE a ficha de um veiculo', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'FIC-0001' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}`, comoColab())
    expect(res.status).toBe(403)
  })

  it('admin LE a lista', async () => {
    const res = await pedir('/api/veiculos', comoAdmin())
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

// As rotas de uso sairam de src/routes/veiculos.ts. Este describe existe pra
// a remocao ser um FATO verificado e nao uma ausencia de teste: se alguem
// reintroduzir os endpoints sem discutir, estes tres falham.
describe('as rotas de check-in/check-out nao existem mais', () => {
  it('POST /:id/pegar -> 404 (rota inexistente, nao 201)', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'GON-0001' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/pegar`, comoAdmin(post({ funcionario_id: funcionarioId })))
    expect(res.status).toBe(404)
  })

  it('POST /:id/devolver -> 404 (rota inexistente, nao 200)', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'GON-0002' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/devolver`, comoAdmin(post()))
    expect(res.status).toBe(404)
  })

  it('GET /:id/historico -> 404 (rota inexistente, nao 200)', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'GON-0003' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}/historico`, comoAdmin())
    expect(res.status).toBe(404)
  })

  it('GET / nao devolve mais `uso_aberto` em nenhuma linha', async () => {
    await pedir('/api/veiculos', comoAdmin(post({ placa: 'GON-0004' })))
    const lista = await (await pedir('/api/veiculos', comoAdmin())).json()
    expect(lista.length).toBeGreaterThan(0)
    for (const v of lista) expect(v).not.toHaveProperty('uso_aberto')
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
})

/**
 * OS DESTINOS DE UM DELETE, e a diferenca entre eles esta nas decisoes
 * documentadas em 013_lancamentos_veiculo.sql e 015_veiculo_usos_cascade.sql:
 *
 *  - com LANCAMENTO: passa e o lancamento fica. `lancamentos_veiculo_fk` e
 *    `on delete set null` — a despesa aconteceu e continua valendo; o que se
 *    perde e a etiqueta "de qual carro". O valor do lancamento nao pode mudar
 *    porque alguem arrumou o cadastro da frota.
 *  - com REGISTRO DE USO legado: passa e o uso sai junto.
 *    `veiculo_usos_veiculo_fk` era `on delete restrict` (011) e virou
 *    `cascade` na 015. Enquanto foi restrict, uma linha na tabela orfa —
 *    intocavel pelo produto desde que a tela saiu (7b841b1) — barrava a
 *    exclusao para sempre.
 *  - barrado por QUALQUER OUTRA FK: 409 com mensagem legivel, nunca 500. Hoje
 *    nao existe nenhuma; o teste cria uma so para provar o caminho.
 */
describe('DELETE — nem lancamento nem registro de uso barram; outra FK vira 409, nao 500', () => {
  it('excluir veiculo COM lancamento devolve 200 e zera veiculo_id, preservando o valor', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'LAN-0001' })))).json()
    const [lanc] = await admin`
      insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
      values (${tenantId}, current_date, 'Gasolina', 250.00, ${criado.id}) returning id`

    const res = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [depois] = await admin`select veiculo_id, valor from lancamentos where id = ${lanc.id}`
    expect(depois).toBeDefined()
    expect(depois.veiculo_id).toBeNull()
    expect(Number(depois.valor)).toBe(250)
  })

  it('excluir veiculo COM registro de uso legado -> 200 e o uso sai junto', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'USO-0001' })))).json()
    // Inserido direto: nao ha mais rota que escreva em veiculo_usos. E
    // exatamente o cenario de dado legado que a tabela orfa deixa para tras —
    // e era ele que travava a exclusao em producao ate a 015.
    const [uso] = await admin`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id, volta_em)
      values (${tenantId}, ${criado.id}, ${funcionarioId}, now()) returning id`

    const res = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [ainda] = await admin`select id from veiculos where id = ${criado.id}`
    expect(ainda).toBeUndefined()
    const [usoDepois] = await admin`select id from veiculo_usos where id = ${uso.id}`
    expect(usoDepois, 'o registro de uso deveria ter saido junto').toBeUndefined()
  })

  /**
   * A REDE, e o motivo de ela existir depois da 015.
   *
   * Com o cascade, nenhuma FK barra mais a exclusao de um veiculo — entao nao
   * ha como exercitar o 23503 desta rota com o esquema como ele esta. O teste
   * CRIA uma FK `restrict` temporaria, faz o DELETE por HTTP e derruba a FK no
   * `finally`. O que ele prova nao e um bloqueio especifico (nenhum existe):
   * e que a rota traduz um 23503 que ela NAO CONHECE em 409 com texto
   * legivel, em vez de deixar a excecao subir e virar 500 "erro interno".
   *
   * Sem esta prova, o try/catch da rota ficaria sem cobertura no dia em que a
   * 015 removeu a unica causa conhecida — e a regressao seria invisivel ate
   * alguem adicionar a proxima tabela e o dono levar 500 de novo. Foi
   * exatamente esse buraco que existia em funcionarios.ts, que nem try/catch
   * tinha.
   *
   * A tabela auxiliar e criada e derrubada aqui e nao interfere em outros
   * arquivos de teste rodando em paralelo: nenhum deles insere nela, e uma FK
   * `restrict` so barra quando existe linha referenciando a que sai.
   */
  it('barrado por outra FK (restrict criada aqui) -> 409 com mensagem legivel, nunca 500', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'FKX-0001' })))).json()
    await admin.unsafe(`
      create table teste_bloqueio_veiculo (
        id         uuid primary key default gen_random_uuid(),
        tenant_id  uuid not null,
        veiculo_id uuid not null,
        constraint teste_bloqueio_veiculo_fk
          foreign key (tenant_id, veiculo_id) references veiculos(tenant_id, id) on delete restrict
      )`)
    try {
      await admin`
        insert into teste_bloqueio_veiculo (tenant_id, veiculo_id)
        values (${tenantId}, ${criado.id})`

      const res = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
      expect(res.status, 'FK desconhecida nao pode virar 500').toBe(409)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      const corpo = await res.json()
      // A mensagem tem que dizer o CAMINHO (desativar), nao so que falhou.
      expect(corpo.erro).toMatch(/não pode ser excluído/i)
      expect(corpo.erro).toMatch(/desative-o/i)

      const [ainda] = await admin`select id from veiculos where id = ${criado.id}`
      expect(ainda, 'o bloqueio e real: o veiculo continua no cadastro').toBeDefined()
    } finally {
      await admin.unsafe('drop table if exists teste_bloqueio_veiculo')
    }
  })

  it('excluir veiculo sem nada -> 200', async () => {
    const criado = await (await pedir('/api/veiculos', comoAdmin(post({ placa: 'SEM-0002' })))).json()
    const res = await pedir(`/api/veiculos/${criado.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(200)
  })

  it('DELETE de id inexistente -> 404', async () => {
    const res = await pedir('/api/veiculos/00000000-0000-0000-0000-000000000000', comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ erro: 'nao encontrado' })
  })
})
