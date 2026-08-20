import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import postgres from 'postgres'
import { criarPool, withTenant } from './db'
import { verificarSenha, criarSessao } from './auth'
import { exigirSessao, COOKIE_SESSAO, type Vars } from './middleware/sessao'
import { clientes } from './routes/clientes'

type Env = { DATABASE_URL: string }

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

/**
 * /api/health e uma rota publica, sem autenticacao — ate aqui ela devolvia
 * `String(err)` no erro (que inclui o hostname do banco, ex.:
 * "getaddrinfo ENOTFOUND db.<ref>.supabase.co", ou o nome do role numa
 * falha de autenticacao) e o banner completo do PostgreSQL (versao +
 * compilador) no sucesso. Qualquer um na internet podia sondar isso.
 * Agora devolve so {ok:true}/{ok:false}; o detalhe vai pro log do servidor
 * (console.error, visivel via `wrangler tail` em producao), nunca pro
 * corpo da resposta.
 */
app.get('/api/health', async (c) => {
  const isLocal = /^postgres:\/\/[^@]*@(localhost|127\.0\.0\.1)/.test(c.env.DATABASE_URL)
  const sql = postgres(c.env.DATABASE_URL, {
    prepare: false,
    max: 1,
    ...(isLocal ? { ssl: false } : {}),
  })
  try {
    await sql`select version()`
    return c.json({ ok: true })
  } catch (err) {
    console.error('falha no health check:', err)
    return c.json({ ok: false }, 500)
  } finally {
    c.executionCtx.waitUntil(sql.end())
  }
})

// Hash descartavel, gerado uma vez, so para consumir o mesmo tempo de CPU
// quando o usuario (ou o tenant) nao existe. Sem isso, a diferenca de
// latencia entre "usuario inexistente" e "senha errada" enumera contas:
// ~200ms de PBKDF2 sao trivialmente mensuraveis por quem tenta logins.
const HASH_DUMMY =
  'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

app.post('/api/login', async (c) => {
  const { slug, email, senha } = await c.req.json<{
    slug: string; email: string; senha: string
  }>()
  const sql = criarPool(c.env.DATABASE_URL)
  try {
    const [tenant] = await sql<{ id: string }[]>`
      select id from tenants where slug = ${slug} and ativo = true`
    // Falha generica de proposito: nao revelar se o tenant ou o email existe.
    if (!tenant) {
      await verificarSenha(senha, HASH_DUMMY)
      return c.json({ erro: 'credenciais invalidas' }, 401)
    }

    // usuarios tem RLS forcada: sem passar por withTenant, a policy nao acha
    // nenhum tenant_id ativo (current_setting('app.tenant_id') fica NULL) e
    // este select devolve zero linhas sempre — nao so para tenant errado, para
    // qualquer um. Verificado ao vivo contra o banco antes desta correcao.
    const [usuario] = await withTenant(sql, tenant.id, tx => tx<{ id: string; senha_hash: string }[]>`
      select id, senha_hash from usuarios
      where tenant_id = ${tenant.id} and email = ${email} and ativo = true`)
    if (!usuario) {
      await verificarSenha(senha, HASH_DUMMY)
      return c.json({ erro: 'credenciais invalidas' }, 401)
    }
    if (!await verificarSenha(senha, usuario.senha_hash)) {
      return c.json({ erro: 'credenciais invalidas' }, 401)
    }

    const token = await criarSessao(sql, usuario.id, tenant.id)
    setCookie(c, COOKIE_SESSAO, token, {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 7 * 86400,
    })
    return c.json({ ok: true })
  } finally {
    c.executionCtx.waitUntil(sql.end())
  }
})

app.post('/api/logout', exigirSessao, async (c) => {
  const sql = c.get('sql')
  // sessoes tem RLS forcada: o delete PRECISA passar por withTenant, senao
  // e barrado em silencio (a rota responderia 200 sem apagar nada, e a
  // sessao continuaria valida no banco ate expirar).
  await withTenant(sql, c.get('tenantId'), tx =>
    tx`delete from sessoes where token = ${c.get('token')}`)
  deleteCookie(c, COOKIE_SESSAO, { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/eu', exigirSessao, (c) =>
  c.json({ usuarioId: c.get('usuarioId'), papel: c.get('papel') }))

app.route('/api/clientes', clientes)

/**
 * Sem isto, qualquer excecao nao tratada (ex.: um erro do Postgres que
 * respostaDeErroPg nao mapeia, como "invalid input syntax for type
 * integer" quando um campo numerico recebe lixo) vira o 500 padrao do
 * Hono: corpo "Internal Server Error" em **texto puro**, nao JSON. O front
 * (web/src/api/client.ts) faz `JSON.parse(texto)` incondicional — nesse
 * corpo o parse lanca SyntaxError, o `throw new ErroApi(...)` nunca roda, e
 * o componente nunca recebe um ErroApi (cenario reproduzido ao vivo digitando
 * "1.5" no campo de prazo). Este handler garante {erro} em JSON pra
 * qualquer excecao, e loga o detalhe so no servidor — nunca a mensagem
 * crua do Postgres pro cliente (mesma preocupacao do /api/health acima).
 */
app.onError((err, c) => {
  console.error('erro nao tratado:', err)
  return c.json({ erro: 'erro interno' }, 500)
})

export default app
