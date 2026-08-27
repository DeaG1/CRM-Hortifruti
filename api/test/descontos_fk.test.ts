import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

/**
 * O CONTRATO DE `descontos` NO BANCO, sem passar por rota nenhuma — molde de
 * test/fk_set_null.test.ts e test/veiculo_usos_cascade.test.ts: o que se
 * verifica aqui e o comportamento da CONSTRAINT, que continua valendo para
 * acesso direto ao banco, script de importacao e rota futura escrita
 * distraidamente. O par pela HTTP esta em test/descontos.http.test.ts.
 *
 * Duas coisas, e as duas ja custaram caro neste projeto:
 *
 *  1. A FK e COMPOSTA com `tenant_id` (010). A checagem de FK do Postgres roda
 *     com privilegio do dono da tabela referenciada e NAO respeita RLS: com
 *     `references funcionarios(id)`, um desconto da empresa B apontando para
 *     o funcionario da empresa A passaria em silencio — e o dinheiro seria
 *     abatido do salario de alguem de outra empresa.
 *  2. Ela e `cascade`, e nao `restrict` (015). `restrict` reproduziria o
 *     bloqueio permanente que prendeu o dono: excluir o funcionario passaria a
 *     falhar por causa de linhas cujo unico caminho no produto e... aquele
 *     mesmo funcionario.
 */

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string
let tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-desc-fk-a', 'Desc FK A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-desc-fk-b', 'Desc FK B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from descontos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from lancamentos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from funcionarios where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

async function criarFuncionario(tenantId: string, nome: string): Promise<string> {
  const [f] = await withTenant(sql, tenantId, tx => tx`
    insert into funcionarios (tenant_id, nome, salario) values (${tenantId}, ${nome}, 2000) returning id`)
  return f.id as string
}

describe('descontos_funcionario_fk — composta com tenant_id e cascade', () => {
  it('a definicao da constraint e exatamente a esperada', async () => {
    const [linha] = await admin<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'descontos'::regclass and conname = 'descontos_funcionario_fk'`
    expect(linha, 'a constraint precisa existir com este nome').toBeDefined()
    expect(linha.def).toBe(
      'FOREIGN KEY (tenant_id, funcionario_id) REFERENCES funcionarios(tenant_id, id) ON DELETE CASCADE',
    )
  })

  it('o banco RECUSA desconto apontando para funcionario de outra empresa', async () => {
    // O comportamento que a composicao protege, exercitado de verdade e nao
    // so lido de pg_constraint. Com uma FK simples este insert passaria em
    // silencio — e foi assim que a 010 encontrou lancamentos corrompidos.
    const alheio = await criarFuncionario(tenantB, 'Funcionario Da Empresa B')

    await expect(withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${alheio}, current_date, 'falta forjada', 100)`))
      .rejects.toMatchObject({ code: '23503' })

    const linhas = await admin`select id from descontos where funcionario_id = ${alheio}`
    expect(linhas).toHaveLength(0)
  })

  it('excluir o funcionario leva os descontos dele junto, e so os dele', async () => {
    const demitido = await criarFuncionario(tenantA, 'Demitido Com Faltas')
    const outro = await criarFuncionario(tenantA, 'Colega Que Fica')
    const [d1] = await withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${demitido}, '2026-06-10', 'faltou', 100) returning id`)
    const [d2] = await withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${demitido}, '2026-06-11', 'faltou de novo', 100) returning id`)
    const [doColega] = await withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${outro}, '2026-06-10', 'atraso', 20) returning id`)

    await withTenant(sql, tenantA, tx => tx`delete from funcionarios where id = ${demitido}`)

    const foram = await admin`select id from descontos where id in (${d1.id}, ${d2.id})`
    expect(foram, 'os descontos do demitido deveriam ter saido junto').toHaveLength(0)
    const [ficou] = await admin`select id from descontos where id = ${doColega.id}`
    expect(ficou, 'o desconto do colega nao pode ter sido tocado').toBeDefined()
  })

  it('RLS: uma empresa nao le nem escreve desconto da outra', async () => {
    const daA = await criarFuncionario(tenantA, 'Le So O Proprio')
    const [meu] = await withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${daA}, '2026-07-01', 'falta da empresa A', 30) returning id`)

    const vistosPorB = await withTenant(sql, tenantB, tx => tx`select id from descontos`)
    expect(vistosPorB.map(l => l.id)).not.toContain(meu.id)

    // E o `with check` da policy: gravar para o tenant alheio e recusado
    // mesmo com o tenant_id escrito na mao.
    await expect(withTenant(sql, tenantB, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${daA}, current_date, 'invasao', 10)`))
      .rejects.toThrow()
  })

  it('sem tenant fixado na sessao, nenhum desconto e visivel (o nullif da 002 nao lanca)', async () => {
    const linhas = await sql`select id from descontos`
    expect(linhas).toHaveLength(0)
  })

  it('as CHECKs seguram valor negativo e motivo em branco (ultima linha de defesa)', async () => {
    const f = await criarFuncionario(tenantA, 'Alvo Das Checks')
    await expect(withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${f}, current_date, 'motivo ok', -1)`))
      .rejects.toMatchObject({ code: '23514', constraint_name: 'descontos_valor_check' })

    await expect(withTenant(sql, tenantA, tx => tx`
      insert into descontos (tenant_id, funcionario_id, data, motivo, valor)
      values (${tenantA}, ${f}, current_date, '   ', 10)`))
      .rejects.toMatchObject({ code: '23514', constraint_name: 'descontos_motivo_check' })
  })
})
