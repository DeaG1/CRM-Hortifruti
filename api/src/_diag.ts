// TEMPORARIO — endpoint de diagnostico de latencia. Removido apos a medicao.
import { Hono } from 'hono'
import { criarPoolDoEnv, withTenant, type EnvBanco } from './db'

export const diag = new Hono<{ Bindings: EnvBanco }>()

diag.get('/', async (c) => {
  const t: Record<string, number> = {}
  let m = Date.now()
  const marca = (k: string) => { t[k] = Date.now() - m; m = Date.now() }

  const sql = criarPoolDoEnv(c.env)
  marca('criar_pool')
  try {
    await sql`select 1`;                       marca('query_1_fria')
    await sql`select 1`;                       marca('query_2_quente')
    await sql`select 1`;                       marca('query_3_quente')
    const [tn] = await sql<{ id: string }[]>`select id from tenants limit 1`
    marca('select_tenants')
    if (tn) {
      await withTenant(sql, tn.id, tx => tx`select 1`);   marca('withTenant_1')
      await withTenant(sql, tn.id, tx => tx`select 1`);   marca('withTenant_2')
    }
    return c.json({ ms: t, total: Object.values(t).reduce((a, b) => a + b, 0) })
  } finally {
    c.executionCtx.waitUntil(sql.end())
  }
})
