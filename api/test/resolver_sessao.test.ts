import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'

// resolver_sessao (migration 003, corrigida na 006) e a unica porta de
// entrada de sessao sem tenant ainda definido (lerSessao em api/src/auth.ts
// passa por ela). auth.test.ts e sessao.test.ts cobrem o fluxo feliz via
// HTTP; este arquivo prova, direto contra a funcao SQL, que cada um dos tres
// predicados do WHERE (expira_em, usuarios.ativo, tenants.ativo) de fato
// barra a sessao quando deveria — sensibilidade provada por mutacao,
// registrada no relatorio final.

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let usuarioAtivoId: string
let usuarioInativoId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome, ativo) values ('teste-resolver-sessao', 'Tenant Resolver Sessao', true)
    on conflict (slug) do update set nome = excluded.nome, ativo = true returning id`
  tenantId = t.id

  await admin`delete from usuarios where tenant_id = ${tenantId}`
  const hash = await hashSenha('segredo123')
  const [uAtivo] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel, ativo)
    values (${tenantId}, 'ativo@resolver.com', ${hash}, 'Ativo', 'admin', true) returning id`
  const [uInativo] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel, ativo)
    values (${tenantId}, 'inativo@resolver.com', ${hash}, 'Inativo', 'admin', false) returning id`
  usuarioAtivoId = uAtivo.id
  usuarioInativoId = uInativo.id
})

afterAll(async () => {
  // devolve o tenant ativo, para o caso de um teste anterior ter falhado
  // no meio e deixado o desligamento sem reverter.
  if (admin) await admin`update tenants set ativo = true where id = ${tenantId}`.catch(() => {})
  await sql?.end()
  await admin?.end()
})

/** true se resolver_sessao(token) devolveu alguma linha. */
async function resolveu(token: string): Promise<boolean> {
  const linhas = await sql`select * from resolver_sessao(${token})`
  return linhas.length > 0
}

describe('resolver_sessao', () => {
  it('sessao dentro da validade, usuario e tenant ativos: resolve', async () => {
    const token = await criarSessao(sql, usuarioAtivoId, tenantId)
    expect(await resolveu(token)).toBe(true)
  })

  it('sessao expirada nao resolve', async () => {
    const token = await criarSessao(sql, usuarioAtivoId, tenantId)
    await admin`update sessoes set expira_em = now() - interval '1 minute' where token = ${token}`
    expect(await resolveu(token)).toBe(false)
  })

  it('usuario inativo nao resolve', async () => {
    const token = await criarSessao(sql, usuarioInativoId, tenantId)
    expect(await resolveu(token)).toBe(false)
  })

  it('tenant inativo nao resolve (kill switch: desativar o tenant mata a sessao viva na hora)', async () => {
    const token = await criarSessao(sql, usuarioAtivoId, tenantId)
    // pre-condicao: com o tenant ainda ativo, a sessao resolve normalmente.
    expect(await resolveu(token)).toBe(true)

    await admin`update tenants set ativo = false where id = ${tenantId}`
    try {
      expect(await resolveu(token)).toBe(false)
    } finally {
      await admin`update tenants set ativo = true where id = ${tenantId}`
    }
  })
})
