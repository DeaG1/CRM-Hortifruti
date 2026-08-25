import { describe, it, expect } from 'vitest'
import {
  derivarFornecedores, VARIACAO_ALERTA_PCT, VARIACAO_ATENCAO_PCT,
  type Fornecedor,
} from './fornecedores'
import { derivarRelatorioCompras, type EntradaResumo } from './relatorios'

const fornecedor = (over: Partial<Fornecedor> = {}): Fornecedor => ({
  id: 'f1', nome: 'Fazenda Boa Terra', regiao: 'Norte do PR', contato: '(43) 90000-0000', ...over,
})

const entrada = (over: Partial<EntradaResumo> = {}): EntradaResumo => ({
  numero: 'C-1', fornecedor_id: 'f1', data: '2026-06-08', perda_kg: 0, perda_itens_qtd: 0,
  motivo: 'transporte', pago: 'Pago', data_pag: '2026-06-10',
  valor_total: 4000, peso_total: 2000, ...over,
})

describe('derivarFornecedores — fornecedor COM coletas mostra as quatro métricas', () => {
  const fs = [fornecedor()]
  const entradas = [
    // mais antiga: R$ 2,00/kg
    entrada({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000, perda_kg: 100 }),
    // mais recente: R$ 2,20/kg
    entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000, perda_kg: 0 }),
  ]

  it('preço médio é Σ valor / Σ kg do fornecedor', () => {
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    // 4200 / 2000
    expect(porFornecedor.get('f1')!.precoMedio).toBeCloseTo(2.1, 10)
  })

  it('variação é o preço da última coleta contra o da anterior', () => {
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    // 2,20 vs 2,00 = +10%
    expect(porFornecedor.get('f1')!.variacaoPct).toBeCloseTo(10, 10)
  })

  it('última coleta é a data máxima das coletas do fornecedor', () => {
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    expect(porFornecedor.get('f1')!.ultimaColeta).toBe('2026-06-10')
  })

  it('aproveitamento é (kg − perda) / kg', () => {
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    // 100kg perdidos em 2000kg = 5% de perda -> 95% de aproveitamento
    expect(porFornecedor.get('f1')!.aproveitPct).toBeCloseTo(95, 10)
  })

  it('conta as coletas do fornecedor', () => {
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    expect(porFornecedor.get('f1')!.coletas).toBe(2)
  })
})

describe('derivarFornecedores — reusa derivarRelatorioCompras, não uma segunda fórmula', () => {
  it('preço médio e aproveitamento batem, número a número, com a aba Compras', () => {
    const fs = [fornecedor({ id: 'f1' }), fornecedor({ id: 'f2', nome: 'Sítio Vale Verde' })]
    const entradas = [
      entrada({ numero: 'C-1', fornecedor_id: 'f1', valor_total: 3333, peso_total: 1111, perda_kg: 37 }),
      entrada({ numero: 'C-2', fornecedor_id: 'f1', valor_total: 1234, peso_total: 567, perda_kg: 13 }),
      entrada({ numero: 'C-3', fornecedor_id: 'f2', valor_total: 999, peso_total: 321, perda_kg: 7 }),
    ]
    const { porFornecedor } = derivarFornecedores(fs, entradas)
    const { linhas } = derivarRelatorioCompras(fs, entradas, '', '')

    linhas.forEach(l => {
      const m = porFornecedor.get(l.fornecedorId!)!
      expect(m.precoMedio).toBe(l.precoMedio)
      expect(m.aproveitPct).toBe(l.aproveitPct)
    })
  })
})

describe('derivarFornecedores — travessão nunca vira zero', () => {
  it('fornecedor SEM coleta nenhuma: as quatro métricas são null', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor({ id: 'f9' })], [])
    const m = porFornecedor.get('f9')!
    expect(m.coletas).toBe(0)
    expect(m.precoMedio).toBeNull()
    expect(m.variacaoPct).toBeNull()
    expect(m.ultimaColeta).toBeNull()
    expect(m.aproveitPct).toBeNull()
  })

  it('fornecedor sem coleta não vira 100% de aproveitamento (o mais elogioso)', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor({ id: 'f9' })], [])
    expect(porFornecedor.get('f9')!.aproveitPct).not.toBe(100)
  })

  it('quem comprou e NÃO perdeu nada tem 100% medido — não é null', () => {
    const { porFornecedor } = derivarFornecedores(
      [fornecedor()],
      [entrada({ perda_kg: 0, perda_itens_qtd: 0 })],
    )
    expect(porFornecedor.get('f1')!.aproveitPct).toBe(100)
  })

  it('entradas de OUTRO fornecedor não emprestam métrica a quem não coletou', () => {
    const fs = [fornecedor({ id: 'f1' }), fornecedor({ id: 'f2', nome: 'Sítio Vale Verde' })]
    const { porFornecedor } = derivarFornecedores(fs, [entrada({ fornecedor_id: 'f1' })])
    expect(porFornecedor.get('f2')!.precoMedio).toBeNull()
    expect(porFornecedor.get('f2')!.coletas).toBe(0)
  })

  it('coleta sem quilo convertível: preço médio e aproveitamento ficam null, não 0', () => {
    // Toda a carga veio em CX de produto sem peso médio: peso_total = 0 e a
    // API contou os itens em itens_sem_conversao. Não há preço POR QUILO.
    const { porFornecedor } = derivarFornecedores(
      [fornecedor()],
      [entrada({ valor_total: 900, peso_total: 0, itens_sem_conversao: 3 })],
    )
    const m = porFornecedor.get('f1')!
    expect(m.precoMedio).toBeNull()
    expect(m.aproveitPct).toBeNull()
    expect(m.itensSemConversao).toBe(3)
  })
})

describe('derivarFornecedores — variação precisa de duas coletas', () => {
  it('uma única coleta: variação é null (não 0%), e `coletas` diz por quê', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], [entrada()])
    const m = porFornecedor.get('f1')!
    expect(m.coletas).toBe(1)
    expect(m.variacaoPct).toBeNull()
    // as OUTRAS três saem normalmente — uma coleta já basta para elas
    expect(m.precoMedio).toBeCloseTo(2, 10)
    expect(m.ultimaColeta).toBe('2026-06-08')
    expect(m.aproveitPct).toBe(100)
  })

  it('duas coletas com o MESMO preço: 0% é uma variação medida, não travessão', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000 }),
      entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 2000, peso_total: 1000 }),
    ])
    expect(porFornecedor.get('f1')!.variacaoPct).toBe(0)
  })

  it('preço caindo dá variação negativa', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000 }),
      entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 1800, peso_total: 1000 }),
    ])
    expect(porFornecedor.get('f1')!.variacaoPct).toBeCloseTo(-10, 10)
  })

  it('compara só as DUAS últimas — a terceira mais antiga não entra', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', data: '2026-05-01', valor_total: 5000, peso_total: 1000 }),
      entrada({ numero: 'C-2', data: '2026-06-01', valor_total: 2000, peso_total: 1000 }),
      entrada({ numero: 'C-3', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
    ])
    expect(porFornecedor.get('f1')!.variacaoPct).toBeCloseTo(10, 10)
  })

  it('coleta anterior sem quilo convertível: sem base de comparação, null', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', data: '2026-06-01', valor_total: 900, peso_total: 0, itens_sem_conversao: 2 }),
      entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
    ])
    const m = porFornecedor.get('f1')!
    expect(m.coletas).toBe(2)
    expect(m.variacaoPct).toBeNull()
  })

  it('duas coletas no MESMO dia: desempata por numero desc, ordem de entrada não importa', () => {
    const doDia = [
      entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
      entrada({ numero: 'C-1', data: '2026-06-10', valor_total: 2000, peso_total: 1000 }),
    ]
    const emOrdem = derivarFornecedores([fornecedor()], doDia)
    const invertido = derivarFornecedores([fornecedor()], doDia.slice().reverse())
    expect(emOrdem.porFornecedor.get('f1')!.variacaoPct).toBeCloseTo(10, 10)
    expect(invertido.porFornecedor.get('f1')!.variacaoPct)
      .toBe(emOrdem.porFornecedor.get('f1')!.variacaoPct)
  })
})

describe('derivarFornecedores — período', () => {
  const entradas = [
    entrada({ numero: 'C-1', data: '2026-05-20', valor_total: 2000, peso_total: 1000 }),
    entrada({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
  ]

  it('sem período (padrão) soma a base inteira', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], entradas)
    expect(porFornecedor.get('f1')!.coletas).toBe(2)
  })

  it('recortado a um mês, a coleta de fora some — e a variação volta a ser null', () => {
    const { porFornecedor } = derivarFornecedores([fornecedor()], entradas, '2026-06', '2026-06')
    const m = porFornecedor.get('f1')!
    expect(m.coletas).toBe(1)
    expect(m.ultimaColeta).toBe('2026-06-10')
    expect(m.variacaoPct).toBeNull()
  })
})

describe('derivarFornecedores — itens sem conversão propagam a sinalização', () => {
  it('soma os itens sem conversão das coletas do fornecedor', () => {
    const { porFornecedor, resumo } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', itens_sem_conversao: 2 }),
      entrada({ numero: 'C-2', data: '2026-06-09', itens_sem_conversao: 1 }),
    ])
    expect(porFornecedor.get('f1')!.itensSemConversao).toBe(3)
    expect(resumo.itensSemConversao).toBe(3)
  })

  it('base 100% convertível não sinaliza nada (o caso normal)', () => {
    const { porFornecedor, resumo } = derivarFornecedores([fornecedor()], [entrada()])
    expect(porFornecedor.get('f1')!.itensSemConversao).toBe(0)
    expect(resumo.itensSemConversao).toBe(0)
  })

  it('itens de entrada SEM fornecedor não entram no total da tela', () => {
    // A aba Compras conta esses itens na linha '—'; aqui não há célula
    // nenhuma para eles, então a nota de rodapé desta tela não os menciona.
    const { resumo } = derivarFornecedores([fornecedor()], [
      entrada({ numero: 'C-1', itens_sem_conversao: 0 }),
      entrada({ numero: 'C-9', fornecedor_id: null, itens_sem_conversao: 4 }),
    ])
    expect(resumo.itensSemConversao).toBe(0)
  })
})

describe('derivarFornecedores — cartão de resumo (variação média)', () => {
  const comDuasColetas = (id: string, de: number, para: number): EntradaResumo[] => [
    { ...entrada({ numero: `${id}-1`, data: '2026-06-01' }), fornecedor_id: id, valor_total: de * 1000, peso_total: 1000 },
    { ...entrada({ numero: `${id}-2`, data: '2026-06-10' }), fornecedor_id: id, valor_total: para * 1000, peso_total: 1000 },
  ]

  it('média das variações dos fornecedores que TÊM variação', () => {
    const fs = [fornecedor({ id: 'f1' }), fornecedor({ id: 'f2', nome: 'Sítio Vale Verde' })]
    const entradas = [
      ...comDuasColetas('f1', 2, 2.2), // +10%
      ...comDuasColetas('f2', 2, 1.6), // -20%
    ]
    const { resumo } = derivarFornecedores(fs, entradas)
    expect(resumo.variacaoMediaPct).toBeCloseTo(-5, 10)
    expect(resumo.fornecedoresComVariacao).toBe(2)
  })

  it('fornecedor com uma coleta só não puxa a média para zero — fica fora dela', () => {
    const fs = [fornecedor({ id: 'f1' }), fornecedor({ id: 'f2', nome: 'Sítio Vale Verde' })]
    const entradas = [
      ...comDuasColetas('f1', 2, 2.2), // +10%
      entrada({ numero: 'C-9', fornecedor_id: 'f2' }), // uma só: sem variação
    ]
    const { resumo } = derivarFornecedores(fs, entradas)
    expect(resumo.variacaoMediaPct).toBeCloseTo(10, 10)
    expect(resumo.fornecedoresComVariacao).toBe(1)
  })

  it('ninguém com duas coletas: média é null, não 0 (que leria "preços estáveis")', () => {
    const { resumo } = derivarFornecedores([fornecedor()], [entrada()])
    expect(resumo.variacaoMediaPct).toBeNull()
    expect(resumo.fornecedoresComVariacao).toBe(0)
    expect(resumo.coletasNoPeriodo).toBe(1)
  })

  it('sem entrada nenhuma: média null e coletasNoPeriodo 0 (a tela distingue os dois casos)', () => {
    const { resumo } = derivarFornecedores([fornecedor()], [])
    expect(resumo.variacaoMediaPct).toBeNull()
    expect(resumo.coletasNoPeriodo).toBe(0)
  })
})

describe('derivarFornecedores — limites CEASA do semáforo', () => {
  it('as constantes são ±4% (atenção) e ±7% (alerta)', () => {
    expect(VARIACAO_ATENCAO_PCT).toBe(4)
    expect(VARIACAO_ALERTA_PCT).toBe(7)
  })
})
