import { describe, it, expect } from 'vitest'
import {
  proximoPagamento,
  statusPagamento,
  ultimoSalarioPago,
  derivarFuncionarios,
  parseDataIso,
  saldoFuncionario,
  lancamentosDoFuncionario,
  descontosDoFuncionario,
  historicoDoFuncionario,
  sujeitoDoExcedente,
  descricaoSalario,
  estatisticasFuncionarios,
  type Funcionario,
  type LancamentoParaFuncionario,
} from './funcionarios'
import type { Desconto } from './descontos'

/** Um desconto por falta — o registro que NAO e lancamento (nada se move
 * quando ele e criado; a empresa e que vai pagar menos depois). */
const desc = (over: Partial<Desconto> = {}): Desconto => ({
  id: 'd1', funcionario_id: '1', data: '2026-06-12', motivo: 'faltou sem avisar', valor: 0, ...over,
})

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
    const [d] = derivarFuncionarios(funcionarios, lancamentos, [], hoje)
    expect(d.ultimoPago).toBe('2026-05-30')
    expect(d.pagamento.proximaData).toBe('2026-06-05')
    expect(d.pagamento.status).toBe('atrasado')
  })

  it('funcionario sem nenhum lancamento nao quebra e usa o ramo "nunca pago"', () => {
    const hoje = new Date(2026, 5, 1, 9, 0)
    const funcionarios = [funcionario({ id: '9', dia_pag: 20 })]
    const [d] = derivarFuncionarios(funcionarios, [], [], hoje)
    expect(d.ultimoPago).toBeNull()
    expect(d.pagamento.proximaData).toBe('2026-06-20')
  })

  it('preserva os campos originais do funcionario', () => {
    const [d] = derivarFuncionarios([funcionario({ nome: 'Maria Souza' })], [], [])
    expect(d.nome).toBe('Maria Souza')
    expect(d.salario).toBe(2200)
  })
})

/* ==================== dinheiro: as cinco colunas ==================== */

describe('saldoFuncionario — as cinco colunas', () => {
  it('soma adiantamentos e salários pagos e devolve o que falta pagar', () => {
    const s = saldoFuncionario(2200, [
      lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
      lanc({ id: 'b', categoria: 'Adiantamento de salário', valor: 200, data: '2026-06-18' }),
      lanc({ id: 'c', categoria: 'Salário', valor: 1000, data: '2026-06-05' }),
    ], [])
    expect(s.salario).toBe(2200)
    expect(s.adiantado).toBe(500)
    expect(s.pagoSalario).toBe(1000)
    expect(s.aPagar).toBe(700) // 2200 − 500 − 1000
    expect(s.saldoBruto).toBe(700)
    expect(s.podePagar).toBe(true)
    expect(s.quitado).toBe(false)
  })

  it('funcionário sem nenhum lançamento: zeros medidos, a pagar = salário inteiro', () => {
    const s = saldoFuncionario(2200, [], [])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(2200)
    expect(s.excedente).toBe(0)
  })

  it('adiantamento sem salário pago: desconta só o adiantado', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Adiantamento de salário', valor: 500 })], [])
    expect(s.adiantado).toBe(500)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(1700)
  })

  it('salário pago sem adiantamento: desconta só o pago', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Salário', valor: 2200 })], [])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(2200)
    expect(s.aPagar).toBe(0)
    expect(s.podePagar).toBe(false)
    expect(s.quitado).toBe(true)
  })

  it('ignora categorias que não são de folha', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Gasolina', valor: 900 })], [])
    expect(s.adiantado).toBe(0)
    expect(s.pagoSalario).toBe(0)
    expect(s.aPagar).toBe(2200)
  })

  it('adiantou mais que o salário: a pagar fica em zero (não negativo) e o excesso sai em excedente', () => {
    const s = saldoFuncionario(2000, [lanc({ categoria: 'Adiantamento de salário', valor: 2300 })], [])
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

describe('estatisticasFuncionarios — os cartões do topo', () => {
  const funcs = [funcionario({ id: '1', salario: 2200 }), funcionario({ id: '2', salario: 1800 })]

  it('conta, soma a folha e agrega adiantado/pago do período', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ id: 'a', funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
      lanc({ id: 'b', funcionario_id: '2', categoria: 'Salário', valor: 1800, data: '2026-06-05' }),
      lanc({ id: 'c', funcionario_id: '1', categoria: 'Salário', valor: 2200, data: '2026-05-05' }),
    ], [], '2026-06')
    expect(st.quantidade).toBe(2)
    expect(st.folhaMensal).toBe(4000)
    expect(st.adiantadoPeriodo).toBe(300)
    expect(st.pagoPeriodo).toBe(1800)
    expect(st.aPagarTotal).toBe(1900) // 4000 − 300 − 1800
  })

  it('sem nenhum lançamento no período: zeros medidos, a pagar = folha inteira', () => {
    const st = estatisticasFuncionarios(funcs, [], [], '2026-06')
    expect(st.adiantadoPeriodo).toBe(0)
    expect(st.pagoPeriodo).toBe(0)
    expect(st.aPagarTotal).toBe(4000)
  })

  it('lançamentos indisponíveis (null): os três derivados são null, não zero', () => {
    const st = estatisticasFuncionarios(funcs, null, null)
    expect(st.quantidade).toBe(2)
    expect(st.folhaMensal).toBe(4000) // sai do cadastro, continua disponível
    expect(st.adiantadoPeriodo).toBeNull()
    expect(st.pagoPeriodo).toBeNull()
    expect(st.aPagarTotal).toBeNull()
  })

  it('ignora lançamento sem funcionário vinculado (custo que não é folha)', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ categoria: 'Salário', valor: 999, funcionario_id: null, data: '2026-06-01' }),
    ], [], '2026-06')
    expect(st.pagoPeriodo).toBe(0)
  })

  it('a pagar do cartão nunca fica negativo', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 9000, data: '2026-06-01' }),
    ], [], '2026-06')
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
    const [d] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], ls, [], hoje, '2026-06')
    expect(d.saldo?.adiantado).toBe(300)
    expect(d.saldo?.pagoSalario).toBe(500)
    expect(d.saldo?.aPagar).toBe(1400)
    expect(d.historico?.map(l => l.id)).toEqual(['b', 'a'])
  })

  it('o último salário pago ignora o filtro de período (olha todas as épocas)', () => {
    const hoje = new Date(2026, 5, 25, 9, 0)
    const ls = [lanc({ id: 'c', funcionario_id: '1', categoria: 'Salário', valor: 2200, data: '2026-05-05' })]
    const [d] = derivarFuncionarios([funcionario({ id: '1' })], ls, [], hoje, '2026-06')
    expect(d.ultimoPago).toBe('2026-05-05') // fora do período filtrado, mas ainda é o último
    expect(d.historico).toEqual([]) // e o histórico do período, esse sim, fica vazio
  })

  it('lançamentos indisponíveis (null): saldo e histórico null, cadastro e próximo pagamento intactos', () => {
    const hoje = new Date(2026, 5, 1, 9, 0)
    const [d] = derivarFuncionarios([funcionario({ id: '1', nome: 'Maria Souza', dia_pag: 20 })], null, null, hoje)
    expect(d.saldo).toBeNull()
    expect(d.historico).toBeNull()
    expect(d.nome).toBe('Maria Souza')
    expect(d.salario).toBe(2200)
    expect(d.pagamento.proximaData).toBe('2026-06-20')
  })

  it('lista vazia é diferente de null: zeros medidos', () => {
    const [d] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], [], [], new Date(2026, 5, 1))
    expect(d.saldo?.adiantado).toBe(0)
    expect(d.saldo?.aPagar).toBe(2200)
    expect(d.historico).toEqual([])
  })
})

/* ==================== desconto de salário por falta ==================== */

describe('saldoFuncionario — o desconto abate o "a pagar"', () => {
  it('um desconto reduz o que há a pagar, e sai medido na coluna DESCONTADO', () => {
    const s = saldoFuncionario(2200, [], [desc({ valor: 100 })])
    expect(s.descontado).toBe(100)
    expect(s.aPagar).toBe(2100) // 2200 − 100
    expect(s.saldoBruto).toBe(2100)
  })

  it('vários descontos somam', () => {
    const s = saldoFuncionario(2200, [], [
      desc({ id: 'd1', valor: 100, data: '2026-06-02', motivo: 'faltou segunda' }),
      desc({ id: 'd2', valor: 80, data: '2026-06-09', motivo: 'faltou terça' }),
      desc({ id: 'd3', valor: 20.5, data: '2026-06-16', motivo: 'atraso' }),
    ])
    expect(s.descontado).toBe(200.5)
    expect(s.aPagar).toBe(1999.5)
  })

  it('desconto convive com adiantamento e salário pago — as quatro parcelas na mesma conta', () => {
    const s = saldoFuncionario(2200, [
      lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 300 }),
      lanc({ id: 'b', categoria: 'Salário', valor: 500 }),
    ], [desc({ valor: 200 })])
    expect(s.adiantado).toBe(300)
    expect(s.pagoSalario).toBe(500)
    expect(s.descontado).toBe(200)
    expect(s.aPagar).toBe(1200) // 2200 − 300 − 500 − 200
  })

  it('sem desconto nenhum: zero MEDIDO, não travessão nem ausência', () => {
    const s = saldoFuncionario(2200, [lanc({ categoria: 'Salário', valor: 200 })], [])
    expect(s.descontado).toBe(0)
    expect(s.aPagar).toBe(2000)
  })

  it('desconto maior que o salário: a pagar fica em zero (nunca negativo) e o excesso sai em excedente', () => {
    const s = saldoFuncionario(2000, [], [desc({ valor: 2300 })])
    expect(s.saldoBruto).toBe(-300)
    expect(s.aPagar).toBe(0)
    expect(s.excedente).toBe(300)
    expect(s.podePagar).toBe(false)
    expect(s.quitado).toBe(true)
  })

  it('valor não numérico não contamina a soma (mesma defesa dos lançamentos)', () => {
    const s = saldoFuncionario(2200, [], [desc({ valor: undefined as unknown as number })])
    expect(s.descontado).toBe(0)
    expect(s.aPagar).toBe(2200)
  })
})

describe('sujeitoDoExcedente — a frase do excedente tem de dizer a verdade', () => {
  it('só adiantamento: "Adiantado" (o texto que já existia)', () => {
    const s = saldoFuncionario(2000, [lanc({ categoria: 'Adiantamento de salário', valor: 2300 })], [])
    expect(sujeitoDoExcedente(s)).toBe('Adiantado')
  })

  it('só desconto: "Descontado" — dizer "Adiantado" aqui seria mentira', () => {
    const s = saldoFuncionario(2000, [], [desc({ valor: 2300 })])
    expect(sujeitoDoExcedente(s)).toBe('Descontado')
  })

  it('só salário pago acima do salário do cadastro: "Pago"', () => {
    const s = saldoFuncionario(2000, [lanc({ categoria: 'Salário', valor: 2300 })], [])
    expect(sujeitoDoExcedente(s)).toBe('Pago')
  })

  it('adiantamento e desconto juntos: nomeia os dois', () => {
    const s = saldoFuncionario(2000, [lanc({ categoria: 'Adiantamento de salário', valor: 1500 })], [desc({ valor: 900 })])
    expect(s.excedente).toBe(400)
    expect(sujeitoDoExcedente(s)).toBe('Adiantado e descontado')
  })

  it('as três parcelas: lista com vírgula e "e" antes da última', () => {
    const s = saldoFuncionario(2000, [
      lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 900 }),
      lanc({ id: 'b', categoria: 'Salário', valor: 900 }),
    ], [desc({ valor: 900 })])
    expect(sujeitoDoExcedente(s)).toBe('Adiantado, pago e descontado')
  })

  it('sem excedente: null (não há frase a desenhar)', () => {
    expect(sujeitoDoExcedente(saldoFuncionario(2200, [], [desc({ valor: 100 })]))).toBeNull()
    expect(sujeitoDoExcedente(saldoFuncionario(2200, [], []))).toBeNull()
  })
})

describe('descontosDoFuncionario — o mesmo recorte dos adiantamentos', () => {
  const todos = [
    desc({ id: 'a', funcionario_id: '1', data: '2026-06-03', valor: 100 }),
    desc({ id: 'b', funcionario_id: '1', data: '2026-06-20', valor: 200 }),
    desc({ id: 'c', funcionario_id: '1', data: '2026-03-10', valor: 300 }),
    desc({ id: 'd', funcionario_id: '2', data: '2026-06-11', valor: 400 }),
  ]

  it('só os do funcionário pedido, do mais recente pro mais antigo', () => {
    expect(descontosDoFuncionario(todos, '1').map(d => d.id)).toEqual(['b', 'a', 'c'])
  })

  it('desconto de MARÇO não entra no período de agosto (a data é a da falta)', () => {
    expect(descontosDoFuncionario(todos, '1', '2026-08')).toEqual([])
    expect(descontosDoFuncionario(todos, '1', '2026-03').map(d => d.id)).toEqual(['c'])
  })

  it("'all' devolve todas as épocas", () => {
    expect(descontosDoFuncionario(todos, '1', 'all')).toHaveLength(3)
  })

  it('funcionário sem desconto devolve lista vazia (não quebra)', () => {
    expect(descontosDoFuncionario(todos, '99')).toEqual([])
  })
})

describe('historicoDoFuncionario — lançamentos e descontos na mesma lista', () => {
  it('mescla os dois e ordena do mais recente pro mais antigo', () => {
    const itens = historicoDoFuncionario(
      [
        lanc({ id: 'l-antigo', data: '2026-06-01', valor: 100 }),
        lanc({ id: 'l-novo', data: '2026-06-25', valor: 200 }),
      ],
      [desc({ id: 'd-meio', data: '2026-06-12', valor: 80 })],
    )
    expect(itens.map(i => i.id)).toEqual(['l-novo', 'd-meio', 'l-antigo'])
  })

  it('cada item se identifica, e carrega o registro inteiro (o motivo do desconto inclusive)', () => {
    const [item] = historicoDoFuncionario([], [desc({ id: 'd1', motivo: 'faltou sem avisar', valor: 80 })])
    expect(item.tipo).toBe('desconto')
    expect(item.valor).toBe(80)
    if (item.tipo === 'desconto') expect(item.desconto.motivo).toBe('faltou sem avisar')
  })

  it('as duas listas vazias dão histórico vazio, não null', () => {
    expect(historicoDoFuncionario([], [])).toEqual([])
  })

  it('empate de data: o lançamento vem primeiro (ordem estável, não aleatória)', () => {
    const itens = historicoDoFuncionario(
      [lanc({ id: 'l', data: '2026-06-10', valor: 1 })],
      [desc({ id: 'd', data: '2026-06-10', valor: 1 })],
    )
    expect(itens.map(i => i.id)).toEqual(['l', 'd'])
  })
})

describe('estatisticasFuncionarios — o cartão do topo acompanha o desconto', () => {
  const funcs = [funcionario({ id: '1', salario: 2200 }), funcionario({ id: '2', salario: 1800 })]

  it('soma os descontos do período e abate no "a pagar" do cartão', () => {
    const st = estatisticasFuncionarios(funcs, [
      lanc({ id: 'a', funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' }),
    ], [
      desc({ id: 'd1', funcionario_id: '1', valor: 100, data: '2026-06-12' }),
      desc({ id: 'd2', funcionario_id: '2', valor: 50, data: '2026-06-13' }),
    ], '2026-06')
    expect(st.descontadoPeriodo).toBe(150)
    expect(st.aPagarTotal).toBe(3550) // 4000 − 300 − 0 − 150
  })

  it('desconto fora do período não entra na conta do cartão', () => {
    const st = estatisticasFuncionarios(funcs, [], [
      desc({ id: 'd1', valor: 100, data: '2026-03-12' }),
    ], '2026-06')
    expect(st.descontadoPeriodo).toBe(0)
    expect(st.aPagarTotal).toBe(4000)
  })

  it('descontos indisponíveis (null): os derivados são null, não zero — nem os que dependem só de lançamento', () => {
    // Com metade da conta em mãos, o "a pagar" sairia MAIOR que o real com
    // cara de número medido. Travessão é a resposta honesta.
    const st = estatisticasFuncionarios(funcs, [], null)
    expect(st.quantidade).toBe(2)
    expect(st.folhaMensal).toBe(4000) // sai do cadastro
    expect(st.adiantadoPeriodo).toBeNull()
    expect(st.pagoPeriodo).toBeNull()
    expect(st.descontadoPeriodo).toBeNull()
    expect(st.aPagarTotal).toBeNull()
  })

  it('lista vazia de descontos é diferente de null: zero medido', () => {
    const st = estatisticasFuncionarios(funcs, [], [], '2026-06')
    expect(st.descontadoPeriodo).toBe(0)
    expect(st.aPagarTotal).toBe(4000)
  })

  it('desconto maior que a folha inteira: o cartão para em zero, nunca negativo', () => {
    const st = estatisticasFuncionarios(funcs, [], [desc({ valor: 9000, data: '2026-06-01' })], '2026-06')
    expect(st.aPagarTotal).toBe(0)
  })
})

describe('derivarFuncionarios — desconto por funcionário e no histórico', () => {
  it('anexa o desconto do período ao saldo e o registro ao histórico', () => {
    const hoje = new Date(2026, 5, 25, 9, 0)
    const [d] = derivarFuncionarios(
      [funcionario({ id: '1', salario: 2200 })],
      [lanc({ id: 'a', funcionario_id: '1', categoria: 'Adiantamento de salário', valor: 300, data: '2026-06-10' })],
      [desc({ id: 'x', funcionario_id: '1', valor: 100, data: '2026-06-12', motivo: 'faltou' })],
      hoje, '2026-06',
    )
    expect(d.saldo?.descontado).toBe(100)
    expect(d.saldo?.aPagar).toBe(1800) // 2200 − 300 − 100
    expect(d.historico?.map(i => i.id)).toEqual(['x', 'a'])
  })

  it('desconto de outro funcionário não entra no saldo deste', () => {
    const [d] = derivarFuncionarios(
      [funcionario({ id: '1', salario: 2200 })],
      [],
      [desc({ id: 'x', funcionario_id: '2', valor: 500, data: '2026-06-12' })],
      new Date(2026, 5, 25), '2026-06',
    )
    expect(d.saldo?.descontado).toBe(0)
    expect(d.saldo?.aPagar).toBe(2200)
    expect(d.historico).toEqual([])
  })

  it('desconto fora do período não abate: março não diminui o salário de agosto', () => {
    const ds = [desc({ id: 'x', funcionario_id: '1', valor: 500, data: '2026-03-12' })]
    const [emAgosto] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], [], ds, new Date(2026, 7, 25), '2026-08')
    expect(emAgosto.saldo?.descontado).toBe(0)
    expect(emAgosto.saldo?.aPagar).toBe(2200)

    const [emMarco] = derivarFuncionarios([funcionario({ id: '1', salario: 2200 })], [], ds, new Date(2026, 7, 25), '2026-03')
    expect(emMarco.saldo?.descontado).toBe(500)
    expect(emMarco.saldo?.aPagar).toBe(1700)
  })

  it('descontos indisponíveis (null): saldo e histórico null mesmo com os lançamentos carregados', () => {
    const [d] = derivarFuncionarios(
      [funcionario({ id: '1', nome: 'Maria Souza', salario: 2200, dia_pag: 20 })],
      [lanc({ id: 'a', funcionario_id: '1', categoria: 'Salário', valor: 500, data: '2026-05-30' })],
      null,
      new Date(2026, 5, 1, 9, 0),
    )
    expect(d.saldo, 'sem descontos, o "a pagar" seria maior que o real').toBeNull()
    expect(d.historico).toBeNull()
    // e o cadastro continua inteiro
    expect(d.nome).toBe('Maria Souza')
    expect(d.salario).toBe(2200)
    expect(d.pagamento.proximaData).toBe('2026-06-20')
    // o último salário pago não depende do desconto e continua saindo
    expect(d.ultimoPago).toBe('2026-05-30')
  })
})
