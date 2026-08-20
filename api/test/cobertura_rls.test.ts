import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'

// Gate exigido pela spec da Fase 0 (§3): "Uma tabela nova sem politica de
// RLS deve reprovar o build — verificacao automatica comparando as tabelas
// com tenant_id contra pg_policies." Nao existia nenhum teste automatico
// para isso ate agora — a revisao final provou o buraco criando uma tabela
// com tenant_id e sem RLS, e as 44 provas da suite anterior continuaram
// verdes, inclusive dentro de withTenant.
//
// O risco e concreto: 001_tenants_usuarios.sql (linha 44-45) tem
// `alter default privileges ... grant select, insert, update, delete on
// tables to app_crm` — toda tabela nova nasce com CRUD liberado pra
// app_crm. Sem este gate, basta esquecer um `enable row level security`
// numa das 7 tabelas da Fase 1 para todo hortifruti ver os dados de todos,
// com CI verde.
//
// O gate cobre tres coisas para cada tabela publica com coluna tenant_id:
//   - relrowsecurity  (RLS ligada)
//   - relforcerowsecurity (RLS forcada — sem isso, o owner da tabela
//     continua passando por cima da policy)
//   - uma policy em pg_policies com qual E with_check preenchidos (uma
//     policy so de leitura, ou so de escrita, deixaria a outra metade
//     aberta)
//
// `tenants` e excluida explicitamente: nao tem tenant_id e e sem RLS por
// design (login precisa resolve-lo antes de haver tenant — ver
// 003_policy_sessao.sql). `schema_migrations` tambem fica de fora: e
// infraestrutura do runner (db/migrate.mjs), nao dado de tenant, e nao tem
// tenant_id — mas listamos a exclusao para deixar claro que nao e um
// esquecimento.

const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let admin: ReturnType<typeof criarPool>

beforeAll(() => { admin = criarPool(ADMIN) })
afterAll(async () => { await admin?.end() })

type LinhaCobertura = {
  tabela: string
  relrowsecurity: boolean
  relforcerowsecurity: boolean
  tem_policy_completa: boolean
}

async function tabelasComTenantId(): Promise<LinhaCobertura[]> {
  return admin<LinhaCobertura[]>`
    select
      c.relname as tabela,
      c.relrowsecurity,
      c.relforcerowsecurity,
      exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.qual is not null
          and p.with_check is not null
      ) as tem_policy_completa
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in ('tenants', 'schema_migrations')
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = c.relname
          and col.column_name = 'tenant_id'
      )
    order by c.relname
  `
}

describe('cobertura de RLS (gate automatico exigido pela spec §3)', () => {
  it('a query do gate acha as tabelas com tenant_id que ja existem (sanity — evita falso-positivo por query quebrada)', async () => {
    const tabelas = await tabelasComTenantId()
    expect(tabelas.map(t => t.tabela)).toEqual(
      expect.arrayContaining(['usuarios', 'sessoes', 'clientes']),
    )
  })

  it('toda tabela com coluna tenant_id tem RLS ligada, forcada e policy com qual + with_check', async () => {
    const tabelas = await tabelasComTenantId()
    const semCobertura = tabelas.filter(t =>
      !t.relrowsecurity || !t.relforcerowsecurity || !t.tem_policy_completa)

    expect(
      semCobertura,
      `tabelas com tenant_id sem RLS completa: ${JSON.stringify(semCobertura, null, 2)}`,
    ).toEqual([])
  })

  it('tenants fica de fora do gate por design: nao tem tenant_id', async () => {
    const [linha] = await admin<{ existe: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tenants' and column_name = 'tenant_id'
      ) as existe
    `
    expect(linha.existe).toBe(false)
  })
})
