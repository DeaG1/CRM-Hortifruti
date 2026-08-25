import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { criarPoolDoEnv, type Sql, type EnvBanco } from '../db'
import { lerSessao, precisaRenovar, renovarSessao } from '../auth'

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
  // A renovacao vai no waitUntil, DEPOIS da resposta: a janela deslizante
  // nao pode custar latencia ao usuario. O `sql.end()` que ja morava aqui
  // passa a ser o `finally` dessa mesma tarefa — encerrar o pool antes da
  // renovacao terminar cancelaria a escrita que mantem a sessao viva.
  c.executionCtx.waitUntil(renovarEEncerrar(sql, token, sessao.segundosRestantes))
}

/**
 * Janela deslizante de inatividade, com um freio.
 *
 * Toda requisicao autenticada empurra o vencimento para frente — MAS so
 * quando ja falta menos que o limiar (`precisaRenovar`, api/src/auth.ts).
 * Sem esse freio, abrir uma tela do CRM (que dispara varias chamadas) seria
 * varias escritas no banco pelo mesmo clique. Com ele, uma sessao em uso
 * continuo grava no maximo uma vez a cada 5 minutos.
 *
 * A falha na renovacao e engolida com log e nao derruba a resposta (que ja
 * foi enviada). A consequencia e honesta: a sessao segue com o vencimento
 * antigo e, se nenhuma requisicao seguinte conseguir renovar, expira. Melhor
 * errar para o lado de expirar do que para o lado de manter viva uma sessao
 * cuja renovacao o banco recusou.
 */
async function renovarEEncerrar(sql: Sql, token: string, segundosRestantes: number) {
  try {
    if (precisaRenovar(segundosRestantes)) await renovarSessao(sql, token)
  } catch (err) {
    console.error('falha ao renovar a sessao:', err)
  } finally {
    await sql.end()
  }
}

/** Barra rotas que so o admin pode acessar. Usar depois de exigirSessao. */
export const exigirAdmin: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (c.get('papel') !== 'admin') return c.json({ erro: 'sem permissao' }, 403)
  await next()
}
