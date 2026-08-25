import { describe, it, expect } from 'vitest'
import {
  PERIODO_TODOS,
  MESES_NO_SELETOR,
  periodoDe,
  rotuloPeriodo,
  filtrarPorPeriodo,
  intervaloDoPeriodo,
  queryDePeriodo,
  opcoesDePeriodo,
} from './periodo'

describe('periodoDe', () => {
  it('extrai AAAA-MM de uma data ISO', () => {
    expect(periodoDe('2026-06-10')).toBe('2026-06')
  })

  it('nao confunde o mesmo mes em anos diferentes', () => {
    expect(periodoDe('2025-06-10')).not.toBe(periodoDe('2026-06-10'))
  })

  it('devolve vazio para data ausente ou invalida', () => {
    expect(periodoDe(null)).toBe('')
    expect(periodoDe(undefined)).toBe('')
    expect(periodoDe('lixo')).toBe('')
    expect(periodoDe('2026-06')).toBe('') // mes sem dia nao e uma data
  })
})

describe('rotuloPeriodo', () => {
  it('nomeia o mes em portugues com o ano', () => {
    expect(rotuloPeriodo('2026-06')).toBe('Junho/2026')
    expect(rotuloPeriodo('2026-01')).toBe('Janeiro/2026')
    expect(rotuloPeriodo('2026-12')).toBe('Dezembro/2026')
  })

  it('all vira "Todo o periodo"', () => {
    expect(rotuloPeriodo(PERIODO_TODOS)).toBe('Todo o período')
  })
})

describe('filtrarPorPeriodo', () => {
  const itens = [
    { id: 'a', data: '2026-05-31' },
    { id: 'b', data: '2026-06-01' },
    { id: 'c', data: '2026-06-30' },
    { id: 'd', data: '2025-06-15' },
    { id: 'e', data: null },
  ]

  it('all devolve a lista inteira, sem copiar', () => {
    expect(filtrarPorPeriodo(itens, PERIODO_TODOS, i => i.data)).toBe(itens)
  })

  it('recorta pelo mes civil, respeitando o ano', () => {
    const junho = filtrarPorPeriodo(itens, '2026-06', i => i.data)
    expect(junho.map(i => i.id)).toEqual(['b', 'c'])
  })

  it('item sem data fica de fora quando ha recorte', () => {
    expect(filtrarPorPeriodo(itens, '2026-06', i => i.data).some(i => i.id === 'e')).toBe(false)
  })

  it('mes sem nenhum item devolve lista vazia (nao a lista inteira)', () => {
    expect(filtrarPorPeriodo(itens, '2026-07', i => i.data)).toEqual([])
  })
})

describe('intervaloDoPeriodo / queryDePeriodo', () => {
  it('um mes civil vira o intervalo fechado [mes, mes]', () => {
    expect(intervaloDoPeriodo('2026-06')).toEqual({ de: '2026-06', ate: '2026-06' })
  })

  it('all vira intervalo sem limite (o "deixa tudo passar" de relatorios.ts)', () => {
    expect(intervaloDoPeriodo(PERIODO_TODOS)).toEqual({ de: '', ate: '' })
  })

  it('a query do servidor traz os dois lados, ou nada em all', () => {
    expect(queryDePeriodo('2026-06')).toBe('?de=2026-06&ate=2026-06')
    expect(queryDePeriodo(PERIODO_TODOS)).toBe('')
  })
})

describe('opcoesDePeriodo', () => {
  it('devolve doze meses por padrao, do mais recente para o mais antigo', () => {
    const opcoes = opcoesDePeriodo('2026-08-24')
    expect(opcoes).toHaveLength(MESES_NO_SELETOR)
    expect(opcoes[0]).toBe('2026-08')
    expect(opcoes[1]).toBe('2026-07')
    expect(opcoes[MESES_NO_SELETOR - 1]).toBe('2025-09')
  })

  it('vira o ano corretamente ao atravessar janeiro', () => {
    expect(opcoesDePeriodo('2026-02-01', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
  })

  it('inclui o mes corrente (o recorte que o usuario mais pede)', () => {
    expect(opcoesDePeriodo('2026-08-01', 1)).toEqual(['2026-08'])
  })

  it('data invalida devolve lista vazia — so "Todo o periodo" sobra no seletor', () => {
    expect(opcoesDePeriodo('lixo')).toEqual([])
  })

  it('nunca oferece o valor de "sem recorte" como se fosse um mes', () => {
    expect(opcoesDePeriodo('2026-08-24')).not.toContain(PERIODO_TODOS)
  })
})
