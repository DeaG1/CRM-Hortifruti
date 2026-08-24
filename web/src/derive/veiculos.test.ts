import { describe, it, expect } from 'vitest'
import { horasEmAberto, usoAntigo, formatarHora, formatarDataHora, HORAS_LIMITE_ABERTO } from './veiculos'

describe('horasEmAberto', () => {
  it('calcula as horas decorridas entre desde e agora', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    const desde = new Date('2026-08-23T07:00:00Z').toISOString()
    expect(horasEmAberto(desde, agora)).toBe(5)
  })

  it('zero quando desde e agora sao o mesmo instante', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    expect(horasEmAberto(agora.toISOString(), agora)).toBe(0)
  })
})

describe('usoAntigo — limite de 12h (decisao do dono do negocio: destaca, nao fecha sozinho)', () => {
  it('constante de limite e 12 horas', () => {
    expect(HORAS_LIMITE_ABERTO).toBe(12)
  })

  it('uso ha menos de 12h nao e antigo', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    const desde = new Date('2026-08-23T07:40:00Z').toISOString() // ~4h20
    expect(usoAntigo(desde, agora)).toBe(false)
  })

  it('uso ha exatamente 12h nao e antigo (estrito, so passa de 12h)', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    const desde = new Date('2026-08-23T00:00:00Z').toISOString() // exatas 12h
    expect(usoAntigo(desde, agora)).toBe(false)
  })

  it('uso ha mais de 12h e antigo', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    const desde = new Date('2026-08-22T23:59:00Z').toISOString() // 12h01
    expect(usoAntigo(desde, agora)).toBe(true)
  })

  it('uso de ontem (bem mais de 12h) e antigo', () => {
    const agora = new Date('2026-08-23T12:00:00Z')
    const desde = new Date('2026-08-22T08:00:00Z').toISOString() // 28h
    expect(usoAntigo(desde, agora)).toBe(true)
  })
})

describe('formatarHora', () => {
  it('formata um timestamptz ISO como HH:MM', () => {
    const iso = new Date('2026-08-23T07:40:00').toISOString()
    expect(formatarHora(iso)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('data invalida vira travessao, nao quebra', () => {
    expect(formatarHora('nao-e-uma-data')).toBe('—')
  })
})

describe('formatarDataHora', () => {
  it('formata como DD/MM HH:MM', () => {
    const iso = new Date('2026-08-23T07:40:00').toISOString()
    expect(formatarDataHora(iso)).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
  })

  it('data invalida vira travessao, nao quebra', () => {
    expect(formatarDataHora('nao-e-uma-data')).toBe('—')
  })
})
