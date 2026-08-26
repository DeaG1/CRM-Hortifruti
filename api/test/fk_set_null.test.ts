import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

/**
 * REGRESSAO DE UM DEFEITO REAL: as tres FKs `on delete set null` criadas pela
 * migration 010 nunca funcionaram, e nenhum teste percebia.
 *
 * Um `ON DELETE SET NULL` sem lista de colunas zera TODAS as colunas da chave
 * estrangeira. A 010 tornou todas as chaves COMPOSTAS (o tenant entra na
 * chave, para a checagem de FK parar de ignorar RLS — ver o comentario
 * daquela migration), entao `tenant_id` passou a fazer parte da chave e o
 * `set null` tentava zera-lo. `tenant_id` e `not null`: o delete morria com
 * 23502 e a API devolvia 500 "erro interno".
 *
 * Na pratica, estava quebrado exatamente o caso em que estas FKs tinham algo
 * a fazer — excluir um cadastro COM historico:
 *   - funcionario que ja recebeu salario ou adiantamento;
 *   - cliente que ja comprou;
 *   - fornecedor de quem ja se comprou.
 * Sem historico o delete passava (nao havia linha a atualizar), e era so isso
 * que a suite exercitava — por isso 533 testes ficaram verdes por cima do
 * defeito. Cada `it` abaixo cria o historico ANTES de excluir; sem isso o
 * teste voltaria a ser cego.
 *
 * A correcao (`on delete set null (coluna)`, PostgreSQL 15+) esta em
 * 014_fk_set_null_por_coluna.sql. Se alguem reverter para o `set null` puro,
 * os tres primeiros testes daqui falham com 23502.
 *
 * Este arquivo fala com o BANCO direto (withTenant), como clientes.test.ts:
 * o que esta sendo verificado e o comportamento da constraint, nao o de uma
 * rota. `lancamentos.veiculo_id`, que nasceu ja com a forma correta, tem o
 * seu par em lancamentos.test.ts.
 */

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-fk-set-null', 'FK Set Null')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  await admin`delete from saida_itens where tenant_id = ${tenantId}`
  await admin`delete from saidas where tenant_id = ${tenantId}`
  await admin`delete from entrada_itens where tenant_id = ${tenantId}`
  await admin`delete from entradas where tenant_id = ${tenantId}`
  await admin`delete from lancamentos where tenant_id = ${tenantId}`
  await admin`delete from funcionarios where tenant_id = ${tenantId}`
  await admin`delete from clientes where tenant_id = ${tenantId}`
  await admin`delete from fornecedores where tenant_id = ${tenantId}`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('on delete set null das FKs compostas (010, corrigidas em 014)', () => {
  it('excluir funcionario COM lancamento zera funcionario_id e preserva o lancamento', async () => {
    const [f] = await withTenant(sql, tenantId, tx => tx`
      insert into funcionarios (tenant_id, nome) values (${tenantId}, 'Sai Com Historico') returning id`)
    const [l] = await withTenant(sql, tenantId, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, funcionario_id)
      values (${tenantId}, current_date, 'Salário', 1500, ${f.id}) returning id`)

    await withTenant(sql, tenantId, tx => tx`delete from funcionarios where id = ${f.id}`)

    const [depois] = await withTenant(sql, tenantId, tx => tx`
      select tenant_id, funcionario_id, valor from lancamentos where id = ${l.id}`)
    expect(depois).toBeDefined()
    expect(depois.funcionario_id).toBeNull()
    // O tenant NAO pode ter sido zerado junto — era esse o defeito.
    expect(depois.tenant_id).toBe(tenantId)
    expect(Number(depois.valor)).toBe(1500)
  })

  it('excluir cliente COM venda zera cliente_id e preserva a venda', async () => {
    const [c] = await withTenant(sql, tenantId, tx => tx`
      insert into clientes (tenant_id, nome) values (${tenantId}, 'Mercado Com Historico') returning id`)
    const [s] = await withTenant(sql, tenantId, tx => tx`
      insert into saidas (tenant_id, numero, data_pedido, cliente_id)
      values (${tenantId}, 'FKSN-1', current_date, ${c.id}) returning id`)

    await withTenant(sql, tenantId, tx => tx`delete from clientes where id = ${c.id}`)

    const [depois] = await withTenant(sql, tenantId, tx => tx`
      select tenant_id, cliente_id, numero from saidas where id = ${s.id}`)
    expect(depois).toBeDefined()
    expect(depois.cliente_id).toBeNull()
    expect(depois.tenant_id).toBe(tenantId)
    expect(depois.numero).toBe('FKSN-1')
  })

  it('excluir fornecedor COM entrada zera fornecedor_id e preserva a entrada', async () => {
    const [f] = await withTenant(sql, tenantId, tx => tx`
      insert into fornecedores (tenant_id, nome) values (${tenantId}, 'Sitio Com Historico') returning id`)
    const [e] = await withTenant(sql, tenantId, tx => tx`
      insert into entradas (tenant_id, numero, data, fornecedor_id)
      values (${tenantId}, 'FKEN-1', current_date, ${f.id}) returning id`)

    await withTenant(sql, tenantId, tx => tx`delete from fornecedores where id = ${f.id}`)

    const [depois] = await withTenant(sql, tenantId, tx => tx`
      select tenant_id, fornecedor_id, numero from entradas where id = ${e.id}`)
    expect(depois).toBeDefined()
    expect(depois.fornecedor_id).toBeNull()
    expect(depois.tenant_id).toBe(tenantId)
    expect(depois.numero).toBe('FKEN-1')
  })

  it('as quatro FKs `set null` do banco declaram a lista de colunas (nenhuma ficou para tras)', async () => {
    const linhas = await admin<{ conname: string; def: string }[]>`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where contype = 'f' and confdeltype = 'n'
      order by conname`
    expect(linhas.length).toBe(4)
    for (const linha of linhas) {
      expect(linha.def, `${linha.conname} sem lista de colunas no SET NULL`)
        .toMatch(/ON DELETE SET NULL \(\w+\)/)
    }
  })
})
