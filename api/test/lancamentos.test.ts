import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { respostaDeErroPg, CATEGORIAS } from '../src/routes/lancamentos'

// Molde: test/clientes.test.ts. Cobre isolamento/RLS/constraints direto via
// withTenant — a camada HTTP (sanear, paraJson, autorizacao, codigos de
// status, validacao de categoria e de funcionario_id) fica em
// lancamentos.http.test.ts.

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
    insert into tenants (slug, nome) values ('teste-lanc-a', 'Tenant Lanc A')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [b] = await admin`
    insert into tenants (slug, nome) values ('teste-lanc-b', 'Tenant Lanc B')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantA = a.id; tenantB = b.id
  await admin`delete from lancamentos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from funcionarios where tenant_id in (${tenantA}, ${tenantB})`
})

afterAll(async () => { await sql?.end(); await admin?.end() })

describe('lancamentos', () => {
  it('cria e lista dentro do tenant', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor)
      values (${tenantA}, current_date, 'Gasolina', 100)`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select categoria from lancamentos`)
    expect(linhas.map(l => l.categoria)).toEqual(['Gasolina'])
  })

  it('nao enxerga lancamento de outro tenant', async () => {
    await withTenant(sql, tenantB, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor)
      values (${tenantB}, current_date, 'Frete', 50)`)
    const linhas = await withTenant(sql, tenantA, tx => tx`select categoria from lancamentos`)
    expect(linhas.map(l => l.categoria)).toEqual(['Gasolina'])
  })

  it('nao permite gravar para outro tenant (with check da policy de escrita)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into lancamentos (tenant_id, data, categoria, valor)
        values (${tenantB}, current_date, 'Outros', 10)`)
    ).rejects.toThrow()
  })

  it('rejeita valor negativo (lancamentos_valor_check)', async () => {
    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into lancamentos (tenant_id, data, categoria, valor)
        values (${tenantA}, current_date, 'Outros', -10)`)
    ).rejects.toThrow()
  })

  it('o driver devolve valor (numeric) como string — por isso paraJson existe', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor)
      values (${tenantA}, current_date, 'FGTS', 250.5)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select valor from lancamentos where categoria = 'FGTS'`)
    expect(typeof linha.valor).toBe('string')
    expect(Number(linha.valor)).toBe(250.5)
  })

  it('o driver devolve data (date) como objeto Date, nao como "AAAA-MM-DD" — por isso paraJson converte', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor)
      values (${tenantA}, '2024-03-05', 'INSS', 10)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select data from lancamentos where categoria = 'INSS'`)
    expect(linha.data).toBeInstanceOf(Date)
    expect(linha.data.toISOString().slice(0, 10)).toBe('2024-03-05')
  })

  it(
    'FK funcionario_id NAO respeita RLS entre tenants — por isso a rota HTTP ' +
    'valida com funcionarioPertenceAoTenant antes de gravar',
    async () => {
      // Prova ao vivo do motivo da checagem extra em src/routes/lancamentos.ts:
      // a integridade referencial do Postgres roda com privilegios do dono da
      // tabela e ignora RLS, entao esta insercao succede mesmo apontando para
      // um funcionario de outro tenant. Sem a checagem extra na rota HTTP, a
      // API deixaria vincular lancamento de um tenant a funcionario de outro.
      const [func] = await withTenant(sql, tenantB, tx => tx`
        insert into funcionarios (tenant_id, nome) values (${tenantB}, 'Funcionario Tenant B')
        returning id`)
      const linhas = await withTenant(sql, tenantA, tx => tx`
        insert into lancamentos (tenant_id, data, categoria, valor, funcionario_id)
        values (${tenantA}, current_date, 'Salário', 1000, ${func.id})
        returning funcionario_id`)
      expect(linhas[0].funcionario_id).toBe(func.id)
    },
  )

  it('CATEGORIAS bate com o prototipo (design/CRM Hortifruti.dc.html, LANC_CATS)', () => {
    expect(CATEGORIAS).toEqual([
      'Frete', 'Gasolina', 'Manutenção dos Carros', 'Salário', 'Adiantamento de salário',
      'Vale-alimentação', 'Vale-transporte', 'FGTS', 'INSS', 'Simples Nacional',
      'Parcelamento Impostos', 'Pagamento de conta de sócio', 'Outros',
    ])
  })
})

describe('respostaDeErroPg', () => {
  function erroPg(code: string, constraint_name?: string) {
    return { code, constraint_name }
  }

  it('23505 -> 409', () => {
    expect(respostaDeErroPg(erroPg('23505'))).toEqual({
      corpo: { erro: 'ja existe um lancamento com esses dados' },
      status: 409,
    })
  })

  it('23514 lancamentos_valor_check -> 400, mensagem especifica', () => {
    expect(respostaDeErroPg(erroPg('23514', 'lancamentos_valor_check'))).toEqual({
      corpo: { erro: 'valor nao pode ser negativo' },
      status: 400,
    })
  })

  it('23514 com constraint desconhecida -> 400, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23514', 'alguma_constraint_nova'))).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' },
      status: 400,
    })
  })

  it('outro codigo -> null (deixa a excecao original subir)', () => {
    expect(respostaDeErroPg(erroPg('23503'))).toBeNull()
  })
})
