/**
 * Os sete relatórios da tela de Relatórios — portados de renderVals() em
 * design/CRM Hortifruti.dc.html:2626-2773 (comentário "---- relatórios ----"
 * até o fim do bloco), com os cálculos auxiliares que eles reaproveitam
 * (healthOf/_parseDate mais acima no mesmo arquivo, perdaMedia/fmtBR no
 * bloco "financeiro" que os alimenta). O documento de requisitos lista essas
 * sete contas entre as que não podem quebrar em nenhuma alteração futura —
 * even assim, elas foram portadas como estão: qualquer esquisitice do
 * protótipo (ex.: um valor arredondado num lugar e não noutro) foi mantida
 * de propósito e está comentada onde aparece, nunca corrigida em silêncio.
 *
 * Convenção de arredondamento (igual ao molde, derive/clientes.ts): os
 * números aqui saem CRUS — sem toFixed/toLocaleString — exceto nos poucos
 * pontos em que o PRÓPRIO protótipo arredonda antes de usar o valor de novo
 * (ex.: ticketEntrega por cliente entra arredondado no cálculo de saúde).
 * Formatação (R$, %, casas decimais) é responsabilidade da tela
 * (RelatoriosTela.tsx), igual a ClientesLista.tsx sobre derivarClientes.
 *
 * Sem React, sem fetch: só os tipos de entrada (o formato que cada
 * GET /api/... devolve) e as funções puras que calculam cada relatório.
 */

import { healthDoCliente, type Cliente, type Health, type StatusCliente } from './clientes'
import type { Fornecedor } from './fornecedores'
import type { Lancamento } from './lancamentos'

// ---------------------------------------------------------------- entrada

/** Cabeçalho de uma saída (venda), como GET /api/saidas devolve — ver
 * api/src/routes/saidas.ts (paraJson) e web/src/components/ModalSaida.tsx.
 * `valor`/`peso` são os totais agregados dos itens que GET / calcula em
 * SQL; nenhum dos sete relatórios precisa dos itens em si (ver nota sobre
 * o relatório de produtos, mais abaixo). */
export interface SaidaResumo {
  numero: string
  cliente_id: string | null
  rota: string
  entrega: string | null
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  venc: string | null
  data_pag: string | null
  perda_kg: number
  valor: number
  peso: number
}

/** Cabeçalho de uma entrada (compra), como GET /api/entradas devolve — ver
 * api/src/routes/entradas.ts (paraJsonLista). `valor_total`/`peso_total`
 * são os totais agregados dos itens.
 *
 * `perda_kg` (cabeçalho) e `perda_itens_qtd` (soma de entrada_itens.perda_kg
 * dessa entrada) descrevem o MESMO evento de perda na coleta em duas
 * granularidades — nunca dois números independentes a somar. Ver
 * perdaColetaEfetiva() logo abaixo e o comentário grande em
 * api/src/routes/estoque.ts (buscarEstoque) para a evidência e o raciocínio
 * completo (o protótipo recalcula o cabeçalho a partir dos itens ao salvar
 * a entrada; a API portada não reproduz esse recálculo, então os dois
 * campos podem divergir na prática). */
export interface EntradaResumo {
  numero: string
  fornecedor_id: string | null
  data: string
  perda_kg: number
  /** Soma de entrada_itens.perda_kg desta entrada — ver perdaColetaEfetiva(). */
  perda_itens_qtd: number
  motivo: string
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  valor_total: number
  peso_total: number
}

/**
 * A perda de coleta "de verdade" de uma entrada: o MAIOR entre o cabeçalho
 * (perda_kg) e a soma dos itens dela (perda_itens_qtd), nunca a soma dos
 * dois — somar contaria a mesma perda duas vezes sempre que os dois campos
 * descreverem o mesmo evento (o caso normal, fiel ao protótipo). Usada
 * pelos relatórios que agrupam por uma dimensão do CABEÇALHO da entrada
 * (fornecedor, motivo) — diferente de api/src/routes/relatorios.ts e
 * api/src/routes/estoque.ts, que agrupam por PRODUTO e por isso, quando o
 * cabeçalho excede a soma dos itens, precisam ratear a diferença
 * proporcionalmente (o cabeçalho não tem produto_id próprio); aqui a
 * entrada inteira já É a unidade de agregação, então o máximo simples
 * basta — ver o comentário grande em buscarEstoque (estoque.ts) para o
 * raciocínio completo por trás da regra.
 */
export function perdaColetaEfetiva(en: Pick<EntradaResumo, 'perda_kg' | 'perda_itens_qtd'>): number {
  return Math.max(en.perda_kg || 0, en.perda_itens_qtd || 0)
}

/** Perda de depósito (pós-entrada), como GET /api/perdas devolve — ver
 * api/src/routes/perdas.ts. */
export interface PerdaDeposito {
  data: string
  produto_id: string
  qtd: number
  motivo: string
}

/**
 * Uma linha de GET /api/relatorios/produtos — o único relatório desta tela
 * que precisa dos ITENS de entrada/saída (quanto de cada produto foi
 * comprado e vendido), não só dos cabeçalhos. Ver api/src/routes/relatorios.ts
 * para o porquê dessa soma ter ido para SQL em vez de vir para cá como as
 * outras seis: em resumo, GET /api/entradas e GET /api/saidas não trazem os
 * itens (de propósito, ver comentário nas duas rotas), e buscar item por
 * item via GET /:id de cada linha do período seria N+1 (~116ms por ida ao
 * banco medidos em produção — inviável com dezenas/centenas de linhas).
 */
export interface ProdutoAgregado {
  produto_id: string
  nome: string
  un: string
  compra_qtd: number
  compra_valor: number
  perda_coleta_qtd: number
  venda_qtd: number
  venda_valor: number
  perda_deposito_qtd: number
}

// ------------------------------------------------------------- utilidades

/** 'AAAA-MM' de uma data ISO ('AAAA-MM-DD...'). Vazio se a data for inválida
 * — mesmo formato de mesDe() em derive/clientes.ts, mas com o ano incluído:
 * o protótipo filtrava só pelo mês (seed inteiro em 2026-06) porque o
 * dropdown de período dele é fixo; aqui o filtro é um intervalo De/Até
 * (mesmo padrão de LancamentosLista.tsx), que precisa do ano para não
 * misturar junho/2025 com junho/2026. */
function periodoDe(iso: string): string {
  return typeof iso === 'string' && iso.length >= 7 ? iso.slice(0, 7) : ''
}

/**
 * true se `iso` cai dentro do intervalo [de, ate] (strings 'AAAA-MM',
 * qualquer uma podendo vir vazia = sem limite naquele lado). Mesma semântica
 * de LancamentosLista.tsx (mesDe + os dois `if`): quando de/ate estão VAZIOS
 * (sem filtro), tudo passa — mesmo uma data ausente/inválida. Só quando há
 * filtro ativo é que uma data ausente (periodoDe === '') fica de fora
 * (string vazia é sempre "menor" que 'AAAA-MM' na comparação).
 */
export function noPeriodo(iso: string | null | undefined, de: string, ate: string): boolean {
  const mes = periodoDe(iso ?? '')
  if (de && mes < de) return false
  if (ate && mes > ate) return false
  return true
}

/** Porta _parseDate() do protótipo (design/CRM Hortifruti.dc.html:1854) só
 * no ramo ISO: a API sempre devolve datas 'AAAA-MM-DD' (dataParaTexto em
 * api/src/routes/saidas.ts), o ramo legado 'dd/mm(/aaaa)' do protótipo
 * existia para dado antigo de localStorage e não tem como aparecer aqui.
 * Constrói a data com os componentes locais (não `new Date(iso)`, que
 * interpretaria a string como UTC e podia voltar um dia dependendo do fuso)
 * — mesmo cuidado do original. */
function parseDataLocal(iso: string | null | undefined): number | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

/**
 * Gera o texto de um CSV pt-BR — porta exportarCSV do protótipo
 * (design/CRM Hortifruti.dc.html:1794-1805), exceto a parte de download
 * (Blob + <a download>), que é DOM e fica na tela: função pura não abre
 * blob nem clica em nada.
 *
 * Duas escolhas deliberadas, ambas do original: separador ';' (não ',') —
 * o Excel em português espera ponto e vírgula; com vírgula, todo o CSV cai
 * numa coluna só e parece que o sistema quebrou. E o BOM UTF-8 (`﻿`) no
 * início — sem ele o Excel abre 'ã'/'ç' como lixo.
 */
export function gerarCsv(cabecalho: string[], linhas: (string | number)[][]): string {
  const escapar = (v: string | number): string => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const todas = [cabecalho, ...linhas].map(linha => linha.map(escapar).join(';'))
  return '﻿' + todas.join('\r\n')
}

// -------------------------------------------------------- 1. relatório de clientes

export interface LinhaRelatorioCliente {
  id: string
  nome: string
  rota: string
  status: StatusCliente
  /** nº de entregas (status Entregue) no período. */
  pedidos: number
  faturado: number
  ticketEntrega: number
  participacaoPct: number
  inadimplenciaPct: number
  health: Health
}

export interface RelatorioClientesTotais {
  clientesAtivos: number
  clientesTotal: number
  faturamentoPeriodo: number
  ticketMedioCliente: number
  inadimplenciaMediaPct: number
}

/**
 * Porta o bloco `relClientesRows`/`relClientesTot` (linhas 2627-2643 do
 * protótipo). Diferença deliberada: o protótipo agrupa pedidos por
 * `p.cliente` (nome, texto livre em localStorage); aqui agrupa por
 * `cliente_id` (chave estrangeira real) — a migration 009 já registra essa
 * troca como intencional ("REFERENCIA POR ID, NAO POR NOME": renomear um
 * cliente não pode órfã o histórico dele). O cálculo em si é o mesmo.
 */
export function derivarRelatorioClientes(
  clientes: Cliente[],
  saidas: SaidaResumo[],
  de: string,
  ate: string,
): { linhas: LinhaRelatorioCliente[]; totais: RelatorioClientesTotais } {
  const doPeriodo = saidas.filter(s => noPeriodo(s.entrega, de, ate))
  const entregues = doPeriodo.filter(s => s.status === 'Entregue')
  const receitaFat = entregues.reduce((s, p) => s + (p.valor || 0), 0)

  const fatPorCliente = new Map<string, number>()
  const entPorCliente = new Map<string, number>()
  const atrasoPorCliente = new Map<string, number>()
  entregues.forEach(p => {
    if (!p.cliente_id) return
    fatPorCliente.set(p.cliente_id, (fatPorCliente.get(p.cliente_id) || 0) + (p.valor || 0))
    entPorCliente.set(p.cliente_id, (entPorCliente.get(p.cliente_id) || 0) + 1)
  })
  doPeriodo.filter(p => p.pag === 'Atrasado').forEach(p => {
    if (!p.cliente_id) return
    atrasoPorCliente.set(p.cliente_id, (atrasoPorCliente.get(p.cliente_id) || 0) + (p.valor || 0))
  })
  const inadDoCliente = (id: string): number => {
    const f = fatPorCliente.get(id) || 0
    return f > 0 ? ((atrasoPorCliente.get(id) || 0) / f) * 100 : 0
  }

  const linhas = clientes.map(c => {
    const faturado = fatPorCliente.get(c.id) || 0
    const pedidos = entPorCliente.get(c.id) || 0
    // Arredondado AQUI (não só na exibição): o protótipo alimenta o ticket
    // já arredondado em healthOf (te<150/te<430), então o arredondamento
    // afeta o resultado do health score, não é só cosmético.
    const ticketEntrega = pedidos ? Math.round(faturado / pedidos) : 0
    const inadimplenciaPct = inadDoCliente(c.id)
    return {
      id: c.id,
      nome: c.nome,
      rota: c.rota,
      status: c.status,
      pedidos,
      faturado,
      ticketEntrega,
      participacaoPct: receitaFat > 0 ? Math.round((faturado / receitaFat) * 100) : 0,
      inadimplenciaPct,
      health: healthDoCliente(c, inadimplenciaPct, ticketEntrega),
    }
  }).sort((a, b) => b.faturado - a.faturado)

  const ativos = clientes.filter(c => c.status === 'ativo')
  const clientesAtendidos = new Set(
    entregues.map(p => p.cliente_id).filter((id): id is string => !!id),
  ).size
  const valorAtraso = doPeriodo.filter(p => p.pag === 'Atrasado').reduce((s, p) => s + (p.valor || 0), 0)

  return {
    linhas,
    totais: {
      clientesAtivos: ativos.length,
      clientesTotal: clientes.length,
      faturamentoPeriodo: receitaFat,
      ticketMedioCliente: clientesAtendidos ? receitaFat / clientesAtendidos : 0,
      inadimplenciaMediaPct: receitaFat > 0 ? (valorAtraso / receitaFat) * 100 : 0,
    },
  }
}

// --------------------------------------------------- 2. lista de inadimplentes

export interface LinhaInadimplente {
  clienteId: string
  cliente: string
  resp: string
  tel: string
  pedidosAtraso: number
  valorAtraso: number
  /** ISO do vencimento (ou entrega, na ausência dele) mais antigo em atraso. */
  vencimentoMaisAntigo: string | null
  /** Dias corridos entre o vencimento mais antigo e `hojeIso`. null sem data válida. */
  diasAtraso: number | null
  /** % do faturamento do cliente no período que está em atraso. null sem faturamento (não "0%"). */
  pctDoFaturamentoDele: number | null
}

export interface RelatorioInadimplentesTotais {
  totalEmAtraso: number
  pedidosEmAtraso: number
  clientesInadimplentes: number
  clientesTotal: number
  pctDaReceita: number
  maiorDevedor: { cliente: string; valor: number } | null
}

/**
 * Porta o bloco `relInad`/`relInadTot` (linhas 2716-2740 do protótipo).
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável — a tela passa a data corrente.
 */
export function derivarRelatorioInadimplentes(
  clientes: Cliente[],
  saidas: SaidaResumo[],
  de: string,
  ate: string,
  hojeIso: string,
): { linhas: LinhaInadimplente[]; totais: RelatorioInadimplentesTotais } {
  const doPeriodo = saidas.filter(s => noPeriodo(s.entrega, de, ate))
  const entregues = doPeriodo.filter(s => s.status === 'Entregue')
  const receitaFat = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  const fatPorCliente = new Map<string, number>()
  entregues.forEach(p => {
    if (p.cliente_id) fatPorCliente.set(p.cliente_id, (fatPorCliente.get(p.cliente_id) || 0) + (p.valor || 0))
  })

  const atrasados = doPeriodo.filter(p => p.pag === 'Atrasado')
  const agg = new Map<string, { peds: number; valor: number; maisAntigo: number | null; vencs: string[] }>()
  atrasados.forEach(p => {
    if (!p.cliente_id) return
    const o = agg.get(p.cliente_id) ?? { peds: 0, valor: 0, maisAntigo: null, vencs: [] }
    o.peds++
    o.valor += p.valor || 0
    const dataRef = p.venc || p.entrega
    const t = parseDataLocal(dataRef)
    if (t != null && (o.maisAntigo == null || t < o.maisAntigo)) o.maisAntigo = t
    if (dataRef) o.vencs.push(dataRef)
    agg.set(p.cliente_id, o)
  })

  const hojeTs = parseDataLocal(hojeIso)
  const linhas = Array.from(agg.entries()).map(([clienteId, o]) => {
    const cli = clientes.find(c => c.id === clienteId)
    const fatCli = fatPorCliente.get(clienteId) || 0
    const dias = (hojeTs != null && o.maisAntigo != null)
      ? Math.max(0, Math.round((hojeTs - o.maisAntigo) / 86400000))
      : null
    return {
      clienteId,
      cliente: cli?.nome ?? '—',
      resp: cli?.resp ?? '—',
      tel: cli?.tel ?? '—',
      pedidosAtraso: o.peds,
      valorAtraso: o.valor,
      // vencs.sort() ordena as strings ISO alfabeticamente — a mais antiga
      // fica em [0]. Mesma linha do protótipo (o.vencs.slice().sort()[0]).
      vencimentoMaisAntigo: o.vencs.length ? o.vencs.slice().sort()[0] : null,
      diasAtraso: dias,
      pctDoFaturamentoDele: fatCli > 0 ? Math.round((o.valor / fatCli) * 100) : null,
    }
  }).sort((a, b) => b.valorAtraso - a.valorAtraso)

  const totalEmAtraso = linhas.reduce((s, l) => s + l.valorAtraso, 0)
  return {
    linhas,
    totais: {
      totalEmAtraso,
      pedidosEmAtraso: atrasados.length,
      clientesInadimplentes: linhas.length,
      clientesTotal: clientes.length,
      pctDaReceita: receitaFat > 0 ? (totalEmAtraso / receitaFat) * 100 : 0,
      maiorDevedor: linhas[0] ? { cliente: linhas[0].cliente, valor: linhas[0].valorAtraso } : null,
    },
  }
}

// ------------------------------------------------------------ 3. relatório de pedidos

export interface LinhaStatusPedido {
  status: SaidaResumo['status']
  quantidade: number
  valor: number
}

export interface LinhaRota {
  rota: string
  pedidos: number
  peso: number
  faturado: number
  ticket: number
}

export interface RelatorioPedidosTotais {
  pedidosNoPeriodo: number
  faturadoEntregue: number
  aReceber: number
  pedidosAtrasados: number
  qtdEntregueKg: number
}

/** Ordem fixa de exibição dos status — mesma lista de `statusList` no
 * protótipo (linha 2645). Status com zero pedidos no período é descartado
 * (`.filter(x=>x.count>0)` no original). */
const ORDEM_STATUS: SaidaResumo['status'][] = ['Entregue', 'Em rota', 'Pendente', 'Devolvido', 'Cancelado']

/** Porta o bloco `relPedidosTot`/`relStatus`/`relRotas` (linhas 2645-2649 e
 * 2766-2772 do protótipo). */
export function derivarRelatorioPedidos(
  saidas: SaidaResumo[],
  de: string,
  ate: string,
): { totais: RelatorioPedidosTotais; porStatus: LinhaStatusPedido[]; porRota: LinhaRota[] } {
  const doPeriodo = saidas.filter(s => noPeriodo(s.entrega, de, ate))
  const entregues = doPeriodo.filter(s => s.status === 'Entregue')
  const faturadoEntregue = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  const aReceber = doPeriodo
    .filter(p => p.pag === 'Atrasado' || p.pag === 'Pendente')
    .reduce((s, p) => s + (p.valor || 0), 0)
  const pedidosAtrasados = doPeriodo.filter(p => p.pag === 'Atrasado').length

  const porStatus = ORDEM_STATUS.map(status => {
    const arr = doPeriodo.filter(p => p.status === status)
    return { status, quantidade: arr.length, valor: arr.reduce((s, p) => s + (p.valor || 0), 0) }
  }).filter(s => s.quantidade > 0)

  const rotasAgg = new Map<string, { ped: number; peso: number; fat: number }>()
  doPeriodo.forEach(p => {
    const r = p.rota || '—'
    const o = rotasAgg.get(r) ?? { ped: 0, peso: 0, fat: 0 }
    o.ped++
    o.peso += p.peso || 0
    o.fat += p.valor || 0
    rotasAgg.set(r, o)
  })
  const porRota = Array.from(rotasAgg.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rota, o]) => ({ rota, pedidos: o.ped, peso: o.peso, faturado: o.fat, ticket: o.ped ? o.fat / o.ped : 0 }))

  return {
    totais: {
      pedidosNoPeriodo: doPeriodo.length,
      faturadoEntregue,
      aReceber,
      pedidosAtrasados,
      qtdEntregueKg: entregues.reduce((s, p) => s + (p.peso || 0), 0),
    },
    porStatus,
    porRota,
  }
}

// ------------------------------------------------------------- 4. relatório de compras

export interface LinhaCompraFornecedor {
  fornecedorId: string | null
  fornecedor: string
  coletas: number
  qtd: number
  valor: number
  /** null quando qtd===0 (evita divisão por zero — vira '—' na tela). */
  precoMedio: number | null
  perdaPct: number
  aproveitPct: number
  aPagar: number
}

export interface RelatorioComprasTotais {
  totalComprado: number
  coletasNoPeriodo: number
  fornecedoresNoPeriodo: number
  fornecedoresCadastrados: number
  perdaNaColetaPct: number
  perdaQtd: number
  compradoQtd: number
  aPagarAoProdutor: number
}

/**
 * Porta o bloco `relCompras`/`relComprasTot` (linhas 2650-2673 do
 * protótipo). Mesma troca nome->id de derivarRelatorioClientes, aqui para
 * fornecedor.
 *
 * A perda por fornecedor usa perdaColetaEfetiva(en) (máximo entre cabeçalho
 * e soma dos itens da entrada), não `en.perda_kg` cru — ver o comentário em
 * EntradaResumo/perdaColetaEfetiva, acima: os dois campos descrevem o mesmo
 * evento de perda, somar contaria em dobro.
 */
export function derivarRelatorioCompras(
  fornecedores: Fornecedor[],
  entradas: EntradaResumo[],
  de: string,
  ate: string,
): { linhas: LinhaCompraFornecedor[]; totais: RelatorioComprasTotais } {
  const doPeriodo = entradas.filter(e => noPeriodo(e.data, de, ate))

  const SEM_FORNECEDOR = '—'
  const agg = new Map<string, { coletas: number; qtd: number; valor: number; perda: number; aPagar: number }>()
  doPeriodo.forEach(en => {
    const k = en.fornecedor_id ?? SEM_FORNECEDOR
    const o = agg.get(k) ?? { coletas: 0, qtd: 0, valor: 0, perda: 0, aPagar: 0 }
    o.coletas++
    o.qtd += en.peso_total || 0
    o.valor += en.valor_total || 0
    o.perda += perdaColetaEfetiva(en)
    if (en.pago !== 'Pago') o.aPagar += en.valor_total || 0
    agg.set(k, o)
  })

  const linhas = Array.from(agg.entries()).map(([fornecedorId, o]) => {
    const pp = o.qtd > 0 ? (o.perda / o.qtd) * 100 : 0
    return {
      fornecedorId: fornecedorId === SEM_FORNECEDOR ? null : fornecedorId,
      fornecedor: fornecedorId === SEM_FORNECEDOR
        ? SEM_FORNECEDOR
        : (fornecedores.find(f => f.id === fornecedorId)?.nome ?? '—'),
      coletas: o.coletas,
      qtd: o.qtd,
      valor: o.valor,
      precoMedio: o.qtd > 0 ? o.valor / o.qtd : null,
      perdaPct: pp,
      aproveitPct: 100 - pp,
      aPagar: o.aPagar,
    }
  }).sort((a, b) => b.valor - a.valor)

  const compradoQtd = doPeriodo.reduce((s, e) => s + (e.peso_total || 0), 0)
  const perdaQtd = doPeriodo.reduce((s, e) => s + perdaColetaEfetiva(e), 0)

  return {
    linhas,
    totais: {
      totalComprado: doPeriodo.reduce((s, e) => s + (e.valor_total || 0), 0),
      coletasNoPeriodo: doPeriodo.length,
      fornecedoresNoPeriodo: linhas.length,
      fornecedoresCadastrados: fornecedores.length,
      perdaNaColetaPct: compradoQtd > 0 ? (perdaQtd / compradoQtd) * 100 : 0,
      perdaQtd,
      compradoQtd,
      aPagarAoProdutor: linhas.reduce((s, l) => s + l.aPagar, 0),
    },
  }
}

// ------------------------------------------------------------ 5. ranking de produtos

export interface LinhaRelatorioProduto {
  produtoId: string
  nome: string
  compradoQtd: number
  vendidoQtd: number
  faturamento: number
  /** Sempre calculado (nunca null) — igual a `_margem` no protótipo, mesmo
   * quando vendidoQtd é 0 (vira 0 nesse caso). A tela mostra '—' quando
   * vendidoQtd===0, mas o "maior margem" do total é escolhido sobre ESTE
   * valor cru, sem filtrar — reproduz o `sort((a,b)=>b._margem-a._margem)`
   * do original, que não exclui produtos sem venda no período. */
  margem: number
  /** null quando não há preço de compra E venda no período (sem base de comparação). */
  markupPct: number | null
  /** null quando compradoQtd===0 (sem base para a %; vira '—' na tela). */
  perdaPct: number | null
}

export interface RelatorioProdutosTotais {
  produtosMovimentados: number
  produtosCadastrados: number
  maisFatura: { nome: string; faturamento: number } | null
  maiorMargem: { nome: string; margem: number } | null
  maiorPerda: { nome: string; perdaPct: number } | null
}

/**
 * Porta o bloco `relProdutos`/`relProdutosTot` (linhas 2674-2699 do
 * protótipo) — a diferença é a ENTRADA: o original monta `prodAgg` varrendo
 * `itens` de cada entrada/saída em memória; aqui a soma por produto já vem
 * pronta de GET /api/relatorios/produtos (ver justificativa no topo do
 * arquivo e em api/src/routes/relatorios.ts). A partir do agregado, a conta
 * é a mesma: preço médio de compra/venda, markup, margem em R$ e % de perda.
 */
export function derivarRelatorioProdutos(
  agregados: ProdutoAgregado[],
  produtosCadastrados: number,
): { linhas: LinhaRelatorioProduto[]; totais: RelatorioProdutosTotais } {
  const linhas = agregados.map(o => {
    const perda = o.perda_coleta_qtd + o.perda_deposito_qtd
    const cm = o.compra_qtd > 0 ? o.compra_valor / o.compra_qtd : 0
    const vm = o.venda_qtd > 0 ? o.venda_valor / o.venda_qtd : 0
    const markupPct = (cm > 0 && vm > 0) ? ((vm - cm) / cm) * 100 : null
    const margem = o.venda_valor - o.venda_qtd * cm
    const perdaPct = o.compra_qtd > 0 ? (perda / o.compra_qtd) * 100 : null
    return {
      produtoId: o.produto_id,
      nome: o.nome,
      compradoQtd: o.compra_qtd,
      vendidoQtd: o.venda_qtd,
      faturamento: o.venda_valor,
      margem,
      markupPct,
      perdaPct,
    }
  }).sort((a, b) => b.faturamento - a.faturamento)

  const maisVend = linhas[0] ?? null
  const maiorMargem = linhas.length
    ? linhas.slice().sort((a, b) => b.margem - a.margem)[0]
    : null
  const comPerda = linhas.filter(l => l.perdaPct != null)
  const maiorPerda = comPerda.length
    ? comPerda.slice().sort((a, b) => (b.perdaPct as number) - (a.perdaPct as number))[0]
    : null

  return {
    linhas,
    totais: {
      produtosMovimentados: linhas.length,
      produtosCadastrados,
      maisFatura: maisVend ? { nome: maisVend.nome, faturamento: maisVend.faturamento } : null,
      maiorMargem: maiorMargem ? { nome: maiorMargem.nome, margem: maiorMargem.margem } : null,
      maiorPerda: maiorPerda ? { nome: maiorPerda.nome, perdaPct: maiorPerda.perdaPct as number } : null,
    },
  }
}

// ------------------------------------------------------------- 6. relatório de perdas

export interface LinhaPerdaMotivo {
  motivo: string
  qtd: number
  ocorrencias: number
  pct: number
}

export interface LinhaPerdaProduto {
  nome: string
  compradoQtd: number
  perdaPct: number | null
}

export interface RelatorioPerdasTotais {
  perdaTotalQtd: number
  /** Mesmo `perdaMedia` do dashboard/financeiro: perda (coleta + depósito)
   * sobre o total comprado no período, não sobre o total perdido. */
  indicePerdaPct: number
  principalMotivo: string | null
  principalMotivoPct: number | null
  perdasNoDeposito: number
}

/**
 * Porta o bloco `relPerdaMotivos`/`relPerdaProdutos`/`relPerdasTot` (linhas
 * 2700-2715 do protótipo).
 *
 * "Por motivo" usa CABEÇALHO de entrada (motivo + perdaColetaEfetiva) e a
 * lista de perdas de depósito — não busca os itens de cada entrada
 * individualmente, só o total já resolvido em perda_itens_qtd (GET
 * /api/entradas já devolve pronto, ver EntradaResumo/entradas.ts), por isso
 * não depende do endpoint agregado (relatorios/produtos). "Por produto"
 * reaproveita a saída de derivarRelatorioProdutos (`produtosView`, já
 * filtrada pelo mesmo período) em vez de recalcular — mesma fonte que
 * alimenta a aba Produtos, evitando pedir o agregado duas vezes ou duas
 * contas divergirem.
 *
 * A perda de cada entrada usa perdaColetaEfetiva(en) (máximo entre
 * cabeçalho e soma dos itens), não `en.perda_kg` cru — mesmo raciocínio de
 * derivarRelatorioCompras (ver comentário em EntradaResumo/
 * perdaColetaEfetiva, acima): cabeçalho e soma dos itens descrevem o mesmo
 * evento de perda, somar contaria em dobro.
 */
export function derivarRelatorioPerdas(
  entradas: EntradaResumo[],
  perdasDeposito: PerdaDeposito[],
  produtosView: LinhaRelatorioProduto[],
  de: string,
  ate: string,
): { porMotivo: LinhaPerdaMotivo[]; porProduto: LinhaPerdaProduto[]; totais: RelatorioPerdasTotais } {
  const entradasPeriodo = entradas.filter(e => noPeriodo(e.data, de, ate))
  const perdasPeriodo = perdasDeposito.filter(p => noPeriodo(p.data, de, ate))

  const agg = new Map<string, { qtd: number; ocor: number }>()
  entradasPeriodo.forEach(en => {
    const m = (en.motivo && en.motivo !== '—') ? en.motivo : 'não informado'
    const o = agg.get(m) ?? { qtd: 0, ocor: 0 }
    const perda = perdaColetaEfetiva(en)
    o.qtd += perda
    if (perda > 0) o.ocor++
    agg.set(m, o)
  })
  perdasPeriodo.forEach(pe => {
    const m = pe.motivo || 'não informado'
    const o = agg.get(m) ?? { qtd: 0, ocor: 0 }
    o.qtd += pe.qtd || 0
    o.ocor++
    agg.set(m, o)
  })

  const perdaTotalQtd = Array.from(agg.values()).reduce((s, o) => s + o.qtd, 0)
  const porMotivo = Array.from(agg.entries())
    .map(([motivo, o]) => ({
      motivo,
      qtd: o.qtd,
      ocorrencias: o.ocor,
      pct: perdaTotalQtd ? (o.qtd / perdaTotalQtd) * 100 : 0,
    }))
    .sort((a, b) => b.qtd - a.qtd)

  const porProduto = produtosView
    .filter(p => p.perdaPct != null)
    .slice()
    .sort((a, b) => (b.perdaPct as number) - (a.perdaPct as number))
    .map(p => ({ nome: p.nome, compradoQtd: p.compradoQtd, perdaPct: p.perdaPct }))

  const entKgTot = entradasPeriodo.reduce((s, e) => s + (e.peso_total || 0), 0)
  const entPerdaTot = entradasPeriodo.reduce((s, e) => s + perdaColetaEfetiva(e), 0)
    + perdasPeriodo.reduce((s, p) => s + (p.qtd || 0), 0)

  return {
    porMotivo,
    porProduto,
    totais: {
      perdaTotalQtd,
      indicePerdaPct: entKgTot ? (entPerdaTot / entKgTot) * 100 : 0,
      principalMotivo: porMotivo[0]?.motivo ?? null,
      principalMotivoPct: porMotivo[0]?.pct ?? null,
      perdasNoDeposito: perdasPeriodo.length,
    },
  }
}

// -------------------------------------------------------- 7. livro-caixa (lançamentos)

export interface LinhaLedger {
  data: string | null
  origem: string
  tipo: 'Entrada' | 'Saída'
  entrada: number
  saida: number
}

export interface RelatorioLedgerTotais {
  entrou: number
  saiu: number
  saldo: number
  movimentacoes: number
}

/**
 * Porta o bloco `ledger`/`relLancRows`/`relLancTot` (linhas 2609-2624 do
 * protótipo) — o relatório "Lançamentos" da aba, que na verdade é um
 * livro-caixa: soma vendas PAGAS (entrada de dinheiro), compras PAGAS
 * (saída) e todo lançamento de custo (também saída, sem filtro de status —
 * lançamentos não têm campo de pagamento).
 */
export function derivarRelatorioLedger(
  saidas: SaidaResumo[],
  entradas: EntradaResumo[],
  lancamentos: Lancamento[],
  clientes: Cliente[],
  fornecedores: Fornecedor[],
  de: string,
  ate: string,
): { linhas: LinhaLedger[]; totais: RelatorioLedgerTotais } {
  const saidasPeriodo = saidas.filter(s => noPeriodo(s.entrega, de, ate))
  const entradasPeriodo = entradas.filter(e => noPeriodo(e.data, de, ate))
  const lancPeriodo = lancamentos.filter(l => noPeriodo(l.data, de, ate))

  const nomeCliente = (id: string | null): string => (id && clientes.find(c => c.id === id)?.nome) || '—'
  const nomeFornecedor = (id: string | null): string => (id && fornecedores.find(f => f.id === id)?.nome) || '—'

  const linhas: LinhaLedger[] = []
  saidasPeriodo.filter(p => p.pag === 'Pago').forEach(p => {
    linhas.push({
      data: p.data_pag || p.entrega,
      origem: `Venda ${p.numero} — ${nomeCliente(p.cliente_id)}`,
      tipo: 'Entrada',
      entrada: p.valor || 0,
      saida: 0,
    })
  })
  entradasPeriodo.filter(en => en.pago === 'Pago').forEach(en => {
    linhas.push({
      data: en.data_pag || en.data,
      origem: `Compra ${en.numero} — ${nomeFornecedor(en.fornecedor_id)}`,
      tipo: 'Saída',
      entrada: 0,
      saida: en.valor_total || 0,
    })
  })
  lancPeriodo.forEach(l => {
    linhas.push({
      data: l.data,
      origem: l.categoria + (l.descricao ? ' — ' + l.descricao : ''),
      tipo: 'Saída',
      entrada: 0,
      saida: l.valor || 0,
    })
  })
  linhas.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))

  const entrou = linhas.reduce((s, l) => s + l.entrada, 0)
  const saiu = linhas.reduce((s, l) => s + l.saida, 0)
  return { linhas, totais: { entrou, saiu, saldo: entrou - saiu, movimentacoes: linhas.length } }
}
