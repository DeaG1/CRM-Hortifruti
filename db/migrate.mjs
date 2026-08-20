import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL nao definida'); process.exit(1) }

const sql = postgres(url, { prepare: false, max: 1 })

await sql`create table if not exists schema_migrations (
  versao text primary key,
  aplicada_em timestamptz not null default now()
)`

const aplicadas = new Set(
  (await sql`select versao from schema_migrations`).map(r => r.versao)
)
const arquivos = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

for (const arquivo of arquivos) {
  if (aplicadas.has(arquivo)) { console.log('  ja aplicada:', arquivo); continue }
  const conteudo = await readFile(join(dir, arquivo), 'utf8')
  await sql.begin(async tx => {
    await tx.unsafe(conteudo)
    await tx`insert into schema_migrations (versao) values (${arquivo})`
  })
  console.log('  aplicada:', arquivo)
}

await sql.end()
console.log('migrations concluidas')
