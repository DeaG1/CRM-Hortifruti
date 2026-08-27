import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { respostaDeErroPg } from '../src/routes/funcionarios'

// Molde: test/clientes.test.ts. Cobre isolamento/RLS/constraints direto via
// withTenant — a camada HTTP (sanear, paraJson, autorizacao, codigos de
// status) fica em funcionarios.http.test.ts.

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-func-a', 'Tenant Func A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-func-b', 'Tenant Func B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from funcionarios where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('funcionarios', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into funcionarios (tenant_id, nome, cargo) values (${tenantA}, 'Joao Motorista', 'Motorista')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from funcionarios`)
    expect(linhas.map(l => l.nome)).toEqual(['Joao Motorista'])
  })

  it('nao enxerga funcionario de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into funcionarios (tenant_id, nome) values (${tenantB}, 'Funcionario B')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select nome from funcionarios`)
    expect(linhas.map(l => l.nome)).toEqual(['Joao Motorista'])
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into funcionarios (tenant_id, nome) values (${tenantB}, 'Invasor via Funcionarios')`)
    ).rejects.toThrow()
  })

  it('permite o mesmo nome em tenants diferentes e no mesmo tenant (sem constraint unique)', async () => {
    // Diferente de clientes: funcionarios nao tem unique(tenant_id, lower(nome)).
    // Dois funcionarios com o mesmo nome no mesmo tenant e um cenario real
    // (duas pessoas chamadas "Joao" na equipe).
    await withTenant(sql, tenantA, tx => tx`
      insert into funcionarios (tenant_id, nome) values (${tenantA}, 'Joao Motorista')`)
    const linhas = await withTenant(sql, tenantA, tx =>
      tx`select nome from funcionarios where nome = 'Joao Motorista'`)
    expect(linhas.length).toBe(2)
  })

  it('rejeita salario negativo (funcionarios_salario_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into funcionarios (tenant_id, nome, salario) values (${tenantA}, 'Salario Negativo', -100)`)
    ).rejects.toThrow()
  })

  it('rejeita dia_pag fora de 1..28 (funcionarios_dia_pag_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into funcionarios (tenant_id, nome, dia_pag) values (${tenantA}, 'Dia Pag Invalido', 29)`)
    ).rejects.toThrow()
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into funcionarios (tenant_id, nome, dia_pag) values (${tenantA}, 'Dia Pag Invalido 2', 0)`)
    ).rejects.toThrow()
  })

  it('o driver devolve salario (numeric) como string — por isso paraJson existe', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into funcionarios (tenant_id, nome, salario) values (${tenantA}, 'Com Salario', 3500)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select salario from funcionarios where nome = 'Com Salario'`)
    expect(typeof linha.salario).toBe('string')
    expect(Number(linha.salario)).toBe(3500)
  })

  it('ativo default true', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into funcionarios (tenant_id, nome) values (${tenantA}, 'Funcionario Default')`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select ativo from funcionarios where nome = 'Funcionario Default'`)
    expect(linha.ativo).toBe(true)
  })
})

// respostaDeErroPg nao tem como ser exercitada por HTTP (funcionarios nao
// tem constraint unique hoje), entao o mapeamento de 23505 e testado aqui
// direto, igual test/respostaDeErroPg.test.ts faz para clientes.
describe('respostaDeErroPg', () => {
  function erroPg(code: string, constraint_name?: string) {
    return { code, constraint_name }
  }

  it('23505 -> 409', () => {
    expect(respostaDeErroPg(erroPg('23505'))).toEqual({
      corpo: { erro: 'ja existe um funcionario com esse nome' },
      status: 409,
    })
  })

  it('23514 funcionarios_salario_check -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23514', 'funcionarios_salario_check'))).toEqual({
      corpo: { erro: 'salario nao pode ser negativo' },
      status: 400,
    })
  })

  it('23514 funcionarios_dia_pag_check -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23514', 'funcionarios_dia_pag_check'))).toEqual({
      corpo: { erro: 'dia_pag deve estar entre 1 e 28' },
      status: 400,
    })
  })

  it('23514 com constraint desconhecida -> 400, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23514', 'alguma_constraint_nova'))).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' },
      status: 400,
    })
  })

  /**
   * 23503 (violacao de FK) NAO era mapeado, e a rota DELETE nem try/catch
   * tinha — as duas coisas juntas sao o defeito que prendeu o dono do negocio.
   * `veiculo_usos_funcionario_fk` era `on delete restrict` (011) sobre uma
   * tabela cuja tela foi removida (7b841b1); duas linhas esquecidas la
   * travaram a exclusao do funcionario e a unica coisa que chegava a tela era
   * 500 "erro interno" traduzido como "Não foi possível excluir. Tente
   * novamente."
   *
   * A 015 tirou aquele bloqueio especifico (cascade), mas o mapeamento fica —
   * ele e a rede para a proxima FK. Por isso o teste nao amarra o texto a uma
   * causa: amarra ao que o dono precisa ler, que e a SAIDA.
   */
  it('23503 -> 409 com o caminho (desativar), em vez de deixar virar 500', () => {
    const mapeado = respostaDeErroPg(erroPg('23503', 'uma_fk_qualquer'))
    expect(mapeado?.status).toBe(409)
    expect(mapeado?.corpo.erro).toMatch(/não pode ser excluído/i)
    expect(mapeado?.corpo.erro).toMatch(/desative-o/i)
    expect(mapeado?.corpo.erro).not.toMatch(/veiculo_usos/i)
  })

  it('outro codigo -> null (deixa a excecao original subir)', () => {
    expect(respostaDeErroPg(erroPg('42P01'))).toBeNull()
  })
})
