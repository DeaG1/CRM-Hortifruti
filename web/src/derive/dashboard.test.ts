import { describe, it, expect } from 'vitest'
import {
  METAS_DASHBOARD,
  receitaBruta,
  custoTotal,
  lucroLiquido,
  percentualLucro,
  indiceDePerdas,
  ticketMedioPorEntrega,
  ticketMedioPorMinimercado,
  inadimplenciaGeral,
  clientesAtivos,
  markupMedio,
  giroDeEstoque,
  cicloDeCaixa,
  cicloRecebimentoDias,
  statusIndiceDePerdas,
  statusMarkup,
  statusClientesAtivosKpi,
  statusEquilibrioClientes,
  statusTicketMes,
  statusTicketEntrega,
  statusInadimplencia,
  statusGiroDeEstoque,
  statusCicloDeCaixa,
  statusLucro,
  concentracaoDeCarteira,
  cenariosDeResultado,
  type Saida,
  type Entrada,
  type Perda,
} from './dashboard'
import type { Cliente } from './clientes'
import type { Lancamento } from './lancamentos'

const saida = (over: Partial<Saida> = {}): Saida => ({
  cliente_id: 'c1', status: 'Entregue', pag: 'Pago', entrega: '2026-06-10', data_pag: '2026-06-10',
  valor: 1000, ...over,
})

const entrada = (over: Partial<Entrada> = {}): Entrada => ({
  perda_kg: 0, valor_total: 0, peso_total: 0, ...over,
})

const perda = (over: Partial<Perda> = {}): Perda => ({ qtd: 0, ...over })

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-10', categoria: 'Frete', descricao: '', valor: 0, funcionario_id: null, ...over,
} as Lancamento)

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: 'c1', nome: 'Mercado A', status: 'ativo', tend: '→', ...over,
} as Cliente)

describe('receitaBruta', () => {
  it('indisponivel sem pedidos entregues (nunca 0)', () => {
    expect(receitaBruta([])).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
    expect(receitaBruta([saida({ status: 'Cancelado' })])).toEqual({
      disponivel: false, motivo: 'sem pedidos entregues registrados',
    })
  })

  it('soma so os pedidos entregues', () => {
    const r = receitaBruta([
      saida({ valor: 1000, status: 'Entregue' }),
      saida({ valor: 500, status: 'Em rota' }),
      saida({ valor: 300, status: 'Entregue' }),
    ])
    expect(r).toEqual({ disponivel: true, valor: 1300 })
  })
})

describe('custoTotal', () => {
  it('e zero (real, nao indisponivel) sem entradas nem lancamentos', () => {
    expect(custoTotal([], [])).toBe(0)
  })

  it('soma valor_total das entradas + valor dos lancamentos', () => {
    const c = custoTotal(
      [entrada({ valor_total: 400 }), entrada({ valor_total: 100 })],
      [lancamento({ valor: 50 })],
    )
    expect(c).toBe(550)
  })
})

describe('lucroLiquido', () => {
  it('propaga indisponibilidade da receita', () => {
    expect(lucroLiquido({ disponivel: false, motivo: 'x' }, 100)).toEqual({ disponivel: false, motivo: 'x' })
  })

  it('receita - custo, inclusive negativo (prejuizo e um resultado real)', () => {
    expect(lucroLiquido({ disponivel: true, valor: 1000 }, 1500)).toEqual({ disponivel: true, valor: -500 })
  })
})

describe('percentualLucro', () => {
  it('propaga indisponibilidade', () => {
    expect(percentualLucro({ disponivel: false, motivo: 'x' }, { disponivel: true, valor: 1 }))
      .toEqual({ disponivel: false, motivo: 'x' })
  })

  it('calcula lucro/receita*100', () => {
    expect(percentualLucro({ disponivel: true, valor: 1000 }, { disponivel: true, valor: 250 }))
      .toEqual({ disponivel: true, valor: 25 })
  })

  it('receita exatamente zero cai no fallback a 0% do estudo original (caso extremo, nao lacuna de dado)', () => {
    expect(percentualLucro({ disponivel: true, valor: 0 }, { disponivel: true, valor: 0 }))
      .toEqual({ disponivel: true, valor: 0 })
  })
})

describe('indiceDePerdas', () => {
  it('indisponivel sem compras (entradas) registradas', () => {
    expect(indiceDePerdas([], [])).toEqual({ disponivel: false, motivo: 'sem compras (entradas) registradas' })
    expect(indiceDePerdas([entrada({ peso_total: 0 })], [])).toEqual({
      disponivel: false, motivo: 'sem compras (entradas) registradas',
    })
  })

  it('(perda das entradas + perda de deposito) / kg recebido', () => {
    const r = indiceDePerdas(
      [entrada({ peso_total: 1000, perda_kg: 50 }), entrada({ peso_total: 1000, perda_kg: 30 })],
      [perda({ qtd: 20 })],
    )
    // (50+30+20) / 2000 * 100 = 5%
    expect(r).toEqual({ disponivel: true, valor: 5 })
  })
})

describe('statusIndiceDePerdas', () => {
  it('bate a meta (<=10%) e verde', () => {
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaMetaPct)).toBe('green')
  })
  it('acima da meta ate 13% e ambar', () => {
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaAmbarAtePct)).toBe('amber')
  })
  it('acima de 13% e vermelho', () => {
    expect(statusIndiceDePerdas(METAS_DASHBOARD.perdaAmbarAtePct + 0.1)).toBe('red')
  })
})

describe('ticketMedioPorEntrega', () => {
  it('indisponivel sem pedidos entregues', () => {
    expect(ticketMedioPorEntrega([])).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('media do valor das entregas', () => {
    const r = ticketMedioPorEntrega([saida({ valor: 1000 }), saida({ valor: 500 })])
    expect(r).toEqual({ disponivel: true, valor: 750 })
  })
})

describe('statusTicketEntrega', () => {
  it('bate a meta (>=430) e verde', () => {
    expect(statusTicketEntrega(METAS_DASHBOARD.ticketEntregaMeta)).toBe('green')
  })
  it('entre 150 e 429 e ambar', () => {
    expect(statusTicketEntrega(METAS_DASHBOARD.ticketEntregaAmbarAte)).toBe('amber')
  })
  it('abaixo de 150 e vermelho', () => {
    expect(statusTicketEntrega(METAS_DASHBOARD.ticketEntregaAmbarAte - 1)).toBe('red')
  })
})

describe('ticketMedioPorMinimercado', () => {
  it('indisponivel sem pedidos entregues', () => {
    expect(ticketMedioPorMinimercado([])).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('indisponivel quando nenhum entregue tem cliente identificado', () => {
    const r = ticketMedioPorMinimercado([saida({ cliente_id: null })])
    expect(r).toEqual({ disponivel: false, motivo: 'nenhum pedido entregue tem cliente identificado' })
  })

  it('receita / clientes distintos atendidos (nao / numero de pedidos)', () => {
    const r = ticketMedioPorMinimercado([
      saida({ cliente_id: 'c1', valor: 1000 }),
      saida({ cliente_id: 'c1', valor: 1000 }), // mesmo cliente, 2 pedidos
      saida({ cliente_id: 'c2', valor: 1000 }),
    ])
    // 3000 / 2 clientes distintos = 1500 (nao 3000/3 pedidos = 1000)
    expect(r).toEqual({ disponivel: true, valor: 1500 })
  })
})

describe('statusTicketMes', () => {
  it('bate a meta (>=3500) e verde', () => {
    expect(statusTicketMes(METAS_DASHBOARD.ticketMesMetaBaixo)).toBe('green')
  })
  it('entre 3000 e 3499 e ambar', () => {
    expect(statusTicketMes(METAS_DASHBOARD.ticketMesAmbarAte)).toBe('amber')
  })
  it('abaixo de 3000 e vermelho', () => {
    expect(statusTicketMes(METAS_DASHBOARD.ticketMesAmbarAte - 1)).toBe('red')
  })
})

describe('inadimplenciaGeral', () => {
  it('indisponivel sem pedidos entregues (sem base de receita)', () => {
    expect(inadimplenciaGeral([])).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('valor atrasado (de QUALQUER status) sobre a receita entregue', () => {
    const r = inadimplenciaGeral([
      saida({ status: 'Entregue', pag: 'Pago', valor: 800 }),
      saida({ status: 'Entregue', pag: 'Atrasado', valor: 200 }),
      saida({ status: 'Em rota', pag: 'Atrasado', valor: 300 }), // conta no atraso mesmo nao entregue
    ])
    // atraso = 200+300=500; receita entregue = 800+200=1000 => 50%
    expect(r).toEqual({ disponivel: true, valor: 50 })
  })
})

describe('statusInadimplencia', () => {
  it('bate a meta (<=1%) e verde', () => {
    expect(statusInadimplencia(METAS_DASHBOARD.inadimplenciaMetaPct)).toBe('green')
  })
  it('ate 2% e ambar', () => {
    expect(statusInadimplencia(METAS_DASHBOARD.inadimplenciaAmbarAtePct)).toBe('amber')
  })
  it('acima de 2% e vermelho', () => {
    expect(statusInadimplencia(METAS_DASHBOARD.inadimplenciaAmbarAtePct + 0.1)).toBe('red')
  })
})

describe('clientesAtivos', () => {
  it('conta so status ativo, e zero e uma medida real', () => {
    expect(clientesAtivos([])).toBe(0)
    expect(clientesAtivos([
      cliente({ status: 'ativo' }),
      cliente({ status: 'inativo' }),
      cliente({ status: 'ativo' }),
    ])).toBe(2)
  })
})

describe('statusClientesAtivosKpi', () => {
  it('bate a meta (~35) e verde', () => {
    expect(statusClientesAtivosKpi(METAS_DASHBOARD.clientesAtivosMeta)).toBe('green')
  })
  it('entre 25 e 34 e ambar', () => {
    expect(statusClientesAtivosKpi(METAS_DASHBOARD.clientesAtivosAmbarAte)).toBe('amber')
  })
  it('abaixo de 25 e vermelho', () => {
    expect(statusClientesAtivosKpi(METAS_DASHBOARD.clientesAtivosAmbarAte - 1)).toBe('red')
  })
})

describe('statusEquilibrioClientes', () => {
  it('usa a referencia de equilibrio (20), diferente da meta do KPI (35)', () => {
    expect(statusEquilibrioClientes(20)).toBe('green')
    expect(statusEquilibrioClientes(19)).toBe('red')
  })
})

describe('markupMedio / giroDeEstoque — sempre indisponiveis com a API atual', () => {
  it('markupMedio nunca calcula, mesmo com dado presente (falta detalhamento por item)', () => {
    const r = markupMedio([entrada({ valor_total: 1000, peso_total: 100 })], [saida({ valor: 2000 })])
    expect(r.disponivel).toBe(false)
  })

  it('giroDeEstoque nunca calcula, mesmo com dado presente', () => {
    const r = giroDeEstoque([entrada({ valor_total: 1000, peso_total: 100 })], [saida({ valor: 2000 })])
    expect(r.disponivel).toBe(false)
  })
})

describe('statusMarkup', () => {
  it('bate a meta (>=60%) e verde', () => {
    expect(statusMarkup(METAS_DASHBOARD.markupMetaPct)).toBe('green')
  })
  it('abaixo de 60% e vermelho (sem faixa ambar neste KPI)', () => {
    expect(statusMarkup(METAS_DASHBOARD.markupMetaPct - 0.1)).toBe('red')
  })
})

describe('statusGiroDeEstoque', () => {
  it('bate a meta (<=4d) e verde', () => {
    expect(statusGiroDeEstoque(METAS_DASHBOARD.giroEstoqueMetaDias)).toBe('green')
  })
  it('acima disso e ambar — nunca vermelho neste KPI', () => {
    expect(statusGiroDeEstoque(METAS_DASHBOARD.giroEstoqueMetaDias + 50)).toBe('amber')
  })
})

describe('cicloRecebimentoDias', () => {
  it('indisponivel sem pedidos com data de recebimento', () => {
    expect(cicloRecebimentoDias([saida({ data_pag: null })])).toEqual({
      disponivel: false, motivo: 'sem pedidos entregues com data de recebimento registrada',
    })
  })

  it('exclui recebimento no mesmo dia (recebDias<=0), media dos demais', () => {
    const r = cicloRecebimentoDias([
      saida({ entrega: '2026-06-01', data_pag: '2026-06-01' }), // 0 dias, excluido
      saida({ entrega: '2026-06-01', data_pag: '2026-06-05' }), // 4 dias
      saida({ entrega: '2026-06-01', data_pag: '2026-06-07' }), // 6 dias
    ])
    expect(r).toEqual({ disponivel: true, valor: 5 })
  })
})

describe('cicloDeCaixa', () => {
  it('propaga indisponibilidade do giro primeiro', () => {
    const giro = { disponivel: false as const, motivo: 'sem giro' }
    const receb = { disponivel: false as const, motivo: 'sem recebimento' }
    expect(cicloDeCaixa(giro, receb)).toEqual(giro)
  })

  it('propaga indisponibilidade do recebimento quando o giro esta disponivel', () => {
    const giro = { disponivel: true as const, valor: 4 }
    const receb = { disponivel: false as const, motivo: 'sem recebimento' }
    expect(cicloDeCaixa(giro, receb)).toEqual(receb)
  })

  it('giro + recebimento - prazo de pagamento ao produtor, quando ambos disponiveis', () => {
    const giro = { disponivel: true as const, valor: 4 }
    const receb = { disponivel: true as const, valor: 12 }
    expect(cicloDeCaixa(giro, receb)).toEqual({
      disponivel: true, valor: 4 + 12 - METAS_DASHBOARD.cicloPagamentoProdutorDias,
    })
  })
})

describe('statusCicloDeCaixa', () => {
  it('bate a meta (<=13d) e verde', () => {
    expect(statusCicloDeCaixa(METAS_DASHBOARD.cicloCaixaMetaDias)).toBe('green')
  })
  it('ate 16d e ambar', () => {
    expect(statusCicloDeCaixa(METAS_DASHBOARD.cicloCaixaAmbarAteDias)).toBe('amber')
  })
  it('acima de 16d e vermelho', () => {
    expect(statusCicloDeCaixa(METAS_DASHBOARD.cicloCaixaAmbarAteDias + 1)).toBe('red')
  })
})

describe('statusLucro', () => {
  it('positivo e verde, zero ou negativo e vermelho', () => {
    expect(statusLucro(1)).toBe('green')
    expect(statusLucro(0)).toBe('red')
    expect(statusLucro(-1)).toBe('red')
  })
})

describe('concentracaoDeCarteira', () => {
  it('indisponivel sem pedidos entregues', () => {
    expect(concentracaoDeCarteira([], [])).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('participacao por cliente, ordenada por faturamento desc', () => {
    const clientes = [cliente({ id: 'c1', nome: 'A' }), cliente({ id: 'c2', nome: 'B' })]
    const saidas = [
      saida({ cliente_id: 'c2', valor: 250 }),
      saida({ cliente_id: 'c1', valor: 750 }),
    ]
    const r = concentracaoDeCarteira(clientes, saidas)
    expect(r.disponivel).toBe(true)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.itens.map(i => i.nome)).toEqual(['A', 'B'])
    expect(r.itens[0].percentual).toBe(75)
    expect(r.itens[1].percentual).toBe(25)
    expect(r.top5TextoPct).toBe(100)
  })

  it('cliente acima de 15% de participacao e destacado; abaixo, nao', () => {
    const clientes = [cliente({ id: 'c1', nome: 'A' }), cliente({ id: 'c2', nome: 'B' })]
    const saidas = [saida({ cliente_id: 'c1', valor: 900 }), saida({ cliente_id: 'c2', valor: 100 })]
    const r = concentracaoDeCarteira(clientes, saidas)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.itens[0].destaque).toBe(true)  // 90%
    expect(r.itens[1].destaque).toBe(false) // 10%
  })

  it('agrupa alem do top N em "Demais N clientes"', () => {
    const clientes = Array.from({ length: 7 }, (_, i) => cliente({ id: `c${i}`, nome: `Cliente ${i}` }))
    const saidas = clientes.map((c, i) => saida({ cliente_id: c.id, valor: 100 - i })) // 100..94
    const r = concentracaoDeCarteira(clientes, saidas)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.itens).toHaveLength(6) // top 5 + "demais"
    const demais = r.itens[5]
    expect(demais.agregado).toBe(true)
    expect(demais.nome).toBe('Demais 2 clientes')
  })

  it('pedido sem cliente identificado nao aparece como uma barra', () => {
    const clientes = [cliente({ id: 'c1', nome: 'A' })]
    const saidas = [saida({ cliente_id: 'c1', valor: 500 }), saida({ cliente_id: null, valor: 500 })]
    const r = concentracaoDeCarteira(clientes, saidas)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0].nome).toBe('A')
  })

  it('cliente removido do cadastro ainda aparece, com rotulo generico', () => {
    const saidas = [saida({ cliente_id: 'sumiu', valor: 500 })]
    const r = concentracaoDeCarteira([], saidas)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.itens[0].nome).toBe('Cliente removido')
  })
})

describe('cenariosDeResultado', () => {
  it('indisponivel quando a receita e indisponivel', () => {
    const r = cenariosDeResultado({ disponivel: false, motivo: 'sem pedidos entregues registrados' }, 0)
    expect(r).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('calcula pessimista/realista/otimista sobre o lucro liquido positivo', () => {
    const r = cenariosDeResultado({ disponivel: true, valor: 1000 }, 400) // lucro = 600
    expect(r.disponivel).toBe(true)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.lucro).toBe(600)
    expect(r.percentualLucro).toBe(60)
    const [pess, real, otim] = r.cenarios
    expect(pess.valor).toBe(Math.round(600 * METAS_DASHBOARD.cenarioPessimistaFator)) // 330
    expect(real.valor).toBe(600)
    expect(otim.valor).toBe(Math.round(600 * METAS_DASHBOARD.cenarioOtimistaFator)) // 900
    expect(otim.larguraBarraPct).toBe(100)
  })

  it('lucro zero ou negativo usa o piso de 1 do estudo original (decisao portada como esta)', () => {
    const r = cenariosDeResultado({ disponivel: true, valor: 500 }, 700) // lucro = -200
    expect(r.disponivel).toBe(true)
    if (!r.disponivel) throw new Error('unreachable')
    expect(r.lucro).toBe(-200)
    const [pess, real, otim] = r.cenarios
    expect(pess.valor).toBe(1) // round(max(-200,1)*0.55) = round(0.55) = 1
    expect(otim.valor).toBe(2) // round(1*1.5) = 2
    expect(real.larguraBarraPct).toBe(0) // max(0,-200)=0
  })
})
