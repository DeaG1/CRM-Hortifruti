import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { criarPoolDoEnv, type Sql, type EnvBanco } from '../db'
import { lerSessao } from '../auth'

export const COOKIE_SESSAO = 'crm_sessao'

export type Vars = {
  sql: Sql
  token: string
  tenantId: string
  usuarioId: string
  papel: 'admin' | 'colaborador'
}

export const exigirSessao: MiddlewareHandler<{
  Bindings: EnvBanco
  Variables: Vars
}> = async (c, next) => {
  const token = getCookie(c, COOKIE_SESSAO)
  if (!token) return c.json({ erro: 'nao autenticado' }, 401)

  const sql = criarPoolDoEnv(c.env)
  const sessao = await lerSessao(sql, token)
  if (!sessao) {
    c.executionCtx.waitUntil(sql.end())
    return c.json({ erro: 'sessao invalida' }, 401)
  }

  c.set('sql', sql)
  // Guardado para o logout: o delete precisa rodar dentro de withTenant
  // (sessoes tem RLS forcada), entao a rota de logout precisa do token
  // sem reanalisar o cookie por conta propria.
  c.set('token', token)
  c.set('tenantId', sessao.tenantId)
  c.set('usuarioId', sessao.usuarioId)
  c.set('papel', sessao.papel as Vars['papel'])

  await next()
  c.executionCtx.waitUntil(sql.end())
}

/** Barra rotas que so o admin pode acessar. Usar depois de exigirSessao. */
export const exigirAdmin: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (c.get('papel') !== 'admin') return c.json({ erro: 'sem permissao' }, 403)
  await next()
}
