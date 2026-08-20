import { Hono } from 'hono'
import postgres from 'postgres'

type Env = { DATABASE_URL: string }

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', async (c) => {
  const isLocal = /^postgres:\/\/[^@]*@(localhost|127\.0\.0\.1)/.test(c.env.DATABASE_URL)
  const sql = postgres(c.env.DATABASE_URL, {
    prepare: false,
    max: 1,
    ...(isLocal ? { ssl: false } : {}),
  })
  try {
    const [row] = await sql<{ versao: string }[]>`select version() as versao`
    return c.json({ ok: true, db: row.versao })
  } catch (err) {
    return c.json({ ok: false, db: String(err) }, 500)
  } finally {
    c.executionCtx.waitUntil(sql.end())
  }
})

export default app
