import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import {
  hashSenha, criarSessao,
  MINUTOS_DE_INATIVIDADE, MINUTOS_RESTANTES_PARA_RENOVAR,
} from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

/**
 * JANELA DESLIZANTE DE INATIVIDADE — os testes contra o banco.
 *
 * A politica tem tres partes e cada uma falha de um jeito diferente:
 *
 *   1. a sessao MORRE depois de 30 minutos parada;
 *   2. usar o sistema EMPURRA o vencimento para frente;
 *   3. e o empurrao NAO pode virar uma escrita por requisicao.
 *
 * As tres precisam do Postgres: o vencimento e comparado com `now()` do
 * banco, e a renovacao acontece dentro de uma funcao SQL. A regra pura do
 * limiar (`precisaRenovar`) e testada sem banco em test/auth.test.ts.
 *
 * Rodar: `docker compose -f docker-compose.dev.yml up -d` na raiz, depois
 * `node db/migrate.mjs` e `npm test --prefix api`.
 */

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

const SENHA = 'segredo123'
const SEGUNDOS_DA_JANELA = MINUTOS_DE_INATIVIDADE * 60

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let usuarioId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome, ativo) values ('teste-janela', 'Tenant Janela', true)
    on conflict (slug) do update set nome = excluded.nome, ativo = true returning id`
  tenantId = t.id

  await admin`delete from usuarios where tenant_id = ${tenantId}`
  const [u] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel, ativo)
    values (${tenantId}, 'dono@janela.com', ${await hashSenha(SENHA)}, 'Dono', 'admin', true)
    returning id`
  usuarioId = u.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/** Mesma prótese de ExecutionContext usada em sessao.test.ts. Aqui ela e
 * ainda mais importante: a RENOVACAO acontece dentro de `waitUntil`, depois
 * da resposta. Sem aguardar as promises pendentes, todo teste de renovacao
 * leria o banco antes da escrita acontecer e daria falso negativo. */
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

const comSessao = (token: string) => ({ headers: { cookie: `${COOKIE_SESSAO}=${token}` } })

/** Quantos segundos faltam para a sessao vencer, medido pelo relogio do
 * banco — o mesmo que resolver_sessao e renovar_sessao usam. */
async function segundosRestantes(token: string): Promise<number | null> {
  const [linha] = await admin<{ s: number }[]>`
    select extract(epoch from (expira_em - now()))::double precision as s
    from sessoes where token = ${token}`
  return linha ? Number(linha.s) : null
}

/** Coloca a sessao a `segundos` do vencimento, simulando tempo parado. */
async function envelhecer(token: string, segundos: number) {
  await admin`
    update sessoes set expira_em = now() + make_interval(secs => ${segundos})
    where token = ${token}`
}

describe('criarSessao — a sessao nasce com a janela, nao com dias', () => {
  it('grava vencimento de 30 minutos', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    const restante = await segundosRestantes(token)
    expect(restante).toBeGreaterThan(SEGUNDOS_DA_JANELA - 60)
    expect(restante).toBeLessThanOrEqual(SEGUNDOS_DA_JANELA)
  })

  it('nao grava nada parecido com os 7 dias da politica antiga', async () => {
    // A regressao que este teste existe para pegar e alguem trocar a
    // constante de volta para dias sem trocar o nome, ou multiplicar por
    // 86400 em vez de 60000.
    const token = await criarSessao(sql, usuarioId, tenantId)
    expect(await segundosRestantes(token)).toBeLessThan(2 * 60 * 60)
  })
})

describe('a sessao expira depois da janela de inatividade', () => {
  it('parada por mais que a janela, nao autentica mais', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)

    // Ninguem tocou no sistema por meia hora.
    await envelhecer(token, -1)

    expect((await pedir('/api/eu', comSessao(token))).status).toBe(401)
  })

  it('a requisicao que chega tarde demais NAO ressuscita a sessao', async () => {
    // O `and expira_em > now()` dentro de renovar_sessao (migration 012).
    // Sem ele, a propria requisicao rejeitada empurraria o vencimento e um
    // cookie velho voltaria a valer.
    const token = await criarSessao(sql, usuarioId, tenantId)
    await envelhecer(token, -30)

    await pedir('/api/eu', comSessao(token))

    const restante = await segundosRestantes(token)
    expect(restante).not.toBeNull()
    expect(restante!).toBeLessThan(0)
  })

  it('sessao apagada do banco nao autentica (o cookie sozinho nao vale nada)', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)

    await admin`delete from sessoes where token = ${token}`

    expect((await pedir('/api/eu', comSessao(token))).status).toBe(401)
  })
})

describe('usar o sistema empurra o vencimento para frente', () => {
  it('uma requisicao com a sessao ja gasta devolve a janela inteira', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    // Restam 2 minutos: bem abaixo do limiar, entao esta requisicao renova.
    await envelhecer(token, 2 * 60)

    const res = await pedir('/api/eu', comSessao(token))
    expect(res.status).toBe(200)

    const restante = await segundosRestantes(token)
    expect(restante).toBeGreaterThan(SEGUNDOS_DA_JANELA - 60)
  })

  it('a sessao sobrevive a uma sequencia de requisicoes espacadas', async () => {
    // O funcionario trabalhando a manha inteira: nenhuma pausa passa dos 30
    // minutos, entao a sessao nunca deveria cair — mesmo tendo comecado
    // muito antes dos 30 minutos totais decorridos.
    const token = await criarSessao(sql, usuarioId, tenantId)
    for (let i = 0; i < 6; i++) {
      // 20 minutos parado: dentro da janela, mas ja abaixo do limiar.
      await envelhecer(token, SEGUNDOS_DA_JANELA - 20 * 60)
      expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)
    }
    expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)
  })

  it('qualquer rota autenticada renova, nao so /api/eu', async () => {
    // A renovacao mora no middleware exigirSessao, entao vale para o app
    // inteiro. Se alguem a mover para dentro de uma rota especifica, o
    // funcionario que passa a manha so em Entradas seria deslogado.
    const token = await criarSessao(sql, usuarioId, tenantId)
    await envelhecer(token, 60)

    expect((await pedir('/api/produtos', comSessao(token))).status).toBe(200)

    expect(await segundosRestantes(token)).toBeGreaterThan(SEGUNDOS_DA_JANELA - 60)
  })
})

describe('renovar nao pode virar uma escrita por requisicao', () => {
  it('com muito tempo restante, a requisicao NAO toca no banco', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    // Falta mais que o limiar: nao ha o que renovar.
    await envelhecer(token, (MINUTOS_RESTANTES_PARA_RENOVAR + 2) * 60)
    const antes = await segundosRestantes(token)

    const res = await pedir('/api/eu', comSessao(token))
    expect(res.status).toBe(200)

    // O vencimento nao andou (a diferenca e so o tempo que o teste levou).
    const depois = await segundosRestantes(token)
    expect(depois!).toBeLessThan(antes!)
  })

  it('dez requisicoes seguidas de uma sessao fresca nao geram renovacao nenhuma', async () => {
    // O caso real: abrir uma tela dispara varias chamadas de uma vez (lista,
    // saldo, detalhe). Se cada uma gravasse, seriam dezenas de escritas por
    // minuto por usuario — e cada ida ao banco e uma subrequisicao contada
    // pelo Cloudflare Workers.
    const token = await criarSessao(sql, usuarioId, tenantId)
    const antes = await segundosRestantes(token)

    for (let i = 0; i < 10; i++) {
      expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)
    }

    const depois = await segundosRestantes(token)
    // Se tivesse renovado em alguma das dez, o restante teria VOLTADO para
    // perto da janela cheia em vez de continuar caindo.
    expect(depois!).toBeLessThanOrEqual(antes!)
  })

  it('a renovacao acontece na primeira requisicao abaixo do limiar, nao antes', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)

    // Um segundo ACIMA do limiar: ainda nao.
    await envelhecer(token, MINUTOS_RESTANTES_PARA_RENOVAR * 60 + 30)
    await pedir('/api/eu', comSessao(token))
    expect(await segundosRestantes(token)).toBeLessThan(MINUTOS_RESTANTES_PARA_RENOVAR * 60 + 30)

    // Abaixo do limiar: agora sim.
    await envelhecer(token, MINUTOS_RESTANTES_PARA_RENOVAR * 60 - 30)
    await pedir('/api/eu', comSessao(token))
    expect(await segundosRestantes(token)).toBeGreaterThan(SEGUNDOS_DA_JANELA - 60)
  })
})

describe('resolver_sessao devolve o tempo restante junto com a identidade', () => {
  it('devolve segundos_restantes coerentes com expira_em', async () => {
    const token = await criarSessao(sql, usuarioId, tenantId)
    await envelhecer(token, 7 * 60)

    const [linha] = await sql<{ segundos_restantes: number }[]>`
      select * from resolver_sessao(${token})`

    expect(Number(linha.segundos_restantes)).toBeGreaterThan(6 * 60)
    expect(Number(linha.segundos_restantes)).toBeLessThanOrEqual(7 * 60)
  })

  it('chega como numero, nao como string (float8, nao numeric)', async () => {
    // `'1500' < 1500` compara lexicograficamente e a renovacao aconteceria na
    // hora errada, em silencio. Por isso a funcao devolve double precision.
    const token = await criarSessao(sql, usuarioId, tenantId)
    const [linha] = await sql<{ segundos_restantes: unknown }[]>`
      select * from resolver_sessao(${token})`
    expect(typeof linha.segundos_restantes).toBe('number')
  })
})

describe('cookie de sessao — morre ao fechar o navegador', () => {
  it('o Set-Cookie do login NAO traz Max-Age nem Expires', async () => {
    // O ponto inteiro da parte 1: cookie sem prazo e cookie de sessao, que o
    // navegador guarda so na memoria. Com `maxAge` ele ia para o disco e
    // sobrevivia a fechar o Chrome — o funcionario abria o navegador e caia
    // dentro da sessao do dono.
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-janela', email: 'dono@janela.com', senha: SENHA }),
    })
    expect(res.status).toBe(200)

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_SESSAO}=`))
    expect(setCookie).not.toMatch(/Max-Age/i)
    expect(setCookie).not.toMatch(/Expires/i)
    // As outras protecoes continuam de pe.
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//i)
  })

  it('a sessao criada pelo login ja nasce com a janela de 30 minutos', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-janela', email: 'dono@janela.com', senha: SENHA }),
    })
    const token = (res.headers.get('set-cookie') ?? '')
      .match(new RegExp(`${COOKIE_SESSAO}=([^;]+)`))?.[1]
    expect(token).toBeTruthy()
    expect(await segundosRestantes(token!)).toBeLessThanOrEqual(SEGUNDOS_DA_JANELA)
  })
})

describe('logout apaga a sessao no banco — provado, nao presumido', () => {
  it('depois do logout a linha nao existe mais (consultado com o role admin)', async () => {
    const res = await pedir('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'teste-janela', email: 'dono@janela.com', senha: SENHA }),
    })
    const token = (res.headers.get('set-cookie') ?? '')
      .match(new RegExp(`${COOKIE_SESSAO}=([^;]+)`))?.[1]
    expect(token).toBeTruthy()

    expect((await pedir('/api/logout', { method: 'POST', ...comSessao(token!) })).status).toBe(200)

    // Consultado como admin, sem RLS e sem passar por resolver_sessao: a
    // linha sumiu de verdade, nao esta apenas invisivel para o app.
    const [linha] = await admin`select 1 from sessoes where token = ${token!}`
    expect(linha).toBeUndefined()
  })

  it('o withTenant do logout e LOAD-BEARING: o mesmo delete sem tenant apaga zero linhas', async () => {
    // Isto nao e teste do produto, e teste da SUPOSICAO em que o produto se
    // apoia. `sessoes` tem FORCE ROW LEVEL SECURITY: sem
    // `set_config('app.tenant_id', ...)`, um delete nao da erro — ele apaga
    // zero linhas em silencio, e a rota responderia 200 com a sessao viva.
    // Este projeto ja teve dois bloqueios silenciosos de RLS (busca de
    // usuarios no login, e a policy de tenants da migration 007, confirmada
    // em producao). Se um dia alguem "simplificar" o logout tirando o
    // withTenant, e este teste que grita.
    const token = await criarSessao(sql, usuarioId, tenantId)

    const semTenant = await sql`delete from sessoes where token = ${token}`
    expect(semTenant.count).toBe(0)
    // A sessao continua valendo — a prova de que o delete nao teve efeito.
    expect((await pedir('/api/eu', comSessao(token))).status).toBe(200)

    // Com o tenant definido na mesma transacao, o delete funciona.
    const comTenant = await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`
      return tx`delete from sessoes where token = ${token}`
    })
    expect((comTenant as unknown as { count: number }).count).toBe(1)
    expect((await pedir('/api/eu', comSessao(token))).status).toBe(401)
  })

  it('renovar_sessao NAO cai na mesma armadilha: e SECURITY DEFINER', async () => {
    // A renovacao roda em toda requisicao autenticada e nao passa por
    // withTenant. Se ela dependesse de RLS, seria bloqueada em silencio e
    // TODA sessao morreria em 30 minutos mesmo em uso continuo — um bug que
    // so aparece meia hora depois, sem nada nos logs.
    const token = await criarSessao(sql, usuarioId, tenantId)
    await envelhecer(token, 60)

    // Chamada direta, com o role da aplicacao e sem tenant nenhum definido.
    await sql`select renovar_sessao(${token}, ${MINUTOS_DE_INATIVIDADE}::int)`

    expect(await segundosRestantes(token)).toBeGreaterThan(SEGUNDOS_DA_JANELA - 60)
  })
})
