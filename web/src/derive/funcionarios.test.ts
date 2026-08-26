import { describe, it, expect } from 'vitest'
import {
  proximoPagamento,
  statusPagamento,
  ultimoSalarioPago,
  derivarFuncionarios,
  parseDataIso,
  saldoFuncionario,
  lancamentosDoFuncionario,
  descricaoSalario,
  estatisticasFuncionarios,
  type Funcionario,
  type LancamentoParaFuncionario,
} from './funcionarios'

const lanc = (over: Partial<LancamentoParaFuncionario> = {}): LancamentoParaFuncionario => ({
  id: 'l1', data: '2026-06-15', categoria: 'Salário', descricao: '', valor: 0,
  funcionario_id: '1', veiculo_id: null, ...over,
})

const funcionario = (over: Partial<Funcionario> = {}): Funcionario => ({
  id: '1', nome: 'João Pereira', cargo: 'Motorista', tel: '(41) 99900-1122',
  salario: 2200, dia_pag: 5, ativo: true, ...over,
})

describe('parseDataIso', () => {
  it('interpreta AAAA-MM-DD como data local a meia-noite', () => {
    const d = parseDataIso('2026-06-15')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(5) // junho = indice 5
    expect(d?.getDate()).toBe(15)
  })
  it('devolve null pra formato invalido', () => {
    expect(parseDataIso('15/06/2026')).toBeNull()
    expect(parseDataIso('')).toBeNull()
    expect(parseDataIso(null)).toBeNull()
    expect(parseDataIso(undefined)).toBeNull()
  })
})

describe('proximoPagamento — sem historico (nunca foi pago)', () => {
  it('dia de pagamento ainda nao chegado neste mes: usa este mes', () => {
    // hoje = 10/06, dia de pagamento = 20 -> ainda nao chegou
    const hoje = new Date(2026, 5, 10, 9, 0)
    expect(proximoPagamento(20, null, hoje)).toBe('2026-06-20')
  })

  it('dia de pagamento no passado neste mes: pula pro mes seguinte', () => {
    // hoje = 25/06, dia de pagamento = 5 -> ja passou -> julho
    const hoje = new Date(2026, 5, 25, 9, 0)
    expect(proximoPagamento(5, null, hoje)).toBe('2026-07-05')
  })

  it('decisao "estranha" do original: no proprio dia do pagamento ja pula pro mes seguinte', () => {
    // hoje = 5/06 as 9h, dia de pagamento = 5 -> meia-noite de hoje (00h) e
    // sempre "antes de agora" (9h) -> pula pra julho, mesmo sendo hoje o dia.
    const hoje = new Date(2026, 5, 5, 9, 0)
    expect(proximoPagamento(5, null, hoje)).toBe('2026-07-05')
  })

  it('dezembro rola o ano', () => {
    const hoje = new Date(2026, 11, 25, 9, 0)
    expect(proximoPagamento(5, null, hoje)).toBe('2027-01-05')
  })
})

describe('proximoPagamento — com historico (ja foi pago)', () => {
  it('mes seguinte ao ultimo salario pago, independente de "hoje"', () => {
    const hoje = new Date(2026, 5, 1, 9, 0)
    expect(proximoPagamento(5, '2026-05-30', hoje)).toBe('2026-06-05')
  })

  it('ultimo pagamento em dezembro rola o ano', () => {
    const hoje = new Date(2027, 0, 1, 9, 0)
    expect(proximoPagamento(10, '2026-12-10', hoje)).toBe('2027-01-10')
  })
})

describe('proximoPagamento — clamp do dia (1..28)', () => {
  // Testado pelo ramo "com historico": sem depender da hora de "hoje" (o
  // ramo "sem historico" sempre compara a meia-noite do dia escolhido
  // contra o instante atual — ver teste da decisao "estranha" acima — o
  // que tornaria um clamp pra dia 1 sempre cair no mes seguinte,
  // mascarando o proprio clamp).
  it('dia 0 vira 1', () => {
    expect(proximoPagamento(0, '2026-05-15')).toBe('2026-06-01')
  })
  it('dia 31 vira 28 (nunca quebra em fevereiro)', () => {
    expect(proximoPagamento(31, '2026-05-15')).toBe('2026-06-28')
  })
  it('dia ausente/invalido cai pro default 5', () => {
    expect(proximoPagamento(undefined, '2026-05-15')).toBe('2026-06-05')
    expect(proximoPagamento('abc', '2026-05-15')).toBe('2026-06-05')
  })
})

describe('statusPagamento', () => {
  const hoje = new Date(2026, 5, 10, 14, 30)

  it('atrasado quando a proxima data ja passou', () => {
    const r = statusPagamento('2026-06-05', hoje)
    expect(r.status).toBe('atrasado')
    expect(r.diasAte).toBe(-5)
    expect(r.rotulo).toBe('atrasado 5d')
    expect(r.cor).toBe('#c2502f')
  })

  it('vence em ate 5 dias: proximo (ambar)', () => {
    const r = statusPagamento('2026-06-15', hoje)
    expect(r.status).toBe('proximo')
    expect(r.diasAte).toBe(5)
    expect(r.rotulo).toBe('vence em 5d')
    expect(r.cor).toBe('#c79320')
  })

  it('exatamente no dia (0 dias): proximo, nao atrasado', () => {
    const r = statusPagamento('2026-06-10', hoje)
    expect(r.status).toBe('proximo')
    expect(r.diasAte).toBe(0)
  })

  it('mais de 5 dias: em dia (verde)', () => {
    const r = statusPagamento('2026-06-16', hoje)
    expect(r.status).toBe('em-dia')
    expect(r.diasAte).toBe(6)
    expect(r.rotulo).toBe('em 6d')
    expect(r.cor).toBe('#3f8f5b')
  })

  it('data invalida: indefinido, sem quebrar', () => {
    const r = statusPagamento('nao-e-uma-data', hoje)
    expect(r.status).toBe('indefinido')
    expect(r.diasAte).toBeNull()
    expect(r.rotulo).toBe('—')
  })
})

describe('ultimoSalarioPago', () => {
  it('pega o lancamento de Salario mais recente do funcionario', () => {
    const lancamentos = [
      lanc({ data: '2026-04-05', funcionario_id: '1' }),
      lanc({ data: '2026-06-05', funcionario_id: '1' }),
      lanc({ data: '2026-05-05', funcionario_id: '1' }),
    ]
    expect(ultimoSalarioPago(lancamentos, '1')).toBe('2026-06-05')
  })

  it('ignora lancamentos de outra categoria', () => {
    const lancamentos = [
      lanc({ data: '2026-06-10', categoria: 'Adiantamento de salário', funcionario_id: '1' }),
    ]
    expect(ultimoSalarioPago(lancamentos, '1')).toBeNull()
  })

  it('ignora lancamentos de outro funcionario', () => {
    const lancamentos = [lanc({ data: '2026-06-10', funcionario_id: '2' })]
    expect(ultimoSalarioPago(lancamentos, '1')).toBeNull()
  })

  it('null quando nao ha nenhum lancamento', () => {
    expect(ultimoSalarioPago([], '1')).toBeNull()
  })
})

describe('derivarFuncionarios', () => {
  it('combina ultimo pago + proxima data + status pra cada funcionario', () => {
    const hoje = new Date(2026, 5, 10, 9, 0)
    const funcionarios = [funcionario({ id: '1', dia_pag: 5 })]
    const lancamentos = [lanc({ data: '2026-05-30', funcionario_id: '1', categoria: 'Salário' })]
    const [d] = derivarFuncionarios(funcionarios, lancamentos, hoje)
    expect(d.ultimoPago).toBe('2026-05-30')
    expect(d.pagamento.proximaData).toBe('2026-06-05')
    expect(d.pagamento.status).toBe('atrasado')
  })

  it('funcionario sem nenhum lancamento nao quebra e usa o ramo "nunca pago"', () => {
    const hoje = new Date(2026, 5, 1, 9, 0)
    const funcionarios = [funcionario({ id: '9', dia_pag: 20 })]
    const [d] = derivarFuncionarios(funcionarios, [], hoje)
    expect(d.ultimoPago).toBeNull()
    expect(d.pagamento.proximaData).toBe('2026-06-20')
  })

  it('preserva os campos originais do funcionario', () => {
    const [d] = derivarFuncionarios([funcionario({ nome: 'Maria Souza' })], [])
    expect(d.nome).toBe('Maria Souza')
    expect(d.salario).toBe(2200)
  })
})

/* ==================== dinheiro: as quatro colunas ==================== */

describe('saldoFuncionario — as quatro colunas', () => {
  it('soma adiantamentos e salários pagos e devolve o que falta pagar', () => {
    const s = saldoFuncionario(2200, [
      lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
      lanc({ id: 'b', categoria: 'Adiantamento de salário', valor: 200, data: '2026-06-18' }),
      lanc({ id: 'c', categoria: 'Salário', valor: 1000, data: '2026-06-05' }),
    ])
    expect(s.salario).toBe(2200)
    expect(s.adiantado).toBe(500)
    expect(s.pagoSalario).toBe(1000)
    expect(s.aPagar).toBe(700) // 2200 − 500 − 1000
    expect(s.saldoBruto).toBe(700)
    expect(s.podePagar).toBe(true)
    expect(s.quitado).toBe(false)
  })

  it('funcionário sem nenhum lançamento: zeros medidos, a pagar = salário inteiro', () => {
    const s = saldoFuncionario(2200, [])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(2200)
    expect(s.excedente).toBe(0)
  })

  it('adiantamento sem salário pago: desconta só o adiantado', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Adiantamento de salário', valor: 500 })])
    expect(s.adiantado).toBe(500)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(1700)
  })

  it('salário pago sem adiantamento: desconta só o pago', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Salário', valor: 2200 })])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(2200)
    expect(s.aPagar).toBe(0)
    expect(s.podePagar).toBe(false)
    expect(s.quitado).toBe(true)
  })

  it('ignora categorias que não são de folha', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Gasolina', valor: 900 })])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(2200)
  })

  it('adiantou mais que o salário: a pagar fica em zero (não negativo) e o excesso sai em excedente', () => {
    const s = saldoFuncionario(2000, [lanc({ categoria: 'Adiantamento de salário', valor: 2300 })])
    expect(s.saldoBruto).toBe(-300) // o número cru continua disponível
    expect(s.aPagar).toBe(0) // dívida negativa não existe
    expect(s.excedente).toBe(300)
    expect(s.podePagar).toBe(false)
    expect(s.quitado).toBe(true)
  })
})

describe('lancamentosDoFuncionario', () => {
  const todos = [
    lanc({ id: 'a', funcionario_id: '1', data: '2026-06-03', valor: 100 }),
    lanc({ id: 'b', funcionario_id: '1', data: '2026-06-20', valor: 200 }),
    lanc({ id: 'c', funcionario_id: '1', data: '2026-05-10', valor: 300 }),
    lanc({ id: 'd', funcionario_id: '2', data: '2026-06-11', valor: 400 }),
    lanc({ id: 'e', funcionario_id: null, data: '2026-06-12', valor: 500 }),
  ]

  it('só os do funcionário pedido, do mais recente pro mais antigo', () => {
    expect(lancamentosDoFuncionario(todos, '1').map(l => l.id)).toEqual(['b', 'a', 'c'])
  })

  it('filtra por período AAAA-MM', () => {
    expect(lancamentosDoFuncionario(todos, '1', '2026-06').map(l => l.id)).toEqual(['b', 'a'])
    expect(lancamentosDoFuncionario(todos, '1', '2026-05').map(l => l.id)).toEqual(['c'])
  })

  it("'all' devolve todas as épocas", () => {
    expect(lancamentosDoFuncionario(todos, '1', 'all')).toHaveLength(3)
  })

  it('funcionário sem nenhum lançamento devolve lista vazia (não quebra)', () => {
    expect(lancamentosDoFuncionario(todos, '99')).toEqual([])
  })
})

describe('descricaoSalario', () => {
  it('usa o mês de hoje, em português', () => {
    expect(descricaoSalario(new Date(2026, 5, 10))).toBe('Salário — junho')
    expect(descricaoSalario(new Date(2026, 0, 31))).toBe('Salário — janeiro')
  })
})

describe('estatisticasFuncionarios — os quatro cartões', () => {
  const funcs = [funcionario({ id: '1', salario: 2200 }), funcionario({ id: '2', salario: 1800 })]

  it('conta, soma a folha e agrega adiantado/pago do período', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ id: 'a', funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
      lanc({ id: 'b', funcionario_id: '2', categoria: 'Salário', valor: 1800, data: '2026-06-05' }),
      lanc({ id: 'c', funcionario_id: '1', categoria: 'Salário', valor: 2200, data: '2026-05-05' }),
    ], '2026-06')
    expect(st.quantidade).toBe(2)
    expect(st.folhaMensal).toBe(4000)
    expect(st.adiantadoPeriodo).toBe(300)
    expect(st.pagoPeriodo).toBe(1800)
    expect(st.aPagarTotal).toBe(1900) // 4000 − 300 − 1800
  })

  it('sem nenhum lançamento no período: zeros medidos, a pagar = folha inteira', () => {
    const st = estatisticasFuncionarios(funcs, [], '2026-06')
    expect(st.adiantadoPeriodo).toBe(0)
    expect(st.pagoPeriodo).toBe(0)
    expect(st.aPagarTotal).toBe(4000)
  })

  it('lançamentos indisponíveis (null): os três derivados são null, não zero', () => {
    const st = estatisticasFuncionarios(funcs, null)
    expect(st.quantidade).toBe(2)
    expect(st.folhaMensal).toBe(4000) // sai do cadastro, continua disponível
    expect(st.adiantadoPeriodo).toBeNull()
    expect(st.pagoPeriodo).toBeNull()
    expect(st.aPagarTotal).toBeNull()
  })

  it('ignora lançamento sem funcionário vinculado (custo que não é folha)', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ categoria: 'Salário', valor: 999, funcionario_id: null, data: '2026-06-01' }),
    ], '2026-06')
    expect(st.pagoPeriodo).toBe(0)
  })

  it('a pagar do cartão nunca fica negativo', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 9000, data: '2026-06-01' }),
    ], '2026-06')
    expect(st.aPagarTotal).toBe(0)
  })
})

describe('derivarFuncionarios — saldo e histórico', () => {
  it('anexa o saldo do período e o histórico ordenado a cada funcionário', () => {
    const hoje = new Date(2026, 5, 25, 9, 0)
    const ls = [
      lanc({ id: 'a', funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
      lanc({ id: 'b', funcionario_id: '1', categoria: 'Salário', valor: 500, data: '2026-06-20' }),
      lanc({ id: 'c', funcionario_id: '1', categoria: 'Salário', valor: 2200, data: '2026-05-05' }),
    ]
    const [d] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], ls, hoje, '2026-06')
    expect(d.saldo?.adiantado).toBe(300)
    expect(d.saldo?.pagoSalario).toBe(500)
    expect(d.saldo?.aPagar).toBe(1400)
    expect(d.historico?.map(l => l.id)).toEqual(['b', 'a'])
  })

  it('o último salário pago ignora o filtro de período (olha todas as épocas)', () => {
    const hoje = new Date(2026, 5, 25, 9, 0)
    const ls = [lanc({ id: 'c', funcionario_id: '1', categoria: 'Salário', valor: 2200, data: '2026-05-05' })]
    const [d] = derivarFuncionarios([funcionario({ id: '1' })], ls, hoje, '2026-06')
    expect(d.ultimoPago).toBe('2026-05-05') // fora do período filtrado, mas ainda é o último
    expect(d.historico).toEqual([]) // e o histórico do período, esse sim, fica vazio
  })

  it('lançamentos indisponíveis (null): saldo e histórico null, cadastro e próximo pagamento intactos', () => {
    const hoje = new Date(2026, 5, 1, 9, 0)
    const [d] = derivarFuncionarios([funcionario({ id: '1', nome: 'Maria Souza', dia_pag: 20 })], null, hoje)
    expect(d.saldo).toBeNull()
    expect(d.historico).toBeNull()
    expect(d.nome).toBe('Maria Souza')
    expect(d.salario).toBe(2200)
    expect(d.pagamento.proximaData).toBe('2026-06-20')
  })

  it('lista vazia é diferente de null: zeros medidos', () => {
    const [d] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], [], new Date(2026, 5, 1))
    expect(d.saldo?.adiantado).toBe(0)
    expect(d.saldo?.aPagar).toBe(2200)
    expect(d.historico).toEqual([])
  })
})
