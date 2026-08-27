import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'

/**
 * REGRESSAO DE UM BLOQUEIO REAL EM PRODUCAO: o dono do negocio nao conseguia
 * excluir funcionario nem veiculo, e nao tinha como se destravar.
 *
 * As duas FKs de `veiculo_usos` eram `on delete restrict` (011). A tela que
 * alimentava aquela tabela — o check-in/check-out de veiculos — foi removida
 * (7b841b1) e a tabela ficou, orfa, com as linhas que ja tinha. Duas delas,
 * sobra de teste, apontavam para o funcionario e o veiculo que ele queria
 * excluir. Nenhuma tela le ou escreve em `veiculo_usos`: nao havia botao,
 * lista ou formulario que chegasse naquelas linhas. O bloqueio era, na
 * pratica, permanente.
 *
 * A correcao (`on delete cascade` nas duas) esta em
 * 015_veiculo_usos_cascade.sql. Se alguem reverter para `restrict`, os dois
 * primeiros testes daqui falham com 23503 — que era exatamente o erro que
 * chegava ao dono como 500 "erro interno".
 *
 * Este arquivo fala com o BANCO direto (withTenant), como fk_set_null.test.ts:
 * o que esta sendo verificado e o comportamento da constraint, nao o de uma
 * rota. O par pela HTTP esta em funcionarios.http.test.ts e
 * veiculos.http.test.ts.
 *
 * Cada `it` cria a linha de uso ANTES de excluir. Sem isso o teste seria cego
 * do mesmo jeito que a suite inteira foi: enquanto nao havia linha em
 * `veiculo_usos`, o delete passava e o defeito ficava invisivel.
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
    insert into tenants (slug, nome) values ('teste-uso-cascade', 'Uso Cascade')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  await admin`delete from veiculo_usos where tenant_id = ${tenantId}`
  await admin`delete from lancamentos where tenant_id = ${tenantId}`
  await admin`delete from veiculos where tenant_id = ${tenantId}`
  await admin`delete from funcionarios where tenant_id = ${tenantId}`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

/** Cria um par funcionario+veiculo com uma linha de uso ligando os dois — o
 * estado exato em que o banco do dono estava. */
async function comUsoRegistrado(nome: string, placa: string) {
  const [f] = await withTenant(sql, tenantId, tx => tx`
    insert into funcionarios (tenant_id, nome) values (${tenantId}, ${nome}) returning id`)
  const [v] = await withTenant(sql, tenantId, tx => tx`
    insert into veiculos (tenant_id, placa) values (${tenantId}, ${placa}) returning id`)
  // Inserido direto: nao existe mais rota que escreva em `veiculo_usos`. E
  // justamente por isso que a linha e intocavel pelo produto.
  const [u] = await withTenant(sql, tenantId, tx => tx`
    insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id, volta_em)
    values (${tenantId}, ${v.id}, ${f.id}, now()) returning id`)
  return { funcionarioId: f.id as string, veiculoId: v.id as string, usoId: u.id as string }
}

describe('on delete cascade das FKs de veiculo_usos (011 restrict, corrigidas em 015)', () => {
  it('excluir funcionario COM registro de uso funciona e leva o uso junto', async () => {
    const { funcionarioId, usoId } = await comUsoRegistrado('Motorista Travado', 'TRV-0001')

    await withTenant(sql, tenantId, tx => tx`delete from funcionarios where id = ${funcionarioId}`)

    const [uso] = await admin`select id from veiculo_usos where id = ${usoId}`
    expect(uso, 'o registro de uso deveria ter saido junto com o funcionario').toBeUndefined()
    const [f] = await admin`select id from funcionarios where id = ${funcionarioId}`
    expect(f).toBeUndefined()
  })

  it('excluir veiculo COM registro de uso funciona e leva o uso junto', async () => {
    const { veiculoId, usoId } = await comUsoRegistrado('Motorista Do Carro', 'TRV-0002')

    await withTenant(sql, tenantId, tx => tx`delete from veiculos where id = ${veiculoId}`)

    const [uso] = await admin`select id from veiculo_usos where id = ${usoId}`
    expect(uso, 'o registro de uso deveria ter saido junto com o veiculo').toBeUndefined()
    const [v] = await admin`select id from veiculos where id = ${veiculoId}`
    expect(v).toBeUndefined()
  })

  it('o cascade nao alcanca o LANCAMENTO: excluir funcionario com lancamento preserva a despesa, so desvincula', async () => {
    // O ponto de nao-regressao da 014 visto por este angulo: a mesma exclusao
    // que agora leva o uso junto NAO pode levar o dinheiro junto. Sao FKs
    // diferentes, com decisoes diferentes, e as duas disparam no mesmo delete.
    const { funcionarioId } = await comUsoRegistrado('Motorista Com Salario', 'TRV-0003')
    const [l] = await withTenant(sql, tenantId, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, funcionario_id)
      values (${tenantId}, current_date, 'Salário', 1800, ${funcionarioId}) returning id`)

    await withTenant(sql, tenantId, tx => tx`delete from funcionarios where id = ${funcionarioId}`)

    const [depois] = await withTenant(sql, tenantId, tx => tx`
      select tenant_id, funcionario_id, valor from lancamentos where id = ${l.id}`)
    expect(depois, 'o lancamento nao pode ter sido apagado').toBeDefined()
    expect(depois.funcionario_id).toBeNull()
    expect(depois.tenant_id).toBe(tenantId)
    expect(Number(depois.valor)).toBe(1800)
  })

  it('o cascade nao alcanca o LANCAMENTO: excluir veiculo com despesa preserva o valor, so desvincula', async () => {
    const { veiculoId } = await comUsoRegistrado('Motorista Da Gasolina', 'TRV-0004')
    const [l] = await withTenant(sql, tenantId, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
      values (${tenantId}, current_date, 'Gasolina', 275.50, ${veiculoId}) returning id`)

    await withTenant(sql, tenantId, tx => tx`delete from veiculos where id = ${veiculoId}`)

    const [depois] = await withTenant(sql, tenantId, tx => tx`
      select tenant_id, veiculo_id, valor from lancamentos where id = ${l.id}`)
    expect(depois, 'o lancamento nao pode ter sido apagado').toBeDefined()
    expect(depois.veiculo_id).toBeNull()
    expect(depois.tenant_id).toBe(tenantId)
    expect(Number(depois.valor)).toBe(275.5)
  })

  it('as duas FKs continuam COMPOSTAS com tenant_id — cascade nao pode ter custado o isolamento', async () => {
    // A armadilha da 015 era recriar as constraints como FK simples
    // (`references funcionarios(id)`), o que reabriria o furo da 010: a
    // verificacao de FK do Postgres roda com privilegio do dono da tabela
    // referenciada e NAO respeita RLS, entao uma linha da empresa B
    // referenciando registro da empresa A passaria em silencio.
    const linhas = await admin<{ conname: string; def: string }[]>`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'veiculo_usos'::regclass and contype = 'f'
        and conname in ('veiculo_usos_funcionario_fk', 'veiculo_usos_veiculo_fk')
      order by conname`
    expect(linhas.map(l => l.conname))
      .toEqual(['veiculo_usos_funcionario_fk', 'veiculo_usos_veiculo_fk'])
    expect(linhas[0].def)
      .toBe('FOREIGN KEY (tenant_id, funcionario_id) REFERENCES funcionarios(tenant_id, id) ON DELETE CASCADE')
    expect(linhas[1].def)
      .toBe('FOREIGN KEY (tenant_id, veiculo_id) REFERENCES veiculos(tenant_id, id) ON DELETE CASCADE')
  })

  it('a FK composta continua recusando uso que aponta para veiculo de OUTRO tenant', async () => {
    // O comportamento que a composicao protege, exercitado de verdade e nao
    // so lido de pg_constraint. Se a 015 tivesse recriado uma FK simples,
    // este insert passaria em silencio.
    const [outro] = await admin`
      insert into tenants (slug, nome) values ('teste-uso-cascade-2', 'Uso Cascade 2')
      on conflict (slug) do update set nome = excluded.nome returning id`
    const [vAlheio] = await admin`
      insert into veiculos (tenant_id, placa) values (${outro.id}, 'ALH-0001') returning id`
    const [fLocal] = await withTenant(sql, tenantId, tx => tx`
      insert into funcionarios (tenant_id, nome) values (${tenantId}, 'Motorista Local') returning id`)

    await expect(withTenant(sql, tenantId, tx => tx`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
      values (${tenantId}, ${vAlheio.id}, ${fLocal.id})`))
      .rejects.toMatchObject({ code: '23503' })

    await admin`delete from veiculos where id = ${vAlheio.id}`
  })
})
