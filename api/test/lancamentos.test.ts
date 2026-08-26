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
  await admin`delete from veiculo_usos where tenant_id in (${tenantA}, ${tenantB})`
  await admin`delete from veiculos where tenant_id in (${tenantA}, ${tenantB})`
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
    'o banco rejeita lancamento apontando funcionario de outro tenant',
    async () => {
      // Este teste ja afirmou o CONTRARIO, e por um bom motivo: a integridade
      // referencial do PostgreSQL roda com os privilegios do dono da tabela
      // referenciada e ignora RLS. Enquanto a chave era simples
      // (funcionario_id -> funcionarios.id), esta insercao era ACEITA em
      // silencio, e um lancamento de uma empresa podia apontar para o
      // funcionario de outra — corrompendo o total "a pagar" daquela pessoa.
      //
      // A migration 010 fechou isso incluindo o tenant na propria chave:
      // (tenant_id, funcionario_id) -> funcionarios(tenant_id, id). Agora o
      // banco recusa, e a recusa nao depende de nenhuma rota lembrar de
      // validar — vale tambem para acesso direto ao banco e script de
      // importacao.
      //
      // A checagem de funcionarioPertenceAoTenant em src/routes/lancamentos.ts
      // continua existindo e nao virou redundante: ela devolve 400 com
      // mensagem util em vez de deixar o banco estourar um 23503 cru.
      const [func] = await withTenant(sql, tenantB, tx => tx`
        insert into funcionarios (tenant_id, nome) values (${tenantB}, 'Funcionario Tenant B')
        returning id`)
      await expect(
        withTenant(sql, tenantA, tx => tx`
          insert into lancamentos (tenant_id, data, categoria, valor, funcionario_id)
          values (${tenantA}, current_date, 'Salário', 1000, ${func.id})`),
      ).rejects.toThrow()
    },
  )

  it('CATEGORIAS e a lista do prototipo (LANC_CATS) mais Multa, nesta ordem', () => {
    // A ordem e verificada, nao so o conteudo: ela e a ordem do `<select>` do
    // front (GET /categorias devolve este array como esta) e `categorias[0]`
    // e a categoria inicial de um lancamento novo. 'Multa' entra ao lado das
    // outras duas despesas de carro — foi pedida pelo dono do negocio junto
    // com a despesa por veiculo e nao existe no prototipo.
    expect(CATEGORIAS).toEqual([
      'Frete', 'Gasolina', 'Manutenção dos Carros', 'Multa', 'Salário', 'Adiantamento de salário',
      'Vale-alimentação', 'Vale-transporte', 'FGTS', 'INSS', 'Simples Nacional',
      'Parcelamento Impostos', 'Pagamento de conta de sócio', 'Outros',
    ])
  })

  it('Frete continua na lista de categorias — o que ele nao aceita e veiculo, nao e existir', () => {
    expect(CATEGORIAS).toContain('Frete')
  })
})

/**
 * A FK COMPOSTA DE VEICULO, do lado do banco e com DOIS TENANTS DE VERDADE.
 *
 * Este e o ponto inteiro da migration 010 aplicado a coluna nova de 013. A
 * verificacao de chave estrangeira do PostgreSQL roda com os privilegios do
 * dono da tabela referenciada e IGNORA row level security — com uma FK
 * simples `veiculo_id -> veiculos(id)`, o insert abaixo seria aceito em
 * silencio e um lancamento da empresa A apontaria para o carro da empresa B,
 * fazendo a despesa aparecer no "gasto do veiculo" da empresa errada.
 *
 * Os dois tenants sao reais (linhas em `tenants`, veiculos proprios em cada
 * um), e os inserts passam por `withTenant` — a mesma porta que a API usa.
 * Nao ha mock: se a constraint composta for trocada por uma simples, este
 * teste passa a NAO lancar e falha.
 */
describe('lancamentos.veiculo_id — FK composta com tenant_id (isolamento entre empresas)', () => {
  it('o banco REJEITA lancamento do tenant A apontando veiculo do tenant B', async () => {
    const [veiculoB] = await withTenant(sql, tenantB, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantB}, 'FKL-0001') returning id`)

    await expect(
      withTenant(sql, tenantA, tx => tx`
        insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
        values (${tenantA}, current_date, 'Gasolina', 200, ${veiculoB.id})`),
    ).rejects.toThrow()
  })

  it('o banco ACEITA o mesmo lancamento quando o veiculo e do proprio tenant (prova que nao rejeita tudo)', async () => {
    const [veiculoA] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'FKL-0002') returning id`)

    await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
      values (${tenantA}, current_date, 'Gasolina', 200, ${veiculoA.id})`)

    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select veiculo_id from lancamentos where veiculo_id = ${veiculoA.id}`)
    expect(linha.veiculo_id).toBe(veiculoA.id)
  })

  it('o mesmo pelo lado do UPDATE: apontar para o veiculo de outro tenant e recusado', async () => {
    const [veiculoB] = await withTenant(sql, tenantB, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantB}, 'FKL-0003') returning id`)
    const [lanc] = await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor)
      values (${tenantA}, current_date, 'Multa', 130) returning id`)

    await expect(
      withTenant(sql, tenantA, tx => tx`
        update lancamentos set veiculo_id = ${veiculoB.id} where id = ${lanc.id}`),
    ).rejects.toThrow()
  })

  it('lancamento sem veiculo continua valido (MATCH SIMPLE dispensa a checagem quando ha NULL)', async () => {
    await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
      values (${tenantA}, current_date, 'Simples Nacional', 90, null)`)
    const [linha] = await withTenant(sql, tenantA, tx => tx`
      select veiculo_id from lancamentos where categoria = 'Simples Nacional'`)
    expect(linha.veiculo_id).toBeNull()
  })
})

/**
 * `on delete set null` (013) — a decisao de o que acontece com a despesa
 * quando o carro sai do cadastro. A despesa aconteceu: o dinheiro saiu, e o
 * total de custos do periodo nao pode mudar porque alguem arrumou a frota.
 * O que se perde e a ATRIBUICAO.
 */
describe('lancamentos.veiculo_id — excluir o veiculo nao apaga nem barra a despesa', () => {
  it('excluir o veiculo zera veiculo_id e preserva o lancamento e o valor', async () => {
    const [veiculo] = await withTenant(sql, tenantA, tx => tx`
      insert into veiculos (tenant_id, placa) values (${tenantA}, 'SNL-0001') returning id`)
    const [lanc] = await withTenant(sql, tenantA, tx => tx`
      insert into lancamentos (tenant_id, data, categoria, valor, veiculo_id)
      values (${tenantA}, current_date, 'Manutenção dos Carros', 480, ${veiculo.id}) returning id`)

    await withTenant(sql, tenantA, tx => tx`delete from veiculos where id = ${veiculo.id}`)

    const [depois] = await withTenant(sql, tenantA, tx => tx`
      select veiculo_id, valor from lancamentos where id = ${lanc.id}`)
    expect(depois).toBeDefined()
    expect(depois.veiculo_id).toBeNull()
    expect(Number(depois.valor)).toBe(480)
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
