import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { respostaDeErroPg } from '../src/routes/veiculos'

// Molde: test/clientes.test.ts e test/funcionarios.test.ts. Cobre
// isolamento/RLS/constraints direto via withTenant — a camada HTTP
// (sanear, paraJson, autorizacao, codigos de status, e o 409 de check-in
// duplicado via requisicoes concorrentes de verdade) fica em
// veiculos.http.test.ts.

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantA: string, tenantB: string
let funcionarioA1: string, funcionarioA2: string, funcionarioB: string

beforeAll(async () => {
  admin = criarPool(ADMIN); sql = criarPool(URL)
  const [a] = await admin`
    insert into tenants (slug, nome) values ('teste-veiculos-a', 'Tenant Veiculos A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-veiculos-b', 'Tenant Veiculos B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from veiculo_usos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from veiculos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from funcionarios where tenant_id in (${tenantA}, ${tenantB})`

  const [f1] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantA}, 'Joao Motorista') returning id`
  const [f2] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantA}, 'Maria Motorista') returning id`
  const [fb] = await admin`
    insert into funcionarios (tenant_id, nome) values (${tenantB}, 'Funcionario B') returning id`
  funcionarioA1 = f1.id; funcionarioA2 = f2.id; funcionarioB = fb.id
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('veiculos', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa, modelo) values (${tenantA}, 'ABC-1234', 'Fiorino')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select placa from veiculos`)
    expect(linhas.map(l => l.placa)).toEqual(['ABC-1234'])
  })

  it('nao enxerga veiculo de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantB}, 'ZZZ-9999')`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select placa from veiculos`)
    expect(linhas.map(l => l.placa)).toEqual(['ABC-1234'])
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculos (tenant_id, placa) values (${tenantB}, 'INV-0001')`)
    ).rejects.toThrow()
  })

  it('rejeita placa duplicada no mesmo tenant (case-insensitive)', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'DUP-0001')`)
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculos (tenant_id, placa) values (${tenantA}, 'dup-0001')`)
    ).rejects.toThrow()
  })

  it('permite a mesma placa em tenants diferentes', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'CMP-0001')`)
    await withTenant(sql, tenantB, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantB}, 'CMP-0001')`)
    const linhas = await withTenant(sql, tenantB, tx =>
      tx`select placa from veiculos where placa = 'CMP-0001'`)
    expect(linhas.length).toBe(1)
  })

  it('ativo default true', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'ATV-0001')`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select ativo from veiculos where placa = 'ATV-0001'`)
    expect(linha.ativo).toBe(true)
  })
})

describe('veiculo_usos — a regra central: indice parcial impede dois usos abertos do mesmo carro', () => {
  it('abre um uso, tenta abrir um segundo no mesmo carro -> rejeitado', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'IDX-0001') returning id`)

    await withTenant(sql, tenantA, tx => tx`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
      values (${tenantA}, ${veiculo.id}, ${funcionarioA1})`)

    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
        values (${tenantA}, ${veiculo.id}, ${funcionarioA2})`)
    ).rejects.toThrow()
  })

  it('depois de devolvido (volta_em preenchido), o mesmo carro pode ser pego de novo', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'IDX-0002') returning id`)

    const [uso1] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
      values (${tenantA}, ${veiculo.id}, ${funcionarioA1}) returning id`)

    await withTenant(sql, tenantA, tx => tx`
      update veiculo_usos set volta_em = now() where id = ${uso1.id}`)

    // Agora que nao ha uso aberto para este carro, um segundo insert e aceito.
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
        values (${tenantA}, ${veiculo.id}, ${funcionarioA2})`)
    ).resolves.not.toThrow()

    const abertos = await withTenant(sql, tenantA, tx => tx`
      select id from veiculo_usos where veiculo_id = ${veiculo.id} and volta_em is null`)
    expect(abertos.length).toBe(1)
  })

  it('o mesmo funcionario PODE ter dois carros em aberto ao mesmo tempo', async () => {
    const [carro1] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'DBL-0001') returning id`)
    const [carro2] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'DBL-0002') returning id`)

    await withTenant(sql, tenantA, tx => tx`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
      values (${tenantA}, ${carro1.id}, ${funcionarioA1})`)

    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
        values (${tenantA}, ${carro2.id}, ${funcionarioA1})`)
    ).resolves.not.toThrow()

    const abertos = await withTenant(sql, tenantA, tx => tx`
      select veiculo_id from veiculo_usos
      where funcionario_id = ${funcionarioA1} and volta_em is null
        and veiculo_id in (${carro1.id}, ${carro2.id})`)
    expect(abertos.length).toBe(2)
  })

  it('rejeita funcionario_id de outro tenant (FK composta com tenant_id)', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'FKF-0001') returning id`)
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
        values (${tenantA}, ${veiculo.id}, ${funcionarioB})`)
    ).rejects.toThrow()
  })

  it('rejeita veiculo_id de outro tenant (FK composta com tenant_id)', async () => {
    const [veiculoB] = await withTenant(sql, tenantB, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantB}, 'FKV-0001') returning id`)
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id)
        values (${tenantA}, ${veiculoB.id}, ${funcionarioA1})`)
    ).rejects.toThrow()
  })

  it('rejeita volta_em anterior a saida_em (veiculo_usos_volta_apos_saida)', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'CHK-0001') returning id`)
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id, saida_em, volta_em)
        values (${tenantA}, ${veiculo.id}, ${funcionarioA1}, now(), now() - interval '1 hour')`)
    ).rejects.toThrow()
  })

  it('excluir um veiculo com historico de uso e barrado (veiculo_usos_veiculo_fk, on delete restrict)', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'RST-0001') returning id`)
    await withTenant(sql, tenantA, tx => tx`
      insert into veiculo_usos (tenant_id, veiculo_id, funcionario_id, volta_em)
      values (${tenantA}, ${veiculo.id}, ${funcionarioA1}, now())`)
    await expect(
      withTenant(sql, tenantA, tx => tx`delete from veiculos where id = ${veiculo.id}`)
    ).rejects.toThrow()
  })
})

// respostaDeErroPg nao tem como disparar TODOS os ramos por HTTP com a
// mesma facilidade (em especial o CHECK de volta_apos_saida, que a API
// nunca viola porque sempre fecha com now()) — testado aqui direto, mesmo
// padrao de test/funcionarios.test.ts e test/respostaDeErroPg.test.ts.
describe('respostaDeErroPg', () => {
  function erroPg(code: string, constraint_name?: string) {
    return { code, constraint_name }
  }

  it('23505 veiculos_placa_unica -> 409, mensagem de placa duplicada', () => {
    expect(respostaDeErroPg(erroPg('23505', 'veiculos_placa_unica'))).toEqual({
      corpo: { erro: 'ja existe um veiculo com essa placa' },
      status: 409,
    })
  })

  it('23505 veiculo_usos_aberto_unico -> 409, mensagem de carro ja em uso', () => {
    expect(respostaDeErroPg(erroPg('23505', 'veiculo_usos_aberto_unico'))).toEqual({
      corpo: { erro: 'este veiculo ja esta em uso' },
      status: 409,
    })
  })

  it('23505 com constraint desconhecida -> 409, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23505', 'alguma_constraint_nova'))).toEqual({
      corpo: { erro: 'registro duplicado' },
      status: 409,
    })
  })

  it('23514 veiculo_usos_volta_apos_saida -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23514', 'veiculo_usos_volta_apos_saida'))).toEqual({
      corpo: { erro: 'volta nao pode ser antes da saida' },
      status: 400,
    })
  })

  it('23514 com constraint desconhecida -> 400, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23514', 'alguma_constraint_nova'))).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' },
      status: 400,
    })
  })

  it('23503 veiculo_usos_veiculo_fk -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23503', 'veiculo_usos_veiculo_fk'))).toEqual({
      corpo: { erro: 'veiculo nao encontrado' },
      status: 400,
    })
  })

  it('23503 veiculo_usos_funcionario_fk -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23503', 'veiculo_usos_funcionario_fk'))).toEqual({
      corpo: { erro: 'funcionario nao encontrado' },
      status: 400,
    })
  })

  it('23503 com constraint desconhecida -> 400, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23503', 'alguma_fk_nova'))).toEqual({
      corpo: { erro: 'referencia invalida' },
      status: 400,
    })
  })

  it('codigo desconhecido -> null (deixa a excecao original subir)', () => {
    expect(respostaDeErroPg(erroPg('42P01'))).toBeNull()
  })
})
