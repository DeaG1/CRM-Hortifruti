import { describe, it, expect } from 'vitest'
import {
  derivarResumoEntradas,
  derivarResumoSaidas,
  entradaEmAberto,
} from './resumoOperacional'
import { indiceDePerdas, statusIndiceDePerdas, METAS_DASHBOARD, type Perda } from './dashboard'
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

/** Uma perda de depósito, na forma que `indiceDePerdas` (derive/dashboard.ts)
 * espera — `qtd_kg` já convertido, nunca o `qtd` cru (ver o comentário
 * grande de lá). `itens_sem_conversao` default 0 = converteu normalmente. */
const perdaDeposito = (over: Partial<Perda> = {}): Perda => ({
  data: '2026-08-10',
  qtd_kg: 0,
  itens_sem_conversao: 0,
  ...over,
})

/** O mesmo adaptador que `derivarResumoEntradas` usa internamente para
 * chamar `indiceDePerdas` (id sintético = numero da coleta, nunca lido pela
 * função) — usado aqui só para comparar, número a número, o resultado de
 * `derivarResumoEntradas` com o de `indiceDePerdas` chamada diretamente. */
const indiceDireto = (entradas: EntradaResumo[], perdas: Perda[]) =>
  indiceDePerdas(entradas.map(en => ({ ...en, id: en.numero })), perdas)

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
    ], [])
    expect(r?.aPagarAoProdutor).toBe(500)
    expect(r?.coletasEmAberto).toBe(2)
  })

  it('tudo pago: R$ 0 MEDIDO, não travessão', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', pago: 'Pago', valor_total: 500 }),
      entrada({ numero: 'C-2', pago: 'Pago', valor_total: 300 }),
    ], [])
    expect(r).not.toBeNull()
    expect(r?.aPagarAoProdutor).toBe(0)
    expect(r?.coletasEmAberto).toBe(0)
  })

  it('sem nenhum lançamento devolve null (travessão, nunca zero)', () => {
    expect(derivarResumoEntradas([], [])).toBeNull()
  })

  it('`entradaEmAberto` trata o legado "Atrasado" como dívida, não como pago', () => {
    expect(entradaEmAberto({ pago: 'Atrasado' })).toBe(true)
    expect(entradaEmAberto({ pago: 'Pendente' })).toBe(true)
    expect(entradaEmAberto({ pago: 'Pago' })).toBe(false)
  })
})

/**
 * Cartão "Índice de perdas" (antes "Perda média (coleta/transporte)") — a
 * unificação desta tarefa. `derivarResumoEntradas` não recalcula a fração:
 * chama `indiceDePerdas` (derive/dashboard.ts), a MESMA função do KPI do
 * painel. Os testes abaixo comparam, número a número, os dois caminhos —
 * é essa comparação que impede a divergência (coleta só vs. coleta+depósito)
 * de voltar em silêncio.
 */
describe('derivarResumoEntradas — cartão "Índice de perdas"', () => {
  it('só perda de coleta (sem perda de depósito no período): bate com indiceDePerdas', () => {
    const entradas = [
      entrada({ numero: 'C-1', peso_total: 1000, perda_kg: 80 }),
      entrada({ numero: 'C-2', peso_total: 1000, perda_kg: 60 }),
    ]
    const r = derivarResumoEntradas(entradas, [])
    expect(r?.perdaKg).toBe(140)
    expect(r?.pesoRecebidoKg).toBe(2000)
    expect(r?.perdaMediaPct).toBeCloseTo(7, 10)

    // O MESMO caso que o KPI "Índice de perdas" do painel calcularia para
    // este recorte — nenhuma perda de depósito no período não é motivo para
    // os dois números divergirem.
    const indice = indiceDireto(entradas, [])
    expect(indice.disponivel && indice.valor).toBeCloseTo(r!.perdaMediaPct as number, 10)
  })

  it('coleta + depósito somando: o cartão passa a incluir a perda de depósito', () => {
    const entradas = [entrada({ numero: 'C-1', peso_total: 1000, perda_kg: 50 })]
    const perdas = [perdaDeposito({ qtd_kg: 20 })]
    const r = derivarResumoEntradas(entradas, perdas)
    // Antes desta unificação o cartão mostrava so 50/1000 = 5%; unificado,
    // (50+20)/1000 = 7% — o mesmo que o KPI do painel.
    expect(r?.perdaKg).toBe(70)
    expect(r?.perdaMediaPct).toBeCloseTo(7, 10)

    const indice = indiceDireto(entradas, perdas)
    expect(indice.disponivel && indice.valor).toBeCloseTo(r!.perdaMediaPct as number, 10)
    expect(indice.disponivel && indice.valor).toBeCloseTo(7, 10)
  })

  it('perda zero com peso recebido: 0% MEDIDO, não travessão', () => {
    const r = derivarResumoEntradas([entrada({ peso_total: 1000, perda_kg: 0 })], [])
    expect(r?.perdaMediaPct).toBe(0)
    expect(r?.perdaKg).toBe(0)
  })

  it('sem peso recebido não há índice: travessão (null), nunca 0%', () => {
    const r = derivarResumoEntradas([entrada({ peso_total: 0, perda_kg: 0 })], [])
    expect(r).not.toBeNull()
    expect(r?.perdaMediaPct).toBeNull()
  })

  it('cabeçalho e itens descrevem a MESMA perda de coleta: usa o maior, nunca a soma', () => {
    const r = derivarResumoEntradas([
      entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 60 }),
    ], [])
    expect(r?.perdaKg).toBe(100)
    expect(r?.perdaMediaPct).toBeCloseTo(10, 10)
  })

  it('perda de deposito em CX: entra pelo qtd_kg convertido, nunca pelo qtd cru', () => {
    // 4 CX de 8 kg cada = 32 kg de deposito. Uma soma que usasse `qtd` cru
    // teria misturado "4" com quilos — o defeito que indiceDePerdas fecha.
    const entradas = [entrada({ peso_total: 1000, perda_kg: 50 })]
    const perdas = [perdaDeposito({ qtd_kg: 32 })]
    const r = derivarResumoEntradas(entradas, perdas)
    expect(r?.perdaMediaPct).toBeCloseTo(8.2, 10) // (50+32)/1000*100
  })

  describe('falha isolada: GET /api/perdas indisponível (perdas === null)', () => {
    it('o índice e os quilos viram travessão — NUNCA a perda de coleta sozinha como se fosse o total', () => {
      const r = derivarResumoEntradas([
        entrada({ numero: 'C-1', peso_total: 1000, perda_kg: 80, valor_total: 500, pago: 'Pendente', data_pag: null }),
      ], null)
      expect(r).not.toBeNull()
      expect(r?.perdaMediaPct).toBeNull()
      expect(r?.perdaKg).toBeNull()
      expect(r?.itensSemConversaoIndice).toBe(0)
    })

    it('os outros quatro cartões continuam corretos — a falha não derruba a tela inteira', () => {
      const r = derivarResumoEntradas([
        entrada({ numero: 'C-1', peso_total: 1000, perda_kg: 80, valor_total: 500, pago: 'Pendente', data_pag: null }),
        entrada({ numero: 'C-2', peso_total: 500, perda_kg: 10, valor_total: 300, pago: 'Pago' }),
      ], null)
      expect(r?.coletas).toBe(2)
      expect(r?.pesoRecebidoKg).toBe(1500)
      expect(r?.valorTotal).toBe(800)
      expect(r?.aPagarAoProdutor).toBe(500)
      expect(r?.coletasEmAberto).toBe(1)
    })
  })

  describe('itens sem conversão: dois contadores independentes', () => {
    it('item de ENTRADA sem conversão marca peso recebido E índice (soma os dois lados)', () => {
      const r = derivarResumoEntradas([
        entrada({ numero: 'C-1', itens_sem_conversao: 1 }),
        entrada({ numero: 'C-2', itens_sem_conversao: 2 }),
      ], [])
      expect(r?.itensSemConversao).toBe(3) // so o lado das entradas (cartao PESO RECEBIDO)
      expect(r?.itensSemConversaoIndice).toBe(3) // sem perda de deposito no periodo, os dois batem
    })

    it('item de PERDA DE DEPÓSITO sem conversão marca só o índice, nunca o peso recebido', () => {
      const entradas = [entrada({ numero: 'C-1', peso_total: 1000, itens_sem_conversao: 0 })]
      const perdas = [perdaDeposito({ qtd_kg: null, itens_sem_conversao: 1 })]
      const r = derivarResumoEntradas(entradas, perdas)
      expect(r?.itensSemConversao).toBe(0) // peso recebido continua limpo
      expect(r?.itensSemConversaoIndice).toBe(1) // o índice, não

      const indice = indiceDireto(entradas, perdas)
      expect(indice.disponivel && indice.itensSemConversao).toBe(r?.itensSemConversaoIndice)
    })

    it('nenhuma perda carregada (perdas === null): itensSemConversaoIndice fica 0, não há o que marcar', () => {
      const r = derivarResumoEntradas([entrada({ itens_sem_conversao: 5 })], null)
      expect(r?.itensSemConversaoIndice).toBe(0)
    })
  })
})

describe('derivarResumoEntradas — cartões que a tela já tinha', () => {
  it('conta coletas, soma peso recebido e valor total', () => {
    const r = derivarResumoEntradas([
      entrada({ numero: 'C-1', peso_total: 30, valor_total: 120 }),
      entrada({ numero: 'C-2', peso_total: 70, valor_total: 380 }),
    ], [])
    expect(r?.coletas).toBe(2)
    expect(r?.pesoRecebidoKg).toBe(100)
    expect(r?.valorTotal).toBe(500)
  })
})

/**
 * A régua do semáforo do índice unificado é a do painel (`METAS_DASHBOARD`/
 * `statusIndiceDePerdas`, derive/dashboard.ts) — 10/13, não mais o 10/15
 * próprio que este módulo tinha. Já testada a fundo em dashboard.test.ts;
 * aqui só confirma que é ELA quem o cartão usa (import direto, sem uma
 * segunda régua reaparecendo neste arquivo).
 */
describe('a régua do cartão é a mesma do painel (nenhuma faixa duplicada aqui)', () => {
  it('10% (meta) é verde, 13% (limite âmbar) é âmbar, 13,1% é vermelho', () => {
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaMetaPct)).toBe('green')
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaAmbarAtePct)).toBe('amber')
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaAmbarAtePct + 0.1)).toBe('red')
  })
})
