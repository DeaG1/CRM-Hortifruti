# Fase 0 — Fundação + fatia vertical de Clientes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação multi-tenant (auth real, isolamento por RLS, deploy, backup) e a entidade Clientes funcionando de ponta a ponta, estabelecendo o padrão que as outras 7 entidades vão repetir.

**Architecture:** SPA React (Vite) no Cloudflare Pages consome uma API Hono rodando em Cloudflare Workers, que fala PostgreSQL direto no Supabase via pooler. O isolamento entre tenants é garantido por Row Level Security no banco — a API abre transação, executa `SET LOCAL app.tenant_id` com o tenant da sessão, e todas as queries ficam confinadas. A lógica de derivação (health score, inadimplência, ticket) é portada do protótipo como funções puras testáveis, sem reescrita em SQL.

**Tech Stack:** React 18 + Vite + TypeScript · Hono (Cloudflare Workers) · PostgreSQL 15+ (Supabase) · postgres.js · Vitest · Docker Compose (Postgres local para testes) · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-19-infra-crm-multitenant-design.md`

**Design de referência:** `design/CRM Hortifruti.dc.html` (protótipo single-file, `localStorage`)

---

## Global Constraints

Requisitos do projeto inteiro. Valem implicitamente para toda tarefa.

- **Supabase é usado só como PostgreSQL.** Proibido: Supabase Auth, Storage, Realtime, Edge Functions e o cliente `supabase-js`. Acesso ao banco só por conexão PostgreSQL direta. (spec D4)
- **Conexão na porta 6543** (transaction mode do Supavisor), nunca 5432.
- **`prepare: false`** no driver. Transaction pooling não suporta prepared statements.
- **`SET LOCAL app.tenant_id`, jamais `SET`.** `SET` vaza o tenant para a próxima requisição que reusar a conexão do pool.
- **Toda tabela com `tenant_id`** tem: `not null`, índice, `enable row level security`, `force row level security` e policy com `using` **e** `with check`.
- **A policy usa `nullif(current_setting('app.tenant_id', true), '')::uuid`** — sempre com o `nullif`. Depois que uma transação toca o GUC via `set_config(..., true)` e termina, o PostgreSQL deixa a variável como **string vazia**, não indefinida; `''::uuid` lança `invalid input syntax for type uuid`. Sem o `nullif`, qualquer query fora de `withTenant` numa conexão reaproveitada do pool quebra — em produção, não em desenvolvimento. (Descoberto na Task 3; migration `002_rls_nullif_guard.sql`.)
- **O role da aplicação não é superuser e não tem `BYPASSRLS`.**
- **Migrations são arquivos `.sql` numerados.** Sem ORM com formato de migration proprietário — o schema precisa ser restaurável em qualquer PostgreSQL, incluindo as policies.
- **Autenticação é própria.** Sem Auth0, Clerk ou Supabase Auth. (spec D5)
- **Nenhum segredo no repositório.** Senhas e connection strings só em `.dev.vars` (gitignored) e em secrets do Wrangler/GitHub.
- **Moeda e datas em pt-BR.** Valores monetários em `numeric(12,2)`, nunca float. Datas em `date`; instantes em `timestamptz`.
- **`numeric` chega no JavaScript como string.** O `postgres.js` não converte `numeric` para `number` (e faz certo — `numeric` excede a precisão de um float). Toda coluna `numeric` precisa de conversão explícita na borda da API, ou `limite` chega no front como `"6000.00"` e `limite > 0` compara string com número silenciosamente.
- **Idioma:** identificadores de banco e rotas de API em português (`clientes`, `fornecedores`), acompanhando o domínio e o design.

---

## Nota de refinamento da spec

A spec (seção 3) descreve a resolução de tenant por subdomínio. Este plano usa **a sessão como fonte de verdade do tenant**, e trata o subdomínio como roteamento/branding apenas.

Motivo: se o tenant vier da URL, trocar o subdomínio vira um vetor de acesso a outro tenant, e a defesa passa a depender de validação correta em toda requisição. Vindo da sessão, o usuário só existe dentro de um tenant e não há o que forjar. Quando houver subdomínio, o middleware **valida** que ele bate com a sessão e rejeita divergência.

---

## Estrutura de arquivos

```
package.json                            dependencia `postgres` para o runner de migrations
db/
  migrations/001_tenants_usuarios.sql   tenants, usuarios, sessoes + RLS
  migrations/002_rls_nullif_guard.sql   guard nullif nas policies (ver Global Constraints)
  migrations/003_policy_sessao.sql      funcao resolver_sessao (SECURITY DEFINER)
  migrations/004_clientes.sql           clientes + RLS
  migrate.mjs                           runner: aplica .sql em ordem, registra em schema_migrations
api/
  src/index.ts                          app Hono, montagem de rotas
  src/db.ts                             pool + withTenant() — o único lugar que abre transação
  src/auth.ts                           hash PBKDF2, criação/validação de sessão
  src/middleware/sessao.ts              lê cookie, resolve usuário+tenant, injeta no contexto
  src/routes/clientes.ts                CRUD de clientes
  test/isolamento.test.ts               prova que tenant A não enxerga tenant B
  test/clientes.test.ts                 CRUD
  wrangler.toml
web/
  src/api/client.ts                     fetch tipado, credentials: include
  src/derive/clientes.ts                lógica portada do protótipo — funções puras
  src/derive/clientes.test.ts           testes das funções puras
  src/components/Shell.tsx              sidebar + header
  src/screens/Login.tsx
  src/screens/ClientesLista.tsx
  src/screens/ClienteFicha.tsx
  src/components/ModalCliente.tsx
docker-compose.dev.yml                  Postgres local para testes
.github/workflows/backup.yml            pg_dump → R2
```

Separação que importa: `web/src/derive/` contém **só funções puras** — recebem dados, devolvem números. Nada de React, fetch ou formatação de cor. É o que permite testá-las contra o protótipo e é o que o To Do chama de "lógicas que não podem quebrar".

---

## Task 1: Provar que Worker conecta no Postgres

Esta é a tarefa de maior risco técnico do plano e por isso vem primeiro. Cloudflare Workers não têm TCP nativo do Node; a conexão PostgreSQL depende da flag `nodejs_compat`. **Se isto não funcionar, o Estágio 0 da spec é inviável e o projeto precisa ir direto para VPS.** Descobrir agora custa uma hora; descobrir na Task 9 custa o plano inteiro.

**Files:**
- Create: `api/package.json`, `api/wrangler.toml`, `api/src/index.ts`, `api/.dev.vars.example`, `.gitignore` (modificar)

**Interfaces:**
- Consumes: nada
- Produces: app Hono exportado como `default` de `api/src/index.ts`; rota `GET /api/health` devolvendo `{ ok: boolean, db: string }`

- [ ] **Step 1: Criar o projeto da API**

```bash
mkdir -p api/src && cd api
npm init -y
npm i hono postgres
npm i -D wrangler typescript @cloudflare/workers-types vitest
```

- [ ] **Step 2: Configurar o Wrangler com nodejs_compat**

`api/wrangler.toml`:

```toml
name = "crm-hortifruti-api"
main = "src/index.ts"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true
```

A flag `nodejs_compat` é o que dá ao Worker o shim de `node:net` que o `postgres.js` precisa. Sem ela a conexão falha em runtime, não em build.

- [ ] **Step 3: Escrever o healthcheck que toca o banco**

`api/src/index.ts`:

```ts
import { Hono } from 'hono'
import postgres from 'postgres'

type Env = { DATABASE_URL: string }

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', async (c) => {
  const sql = postgres(c.env.DATABASE_URL, { prepare: false, max: 1 })
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
```

- [ ] **Step 4: Apontar para o Supabase**

Criar `api/.dev.vars` (NÃO commitar) com a connection string do pooler:

```
DATABASE_URL=postgres://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:6543/postgres
```

Confirmar a **porta 6543**. Commitar apenas `api/.dev.vars.example` com o formato e valores fictícios.

Adicionar ao `.gitignore`:

```
.dev.vars
.wrangler/
```

- [ ] **Step 5: Rodar e verificar**

Run: `cd api && npx wrangler dev` e em outro terminal `curl http://localhost:8787/api/health`

Expected: `{"ok":true,"db":"PostgreSQL 15..."}`

Se vier `ok:false` com erro de socket ou `connect ECONNREFUSED`, **pare o plano e reporte** — a decisão de infra precisa ser revista antes de continuar.

- [ ] **Step 6: Commit**

```bash
git add api .gitignore
git commit -m "feat(api): worker Hono com conexao Postgres validada"
```

---

## Task 2: Runner de migrations e schema base

**Files:**
- Create: `db/migrate.mjs`, `db/migrations/001_tenants_usuarios.sql`, `docker-compose.dev.yml`
- Test: verificação manual via psql (a Task 3 automatiza)

**Interfaces:**
- Consumes: nada
- Produces: tabelas `tenants(id uuid, slug text, nome text, ativo bool, criado_em timestamptz)`, `usuarios(id uuid, tenant_id uuid, email text, senha_hash text, nome text, papel text, ativo bool, criado_em timestamptz)`, `sessoes(token text pk, usuario_id uuid, tenant_id uuid, expira_em timestamptz, criado_em timestamptz)`, `schema_migrations(versao text pk, aplicada_em timestamptz)`; comando `node db/migrate.mjs`

- [ ] **Step 1: Postgres local para testes**

`docker-compose.dev.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: crm_dev
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```

Porta 5433 no host para não colidir com um Postgres já instalado.

- [ ] **Step 2: Escrever a migration base**

`db/migrations/001_tenants_usuarios.sql`:

```sql
create extension if not exists pgcrypto;

create table tenants (
  id        uuid primary key default gen_random_uuid(),
  slug      text unique not null,
  nome      text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table usuarios (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  email      text not null,
  senha_hash text not null,
  nome       text not null,
  papel      text not null check (papel in ('admin','colaborador')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (tenant_id, email)
);
create index on usuarios (tenant_id);

create table sessoes (
  token      text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);
create index on sessoes (tenant_id);
create index on sessoes (expira_em);

-- Role da aplicacao: sem superuser, sem BYPASSRLS
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_crm') then
    create role app_crm login password 'trocar_em_producao';
  end if;
end $$;

grant usage on schema public to app_crm;
grant select, insert, update, delete on all tables in schema public to app_crm;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_crm;

-- usuarios e sessoes sao isoladas por tenant
alter table usuarios enable row level security;
alter table usuarios force row level security;
create policy tenant_isolation on usuarios
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table sessoes enable row level security;
alter table sessoes force row level security;
create policy tenant_isolation on sessoes
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

`tenants` fica **sem** RLS de propósito: o login precisa resolver o tenant antes de haver tenant definido. É a única tabela nessa condição, e ela não guarda dado de negócio.

- [ ] **Step 3: Escrever o runner**

O runner é invocado da raiz (`node db/migrate.mjs`), mas o `postgres` foi instalado em `api/`. Sem um `package.json` na raiz, ele falha com `Cannot find module 'postgres'`. Criar na raiz:

```bash
npm init -y && npm i postgres
```

`db/migrate.mjs`:

```js
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
```

Cada migration roda dentro de uma transação junto com o registro dela: ou aplica inteira e fica registrada, ou nada acontece.

- [ ] **Step 4: Aplicar no banco local e verificar**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgres://postgres:dev@localhost:5433/crm_dev node db/migrate.mjs
```
Expected: `aplicada: 001_tenants_usuarios.sql` e `migrations concluidas`

Rodar de novo. Expected: `ja aplicada: 001_tenants_usuarios.sql` — idempotência confirmada.

- [ ] **Step 5: Commit**

```bash
git add db docker-compose.dev.yml
git commit -m "feat(db): runner de migrations e schema base multi-tenant"
```

---

## Task 3: `withTenant()` e o teste de isolamento

O coração da segurança do sistema. Toda query de negócio passa por aqui.

**Files:**
- Create: `api/src/db.ts`, `api/test/isolamento.test.ts`, `api/vitest.config.ts`
- Test: `api/test/isolamento.test.ts`

**Interfaces:**
- Consumes: schema da Task 2
- Produces: `criarPool(url: string): Sql` e `withTenant<T>(sql: Sql, tenantId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T>`

- [ ] **Step 1: Escrever o teste que falha**

`api/test/isolamento.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string
let tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-a', 'Tenant A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-b', 'Tenant B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from usuarios where tenant_id in (${tenantA}, ${tenantB})`
  await admin`insert into usuarios (tenant_id, email, senha_hash, nome, papel)
              values (${tenantA}, 'a@teste.com', 'x', 'Usuario A', 'admin')`
  await admin`insert into usuarios (tenant_id, email, senha_hash, nome, papel)
              values (${tenantB}, 'b@teste.com', 'x', 'Usuario B', 'admin')`

  sql = criarPool(URL)
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('isolamento por RLS', () => {
  it('tenant A nao enxerga usuarios do tenant B', async () => {
    const linhas = await withTenant(sql, tenantA, tx => tx`select email from usuarios`)
    expect(linhas.map(l => l.email)).toEqual(['a@teste.com'])
  })

  it('sem tenant definido, nada e visivel', async () => {
    const linhas = await sql`select email from usuarios`
    expect(linhas).toHaveLength(0)
  })

  it('nao permite gravar para outro tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into usuarios (tenant_id, email, senha_hash, nome, papel)
        values (${tenantB}, 'invasor@teste.com', 'x', 'Invasor', 'admin')`)
    ).rejects.toThrow()
  })

  it('o tenant nao vaza entre transacoes na mesma conexao', async () => {
    await withTenant(sql, tenantA, tx => tx`select 1`)
    const linhas = await sql`select email from usuarios`
    expect(linhas).toHaveLength(0)
  })
})
```

O último teste é o que prova `SET LOCAL` em vez de `SET`. Com `SET`, ele falha — e é exatamente o bug que vazaria dados entre clientes em produção.

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd api && npx vitest run test/isolamento.test.ts`
Expected: FAIL — `Cannot find module '../src/db'`

- [ ] **Step 3: Implementar `db.ts`**

`api/src/db.ts`:

```ts
import postgres from 'postgres'

export type Sql = ReturnType<typeof postgres>

export function criarPool(url: string) {
  return postgres(url, { prepare: false, max: 5, idle_timeout: 20 })
}

/**
 * Abre uma transacao com o tenant fixado e executa fn dentro dela.
 * Toda query de negocio precisa passar por aqui — e o unico ponto
 * onde app.tenant_id e definido.
 *
 * SET LOCAL (nao SET): o escopo morre com a transacao, entao a conexao
 * volta limpa para o pool. Com SET, a proxima requisicao a reusar essa
 * conexao herdaria o tenant anterior.
 */
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  }) as Promise<T>
}
```

`set_config(..., true)` é a forma parametrizável de `SET LOCAL` — o terceiro argumento `true` significa "local à transação". `SET LOCAL` não aceita parâmetro bindado, então interpolar seria injeção de SQL.

- [ ] **Step 4: Configurar o Vitest**

`api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', testTimeout: 20000 } })
```

- [ ] **Step 5: Rodar e verificar que passa**

Run: `cd api && npx vitest run test/isolamento.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 6: Commit**

```bash
git add api/src/db.ts api/test/isolamento.test.ts api/vitest.config.ts
git commit -m "feat(api): withTenant com SET LOCAL e teste de isolamento entre tenants"
```

---

## Task 4: Autenticação — hash, login e sessão

**Files:**
- Create: `api/src/auth.ts`, `api/test/auth.test.ts`
- Modify: `api/src/index.ts`

**Interfaces:**
- Consumes: `criarPool`, `withTenant` da Task 3
- Produces: `hashSenha(senha: string): Promise<string>`, `verificarSenha(senha: string, hash: string): Promise<boolean>`, `criarSessao(sql, usuarioId, tenantId): Promise<string>`, `lerSessao(sql, token): Promise<{ usuarioId, tenantId, papel } | null>`; rotas `POST /api/login`, `POST /api/logout`, `GET /api/eu`

- [ ] **Step 1: Escrever o teste que falha**

`api/test/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hashSenha, verificarSenha } from '../src/auth'

describe('hash de senha', () => {
  it('aceita a senha correta', async () => {
    const hash = await hashSenha('segredo123')
    expect(await verificarSenha('segredo123', hash)).toBe(true)
  })

  it('rejeita a senha errada', async () => {
    const hash = await hashSenha('segredo123')
    expect(await verificarSenha('segredo124', hash)).toBe(false)
  })

  it('gera hashes diferentes para a mesma senha (salt)', async () => {
    expect(await hashSenha('igual')).not.toBe(await hashSenha('igual'))
  })

  it('rejeita hash malformado sem lancar', async () => {
    expect(await verificarSenha('x', 'lixo')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar `auth.ts`**

`api/src/auth.ts`:

```ts
import type { Sql } from './db'
import { withTenant } from './db'

const ITERACOES = 210_000   // recomendacao OWASP para PBKDF2-HMAC-SHA256
const TAM_SAL = 16
const TAM_CHAVE = 32

/**
 * PBKDF2 via WebCrypto. bcrypt e scrypt nao rodam em Cloudflare Workers;
 * WebCrypto e nativo tanto em Workers quanto em Node 18+.
 * Formato: pbkdf2$<iteracoes>$<sal_b64>$<chave_b64>
 */
export async function hashSenha(senha: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(TAM_SAL))
  const chave = await derivar(senha, sal, ITERACOES)
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(chave)}`
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  const partes = hash.split('$')
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false
  const iteracoes = Number(partes[1])
  if (!Number.isInteger(iteracoes) || iteracoes < 1) return false
  let sal: Uint8Array, esperado: Uint8Array
  try { sal = deB64(partes[2]); esperado = deB64(partes[3]) } catch { return false }
  const obtido = await derivar(senha, sal, iteracoes)
  return comparaConstante(obtido, esperado)
}

async function derivar(senha: string, sal: Uint8Array, iteracoes: number) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' },
    material, TAM_CHAVE * 8,
  )
  return new Uint8Array(bits)
}

/** Comparacao em tempo constante — nao vaza informacao por timing. */
function comparaConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i]
  return dif === 0
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const deB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

const DIAS_SESSAO = 7

export async function criarSessao(sql: Sql, usuarioId: string, tenantId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const expira = new Date(Date.now() + DIAS_SESSAO * 86400_000)
  await withTenant(sql, tenantId, tx => tx`
    insert into sessoes (token, usuario_id, tenant_id, expira_em)
    values (${token}, ${usuarioId}, ${tenantId}, ${expira})`)
  return token
}

export async function lerSessao(sql: Sql, token: string) {
  // Sem tenant ainda — por isso consulta com o role admin do proprio pool
  // usando join em tenants, e revalida o tenant logo em seguida.
  const [linha] = await sql<{ usuario_id: string; tenant_id: string; papel: string }[]>`
    select s.usuario_id, s.tenant_id, u.papel
    from sessoes s
    join usuarios u on u.id = s.usuario_id
    where s.token = ${token} and s.expira_em > now() and u.ativo = true`
  if (!linha) return null
  return { usuarioId: linha.usuario_id, tenantId: linha.tenant_id, papel: linha.papel }
}
```

**Nota de segurança sobre `lerSessao`:** ela roda fora de `withTenant`, porque o tenant é justamente o que se quer descobrir. Para que a RLS não a bloqueie, as tabelas `sessoes` e `usuarios` precisam de uma policy adicional que permita esta leitura específica por token. A Task 5 fecha isso — até lá, o teste unitário de hash é o que roda.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Commit**

```bash
git add api/src/auth.ts api/test/auth.test.ts
git commit -m "feat(api): hash PBKDF2 via WebCrypto e sessao por token opaco"
```

---

## Task 5: Policy de sessão e middleware

Fecha o buraco deixado na Task 4: `lerSessao` precisa consultar antes de haver tenant.

**Files:**
- Create: `db/migrations/003_policy_sessao.sql`, `api/src/middleware/sessao.ts`
- Modify: `api/src/index.ts`
- Test: `api/test/sessao.test.ts`

**Interfaces:**
- Consumes: `lerSessao` da Task 4
- Produces: middleware Hono que injeta `c.set('tenantId', ...)`, `c.set('usuarioId', ...)`, `c.set('papel', ...)`; função `sqlDoContexto(c)` que devolve o pool

- [ ] **Step 1: Migration com a função de resolução de sessão**

`db/migrations/003_policy_sessao.sql`:

```sql
-- Resolver a sessao exige ler antes de haver tenant definido.
-- Em vez de abrir a tabela, expomos uma funcao SECURITY DEFINER com
-- superficie minima: recebe um token e devolve no maximo uma linha.
create or replace function resolver_sessao(p_token text)
returns table (usuario_id uuid, tenant_id uuid, papel text)
language sql
security definer
set search_path = public
as $$
  select s.usuario_id, s.tenant_id, u.papel
  from sessoes s
  join usuarios u on u.id = s.usuario_id
  where s.token = p_token
    and s.expira_em > now()
    and u.ativo = true
  limit 1
$$;

revoke all on function resolver_sessao(text) from public;
grant execute on function resolver_sessao(text) to app_crm;
```

A função é `security definer` e recebe **só** o token — não aceita filtro arbitrário, não devolve senha, e um token inválido devolve zero linhas. Isso é uma superfície muito menor do que uma policy que permitisse `select` livre em `sessoes`.

- [ ] **Step 2: Ajustar `lerSessao` para usar a função**

Em `api/src/auth.ts`, substituir o corpo de `lerSessao`:

```ts
export async function lerSessao(sql: Sql, token: string) {
  const [linha] = await sql<{ usuario_id: string; tenant_id: string; papel: string }[]>`
    select * from resolver_sessao(${token})`
  if (!linha) return null
  return { usuarioId: linha.usuario_id, tenantId: linha.tenant_id, papel: linha.papel }
}
```

- [ ] **Step 3: Escrever o middleware**

`api/src/middleware/sessao.ts`:

```ts
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { criarPool, type Sql } from '../db'
import { lerSessao } from '../auth'

export const COOKIE_SESSAO = 'crm_sessao'

export type Vars = {
  sql: Sql
  tenantId: string
  usuarioId: string
  papel: 'admin' | 'colaborador'
}

export const exigirSessao: MiddlewareHandler<{
  Bindings: { DATABASE_URL: string }
  Variables: Vars
}> = async (c, next) => {
  const token = getCookie(c, COOKIE_SESSAO)
  if (!token) return c.json({ erro: 'nao autenticado' }, 401)

  const sql = criarPool(c.env.DATABASE_URL)
  const sessao = await lerSessao(sql, token)
  if (!sessao) {
    c.executionCtx.waitUntil(sql.end())
    return c.json({ erro: 'sessao invalida' }, 401)
  }

  c.set('sql', sql)
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
```

- [ ] **Step 4: Montar login/logout/eu no app**

Em `api/src/index.ts`, adicionar:

```ts
import { setCookie, deleteCookie } from 'hono/cookie'
import { criarPool } from './db'
import { verificarSenha, criarSessao } from './auth'
import { exigirSessao, COOKIE_SESSAO, type Vars } from './middleware/sessao'

app.post('/api/login', async (c) => {
  const { slug, email, senha } = await c.req.json<{
    slug: string; email: string; senha: string
  }>()
  const sql = criarPool(c.env.DATABASE_URL)
  try {
    const [tenant] = await sql<{ id: string }[]>`
      select id from tenants where slug = ${slug} and ativo = true`
    // Falha generica de proposito: nao revelar se o tenant ou o email existe.
    if (!tenant) return c.json({ erro: 'credenciais invalidas' }, 401)

    const [usuario] = await sql<{ id: string; senha_hash: string }[]>`
      select id, senha_hash from usuarios
      where tenant_id = ${tenant.id} and email = ${email} and ativo = true`
    if (!usuario) return c.json({ erro: 'credenciais invalidas' }, 401)
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
  await sql`delete from sessoes where token = ${c.req.header('cookie')?.match(
    new RegExp(`${COOKIE_SESSAO}=([^;]+)`))?.[1] ?? ''}`
  deleteCookie(c, COOKIE_SESSAO, { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/eu', exigirSessao, (c) =>
  c.json({ usuarioId: c.get('usuarioId'), papel: c.get('papel') }))
```

`httpOnly` impede leitura por JavaScript (defesa contra XSS roubando sessão). `sameSite: Lax` cobre CSRF nas requisições de escrita vindas de outro site.

- [ ] **Step 5: Rodar migrations e testar o fluxo**

Run:
```bash
DATABASE_URL=postgres://postgres:dev@localhost:5433/crm_dev node db/migrate.mjs
cd api && npx wrangler dev
```

Em outro terminal, criar tenant e usuário de teste e então:
```bash
curl -i -X POST localhost:8787/api/login -H 'content-type: application/json' \
  -d '{"slug":"teste-a","email":"a@teste.com","senha":"segredo123"}'
```
Expected: `200` com `set-cookie: crm_sessao=...`

```bash
curl localhost:8787/api/eu -H 'cookie: crm_sessao=<token>'
```
Expected: `{"usuarioId":"...","papel":"admin"}`

- [ ] **Step 6: Commit**

```bash
git add db/migrations/003_policy_sessao.sql api/src
git commit -m "feat(api): resolucao de sessao e middleware de tenant"
```

---

## Task 6: Tabela e API de clientes

**Files:**
- Create: `db/migrations/004_clientes.sql`, `api/src/routes/clientes.ts`, `api/test/clientes.test.ts`
- Modify: `api/src/index.ts`

**Interfaces:**
- Consumes: `withTenant`, `exigirSessao`, `exigirAdmin`
- Produces: `GET /api/clientes`, `POST /api/clientes`, `GET /api/clientes/:id`, `PUT /api/clientes/:id`, `DELETE /api/clientes/:id`. Formato do cliente: `{ id, nome, resp, cnpj, tel, email, endereco, rota, freq, status, cobranca, forma, limite, prazo, tend, obs }`

- [ ] **Step 1: Migration**

`db/migrations/004_clientes.sql`:

```sql
create table clientes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  nome       text not null,
  resp       text not null default '',
  cnpj       text not null default '',
  tel        text not null default '',
  email      text not null default '',
  endereco   text not null default '',
  rota       text not null default '',
  freq       text not null default '',
  status     text not null default 'ativo'
             check (status in ('ativo','negociacao','inadimplente','inativo')),
  cobranca   text not null default 'Em dia',
  forma      text not null default 'PIX',
  limite     numeric(12,2) not null default 0,
  prazo      integer not null default 14,
  tend       text not null default '→' check (tend in ('↑','→','↓')),
  obs        text not null default '',
  criado_em  timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);

create index on clientes (tenant_id);
create unique index on clientes (tenant_id, lower(nome));

alter table clientes enable row level security;
alter table clientes force row level security;
create policy tenant_isolation on clientes
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

`unique (tenant_id, lower(nome))` porque o design referencia cliente por nome em vários lugares — enquanto isso for verdade, nomes duplicados dentro do mesmo tenant corromperiam as agregações. Dois tenants diferentes podem ter clientes de mesmo nome sem conflito.

- [ ] **Step 2: Escrever o teste que falha**

`api/test/clientes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  // Upsert em vez de select: este arquivo precisa rodar isolado, sem
  // depender de isolamento.test.ts ter criado os tenants antes.
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-a', 'Tenant A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-b', 'Tenant B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from clientes where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('clientes', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into clientes (tenant_id, nome, resp) values (${tenantA}, 'Mercado A', 'Sonia')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from clientes`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A'])
  })

  it('nao enxerga cliente de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into clientes (tenant_id, nome) values (${tenantB}, 'Mercado B')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from clientes`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A'])
  })

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into clientes (tenant_id, nome) values (${tenantA}, 'mercado a')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo nome em tenants diferentes', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into clientes (tenant_id, nome) values (${tenantB}, 'Mercado A')`)
    const linhas = await withTenant(sql, tenantB, tx => tx`select nome from clientes order by nome`)
    expect(linhas.map(l => l.nome)).toEqual(['Mercado A', 'Mercado B'])
  })

  it('rejeita status invalido', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into clientes (tenant_id, nome, status)
        values (${tenantA}, 'Invalido', 'sei-la')`)
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Rodar e verificar que falha**

Run: `DATABASE_URL=postgres://postgres:dev@localhost:5433/crm_dev node db/migrate.mjs && cd api && npx vitest run test/clientes.test.ts`
Expected: primeiro rodar a migration, depois PASS. Se rodar o teste antes da migration: FAIL com `relation "clientes" does not exist`.

- [ ] **Step 4: Implementar as rotas**

`api/src/routes/clientes.ts`:

```ts
import { Hono } from 'hono'
import { withTenant } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

const CAMPOS = [
  'nome','resp','cnpj','tel','email','endereco','rota','freq',
  'status','cobranca','forma','limite','prazo','tend','obs',
] as const

type Cliente = Record<(typeof CAMPOS)[number], string | number>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente. */
function sanear(corpo: Record<string, unknown>): Partial<Cliente> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Cliente>
}

export const clientes = new Hono<{
  Bindings: { DATABASE_URL: string }
  Variables: Vars
}>()

clientes.use('*', exigirSessao, exigirAdmin)

clientes.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from clientes order by nome`)
  return c.json(linhas)
})

clientes.get('/:id', async (c) => {
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from clientes where id = ${c.req.param('id')}`)
  return linha ? c.json(linha) : c.json({ erro: 'nao encontrado' }, 404)
})

clientes.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (!dados.nome) return c.json({ erro: 'nome e obrigatorio' }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into clientes ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(linha, 201)
  } catch (err) {
    if (String(err).includes('duplicate key')) {
      return c.json({ erro: 'ja existe um cliente com esse nome' }, 409)
    }
    throw err
  }
})

clientes.put('/:id', async (c) => {
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`update clientes set ${tx({ ...dados, alterado_em: new Date() })}
       where id = ${c.req.param('id')} returning *`)
  return linha ? c.json(linha) : c.json({ erro: 'nao encontrado' }, 404)
})

clientes.delete('/:id', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from clientes where id = ${c.req.param('id')} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
```

O `sanear` é a defesa contra mass assignment: mesmo que alguém envie `tenant_id` no corpo, ele nunca chega ao SQL.

- [ ] **Step 5: Converter `numeric` antes de devolver**

Sem isto, `limite` chega no front como `"6000.00"`. Adicionar em `api/src/routes/clientes.ts` e aplicar em toda rota que devolve cliente:

```ts
/** numeric vem como string do postgres.js — converter na borda da API. */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  return { ...linha, limite: Number(linha.limite ?? 0), prazo: Number(linha.prazo ?? 0) }
}
```

Usar em cada retorno: `c.json(linhas.map(paraJson))` no `GET /`, `c.json(paraJson(linha))` nos demais.

Acrescentar o caso ao teste:

```ts
it('devolve limite como numero, nao string', async () => {
  await withTenant(sql, tenantA, tx => tx`
    insert into clientes (tenant_id, nome, limite) values (${tenantA}, 'Com Limite', 6000)`)
  const [linha] = await withTenant(sql, tenantA, tx => tx`
    select limite from clientes where nome = 'Com Limite'`)
  // o driver devolve string — e por isso que paraJson existe
  expect(typeof linha.limite).toBe('string')
  expect(Number(linha.limite)).toBe(6000)
})
```

- [ ] **Step 6: Montar no app**

Em `api/src/index.ts`: `import { clientes } from './routes/clientes'` e `app.route('/api/clientes', clientes)`

- [ ] **Step 7: Rodar os testes e verificar**

Run: `cd api && npx vitest run`
Expected: PASS — isolamento (4) + auth (4) + clientes (6)

- [ ] **Step 8: Commit**

```bash
git add db/migrations/004_clientes.sql api/src/routes/clientes.ts api/test/clientes.test.ts api/src/index.ts
git commit -m "feat(api): CRUD de clientes com isolamento por tenant"
```

---

## Task 7: Portar a lógica de derivação de clientes

As funções que o To Do marca como "não podem quebrar". Portadas do protótipo como funções puras, sem React e sem formatação.

**Files:**
- Create: `web/src/derive/clientes.ts`, `web/src/derive/clientes.test.ts`, `web/package.json`, `web/vite.config.ts`
- Reference: `design/CRM Hortifruti.dc.html` linhas 2148-2215 (origem da lógica) e o método `healthOf`

**Interfaces:**
- Consumes: nada (funções puras)
- Produces: `inadimplenciaPorCliente(pedidos, nomeCliente): number`, `ticketPorEntrega(pedidos, nomeCliente): number`, `healthDoCliente(cliente, inadPct, ticketEntrega): 'green'|'amber'|'red'`, `derivarClientes(clientes, pedidos, periodo): ClienteDerivado[]`

- [ ] **Step 1: Criar o projeto web**

```bash
npm create vite@latest web -- --template react-ts
cd web && npm i && npm i -D vitest
```

- [ ] **Step 2: Escrever os testes que falham**

`web/src/derive/clientes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { healthDoCliente, inadimplenciaPorCliente, ticketPorEntrega, derivarClientes } from './clientes'
import type { Cliente, Pedido } from './clientes'

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', status: 'ativo', tend: '→', ...over,
} as Cliente)

const pedido = (over: Partial<Pedido> = {}): Pedido => ({
  id: '#1', cliente: 'Mercado A', entrega: '2026-06-10',
  valor: 1000, status: 'Entregue', pag: 'Pago', ...over,
} as Pedido)

describe('healthDoCliente', () => {
  it('inadimplente e sempre vermelho', () => {
    expect(healthDoCliente(cliente({ status: 'inadimplente' }), 0, 1000)).toBe('red')
  })
  it('inativo e sempre vermelho', () => {
    expect(healthDoCliente(cliente({ status: 'inativo' }), 0, 1000)).toBe('red')
  })
  it('inadimplencia acima de 2% e vermelho', () => {
    expect(healthDoCliente(cliente(), 2.1, 1000)).toBe('red')
  })
  it('ticket abaixo de 150 e vermelho', () => {
    expect(healthDoCliente(cliente(), 0, 149)).toBe('red')
  })
  it('ticket zero nao penaliza (cliente sem entrega no periodo)', () => {
    expect(healthDoCliente(cliente(), 0, 0)).toBe('green')
  })
  it('inadimplencia entre 1 e 2% e ambar', () => {
    expect(healthDoCliente(cliente(), 1.5, 1000)).toBe('amber')
  })
  it('tendencia de queda e ambar', () => {
    expect(healthDoCliente(cliente({ tend: '↓' }), 0, 1000)).toBe('amber')
  })
  it('em negociacao e ambar', () => {
    expect(healthDoCliente(cliente({ status: 'negociacao' }), 0, 1000)).toBe('amber')
  })
  it('saudavel e verde', () => {
    expect(healthDoCliente(cliente(), 0.5, 500)).toBe('green')
  })
})

describe('inadimplenciaPorCliente', () => {
  it('e a fracao do faturado que esta atrasada', () => {
    const pedidos = [
      pedido({ valor: 1000, pag: 'Pago' }),
      pedido({ valor: 1000, pag: 'Atrasado' }),
    ]
    // faturado = so os Entregues = 2000; atrasado = 1000 => 50%
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A')).toBeCloseTo(50)
  })
  it('e zero quando nao ha faturamento', () => {
    expect(inadimplenciaPorCliente([], 'Mercado A')).toBe(0)
  })
  it('ignora pedidos de outro cliente', () => {
    const pedidos = [pedido({ cliente: 'Outro', valor: 500, pag: 'Atrasado' })]
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A')).toBe(0)
  })
})

describe('ticketPorEntrega', () => {
  it('e a media do valor das entregas', () => {
    const pedidos = [pedido({ valor: 1000 }), pedido({ valor: 500 })]
    expect(ticketPorEntrega(pedidos, 'Mercado A')).toBe(750)
  })
  it('conta apenas pedidos entregues', () => {
    const pedidos = [pedido({ valor: 1000 }), pedido({ valor: 999, status: 'Cancelado' })]
    expect(ticketPorEntrega(pedidos, 'Mercado A')).toBe(1000)
  })
  it('e zero sem entregas', () => {
    expect(ticketPorEntrega([], 'Mercado A')).toBe(0)
  })
})

describe('derivarClientes', () => {
  it('calcula participacao sobre o faturamento total', () => {
    const clientes = [cliente({ nome: 'A' }), cliente({ id: '2', nome: 'B' })]
    const pedidos = [
      pedido({ cliente: 'A', valor: 750 }),
      pedido({ cliente: 'B', valor: 250 }),
    ]
    const saida = derivarClientes(clientes, pedidos, 'all')
    expect(saida.find(c => c.nome === 'A')!.participacao).toBe(75)
    expect(saida.find(c => c.nome === 'B')!.participacao).toBe(25)
  })

  it('filtra por periodo pelo mes da entrega', () => {
    const clientes = [cliente({ nome: 'A' })]
    const pedidos = [
      pedido({ cliente: 'A', entrega: '2026-06-10', valor: 1000 }),
      pedido({ cliente: 'A', entrega: '2026-05-10', valor: 9999 }),
    ]
    expect(derivarClientes(clientes, pedidos, '06')[0].faturado).toBe(1000)
  })
})
```

O caso "ticket zero não penaliza" é sutil e vem direto do protótipo: `te > 0 && te < 150`. Um cliente sem entregas no período não deve aparecer como crítico só por isso.

- [ ] **Step 3: Rodar e verificar que falha**

Run: `cd web && npx vitest run src/derive/clientes.test.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 4: Implementar**

`web/src/derive/clientes.ts`:

```ts
export type StatusCliente = 'ativo' | 'negociacao' | 'inadimplente' | 'inativo'
export type Tendencia = '↑' | '→' | '↓'
export type Health = 'green' | 'amber' | 'red'

export interface Cliente {
  id: string
  nome: string
  resp: string
  rota: string
  freq: string
  status: StatusCliente
  tend: Tendencia
  limite: number
  prazo: number
}

export interface Pedido {
  id: string
  cliente: string
  entrega: string          // ISO: aaaa-mm-dd
  valor: number
  status: 'Entregue' | 'Em rota' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
}

export interface ClienteDerivado extends Cliente {
  faturado: number
  entregas: number
  ticketEntrega: number
  participacao: number
  inadimplencia: number
  health: Health
}

/** Mes de uma data ISO, como '06'. Vazio se a data for invalida. */
export function mesDe(iso: string): string {
  return typeof iso === 'string' && iso.length >= 7 ? iso.slice(5, 7) : ''
}

function doCliente(pedidos: Pedido[], nome: string) {
  return pedidos.filter(p => p.cliente === nome)
}

export function ticketPorEntrega(pedidos: Pedido[], nome: string): number {
  const entregues = doCliente(pedidos, nome).filter(p => p.status === 'Entregue')
  if (entregues.length === 0) return 0
  const total = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  return Math.round(total / entregues.length)
}

export function inadimplenciaPorCliente(pedidos: Pedido[], nome: string): number {
  const meus = doCliente(pedidos, nome)
  const faturado = meus
    .filter(p => p.status === 'Entregue')
    .reduce((s, p) => s + (p.valor || 0), 0)
  if (faturado <= 0) return 0
  const atrasado = meus
    .filter(p => p.pag === 'Atrasado')
    .reduce((s, p) => s + (p.valor || 0), 0)
  return (atrasado / faturado) * 100
}

/**
 * Portado de healthOf() do prototipo. As faixas (2% de inadimplencia,
 * ticket de 150 e 430) sao metas de negocio — viram configuracao na Fase 5.
 * Ticket zero significa "sem entrega no periodo" e nao penaliza.
 */
export function healthDoCliente(
  cliente: Pick<Cliente, 'status' | 'tend'>,
  inadPct: number,
  ticketEntrega: number,
): Health {
  if (!cliente || !cliente.status) return 'green'
  if (cliente.status === 'inadimplente' || cliente.status === 'inativo') return 'red'
  const inad = inadPct || 0
  const te = ticketEntrega || 0
  if (inad > 2 || (te > 0 && te < 150)) return 'red'
  if (inad > 1 || (te > 0 && te < 430) || cliente.tend === '↓' || cliente.status === 'negociacao') {
    return 'amber'
  }
  return 'green'
}

export function derivarClientes(
  clientes: Cliente[],
  pedidos: Pedido[],
  periodo: string,
): ClienteDerivado[] {
  const doPeriodo = periodo === 'all'
    ? pedidos
    : pedidos.filter(p => mesDe(p.entrega) === periodo)

  const entregues = doPeriodo.filter(p => p.status === 'Entregue')
  const faturamentoTotal = entregues.reduce((s, p) => s + (p.valor || 0), 0)

  return clientes.map(c => {
    const meus = entregues.filter(p => p.cliente === c.nome)
    const faturado = meus.reduce((s, p) => s + (p.valor || 0), 0)
    const ticketEntrega = ticketPorEntrega(doPeriodo, c.nome)
    const inadimplencia = inadimplenciaPorCliente(doPeriodo, c.nome)
    return {
      ...c,
      faturado,
      entregas: meus.length,
      ticketEntrega,
      participacao: faturamentoTotal > 0
        ? Math.round((faturado / faturamentoTotal) * 100)
        : 0,
      inadimplencia,
      health: healthDoCliente(c, inadimplencia, ticketEntrega),
    }
  })
}
```

- [ ] **Step 5: Rodar e verificar que passa**

Run: `cd web && npx vitest run src/derive/clientes.test.ts`
Expected: PASS — 17 testes

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): porta a logica de derivacao de clientes como funcoes puras"
```

---

## Task 8: Cliente HTTP e tela de login

**Files:**
- Create: `web/src/api/client.ts`, `web/src/screens/Login.tsx`
- Modify: `web/src/App.tsx`, `web/vite.config.ts`

**Interfaces:**
- Consumes: `POST /api/login`, `GET /api/eu` da Task 5
- Produces: `api.get<T>(rota)`, `api.post<T>(rota, corpo)`, `api.put<T>`, `api.del`; componente `<Login onEntrar={() => void} />`

- [ ] **Step 1: Proxy do Vite para a API**

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
```

O proxy faz o cookie de sessão funcionar em desenvolvimento sem CORS: front e API ficam na mesma origem.

- [ ] **Step 2: Cliente HTTP**

`web/src/api/client.ts`:

```ts
export class ErroApi extends Error {
  constructor(public status: number, public corpo: unknown) {
    super(`API ${status}`)
  }
}

async function requisicao<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(rota, {
    method: metodo,
    credentials: 'include',          // o cookie de sessao precisa viajar
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await resposta.text()
  const dados = texto ? JSON.parse(texto) : null
  if (!resposta.ok) throw new ErroApi(resposta.status, dados)
  return dados as T
}

export const api = {
  get:  <T>(rota: string) => requisicao<T>('GET', rota),
  post: <T>(rota: string, corpo: unknown) => requisicao<T>('POST', rota, corpo),
  put:  <T>(rota: string, corpo: unknown) => requisicao<T>('PUT', rota, corpo),
  del:  <T>(rota: string) => requisicao<T>('DELETE', rota),
}
```

- [ ] **Step 3: Tela de login**

`web/src/screens/Login.tsx` — replicar o visual do protótipo (fundo `#21331f`, card claro, fonte Archivo). Campos: **slug do hortifruti**, e-mail e senha. Diferença em relação ao protótipo, que tinha um `select` de papel: o papel agora vem do usuário no banco.

```tsx
import { useState } from 'react'
import { api, ErroApi } from '../api/client'

export function Login({ onEntrar }: { onEntrar: () => void }) {
  const [slug, setSlug] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setErro(''); setEnviando(true)
    try {
      await api.post('/api/login', { slug, email, senha })
      onEntrar()
    } catch (err) {
      setErro(err instanceof ErroApi && err.status === 401
        ? 'Credenciais inválidas.'
        : 'Não foi possível entrar. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={entrar} style={{ /* ver design/CRM Hortifruti.dc.html */ }}>
      <input value={slug} onChange={e => setSlug(e.target.value)}
             placeholder="Hortifrúti" autoComplete="organization" required />
      <input value={email} onChange={e => setEmail(e.target.value)}
             type="email" placeholder="E-mail" autoComplete="username" required />
      <input value={senha} onChange={e => setSenha(e.target.value)}
             type="password" placeholder="Senha" autoComplete="current-password" required />
      {erro && <p role="alert">{erro}</p>}
      <button type="submit" disabled={enviando}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
```

A mensagem de erro é sempre genérica: dizer "e-mail não encontrado" permitiria enumerar usuários.

- [ ] **Step 4: Verificar o fluxo no navegador**

Run: `cd api && npx wrangler dev` e `cd web && npm run dev`

Abrir `http://localhost:5173`, logar com o usuário de teste.
Expected: entra na aplicação; recarregar a página mantém a sessão (`GET /api/eu` responde 200).

- [ ] **Step 5: Commit**

```bash
git add web/src/api web/src/screens/Login.tsx web/vite.config.ts web/src/App.tsx
git commit -m "feat(web): cliente HTTP e tela de login"
```

---

## Task 9: Shell e tela de clientes

**Files:**
- Create: `web/src/components/Shell.tsx`, `web/src/screens/ClientesLista.tsx`
- Modify: `web/src/App.tsx`
- Reference: `design/CRM Hortifruti.dc.html` (sidebar linhas ~40-90; tabela de clientes; `navDefs` linha ~2113)

**Interfaces:**
- Consumes: `derivarClientes` (Task 7), `api` (Task 8), `GET /api/clientes` (Task 6)
- Produces: `<Shell papel telaAtual onNavegar>`, `<ClientesLista onAbrir={(id) => void} />`

- [ ] **Step 1: Shell com a navegação do design**

As 10 entradas do menu, na ordem do protótipo: Saúde do Negócio, Clientes, Entradas (Compras), Saídas (Vendas), Estoque, Fornecedores, Produtos, Funcionários, Financeiro, Relatórios.

Colaborador vê apenas Entradas, Saídas e Estoque. Portar `ADMIN_ONLY_SCREENS = ['dashboard','clientes','fornecedores','produtos','financeiro','relatorios','funcionarios']`.

Nesta fase só Clientes tem tela; as demais renderizam um placeholder identificado — não devem sumir do menu, para o layout ser avaliado inteiro.

Paleta do design: fundo `#ece8db`, sidebar `#21331f`, ativo `rgba(124,179,66,0.18)`, texto do menu `#bcc9ac`, acento `#7cb342`. Semáforo: verde `#3f8f5b`, âmbar `#c79320`, vermelho `#c2502f`. Fontes: Archivo (títulos), Public Sans (texto), IBM Plex Mono (números).

- [ ] **Step 2: Tela de clientes**

Colunas do protótipo: Cliente, Responsável, Rota, Frequência, Status, Ticket do mês, Ticket por entrega, Participação, Inadimplência, Tendência, Health.

Filtros de status com contagem: Todos, Ativo, Em negociação, Inadimplente, Inativo.

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { derivarClientes, type Cliente, type Pedido, type ClienteDerivado } from '../derive/clientes'

const CORES: Record<string, string> = { green: '#3f8f5b', amber: '#c79320', red: '#c2502f' }

export function ClientesLista({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [periodo] = useState('all')
  const [filtro, setFiltro] = useState('Todos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Cliente[]>('/api/clientes'),
      // Pedidos ainda nao tem endpoint (Fase 1). Ate la, lista vazia:
      // as derivacoes tratam ausencia de pedido sem quebrar.
      Promise.resolve<Pedido[]>([]),
    ])
      .then(([cs, ps]) => { if (!cancelado) { setClientes(cs); setPedidos(ps) } })
      .catch(() => { if (!cancelado) setErro('Não foi possível carregar os clientes.') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [])

  const derivados: ClienteDerivado[] = derivarClientes(clientes, pedidos, periodo)
  const visiveis = filtro === 'Todos'
    ? derivados
    : derivados.filter(c => rotuloStatus(c.status) === filtro)

  if (carregando) return <p>Carregando…</p>
  if (erro) return <p role="alert">{erro}</p>
  if (clientes.length === 0) return <p>Nenhum cliente cadastrado ainda.</p>

  return (/* tabela — ver design */)
}

function rotuloStatus(s: string) {
  return ({ ativo: 'Ativo', negociacao: 'Em negociação',
            inadimplente: 'Inadimplente', inativo: 'Inativo' })[s] ?? s
}
```

A flag `cancelado` evita atualizar estado depois que o componente desmontou — o aviso clássico de React em navegação rápida.

- [ ] **Step 3: Verificar no navegador**

Run: com API e web rodando, cadastrar 2 clientes direto no banco e abrir a tela.
Expected: os dois aparecem; os filtros de status contam certo; ticket e inadimplência aparecem zerados (ainda não há pedidos) sem quebrar o layout.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Shell.tsx web/src/screens/ClientesLista.tsx web/src/App.tsx
git commit -m "feat(web): shell de navegacao e listagem de clientes"
```

---

## Task 10: Ficha do cliente e modal de CRUD

**Files:**
- Create: `web/src/screens/ClienteFicha.tsx`, `web/src/components/ModalCliente.tsx`
- Modify: `web/src/App.tsx`
- Reference: `newCliente` e `editCliente` no design (valores padrão do formulário)

**Interfaces:**
- Consumes: `api` (Task 8), rotas de clientes (Task 6)
- Produces: `<ClienteFicha id onVoltar onEditar />`, `<ModalCliente cliente onSalvar onFechar />`

- [ ] **Step 1: Modal com os padrões do protótipo**

`web/src/components/ModalCliente.tsx`:

```tsx
import { useState } from 'react'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

/** Valores iniciais copiados de newCliente() no prototipo. */
export const CLIENTE_NOVO = {
  nome: '', resp: '', cnpj: '', tel: '', email: '', endereco: '',
  rota: 'Sul A', freq: '2×/sem · Seg e Qui', status: 'ativo',
  cobranca: 'Em dia', forma: 'PIX', limite: 0, prazo: 14, tend: '→', obs: '',
}

export function ModalCliente({
  cliente, onSalvo, onFechar,
}: {
  cliente: Partial<Cliente> | null   // null = criando
  onSalvo: (c: Cliente) => void
  onFechar: () => void
}) {
  const [rascunho, setRascunho] = useState({ ...CLIENTE_NOVO, ...(cliente ?? {}) })
  const [erroNome, setErroNome] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const editando = Boolean(cliente?.id)

  function campo<K extends keyof typeof rascunho>(chave: K) {
    return {
      value: rascunho[chave] as string | number,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErroNome(''); setErroGeral('')
    if (!rascunho.nome.trim()) { setErroNome('Informe o nome.'); return }
    setSalvando(true)
    try {
      const corpo = {
        ...rascunho,
        limite: Number(rascunho.limite) || 0,
        prazo: Number(rascunho.prazo) || 0,
      }
      const salvo = editando
        ? await api.put<Cliente>(`/api/clientes/${cliente!.id}`, corpo)
        : await api.post<Cliente>('/api/clientes', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroNome('Já existe um cliente com esse nome.')
      } else {
        setErroGeral('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={editando ? 'Editar cliente' : 'Novo cliente'}
         onClick={onFechar}>
      <form onClick={e => e.stopPropagation()} onSubmit={salvar}>
        <input {...campo('nome')} placeholder="Nome do minimercado" autoFocus required />
        {erroNome && <p role="alert">{erroNome}</p>}

        <input {...campo('resp')} placeholder="Responsável" />
        <input {...campo('cnpj')} placeholder="CNPJ" />
        <input {...campo('tel')} placeholder="Telefone" />
        <input {...campo('email')} type="email" placeholder="E-mail" />
        <input {...campo('endereco')} placeholder="Endereço" />
        <input {...campo('rota')} placeholder="Rota" />
        <input {...campo('freq')} placeholder="Frequência" />

        <select {...campo('status')}>
          <option value="ativo">Ativo</option>
          <option value="negociacao">Em negociação</option>
          <option value="inadimplente">Inadimplente</option>
          <option value="inativo">Inativo</option>
        </select>

        <select {...campo('forma')}>
          <option>PIX</option><option>Boleto</option><option>Dinheiro</option>
        </select>

        <input {...campo('limite')} type="number" min="0" step="0.01"
               placeholder="Limite de crédito" />
        <input {...campo('prazo')} type="number" min="0" placeholder="Prazo (dias)" />

        <select {...campo('tend')}>
          <option value="↑">Crescendo</option>
          <option value="→">Estável</option>
          <option value="↓">Caindo</option>
        </select>

        <textarea {...campo('obs')} placeholder="Observações" rows={3} />

        {erroGeral && <p role="alert">{erroGeral}</p>}
        <button type="button" onClick={onFechar}>Cancelar</button>
        <button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </div>
  )
}
```

O `stopPropagation` no formulário é o que faz clicar no fundo fechar o modal sem que clicar dentro dele feche também — comportamento que o protótipo já tem em `closeModalBackdrop`.

Estilos: seguir os modais do design (`design/CRM Hortifruti.dc.html`), fundo do overlay escurecido, card claro `#f3f0e6`, cantos arredondados.

- [ ] **Step 2: Ficha do cliente**

Cabeçalho com nome, health e status. Blocos: cadastro (contato e endereço), crédito (limite e prazo), métricas do período (faturado, ticket, inadimplência, participação) e observações. Botões de editar e excluir; excluir pede confirmação.

Enquanto não houver endpoint de pedidos, o histórico mostra "Nenhuma entrega registrada" em vez de um bloco vazio.

- [ ] **Step 3: Verificar o ciclo completo**

Run: no navegador — criar cliente, ver na lista, abrir ficha, editar, salvar, excluir.
Expected: cada ação reflete na lista sem recarregar a página; criar cliente com nome repetido mostra o erro no campo.

- [ ] **Step 4: Commit**

```bash
git add web/src/screens/ClienteFicha.tsx web/src/components/ModalCliente.tsx web/src/App.tsx
git commit -m "feat(web): ficha do cliente e modal de cadastro"
```

---

## Task 11: Backup automático para o R2

A spec exige que isto rode **antes** de existir dado real. Não adie para depois do deploy.

**Files:**
- Create: `.github/workflows/backup.yml`, `docs/runbook-restore.md`

**Interfaces:**
- Consumes: secrets `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- Produces: objetos `backup-<aaaa-mm-dd-hhmm>.dump` no R2

- [ ] **Step 1: Workflow**

`.github/workflows/backup.yml`:

```yaml
name: backup

on:
  schedule:
    - cron: '0 11,14,17,20,23 * * *'   # UTC -> 08,11,14,17,20 BRT
  workflow_dispatch:

jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - name: Instalar o pg_dump 16
        run: |
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
          sudo apt-get update && sudo apt-get install -y postgresql-client-16

      - name: Gerar o dump
        env:
          PGSSLMODE: require
        run: |
          NOME="backup-$(date -u +%Y-%m-%d-%H%M).dump"
          echo "NOME=$NOME" >> "$GITHUB_ENV"
          pg_dump --format=custom --no-owner --no-privileges \
            --file="$NOME" "${{ secrets.DATABASE_URL }}"
          ls -lh "$NOME"

      - name: Enviar para o R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
        run: |
          aws s3 cp "$NOME" "s3://${{ secrets.R2_BUCKET }}/$NOME" \
            --endpoint-url "https://${{ secrets.R2_ACCOUNT_ID }}.r2.cloudflarestorage.com"

      - name: Expirar backups com mais de 30 dias
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
        run: |
          CORTE=$(date -u -d '30 days ago' +%Y-%m-%d)
          aws s3 ls "s3://${{ secrets.R2_BUCKET }}/" \
            --endpoint-url "https://${{ secrets.R2_ACCOUNT_ID }}.r2.cloudflarestorage.com" \
          | awk '{print $4}' | grep '^backup-' | while read -r objeto; do
              DATA=$(echo "$objeto" | sed -E 's/^backup-([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/')
              if [[ "$DATA" < "$CORTE" ]]; then
                echo "expirando $objeto"
                aws s3 rm "s3://${{ secrets.R2_BUCKET }}/$objeto" \
                  --endpoint-url "https://${{ secrets.R2_ACCOUNT_ID }}.r2.cloudflarestorage.com"
              fi
            done

      - name: Avisar se falhou
        if: failure()
        run: echo "::error::Backup falhou — investigar hoje, nao amanha"
```

A retenção de 30 dias é requisito da spec (seção 5). Sem ela, cinco dumps por dia enchem os 10GB gratuitos do R2 e o backup começa a falhar — provavelmente em silêncio, meses depois, que é o pior momento possível.

O passo `if: failure()` existe porque o modo de falha clássico de backup é o job quebrar em silêncio e ninguém notar por semanas. Configure notificação de falha de Actions no seu e-mail.

Para o dump usar a conexão **direta** (porta 5432), não o pooler: `pg_dump` abre sessão longa e transaction pooling não a suporta.

- [ ] **Step 2: Runbook de restauração**

`docs/runbook-restore.md` com os passos cronometrados: baixar o dump do R2, subir Postgres de destino, `pg_restore --no-owner --no-privileges`, recriar o role `app_crm`, **conferir se as policies de RLS vieram** (`select tablename, policyname from pg_policies`), reapontar `DATABASE_URL`, e validar rodando a suíte de isolamento contra o banco restaurado.

O passo das policies é o que mais se esquece: um restore que traz os dados mas perde a RLS deixa o sistema aberto entre tenants sem nenhum sintoma visível.

- [ ] **Step 3: Ensaiar o restore**

Run: disparar o workflow manualmente (`workflow_dispatch`), baixar o dump gerado e restaurar num Postgres local; cronometrar.

Expected: restore completo, `pg_policies` mostra `tenant_isolation` em `usuarios`, `sessoes` e `clientes`, e `npx vitest run test/isolamento.test.ts` passa contra o banco restaurado.

Anotar o tempo real no runbook.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/backup.yml docs/runbook-restore.md
git commit -m "chore: backup automatico para R2 e runbook de restauracao"
```

---

## Task 12: Deploy

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `api/wrangler.toml`

**Interfaces:**
- Consumes: tudo acima
- Produces: API em Workers e front em Cloudflare Pages, em produção

- [ ] **Step 1: Secrets de produção**

```bash
cd api && npx wrangler secret put DATABASE_URL
```

Nunca em `wrangler.toml` — esse arquivo é versionado.

- [ ] **Step 2: Migrations em produção**

Run: `DATABASE_URL='<conexao direta do Supabase, porta 5432>' node db/migrate.mjs`

Migrations usam a conexão direta, não o pooler: `create table` e `create policy` são DDL e não se comportam bem em transaction pooling.

- [ ] **Step 3: Trocar a senha do role `app_crm`**

```sql
alter role app_crm password '<senha forte gerada>';
```

A migration cria com `trocar_em_producao` de propósito, para o passo ser impossível de esquecer em silêncio. Atualizar a `DATABASE_URL` do Worker com a senha nova.

- [ ] **Step 4: Pipeline que barra deploy sem isolamento**

A spec (seção 6) exige que o teste de isolamento bloqueie o deploy. `.github/workflows/deploy.yml`:

```yaml
name: deploy

on:
  push:
    branches: [master]

jobs:
  testar:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: dev
          POSTGRES_DB: crm_dev
        ports: ['5433:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Aplicar migrations
        env:
          DATABASE_URL: postgres://postgres:dev@localhost:5433/crm_dev
        run: npm ci --prefix api && node db/migrate.mjs

      - name: Testes da API (inclui isolamento entre tenants)
        run: npm --prefix api exec vitest run

      - name: Testes de derivacao
        run: npm ci --prefix web && npm --prefix web exec vitest run

  publicar:
    needs: testar          # sem os testes verdes, nao publica
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci --prefix api && npm ci --prefix web
      - run: npm --prefix web run build
      - name: Publicar API e front
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          npm --prefix api exec wrangler deploy
          npm --prefix web exec wrangler pages deploy dist
```

O `needs: testar` é o gate: se o teste de isolamento falhar, `publicar` nunca roda. É a única proteção automática contra subir uma versão que vaza dados entre clientes.

Workers e Pages fazem deploy atômico — a versão nova só recebe tráfego quando está pronta —, então o blue-green que a spec pede já vem do runtime nesta fase. Ele vira trabalho manual só no Estágio 1, quando o app mudar para VPS.

- [ ] **Step 5: Publicar**

```bash
cd api && npx wrangler deploy
cd ../web && npm run build && npx wrangler pages deploy dist
```

- [ ] **Step 6: Verificar em produção**

Run: `curl https://<sua-api>.workers.dev/api/health`
Expected: `{"ok":true,...}`

Abrir o front publicado, logar, criar um cliente, recarregar. Expected: o cliente persiste.

- [ ] **Step 7: Verificar o isolamento em produção**

Criar um segundo tenant com um usuário próprio, logar com ele e confirmar que a lista de clientes vem vazia — não com os clientes do primeiro.

Este é o teste que autoriza o segundo cliente pagante a existir. Não pule.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/deploy.yml api/wrangler.toml
git commit -m "chore: deploy da API em Workers e do front em Pages"
```

---

## Definição de pronto

- [ ] `npx vitest run` passa em `api/` e em `web/`
- [ ] Dois tenants coexistem e não enxergam dados um do outro — verificado **em produção**
- [ ] Backup rodou ao menos uma vez e um restore foi ensaiado e cronometrado
- [ ] O runbook de restauração existe e foi seguido de ponta a ponta uma vez
- [ ] Nenhum segredo no repositório — `git log -p -- api web db .github | grep -iE 'pooler\.supabase|password=|secret_access'` sem resultado (restringir a código e config; `docs/` cita essas palavras legitimamente)
- [ ] `.dev.vars` está no `.gitignore` e `git ls-files | grep dev.vars` só mostra o `.example`
- [ ] A senha do role `app_crm` foi trocada em produção
- [ ] Clientes funciona ponta a ponta: criar, listar, filtrar, abrir ficha, editar, excluir

## O que fica para a Fase 1

As 7 entidades restantes (produtos, fornecedores, funcionários, entradas, saídas, perdas, lançamentos), repetindo o padrão validado aqui: migration com RLS → teste de isolamento → rotas → derivação portada com testes → tela → modal.

Duas dívidas conhecidas que a Fase 1 precisa resolver:

1. **Pedidos e entradas referenciam cliente e fornecedor por nome.** Na migração das próximas entidades, converter para foreign key. As derivações desta fase (`derivarClientes`) casam por `p.cliente === c.nome`; quando `pedidos` ganhar `cliente_id`, essas funções mudam junto — e os testes da Task 7 são o que garante que os números continuam iguais.

2. **`ClientesLista` usa lista de pedidos vazia.** Ticket, inadimplência e participação aparecem zerados até o endpoint de pedidos existir. É esperado, e não é bug.
