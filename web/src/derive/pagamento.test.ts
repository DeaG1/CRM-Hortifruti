import { describe, it, expect } from 'vitest'
import { situacaoExibidaSaida, valorSelecionavelPagamento, rotuloOpcaoPendente } from './pagamento'

describe('situacaoExibidaSaida', () => {
  it('Pendente com vencimento no passado exibe Atrasado', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-08-01', '2026-08-23')).toBe('Atrasado')
  })

  it('Pendente com vencimento no futuro exibe Pendente', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-09-01', '2026-08-23')).toBe('Pendente')
  })

  it('Pendente com vencimento HOJE ainda nao esta atrasado (so apos o dia virar)', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-08-23', '2026-08-23')).toBe('Pendente')
  })

  it('Pendente sem vencimento (null) exibe Pendente — nao ha data pra calcular atraso', () => {
    expect(situacaoExibidaSaida('Pendente', null, '2026-08-23')).toBe('Pendente')
  })

  it('Pendente sem vencimento (undefined) exibe Pendente', () => {
    expect(situacaoExibidaSaida('Pendente', undefined, '2026-08-23')).toBe('Pendente')
  })

  it('valor gravado Atrasado exibe Atrasado mesmo com vencimento no futuro (fidelidade ao dado legado)', () => {
    expect(situacaoExibidaSaida('Atrasado', '2027-01-01', '2026-08-23')).toBe('Atrasado')
  })

  it('valor gravado Atrasado exibe Atrasado mesmo sem vencimento nenhum', () => {
    expect(situacaoExibidaSaida('Atrasado', null, '2026-08-23')).toBe('Atrasado')
  })

  it('Pago exibe Pago, independente do vencimento', () => {
    expect(situacaoExibidaSaida('Pago', '2026-01-01', '2026-08-23')).toBe('Pago')
  })

  it('— (nao aplicavel) passa direto, sem calculo', () => {
    expect(situacaoExibidaSaida('—', '2026-01-01', '2026-08-23')).toBe('—')
  })
})

describe('valorSelecionavelPagamento', () => {
  it('Pago mapeia para Pago', () => {
    expect(valorSelecionavelPagamento('Pago')).toBe('Pago')
  })
  it('Pendente mapeia para Pendente', () => {
    expect(valorSelecionavelPagamento('Pendente')).toBe('Pendente')
  })
  it('Atrasado (calculado) mapeia para Pendente — e a mesma opcao "ainda nao pago"', () => {
    expect(valorSelecionavelPagamento('Atrasado')).toBe('Pendente')
  })
})

describe('rotuloOpcaoPendente', () => {
  it('situacao Atrasado troca o rotulo da opcao para "Atrasado"', () => {
    expect(rotuloOpcaoPendente('Atrasado')).toBe('Atrasado')
  })
  it('situacao Pendente mantem o rotulo "Pendente"', () => {
    expect(rotuloOpcaoPendente('Pendente')).toBe('Pendente')
  })
  it('situacao Pago nao afeta o rotulo da opcao Pendente (continua "Pendente")', () => {
    expect(rotuloOpcaoPendente('Pago')).toBe('Pendente')
  })
})
