import { describe, it, expect } from 'vitest'
import {
  derivarResumoEntradas,
  derivarResumoSaidas,
  entradaEmAberto,
  statusPerdaMedia,
  META_PERDA_MEDIA_PCT,
  PERDA_MEDIA_AMBAR_ATE_PCT,
} from './resumoOperacional'
import type { EntradaResumo, SaidaResumo } from './relatorios'

const HOJE = '2026-08-24'

const saida = (over: Partial<SaidaResumo> = {}): SaidaResumo => ({
  numero: 'S-0001',
  cliente_id: 'cli-1',
  rota: 'Norte',
  entrega: '2026-08-05',
  status: 'Entregue',
  pag: 'Pago',
  venc: null,
  data_pag: '2026-08-07',
  perda_kg: 0,
  valor: 1000,
  peso: 100,
  ...over,
})

const entrada = (over: Partial<EntradaResumo> = {}): EntradaResumo => ({
  numero: 'C-1040',
  fornecedor_id: 'f-1',
  data: '2026-08-10',
  perda_kg: 0,
  perda_itens_qtd: 0,
  motivo: '',
  pago: 'Pago',
  data_pag: '2026-08-11',
  valor_total: 500,
  peso_total: 200,
  ...over,
})

/* ============================== saídas ============================== */

describe('derivarResumoSaidas — cartão "Pedidos"', () => {
  it('conta todos os pedidos da base, qualquer que seja o status', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1' }),
      saida({ numero: 'S-2', status: 'Cancelado', pag: '—' }),
      saida({ numero: 'S-3', status: 'Em rota', pag: 'Pendente' }),
    ], HOJE)
    expect(r?.pedidos).toBe(3)
  })

  it('sem nenhum lançamento devolve null (a tela mostra travessão, nunca zero)', () => {
    expect(derivarResumoSaidas([], HOJE)).toBeNull()
  })
})

describe('derivarResumoSaidas — cartão "Faturado (entregue)"', () => {
  it('soma só o valor dos pedidos ENTREGUES e conta quantos são', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', status: 'Entregue', valor: 1000 }),
      saida({ numero: 'S-2', status: 'Entregue', valor: 500 }),
      saida({ numero: 'S-3', status: 'Em rota', valor: 9999, pag: 'Pendente' }),
      saida({ numero: 'S-4', status: 'Cancelado', valor: 8888, pag: '—' }),
    ], HOJE)
    expect(r?.faturadoEntregue).toBe(1500)
    expect(r?.pedidosEntregues).toBe(2)
  })

  it('nenhum pedido entregue ainda: zero MEDIDO, não travessão', () => {
    const r = derivarResumoSaidas([saida({ status: 'Em rota', pag: 'Pendente', valor: 700 })], HOJE)
    expect(r).not.toBeNull()
    expect(r?.faturadoEntregue).toBe(0)
    expect(r?.pedidosEntregues).toBe(0)
  })
})

describe('derivarResumoSaidas — cartão "A receber / atrasado"', () => {
  it('soma o valor dos pedidos ainda não pagos (Pendente + Atrasado)', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', pag: 'Pago', valor: 1000 }),
      saida({ numero: 'S-2', pag: 'Pendente', venc: '2026-09-30', valor: 300, data_pag: null }),
      saida({ numero: 'S-3', pag: 'Atrasado', venc: '2026-07-01', valor: 200, data_pag: null }),
    ], HOJE)
    expect(r?.aReceber).toBe(500)
  })

  it('pedido com pagamento "não aplicável" (cancelado/devolvido) NÃO é dívida do cliente', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', status: 'Cancelado', pag: '—', valor: 4000, data_pag: null }),
      saida({ numero: 'S-2', pag: 'Pendente', venc: '2026-09-30', valor: 100, data_pag: null }),
    ], HOJE)
    expect(r?.aReceber).toBe(100)
  })

  it('tudo pago: R$ 0 MEDIDO, não travessão — é a informação boa', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', pag: 'Pago', valor: 1000 }),
      saida({ numero: 'S-2', pag: 'Pago', valor: 500 }),
    ], HOJE)
    expect(r).not.toBeNull()
    expect(r?.aReceber).toBe(0)
    expect(r?.pedidosAtrasados).toBe(0)
  })

  it('conta como atraso o pedido Pendente com vencimento DECORRIDO (derivado, não gravado)', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', pag: 'Pendente', venc: '2026-08-23', valor: 300, data_pag: null }),
    ], HOJE)
    expect(r?.pedidosAtrasados).toBe(1)
    expect(r?.aReceber).toBe(300)
  })

  it('não conta como atraso o pedido Pendente com vencimento no futuro', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', pag: 'Pendente', venc: '2026-08-25', valor: 300, data_pag: null }),
    ], HOJE)
    expect(r?.pedidosAtrasados).toBe(0)
    expect(r?.aReceber).toBe(300)
  })

  it('vencimento exatamente hoje ainda não é atraso', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', pag: 'Pendente', venc: HOJE, valor: 300, data_pag: null }),
    ], HOJE)
    expect(r?.pedidosAtrasados).toBe(0)
  })
})

describe('derivarResumoSaidas — cartão "Qtd entregue"', () => {
  it('soma o peso só dos pedidos ENTREGUES', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', status: 'Entregue', peso: 100 }),
      saida({ numero: 'S-2', status: 'Em rota', pag: 'Pendente', peso: 900 }),
    ], HOJE)
    expect(r?.qtdEntregueKg).toBe(100)
  })

  it('propaga o contador de itens sem conversão dos ENTREGUES (o conjunto que ele qualifica)', () => {
    const r = derivarResumoSaidas([
      saida({ numero: 'S-1', status: 'Entregue', peso: 100, itens_sem_conversao: 2 }),
      saida({ numero: 'S-2', status: 'Em rota', pag: 'Pendente', peso: 50, itens_sem_conversao: 5 }),
    ], HOJE)
    expect(r?.itensSemConversao).toBe(2)
  })

  it('sem item fora da conversão o contador é zero (número limpo)', () => {
    const r = derivarResumoSaidas([saida({ peso: 100 })], HOJE)
    expect(r?.itensSemConversao).toBe(0)
  })
})

/* ============================= entradas ============================= */

describe('derivarResumoEntradas — cartão "A pagar ao produtor"', () => {
  it('soma o valor das coletas ainda não pagas e conta quantas são', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', pago: 'Pago', valor_total: 500 }),
      entrada({ numero: 'C-2', pago: 'Pendente', valor_total: 300, data_pag: null }),
      entrada({ numero: 'C-3', pago: 'Atrasado', valor_total: 200, data_pag: null }),
    ])
    expect(r?.aPagarAoProdutor).toBe(500)
    expect(r?.coletasEmAberto).toBe(2)
  })

  it('tudo pago: R$ 0 MEDIDO, não travessão', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', pago: 'Pago', valor_total: 500 }),
      entrada({ numero: 'C-2', pago: 'Pago', valor_total: 300 }),
    ])
    expect(r).not.toBeNull()
    expect(r?.aPagarAoProdutor).toBe(0)
    expect(r?.coletasEmAberto).toBe(0)
  })

  it('sem nenhum lançamento devolve null (travessão, nunca zero)', () => {
    expect(derivarResumoEntradas([])).toBeNull()
  })

  it('`entradaEmAberto` trata o legado "Atrasado" como dívida, não como pago', () => {
    expect(entradaEmAberto({ pago: 'Atrasado' })).toBe(true)
    expect(entradaEmAberto({ pago: 'Pendente' })).toBe(true)
    expect(entradaEmAberto({ pago: 'Pago' })).toBe(false)
  })
})

describe('derivarResumoEntradas — cartão "Perda média"', () => {
  it('divide a perda pelo peso recebido, em %', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', peso_total: 1000, perda_kg: 80 }),
      entrada({ numero: 'C-2', peso_total: 1000, perda_kg: 60 }),
    ])
    expect(r?.perdaKg).toBe(140)
    expect(r?.pesoRecebidoKg).toBe(2000)
    expect(r?.perdaMediaPct).toBeCloseTo(7, 10)
  })

  it('perda zero com peso recebido: 0% MEDIDO, não travessão', () => {
    const r = derivarResumoEntradas([entrada({ peso_total: 1000, perda_kg: 0 })])
    expect(r?.perdaMediaPct).toBe(0)
  })

  it('sem peso recebido não há índice: travessão (null), nunca 0%', () => {
    const r = derivarResumoEntradas([entrada({ peso_total: 0, perda_kg: 0 })])
    expect(r).not.toBeNull()
    expect(r?.perdaMediaPct).toBeNull()
  })

  it('cabeçalho e itens descrevem a MESMA perda: usa o maior, nunca a soma', () => {
    const r = derivarResumoEntradas([
      entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 60 }),
    ])
    expect(r?.perdaKg).toBe(100)
    expect(r?.perdaMediaPct).toBeCloseTo(10, 10)
  })

  it('propaga o contador de itens sem conversão (o índice divide por esse peso)', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', itens_sem_conversao: 1 }),
      entrada({ numero: 'C-2', itens_sem_conversao: 2 }),
    ])
    expect(r?.itensSemConversao).toBe(3)
  })
})

describe('derivarResumoEntradas — cartões que a tela já tinha', () => {
  it('conta coletas, soma peso recebido e valor total', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', peso_total: 30, valor_total: 120 }),
      entrada({ numero: 'C-2', peso_total: 70, valor_total: 380 }),
    ])
    expect(r?.coletas).toBe(2)
    expect(r?.pesoRecebidoKg).toBe(100)
    expect(r?.valorTotal).toBe(500)
  })
})

describe('statusPerdaMedia — semáforo contra o alvo de 10%', () => {
  it('abaixo do alvo é verde', () => {
    expect(statusPerdaMedia(0)).toBe('green')
    expect(statusPerdaMedia(9.9)).toBe('green')
  })

  it('exatamente no alvo ainda é verde — "meta ≤ 10%" inclui o 10', () => {
    expect(statusPerdaMedia(META_PERDA_MEDIA_PCT)).toBe('green')
  })

  it('acima do alvo e até 15% é âmbar, inclusive no próprio 15', () => {
    expect(statusPerdaMedia(10.1)).toBe('amber')
    expect(statusPerdaMedia(PERDA_MEDIA_AMBAR_ATE_PCT)).toBe('amber')
  })

  it('acima de 15% é vermelho', () => {
    expect(statusPerdaMedia(15.1)).toBe('red')
    expect(statusPerdaMedia(90)).toBe('red')
  })
})
