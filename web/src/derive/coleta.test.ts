import { describe, it, expect } from 'vitest'
import { qtdEmKg, somarQtdEmKg, perdaColetaPct } from './coleta'

describe('qtdEmKg', () => {
  it('item em KG conta a quantidade crua — nao ha o que converter', () => {
    expect(qtdEmKg('KG', 1450, 0)).toBe(1450)
    // Mesmo com peso medio cadastrado: 'KG' nunca multiplica (multiplicar
    // aqui transformaria 1450 kg em 11.600 kg com uma caixa de 8).
    expect(qtdEmKg('KG', 1450, 8)).toBe(1450)
  })

  it('outra unidade converte pelo peso medio da embalagem', () => {
    expect(qtdEmKg('CX', 4, 8)).toBe(32)
    expect(qtdEmKg('DZ', 3, 1.5)).toBe(4.5)
  })

  it('outra unidade SEM peso medio nao converte: null, nunca 1 nem 0', () => {
    // Zero = "nao informado" (migration 009). Um fator 1 diria que uma caixa
    // pesa um quilo; um zero diria que a caixa esta vazia. As duas mentiras
    // entram numa soma sem deixar rastro — por isso `null`.
    expect(qtdEmKg('CX', 4, 0)).toBeNull()
    expect(qtdEmKg('UN', 10, 0)).toBeNull()
  })

  it('peso medio negativo tambem nao converte (dado invalido, nao fator)', () => {
    expect(qtdEmKg('CX', 4, -2)).toBeNull()
  })

  it('quantidade vazia ou nao numerica conta zero, sem quebrar a soma', () => {
    expect(qtdEmKg('KG', Number.NaN, 0)).toBe(0)
    expect(qtdEmKg('CX', Number.NaN, 8)).toBe(0)
  })
})

describe('somarQtdEmKg', () => {
  it('soma cada parcela pela unidade dela', () => {
    // 1450 kg + 4 CX de 8 kg = 1482. Somar cru daria "1454".
    const r = somarQtdEmKg([
      { un: 'KG', qtd: 1450, pesoMedio: 0 },
      { un: 'CX', qtd: 4, pesoMedio: 8 },
    ])
    expect(r.kg).toBe(1482)
    expect(r.itensSemConversao).toBe(0)
  })

  it('item nao convertivel fica FORA da soma e e contado', () => {
    const r = somarQtdEmKg([
      { un: 'KG', qtd: 100, pesoMedio: 0 },
      { un: 'CX', qtd: 4, pesoMedio: 0 },
    ])
    expect(r.kg).toBe(100) // e nao 104
    expect(r.itensSemConversao).toBe(1)
  })

  it('lista vazia soma zero e nao acusa nada de incompleto', () => {
    expect(somarQtdEmKg([])).toEqual({ kg: 0, itensSemConversao: 0 })
  })

  it('conta um por um: dois itens sem fator sao dois, nao um', () => {
    const r = somarQtdEmKg([
      { un: 'CX', qtd: 4, pesoMedio: 0 },
      { un: 'MC', qtd: 2, pesoMedio: 0 },
      { un: 'KG', qtd: 10, pesoMedio: 0 },
    ])
    expect(r.kg).toBe(10)
    expect(r.itensSemConversao).toBe(2)
  })
})

describe('perdaColetaPct', () => {
  it('perda sobre o peso recebido, em %', () => {
    expect(perdaColetaPct(140, 1400)).toBeCloseTo(10, 10)
    expect(perdaColetaPct(8, 100)).toBeCloseTo(8, 10)
  })

  it('zero MEDIDO e 0%, nao travessao: houve coleta e nao houve perda', () => {
    expect(perdaColetaPct(0, 1400)).toBe(0)
  })

  it('sem peso recebido nao ha fracao: null (travessao), nunca 0%', () => {
    // Zero aqui afirmaria "nao se perdeu nada" numa coleta que nao pesou
    // nada — a leitura tranquilizadora onde nao houve medida. O proprio
    // prototipo ja fazia isto certo (2513).
    expect(perdaColetaPct(0, 0)).toBeNull()
    expect(perdaColetaPct(12, 0)).toBeNull()
  })

  it('peso negativo (dado invalido) tambem nao vira denominador', () => {
    expect(perdaColetaPct(10, -5)).toBeNull()
  })

  it('perda maior que o peso passa de 100% em vez de ser truncada', () => {
    // Nao e caso normal, e por isso mesmo tem de aparecer: truncar em 100%
    // esconderia um lancamento errado (ou uma coleta que virou perda total).
    expect(perdaColetaPct(150, 100)).toBeCloseTo(150, 10)
  })
})
