import { describe, it, expect } from 'vitest'
import {
  nomeVeiculo,
  lancamentosDoVeiculo,
  gastoDoVeiculo,
  gastoPorCategoria,
  derivarVeiculos,
  estatisticasVeiculos,
  placaDeVeiculo,
  type Veiculo,
} from './veiculos'
import type { Lancamento } from './lancamentos'

// Este arquivo testava horas em aberto e o limite de 12h do check-in/check-out.
// A funcionalidade saiu (o dono do negócio usou e recusou), as funções saíram
// junto, e os testes delas com elas. O que entra é a aritmética da despesa por
// veículo — molde de derive/funcionarios.test.ts.

const veiculo = (over: Partial<Veiculo> = {}): Veiculo => ({
  id: 'v-1', placa: 'ABC-1234', modelo: 'Fiorino', marca: 'Fiat', ano: 2020,
  ativo: true, obs: '', ...over,
})

const lanc = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l-1', data: '2026-06-10', categoria: 'Gasolina', descricao: '', valor: 0,
  funcionario_id: null, veiculo_id: 'v-1', ...over,
})

describe('nomeVeiculo', () => {
  it('junta marca e modelo', () => {
    expect(nomeVeiculo({ placa: 'ABC-1234', marca: 'Fiat', modelo: 'Fiorino' })).toBe('Fiat Fiorino')
  })

  it('usa só o que existe quando falta marca ou modelo', () => {
    expect(nomeVeiculo({ placa: 'ABC-1234', marca: '', modelo: 'Kombi' })).toBe('Kombi')
    expect(nomeVeiculo({ placa: 'ABC-1234', marca: 'Fiat', modelo: '' })).toBe('Fiat')
  })

  it('cai para a placa quando não há marca nem modelo — nunca vazio', () => {
    expect(nomeVeiculo({ placa: 'ABC-1234', marca: '', modelo: '' })).toBe('ABC-1234')
  })
})

describe('lancamentosDoVeiculo', () => {
  it('traz só os lançamentos deste veículo', () => {
    const lista = [
      lanc({ id: 'a', veiculo_id: 'v-1' }),
      lanc({ id: 'b', veiculo_id: 'v-2' }),
      lanc({ id: 'c', veiculo_id: null }),
    ]
    expect(lancamentosDoVeiculo(lista, 'v-1').map(l => l.id)).toEqual(['a'])
  })

  it('recorta pelo período e devolve do mais recente pro mais antigo', () => {
    const lista = [
      lanc({ id: 'maio', data: '2026-05-20' }),
      lanc({ id: 'junho-1', data: '2026-06-02' }),
      lanc({ id: 'junho-2', data: '2026-06-28' }),
    ]
    expect(lancamentosDoVeiculo(lista, 'v-1', '2026-06').map(l => l.id)).toEqual(['junho-2', 'junho-1'])
  })

  it("'all' não recorta nada", () => {
    const lista = [
      lanc({ id: 'maio', data: '2026-05-20' }),
      lanc({ id: 'junho', data: '2026-06-02' }),
    ]
    expect(lancamentosDoVeiculo(lista, 'v-1', 'all').map(l => l.id)).toEqual(['junho', 'maio'])
  })

  it('não filtra por categoria: o histórico mostra tudo que o banco atribui a este carro', () => {
    // A API já garante que só as categorias de veículo chegam com veiculo_id
    // preenchido. Filtrar de novo aqui esconderia uma linha que o gasto conta
    // — e o total não bateria com o que está listado.
    const lista = [lanc({ id: 'estranho', categoria: 'Outros', valor: 40 })]
    expect(lancamentosDoVeiculo(lista, 'v-1').map(l => l.id)).toEqual(['estranho'])
  })

  it('não muta a lista recebida', () => {
    const lista = [lanc({ id: 'a', data: '2026-06-01' }), lanc({ id: 'b', data: '2026-06-20' })]
    lancamentosDoVeiculo(lista, 'v-1')
    expect(lista.map(l => l.id)).toEqual(['a', 'b'])
  })
})

describe('gastoDoVeiculo', () => {
  it('soma os valores', () => {
    expect(gastoDoVeiculo([lanc({ valor: 250 }), lanc({ valor: 130.5 })])).toBe(380.5)
  })

  it('lista vazia é zero MEDIDO, não travessão — quem decide isso é a tela', () => {
    expect(gastoDoVeiculo([])).toBe(0)
  })

  it('valor não numérico conta como zero em vez de virar NaN', () => {
    expect(gastoDoVeiculo([lanc({ valor: 100 }), lanc({ valor: undefined as never })])).toBe(100)
  })
})

describe('gastoPorCategoria', () => {
  it('abre o total nas três categorias de despesa de carro', () => {
    const lista = [
      lanc({ categoria: 'Gasolina', valor: 300 }),
      lanc({ categoria: 'Gasolina', valor: 200 }),
      lanc({ categoria: 'Manutenção dos Carros', valor: 480 }),
      lanc({ categoria: 'Multa', valor: 130 }),
    ]
    expect(gastoPorCategoria(lista)).toEqual({
      'Gasolina': 500,
      'Manutenção dos Carros': 480,
      'Multa': 130,
    })
  })

  it('categoria sem gasto vem com zero, não ausente', () => {
    expect(gastoPorCategoria([lanc({ categoria: 'Multa', valor: 130 })])).toEqual({
      'Gasolina': 0,
      'Manutenção dos Carros': 0,
      'Multa': 130,
    })
  })

  it('categoria inesperada ganha chave própria — o total continua sendo a soma das partes', () => {
    const saida = gastoPorCategoria([lanc({ categoria: 'Frete', valor: 90 })])
    expect(saida['Frete']).toBe(90)
    expect(Object.values(saida).reduce((a, b) => a + b, 0)).toBe(90)
  })
})

describe('derivarVeiculos', () => {
  it('calcula o gasto e o histórico de cada veículo no período', () => {
    const veiculos = [veiculo({ id: 'v-1' }), veiculo({ id: 'v-2', placa: 'XYZ-9876' })]
    const lancamentos = [
      lanc({ id: 'a', veiculo_id: 'v-1', valor: 300, data: '2026-06-02' }),
      lanc({ id: 'b', veiculo_id: 'v-1', valor: 200, data: '2026-05-02' }),
      lanc({ id: 'c', veiculo_id: 'v-2', valor: 90, data: '2026-06-15' }),
    ]
    const [v1, v2] = derivarVeiculos(veiculos, lancamentos, '2026-06')
    expect(v1.gasto).toBe(300)
    expect(v1.historico?.map(l => l.id)).toEqual(['a'])
    expect(v2.gasto).toBe(90)
  })

  it('veículo SEM gasto no período fica com R$ 0 medido e histórico vazio — e continua na lista', () => {
    const derivados = derivarVeiculos([veiculo({ id: 'v-1' })], [], '2026-07')
    expect(derivados.length).toBe(1)
    expect(derivados[0].gasto).toBe(0)
    expect(derivados[0].historico).toEqual([])
  })

  it('período sem nenhum lançamento não some com o CADASTRO', () => {
    const veiculos = [veiculo({ id: 'v-1' }), veiculo({ id: 'v-2', placa: 'XYZ-9876' })]
    const lancamentos = [lanc({ veiculo_id: 'v-1', valor: 300, data: '2026-06-02' })]
    const derivados = derivarVeiculos(veiculos, lancamentos, '2026-12')
    expect(derivados.map(v => v.placa)).toEqual(['ABC-1234', 'XYZ-9876'])
    expect(derivados.every(v => v.gasto === 0)).toBe(true)
  })

  it('lançamentos INDISPONÍVEIS (null) dão gasto null e histórico null, nunca zero', () => {
    const derivados = derivarVeiculos([veiculo()], null, '2026-06')
    expect(derivados[0].gasto).toBeNull()
    expect(derivados[0].historico).toBeNull()
    // O cadastro sai inteiro mesmo assim.
    expect(derivados[0].placa).toBe('ABC-1234')
    expect(derivados[0].ativo).toBe(true)
  })

  it('null (indisponível) e [] (carregou vazio) são resultados DIFERENTES', () => {
    expect(derivarVeiculos([veiculo()], null)[0].gasto).toBeNull()
    expect(derivarVeiculos([veiculo()], [])[0].gasto).toBe(0)
  })
})

describe('estatisticasVeiculos', () => {
  it('conta o cadastro e os ativos sem depender de lançamento nem de período', () => {
    const stats = estatisticasVeiculos(
      [veiculo({ id: 'v-1' }), veiculo({ id: 'v-2', ativo: false })], null, '2026-06',
    )
    expect(stats.quantidade).toBe(2)
    expect(stats.ativos).toBe(1)
  })

  it('soma o gasto de TODOS os veículos no período, aberto por categoria', () => {
    const lancamentos = [
      lanc({ veiculo_id: 'v-1', categoria: 'Gasolina', valor: 300, data: '2026-06-02' }),
      lanc({ veiculo_id: 'v-2', categoria: 'Multa', valor: 130, data: '2026-06-09' }),
      lanc({ veiculo_id: 'v-1', categoria: 'Gasolina', valor: 999, data: '2026-05-02' }),
    ]
    const stats = estatisticasVeiculos([veiculo()], lancamentos, '2026-06')
    expect(stats.gastoPeriodo).toBe(430)
    expect(stats.porCategoria).toEqual({ 'Gasolina': 300, 'Manutenção dos Carros': 0, 'Multa': 130 })
  })

  it('lançamento SEM veículo não entra: o total dos cartões é o que aparece nas linhas', () => {
    const lancamentos = [
      lanc({ veiculo_id: 'v-1', valor: 300 }),
      lanc({ veiculo_id: null, categoria: 'Gasolina', valor: 5000 }),
    ]
    expect(estatisticasVeiculos([veiculo()], lancamentos, 'all').gastoPeriodo).toBe(300)
  })

  it('lançamentos indisponíveis dão null nos dois — nunca zero nem objeto zerado', () => {
    const stats = estatisticasVeiculos([veiculo()], null, '2026-06')
    expect(stats.gastoPeriodo).toBeNull()
    expect(stats.porCategoria).toBeNull()
  })

  it('período sem movimento dá zero MEDIDO, não null', () => {
    const stats = estatisticasVeiculos([veiculo()], [lanc({ valor: 300, data: '2026-06-01' })], '2026-07')
    expect(stats.gastoPeriodo).toBe(0)
    expect(stats.porCategoria).toEqual({ 'Gasolina': 0, 'Manutenção dos Carros': 0, 'Multa': 0 })
  })

  it('o total do período é a soma das categorias', () => {
    const lancamentos = [
      lanc({ categoria: 'Gasolina', valor: 300 }),
      lanc({ categoria: 'Manutenção dos Carros', valor: 480 }),
      lanc({ categoria: 'Multa', valor: 130 }),
    ]
    const stats = estatisticasVeiculos([veiculo()], lancamentos, 'all')
    const somaDasPartes = Object.values(stats.porCategoria!).reduce((a, b) => a + b, 0)
    expect(stats.gastoPeriodo).toBe(somaDasPartes)
    expect(stats.gastoPeriodo).toBe(910)
  })
})

describe('placaDeVeiculo — a etiqueta que o histórico do funcionário usa', () => {
  const frota = [veiculo({ id: 'v-1', placa: 'ABC-1234' }), veiculo({ id: 'v-2', placa: 'XYZ-9876' })]

  it('acha a placa pelo id', () => {
    expect(placaDeVeiculo(frota, 'v-2')).toBe('XYZ-9876')
  })

  it('sem veículo no lançamento: null (a maioria dos lançamentos)', () => {
    expect(placaDeVeiculo(frota, null)).toBeNull()
    expect(placaDeVeiculo(frota, '')).toBeNull()
    expect(placaDeVeiculo(frota, undefined)).toBeNull()
  })

  it('lista indisponível: null — nunca uma placa inventada', () => {
    expect(placaDeVeiculo(null, 'v-1')).toBeNull()
  })

  it('id que não está na lista (carro excluído do cadastro): null', () => {
    expect(placaDeVeiculo(frota, 'v-99')).toBeNull()
  })

  it('lista vazia: null, e não estoura', () => {
    expect(placaDeVeiculo([], 'v-1')).toBeNull()
  })
})

/**
 * O GASTO DO CARRO NÃO SABE DE FUNCIONÁRIO, e é isso que estes testes fixam: a
 * multa foi paga ao órgão de trânsito, é custo daquele veículo, e continua
 * inteira na conta dele independentemente de quem reembolsa pela folha. Quem
 * subtrai do salário é derive/funcionarios.ts, do outro lado.
 */
describe('gasto do veículo — a multa conta inteira, com ou sem funcionário vinculado', () => {
  const multaComCulpado = lanc({
    id: 'm1', categoria: 'Multa', valor: 293.47, data: '2026-06-12',
    veiculo_id: 'v-1', funcionario_id: 'f-1',
  })
  const multaSemCulpado = { ...multaComCulpado, id: 'm2', funcionario_id: null }

  it('lancamentosDoVeiculo filtra por veículo, não por funcionário', () => {
    expect(lancamentosDoVeiculo([multaComCulpado], 'v-1', '2026-06')).toHaveLength(1)
  })

  it('o gasto é o mesmo com e sem funcionário vinculado', () => {
    const comCulpado = gastoDoVeiculo(lancamentosDoVeiculo([multaComCulpado], 'v-1', '2026-06'))
    const semCulpado = gastoDoVeiculo(lancamentosDoVeiculo([multaSemCulpado], 'v-1', '2026-06'))
    expect(comCulpado).toBe(293.47)
    expect(semCulpado).toBe(293.47)
  })

  it('a abertura por categoria também não muda', () => {
    expect(gastoPorCategoria([multaComCulpado]).Multa).toBe(293.47)
    expect(gastoPorCategoria([multaSemCulpado]).Multa).toBe(293.47)
  })

  it('derivarVeiculos e os cartões do topo somam a multa vinculada como qualquer outra', () => {
    const [derivado] = derivarVeiculos([veiculo({ id: 'v-1' })], [multaComCulpado], '2026-06')
    expect(derivado.gasto).toBe(293.47)
    expect(derivado.historico).toHaveLength(1)

    const stats = estatisticasVeiculos([veiculo({ id: 'v-1' })], [multaComCulpado], '2026-06')
    expect(stats.gastoPeriodo).toBe(293.47)
    expect(stats.porCategoria?.Multa).toBe(293.47)
  })
})
