import { describe, it, expect } from 'vitest'
import {
  calcularCaixa,
  saldoEmCaixa,
  recebidoDeClientes,
  pagoAosProdutores,
  lancamentosPagos,
  type SaidaCaixa,
  type EntradaCaixa,
  type LancamentoCaixa,
} from './caixa'

const HOJE = '2026-06-20'

const saida = (over: Partial<SaidaCaixa> = {}): SaidaCaixa =>
  ({ pag: 'Pago', venc: null, valor: 1000, ...over })
const entrada = (over: Partial<EntradaCaixa> = {}): EntradaCaixa =>
  ({ pago: 'Pago', valor_total: 400, ...over })
const lancamento = (over: Partial<LancamentoCaixa> = {}): LancamentoCaixa =>
  ({ valor: 100, ...over })

// ------------------------------------------------- parcela 1: recebido

describe('recebidoDeClientes — o que conta como recebido', () => {
  it('soma so as vendas pagas', () => {
    expect(recebidoDeClientes(
      [saida({ valor: 1000 }), saida({ pag: 'Pendente', valor: 500 })],
      HOJE,
    )).toBe(1000)
  })

  it('venda atrasada nao entra (ainda nao entrou dinheiro)', () => {
    expect(recebidoDeClientes([saida({ pag: 'Atrasado', valor: 800 })], HOJE)).toBe(0)
  })

  it('usa a situacao DERIVADA: pendente com vencimento vencido e atraso, nao pagamento', () => {
    // `pag` gravado e 'Pendente'; `situacaoExibidaSaida` o exibe como
    // 'Atrasado'. Nenhum dos dois e 'Pago' — o ponto do teste e que a regra
    // usada e a derivada, nao uma comparacao com o campo cru.
    expect(recebidoDeClientes([saida({ pag: 'Pendente', venc: '2026-06-01', valor: 900 })], HOJE)).toBe(0)
  })

  it('pedido cancelado/devolvido (pag "—") nunca conta como recebido', () => {
    expect(recebidoDeClientes([saida({ pag: '—', valor: 700 })], HOJE)).toBe(0)
  })

  it('venda sem valor nao quebra a soma', () => {
    expect(recebidoDeClientes([saida({ valor: undefined })], HOJE)).toBe(0)
  })
})

// --------------------------------------------- parcela 2: pago ao produtor

describe('pagoAosProdutores — o que conta como pago', () => {
  it('soma so as compras marcadas como pagas', () => {
    expect(pagoAosProdutores([
      entrada({ valor_total: 400 }),
      entrada({ pago: 'Pendente', valor_total: 900 }),
    ])).toBe(400)
  })

  it('compra gravada como "Atrasado" continua sendo divida, nao sai do caixa', () => {
    expect(pagoAosProdutores([entrada({ pago: 'Atrasado', valor_total: 600 })])).toBe(0)
  })

  it('pago sem data de pagamento continua sendo dinheiro que saiu', () => {
    // `data_pag` diz QUANDO, nao SE — exigi-la aqui inflaria o saldo.
    expect(pagoAosProdutores([entrada({ pago: 'Pago', valor_total: 250 })])).toBe(250)
  })
})

// ------------------------------------------------ parcela 3: lancamentos

describe('lancamentosPagos — o que conta como pago', () => {
  it('soma TODOS os lancamentos: a tabela nao tem situacao de pagamento', () => {
    expect(lancamentosPagos([lancamento({ valor: 100 }), lancamento({ valor: 250 })])).toBe(350)
  })

  it('lista vazia vale zero, nao indisponivel', () => {
    expect(lancamentosPagos([])).toBe(0)
  })
})

// --------------------------------------------------------- as tres juntas

describe('calcularCaixa — as tres fontes somando', () => {
  it('recebido − pago ao produtor − lancamentos', () => {
    const caixa = calcularCaixa(
      [saida({ valor: 3000 }), saida({ pag: 'Pendente', valor: 1000 })],
      [entrada({ valor_total: 1200 }), entrada({ pago: 'Pendente', valor_total: 500 })],
      [lancamento({ valor: 300 }), lancamento({ valor: 200 })],
      HOJE,
    )
    expect(caixa).toEqual({
      recebido: 3000,
      pagoAoProdutor: 1200,
      lancamentosPagos: 500,
      saldo: 1300,
    })
  })

  it('as tres parcelas ficam expostas para o badge explicar o numero', () => {
    const caixa = calcularCaixa([saida({ valor: 100 })], [entrada({ valor_total: 40 })], [lancamento({ valor: 10 })], HOJE)
    expect(caixa?.recebido).toBe(100)
    expect(caixa?.pagoAoProdutor).toBe(40)
    expect(caixa?.lancamentosPagos).toBe(10)
    expect(caixa?.saldo).toBe(50)
  })

  it('nada lancado em lugar nenhum e zero MEDIDO, nao indisponivel', () => {
    expect(calcularCaixa([], [], [], HOJE)).toEqual({
      recebido: 0, pagoAoProdutor: 0, lancamentosPagos: 0, saldo: 0,
    })
  })
})

describe('calcularCaixa — saldo negativo', () => {
  it('gastar mais do que recebeu devolve numero negativo, nao zero', () => {
    const caixa = calcularCaixa([saida({ valor: 500 })], [entrada({ valor_total: 900 })], [lancamento({ valor: 300 })], HOJE)
    expect(caixa?.saldo).toBe(-700)
  })

  it('so lancamentos, sem nenhuma venda, tambem fica negativo', () => {
    expect(saldoEmCaixa([], [], [lancamento({ valor: 250 })], HOJE)).toBe(-250)
  })
})

describe('calcularCaixa — nunca um saldo parcial', () => {
  it('sem as vendas: null', () => {
    expect(calcularCaixa(null, [entrada()], [lancamento()], HOJE)).toBeNull()
  })

  it('sem as compras: null (o saldo sairia maior que o real)', () => {
    expect(calcularCaixa([saida()], null, [lancamento()], HOJE)).toBeNull()
  })

  it('sem os lancamentos: null (o saldo sairia maior que o real)', () => {
    expect(calcularCaixa([saida()], [entrada()], null, HOJE)).toBeNull()
  })

  it('sem nenhuma das tres: null', () => {
    expect(calcularCaixa(null, null, null, HOJE)).toBeNull()
  })

  it('lista VAZIA e diferente de fonte indisponivel', () => {
    expect(calcularCaixa([], [], [], HOJE)).not.toBeNull()
    expect(calcularCaixa([], [], null, HOJE)).toBeNull()
  })
})

describe('saldoEmCaixa — atalho para so o numero', () => {
  it('devolve o mesmo saldo de calcularCaixa', () => {
    const args: Parameters<typeof calcularCaixa> = [
      [saida({ valor: 800 })], [entrada({ valor_total: 300 })], [lancamento({ valor: 100 })], HOJE,
    ]
    expect(saldoEmCaixa(...args)).toBe(calcularCaixa(...args)?.saldo)
  })

  it('propaga o null de qualquer fonte ausente', () => {
    expect(saldoEmCaixa([saida()], [entrada()], null, HOJE)).toBeNull()
  })
})

describe('calcularCaixa — acumulado, nunca recortado por periodo', () => {
  it('nao ha parametro de periodo: vendas de meses diferentes somam juntas', () => {
    // Se o saldo seguisse o filtro, uma venda de maio e outra de junho nao
    // poderiam estar no mesmo numero. Caixa e posicao acumulada — ver o
    // cabecalho de derive/caixa.ts.
    const caixa = calcularCaixa(
      [saida({ valor: 100 }), saida({ valor: 200 })],
      [entrada({ valor_total: 50 })],
      [],
      HOJE,
    )
    expect(caixa?.saldo).toBe(250)
    // A assinatura tem exatamente quatro parametros (as tres fontes + hoje).
    expect(calcularCaixa.length).toBe(4)
  })
})
