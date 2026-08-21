import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { criarPoolDoEnv, withTenant, type EnvBanco } from './db'
import { verificarSenha, criarSessao, ITERACOES } from './auth'
import { exigirSessao, COOKIE_SESSAO, type Vars } from './middleware/sessao'
import { clientes } from './routes/clientes'
import { produtos } from './routes/produtos'
import { fornecedores } from './routes/fornecedores'
import { funcionarios } from './routes/funcionarios'
import { lancamentos } from './routes/lancamentos'
import { entradas } from './routes/entradas'
import { saidas } from './routes/saidas'
import { perdas } from './routes/perdas'
import { estoque } from './routes/estoque'

type Env = EnvBanco

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
  const sql = criarPoolDoEnv(c.env)
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

// Hash descartavel, so para consumir o mesmo tempo de CPU quando o usuario
// (ou o tenant) nao existe. Sem isso, a diferenca de latencia entre "usuario
// inexistente" e "senha errada" enumera contas: o PBKDF2 e trivialmente
// mensuravel por quem tenta logins.
//
// O numero de iteracoes vem de ITERACOES, nunca fixado a mao. Ele ja esteve
// fixado em 210000 enquanto a constante caiu para 100000 (teto do runtime do
// Workers), e o efeito era pior que um dummy lento: `verificarSenha` LANCA ao
// receber um hash acima do teto, entao o login com usuario inexistente
// respondia 500 em vez de 401 — reabrindo por outro caminho exatamente a
// enumeracao que este dummy existe para fechar.
//
// O sal precisa ter TAM_SAL bytes e a chave TAM_CHAVE, senao verificarSenha
// rejeita o formato de imediato e nao gasta tempo nenhum — o que anula a
// defesa em silencio.
const HASH_DUMMY =
  `pbkdf2$${ITERACOES}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`

app.post('/api/login', async (c) => {
  const { slug, email, senha } = await c.req.json<{
    slug: string; email: string; senha: string
  }>()
  const sql = criarPoolDoEnv(c.env)
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

// As oito entidades do CRM. Cada router traz sua propria exigencia de
// permissao: clientes, produtos, fornecedores, funcionarios e lancamentos sao
// telas de admin no design; entradas, saidas e perdas o colaborador tambem
// acessa (`ADMIN_ONLY_SCREENS` em web/src/telas.ts).
app.route('/api/clientes', clientes)
app.route('/api/produtos', produtos)
app.route('/api/fornecedores', fornecedores)
app.route('/api/funcionarios', funcionarios)
app.route('/api/lancamentos', lancamentos)
app.route('/api/entradas', entradas)
app.route('/api/saidas', saidas)
app.route('/api/perdas', perdas)
// Estoque nao guarda dado proprio — e um agregado sobre entradas, perdas e
// saidas (ver src/routes/estoque.ts). So exigirSessao, igual entradas/
// saidas/perdas: colaborador acessa.
app.route('/api/estoque', estoque)

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
