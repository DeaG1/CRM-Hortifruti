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
  markupMedio,
  giroDeEstoque,
  cicloDeCaixa,
  cicloRecebimentoDias,
  statusIndiceDePerdas,
  statusMarkup,
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
import type { ProdutoAgregado } from './relatorios'

const saida = (over: Partial<Saida> = {}): Saida => ({
  id: 's1', cliente_id: 'c1', status: 'Entregue', pag: 'Pago', entrega: '2026-06-10', data_pag: '2026-06-10',
  valor: 1000, peso: 100, ...over,
})

const entrada = (over: Partial<Entrada> = {}): Entrada => ({
  id: 'e1', data: '2026-06-01', pago: 'Pago', data_pag: '2026-06-04',
  perda_kg: 0, valor_total: 0, peso_total: 0, ...over,
})

/**
 * Uma perda de depósito lançada EM QUILOS — o caso em que a conversão é
 * no-op. Manda `un: 'KG'` e o `qtd` cru IGUAL ao `qtd_kg`, exatamente como a
 * API faz nesse caso: é o que torna verificável a afirmação "não quebrou quem
 * já estava certo". Um fixture que omitisse o `qtd` faria qualquer mutação
 * que voltasse a somar o campo cru derrubar também os testes de KG, e a
 * sensibilidade não distinguiria mais uma coisa da outra.
 */
const perda = (over: Partial<Perda> = {}): Perda => {
  const base = { qtd_kg: 0, itens_sem_conversao: 0, ...over }
  const daApi = { ...base, un: 'KG', qtd: base.qtd_kg ?? 0 }
  return daApi
}

/**
 * A mesma perda como GET /api/perdas de fato a devolve: com o `qtd` CRU
 * junto, na unidade da própria perda. `Perda` não declara esse campo de
 * propósito (ver o comentário do tipo em dashboard.ts), mas os testes de
 * conversão precisam mandá-lo — ele é o número que a versão anterior somava,
 * e só prova que ficou de fora da conta se chegar até a função. Vai por uma
 * VARIÁVEL, e não por um literal, porque o excess property check do
 * TypeScript só dispara em literais.
 */
function perdaDaApi(campos: { un: string; qtd: number; qtd_kg: number | null }): Perda {
  const daApi = {
    data: '2026-06-19', produto_id: 'p1', motivo: 'vencimento',
    un: campos.un, qtd: campos.qtd, qtd_kg: campos.qtd_kg,
    itens_sem_conversao: campos.qtd_kg === null ? 1 : 0,
  }
  return daApi
}

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
      [perda({ qtd_kg: 20 })],
    )
    // (50+30+20) / 2000 * 100 = 5%
    expect(r).toEqual({ disponivel: true, valor: 5 })
  })
})

describe('indiceDePerdas soma em KG, cada parcela pela unidade dela', () => {
  // `perdas.qtd` esta na unidade da PROPRIA perda; as duas perda_kg
  // (entrada_itens/saida_itens) sao KG por contrato para item de qualquer
  // unidade. Ate esta versao, o indice somava a primeira crua com as
  // segundas — 4 caixas entrando como "4" ao lado de centenas de quilos —, e
  // saia PARA BAIXO, a direcao que esconde sangria.

  const entradaKg = (over: Partial<Entrada> = {}) =>
    entrada({ peso_total: 1000, perda_kg: 50, ...over })

  it('perda so em KG: a conversao e no-op, o valor e o mesmo de antes', () => {
    // Prova que a correcao nao quebrou quem ja estava certo.
    const r = indiceDePerdas([entradaKg()], [perdaDaApi({ un: 'KG', qtd: 20, qtd_kg: 20 })])
    expect(r.disponivel && r.valor).toBeCloseTo(7) // (50+20)/1000*100
    expect(r).not.toHaveProperty('itensSemConversao')
  })

  it('perda em CX com fator: entra pelos quilos (qtd_kg), nao pelas caixas (qtd)', () => {
    // 4 CX de 8 kg = 32 kg. Somar `qtd` daria (50+4)/1000 = 5,4%.
    const r = indiceDePerdas([entradaKg()], [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: 32 })])
    expect(r.disponivel && r.valor).toBeCloseTo(8.2) // (50+32)/1000*100
  })

  it('perda em CX SEM fator: fica fora da soma (nunca vira 1) e e contada', () => {
    const r = indiceDePerdas([entradaKg()], [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: null })])
    // Nem 5,4% (fator 1 inventado) nem 8,2% (fator que nao existe): 5,0%, o
    // que da para afirmar — marcado como incompleto.
    expect(r.disponivel && r.valor).toBeCloseTo(5)
    expect(r.disponivel && r.itensSemConversao).toBe(1)
  })

  it('mistura: converte o que da, deixa de fora o que nao da, e conta o que ficou', () => {
    const r = indiceDePerdas([entradaKg()], [
      perdaDaApi({ un: 'KG', qtd: 11, qtd_kg: 11 }),
      perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: 32 }),
      perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: null }),
    ])
    // (50 + 11 + 32) / 1000. Somar cru daria (50+11+4+4)/1000 = 6,9%.
    expect(r.disponivel && r.valor).toBeCloseTo(9.3)
    expect(r.disponivel && r.itensSemConversao).toBe(1)
  })

  it('as duas perda_kg NAO sao convertidas: perda de coleta entra em kg, crua', () => {
    // A perda de coleta ja e kg por contrato para item de qualquer unidade
    // (nome da coluna, rotulo em ModalEntrada.tsx e total do rodape do mesmo
    // modal). Aqui a entrada tem 296 kg de coleta e o deposito 92 kg de
    // caixas convertidas: 388 sobre 8700 — o caso do seed do prototipo.
    // Converter a coleta por engano (x8, x20…) explodiria o indice.
    const r = indiceDePerdas(
      [entrada({ peso_total: 8700, perda_kg: 296, perda_itens_qtd: 296 })],
      [
        perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: 32 }),
        perdaDaApi({ un: 'CX', qtd: 3, qtd_kg: 60 }),
      ],
    )
    expect(r.disponivel && r.valor).toBeCloseTo(4.4598, 3)
    // O numero que a versao anterior mostrava, com `qtd` cru: (296+7)/8700.
    expect(r.disponivel && r.valor).not.toBeCloseTo(3.4828, 3)
  })

  it('indicador completo sai LIMPO — sem o campo de marca', () => {
    // O caso normal (a esmagadora maioria) nao pode ganhar um campo a mais so
    // porque o mecanismo de marca existe: `itensSemConversao` ausente e 0 sao
    // a mesma coisa, e o objeto continua de dois campos.
    const r = indiceDePerdas([entradaKg()], [perdaDaApi({ un: 'KG', qtd: 20, qtd_kg: 20 })])
    expect(r).not.toHaveProperty('itensSemConversao')
  })

  it('conta tambem o que ficou fora do DENOMINADOR (itens de entrada sem fator)', () => {
    // O indice e uma fracao: perda em cima, kg comprado embaixo. Um item de
    // entrada que nao entrou em `peso_total` deixa o denominador curto — o
    // numero sai para CIMA, e exibi-lo limpo seria tao desonesto quanto no
    // outro lado.
    const r = indiceDePerdas(
      [entradaKg({ itens_sem_conversao: 2 })],
      [perdaDaApi({ un: 'KG', qtd: 20, qtd_kg: 20 })],
    )
    expect(r.disponivel && r.valor).toBeCloseTo(7)
    expect(r.disponivel && r.itensSemConversao).toBe(2)
  })

  it('soma os dois lados quando os dois perderam lancamentos', () => {
    const r = indiceDePerdas(
      [entradaKg({ itens_sem_conversao: 2 })],
      [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: null })],
    )
    expect(r.disponivel && r.itensSemConversao).toBe(3)
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
    expect(inadimplenciaGeral([], '2026-06-15')).toEqual({ disponivel: false, motivo: 'sem pedidos entregues registrados' })
  })

  it('valor atrasado (de QUALQUER status) sobre a receita entregue', () => {
    const r = inadimplenciaGeral([
      saida({ status: 'Entregue', pag: 'Pago', valor: 800 }),
      saida({ status: 'Entregue', pag: 'Atrasado', valor: 200 }),
      saida({ status: 'Em rota', pag: 'Atrasado', valor: 300 }), // conta no atraso mesmo nao entregue
    ], '2026-06-15')
    // atraso = 200+300=500; receita entregue = 800+200=1000 => 50%
    expect(r).toEqual({ disponivel: true, valor: 50 })
  })

  // DEFEITO CORRIGIDO: a UI parou de gravar 'Atrasado' (SaidasLista/ModalSaida
  // só oferecem Pendente/Pago — ver derive/pagamento.ts); 'Atrasado' passou a
  // ser CALCULADO a partir de pag='Pendente' + venc vencido. Antes desta
  // correção, este indicador filtrava só o campo `pag` gravado e caminhava
  // pra zero conforme os registros antigos fossem substituídos por vendas
  // novas — mesmo com dívida real se acumulando.
  describe('deriva "atrasado" via situacaoExibidaSaida (nao so o pag gravado)', () => {
    it('pendente com vencimento passado conta como atrasada', () => {
      const r = inadimplenciaGeral([
        saida({ status: 'Entregue', pag: 'Pendente', venc: '2026-06-01', valor: 1000 }),
      ], '2026-06-15')
      expect(r).toEqual({ disponivel: true, valor: 100 })
    })

    it('pendente com vencimento futuro NAO conta', () => {
      const r = inadimplenciaGeral([
        saida({ status: 'Entregue', pag: 'Pendente', venc: '2026-07-01', valor: 1000 }),
      ], '2026-06-15')
      expect(r).toEqual({ disponivel: true, valor: 0 })
    })

    it('pendente sem vencimento NAO conta (nao inventa data default)', () => {
      const r = inadimplenciaGeral([
        saida({ status: 'Entregue', pag: 'Pendente', venc: null, valor: 1000 }),
      ], '2026-06-15')
      expect(r).toEqual({ disponivel: true, valor: 0 })
    })

    it('paga nunca conta, mesmo com vencimento passado', () => {
      const r = inadimplenciaGeral([
        saida({ status: 'Entregue', pag: 'Pago', venc: '2026-01-01', valor: 1000 }),
      ], '2026-06-15')
      expect(r).toEqual({ disponivel: true, valor: 0 })
    })

    it('registro gravado como Atrasado (dado antigo, de antes da mudanca) continua contando', () => {
      const r = inadimplenciaGeral([
        saida({ status: 'Entregue', pag: 'Atrasado', venc: null, valor: 1000 }),
      ], '2026-06-15')
      expect(r).toEqual({ disponivel: true, valor: 100 })
    })
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

const produtoAgregado = (over: Partial<ProdutoAgregado> = {}): ProdutoAgregado => ({
  produto_id: 'p1', nome: 'Produto', un: 'KG',
  compra_qtd: 0, compra_valor: 0, perda_coleta_qtd: 0,
  venda_qtd: 0, venda_valor: 0, perda_deposito_qtd: 0,
  ...over,
})

describe('markupMedio — destravado por GET /api/relatorios/produtos', () => {
  it('indisponivel sem nenhum produto agregado (nunca 0)', () => {
    expect(markupMedio([])).toEqual({
      disponivel: false, motivo: 'sem produtos com preço médio de compra e venda apurável no período',
    })
  })

  it('indisponivel quando nenhum produto tem compra E venda no periodo', () => {
    // so compra (nunca vendido) e so venda (nunca comprado no periodo) —
    // markupPct fica null nos dois em derivarRelatorioProdutos, nenhum entra na media
    const r = markupMedio([
      produtoAgregado({ produto_id: 'so-compra', compra_qtd: 100, compra_valor: 200, venda_qtd: 0, venda_valor: 0 }),
      produtoAgregado({ produto_id: 'so-venda', compra_qtd: 0, compra_valor: 0, venda_qtd: 10, venda_valor: 150 }),
    ])
    expect(r.disponivel).toBe(false)
  })

  it('media SIMPLES (nao ponderada por volume) do markup% de cada produto — fidelidade ao estudo original', () => {
    const r = markupMedio([
      // cm=100/10=10, vm=200/10=20 -> markup 100%
      produtoAgregado({ produto_id: 'a', compra_qtd: 10, compra_valor: 100, venda_qtd: 10, venda_valor: 200 }),
      // cm=10000/1000=10, vm=10000/1000=10 -> markup 0%, MUITO mais volume que 'a'
      produtoAgregado({ produto_id: 'b', compra_qtd: 1000, compra_valor: 10000, venda_qtd: 1000, venda_valor: 10000 }),
    ])
    // media simples (100+0)/2=50 — se fosse ponderada por volume ficaria perto de 0
    expect(r).toEqual({ disponivel: true, valor: 50 })
  })

  it('produto sem venda no periodo (markupPct null) fica de fora da media, nao vira 0', () => {
    const r = markupMedio([
      produtoAgregado({ produto_id: 'a', compra_qtd: 10, compra_valor: 100, venda_qtd: 10, venda_valor: 150 }), // markup 50%
      produtoAgregado({ produto_id: 'parado', compra_qtd: 50, compra_valor: 500, venda_qtd: 0, venda_valor: 0 }), // null
    ])
    expect(r).toEqual({ disponivel: true, valor: 50 })
  })
})

describe('giroDeEstoque — destravado, importado de derive/financeiro.ts (diasEstoque)', () => {
  it('indisponivel (nao 0) sem nenhuma saida para estimar o ritmo', () => {
    const r = giroDeEstoque([entrada({ peso_total: 1000, perda_kg: 0 })], [])
    expect(r).toEqual({
      disponivel: false, motivo: 'sem saídas com peso registrado para estimar o giro de estoque',
    })
  })

  it('calcula os dias que o saldo atual duraria no ritmo de saida (periodo "all": dias reais entre as datas extremas)', () => {
    // mesma massa de calcularCicloCaixa em financeiro.test.ts: entrada 05-01,
    // saida (entrega) 05-30 -> intervalo real de 30 dias (nao 30 fixo, so
    // coincide aqui). qEnt=1000, qPer=0, qSai=300 -> (1000-300)/(300/30) = 70
    const r = giroDeEstoque(
      [entrada({ data: '2026-05-01', peso_total: 1000, perda_kg: 0 })],
      [saida({ entrega: '2026-05-30', peso: 300, status: 'Entregue' })],
    )
    expect(r).toEqual({ disponivel: true, valor: 70 })
  })

  it('saidas canceladas/devolvidas nao contam para o ritmo de saida', () => {
    const r = giroDeEstoque(
      [entrada({ data: '2026-05-01', peso_total: 1000, perda_kg: 0 })],
      [saida({ entrega: '2026-05-30', peso: 999, status: 'Cancelado' }), saida({ entrega: '2026-05-30', peso: 999, status: 'Devolvido' })],
    )
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

  // DEFEITO 2 (corrigido, mesma duplicacao de diasRecebimento em
  // financeiro.test.ts): o recebimento no mesmo dia da entrega (0 dias)
  // agora ENTRA na media — antes era excluido, piorando o indicador quanto
  // mais clientes pagassem a vista.
  it('inclui recebimento no mesmo dia da entrega (0 dias) na media — defeito corrigido', () => {
    const r = cicloRecebimentoDias([
      saida({ entrega: '2026-06-01', data_pag: '2026-06-01' }), // 0 dias, agora entra
      saida({ entrega: '2026-06-01', data_pag: '2026-06-05' }), // 4 dias
      saida({ entrega: '2026-06-01', data_pag: '2026-06-07' }), // 6 dias
    ])
    // media (0+4+6)/3 = 10/3. Com o defeito antigo (filtro `> 0`), o 0 seria
    // excluido e a media seria (4+6)/2 = 5 — diferente do valor correto.
    expect(r).toEqual({ disponivel: true, valor: 10 / 3 })
  })

  it('nao confunde pagamento no mesmo dia (0) com ausencia de data de pagamento (null)', () => {
    const r = cicloRecebimentoDias([
      saida({ entrega: '2026-06-01', data_pag: '2026-06-01' }), // 0 dias, entra
      saida({ entrega: '2026-06-01', data_pag: null }), // sem data, fica de fora
    ])
    expect(r).toEqual({ disponivel: true, valor: 0 })
  })
})

describe('cicloDeCaixa — destravado, delegado a calcularCicloCaixa (derive/financeiro.ts)', () => {
  it('indisponivel (nao 0) quando falta qualquer um dos tres componentes', () => {
    // sem nenhuma entrada paga -> pagamentoProdutor null -> total null,
    // mesmo com estoque e recebimento calculaveis (mesmo caso de
    // calcularCicloCaixa em financeiro.test.ts)
    const entradas = [entrada({ pago: 'Pendente', data_pag: null, peso_total: 1000, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-06-01', data_pag: '2026-06-13', status: 'Entregue', peso: 300 })]
    expect(cicloDeCaixa(entradas, saidas)).toEqual({
      disponivel: false,
      motivo: 'requer giro de estoque, recebimento e pagamento ao produtor calculáveis ao mesmo tempo (falta ao menos um)',
    })
  })

  it('estoque + recebimento - pagamento ao produtor (CCC padrao), quando os tres sao calculaveis', () => {
    // fixture IDENTICA a calcularCicloCaixa em financeiro.test.ts (mesma
    // conta, mesma funcao importada — os dois modulos tem que bater):
    // pagamentoProdutor=3 (05-01->05-04), estoque=70 (30 dias reais 'all'
    // entre 05-01 e 05-30, (1000-300)/(300/30)), recebimento=12 (05-30->06-11)
    // total = 70 + 12 - 3 = 79
    const entradas = [
      entrada({ data: '2026-05-01', data_pag: '2026-05-04', pago: 'Pago', peso_total: 1000, perda_kg: 0 }),
    ]
    const saidas = [
      saida({ entrega: '2026-05-30', data_pag: '2026-06-11', status: 'Entregue', peso: 300 }),
    ]
    expect(cicloDeCaixa(entradas, saidas)).toEqual({ disponivel: true, valor: 79 })
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

describe('indiceDePerdas reconcilia perda de coleta', () => {
  // O total no cabecalho da entrada e a soma das perdas dos itens sao o mesmo
  // evento em duas granularidades (o prototipo recalcula o cabecalho a partir
  // dos itens ao salvar). Somar os dois desconta em dobro; usar so o cabecalho
  // ignora o detalhe quando ele e maior. A regra e o maior dos dois, e ela
  // precisa bater com estoque e relatorios — dois indicadores que deveriam
  // coincidir e nao coincidem sao piores que um indicador ausente.
  const entrada = (perda_kg: number, perda_itens_qtd: number) => ({
    id: 'e1', data: '2026-06-01', pago: 'Pago' as const, data_pag: '2026-06-02',
    perda_kg, perda_itens_qtd, valor_total: 1000, peso_total: 1000,
  })

  it('usa o cabecalho quando ele e maior que a soma dos itens', () => {
    const r = indiceDePerdas([entrada(100, 40)], [])
    expect(r.disponivel && r.valor).toBeCloseTo(10)
  })

  it('usa a soma dos itens quando ela e maior que o cabecalho', () => {
    const r = indiceDePerdas([entrada(40, 100)], [])
    expect(r.disponivel && r.valor).toBeCloseTo(10)
  })

  it('nao soma os dois (evita descontar a mesma perda duas vezes)', () => {
    const r = indiceDePerdas([entrada(100, 100)], [])
    // somando daria 20%; o correto e 10%
    expect(r.disponivel && r.valor).toBeCloseTo(10)
  })
})
