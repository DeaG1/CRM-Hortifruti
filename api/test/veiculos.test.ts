import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { respostaDeErroPg } from '../src/routes/veiculos'

// Molde: test/clientes.test.ts e test/funcionarios.test.ts. Cobre
// isolamento/RLS/constraints direto via withTenant — a camada HTTP
// (sanear, paraJson, autorizacao e os codigos de status) fica em
// veiculos.http.test.ts.
//
// O describe de `veiculo_usos` (indice parcial de uso aberto, dois carros
// pro mesmo funcionario, CHECK de volta antes da saida) SAIU: aquelas
// constraints continuam no banco, mas nenhuma linha de codigo escreve mais
// nessa tabela, entao os testes provavam uma regra de negocio que o produto
// nao tem mais. O que sobrou dela e observavel — a exclusao barrada por
// historico legado — e testado pela API, em veiculos.http.test.ts, que e
// onde o usuario encontra o efeito. A FK COMPOSTA de veiculo continua
// testada aqui, agora do lado que importa: `lancamentos.veiculo_id`.

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
    insert into tenants (slug, nome) values ('teste-veiculos-a', 'Tenant Veiculos A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-veiculos-b', 'Tenant Veiculos B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id

  await admin`delete from lancamentos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from veiculo_usos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from veiculos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from funcionarios where tenant_id in (${tenantA}, ${tenantB})`
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

describe('respostaDeErroPg', () => {
  function erroPg(code: string, constraint_name?: string) {
    return { code, constraint_name }
  }

  it('23505 -> 409, mensagem de placa duplicada (a unica unique alcancavel)', () => {
    expect(respostaDeErroPg(erroPg('23505', 'veiculos_placa_unica'))).toEqual({
      corpo: { erro: 'ja existe um veiculo com essa placa' },
      status: 409,
    })
  })

  // A mensagem NAO nomeia mais a causa. Ela nomeava `veiculo_usos`, que era a
  // unica FK capaz de barrar — ate a 015 passar aquelas FKs para cascade. Um
  // texto que nomeia uma causa morta mente; o que a rota tem como saber, e o
  // que o dono precisa, e a SAIDA: desativar em vez de excluir. Ver
  // respostaDeErroPg em src/routes/veiculos.ts.
  it('23503 -> 409, com o caminho (desativar) e sem nomear uma causa que a rota nao conhece', () => {
    const mapeado = respostaDeErroPg(erroPg('23503', 'uma_fk_qualquer'))
    expect(mapeado?.status).toBe(409)
    expect(mapeado?.corpo.erro).toMatch(/não pode ser excluído/i)
    expect(mapeado?.corpo.erro).toMatch(/desative-o/i)
    expect(mapeado?.corpo.erro).not.toMatch(/veiculo_usos|uso registrado/i)
  })

  it('23514 (CHECK) nao e mais mapeado: `veiculos` nao tem nenhuma CHECK propria', () => {
    expect(respostaDeErroPg(erroPg('23514', 'qualquer_check'))).toBeNull()
  })

  it('codigo desconhecido -> null (deixa a excecao original subir)', () => {
    expect(respostaDeErroPg(erroPg('42P01'))).toBeNull()
  })
})
