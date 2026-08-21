import { describe, it, expect } from 'vitest'
import {
  proximoPagamento,
  statusPagamento,
  ultimoSalarioPago,
  derivarFuncionarios,
  parseDataIso,
  type Funcionario,
  type LancamentoParaFuncionario,
} from './funcionarios'

const lanc = (over: Partial<LancamentoParaFuncionario> = {}): LancamentoParaFuncionario => ({
  data: '2026-06-15', categoria: 'Salário', funcionario_id: '1', ...over,
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
