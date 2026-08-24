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
import { situacaoExibidaSaida } from './pagamento'

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
  /** SEMPRE em kg — a API converte cada item pela unidade dele (item em 'KG'
   * conta `qtd`; em outra unidade conta `qtd * produtos.peso_medio`). Ver
   * `itens_sem_conversao` abaixo para o que fica de fora. */
  peso: number
  /**
   * Quantos itens desta saída ficaram FORA de `peso`: produto lançado em
   * unidade diferente de KG sem `produtos.peso_medio` cadastrado (0 = não
   * informado), portanto não convertível em quilos. A API não inventa fator
   * nenhum (uma caixa não pesa um quilo) e não some com o problema: exclui a
   * contribuição do item e conta quantos foram, para a tela poder dizer que
   * o total está incompleto. Mesma convenção de
   * `EntradaResumo.itens_sem_conversao` — ver o comentário grande em
   * api/src/routes/saidas.ts (GET /).
   *
   * Opcional pelo mesmo motivo do campo irmão em EntradaResumo: a API sempre
   * envia, mas fixtures de teste montam saídas parciais e ausente tem
   * exatamente o mesmo significado que 0 (nada ficou de fora).
   */
  itens_sem_conversao?: number
}

/** Cabeçalho de uma entrada (compra), como GET /api/entradas devolve — ver
 * api/src/routes/entradas.ts (paraJsonLista). `valor_total`/`peso_total`
 * são os totais agregados dos itens — `peso_total` SEMPRE em kg (a API
 * converte cada item pela unidade dele, ver `itens_sem_conversao` abaixo).
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
  /**
   * Quantos itens desta entrada ficaram FORA de `peso_total`: produto
   * lançado em unidade diferente de KG sem `produtos.peso_medio` cadastrado
   * (0 = não informado), portanto não convertível em quilos. A API não
   * inventa fator nenhum (uma caixa não pesa um quilo) e não some com o
   * problema: exclui a contribuição do item e conta quantos foram, para a
   * tela poder dizer que o total está incompleto em vez de exibir um número
   * silenciosamente menor do que a realidade. Ver o comentário grande em
   * api/src/routes/entradas.ts (GET /).
   *
   * Opcional pelo mesmo motivo dos campos de perdaColetaEfetiva: a API
   * sempre envia, mas fixtures de teste montam entradas parciais e ausente
   * tem exatamente o mesmo significado que 0 (nada ficou de fora).
   */
  itens_sem_conversao?: number
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
export function perdaColetaEfetiva(
  // Campos opcionais de proposito: a API sempre envia os dois, mas fixtures de
  // teste montam entradas parciais, e o `|| 0` abaixo ja trata ausencia. Exigir
  // ambos obrigaria a reescrever dezenas de fixtures sem ganho de correcao —
  // ausente e zero produzem o mesmo resultado nesta conta.
  en: { perda_kg?: number; perda_itens_qtd?: number },
): number {
  return Math.max(en.perda_kg || 0, en.perda_itens_qtd || 0)
}

/**
 * Perda de depósito (pós-entrada), como GET /api/perdas devolve — ver
 * api/src/routes/perdas.ts.
 *
 * `qtd` (a quantidade na unidade da PRÓPRIA perda) NÃO está declarada aqui
 * de propósito, embora a API a envie: este módulo soma perdas com números que
 * já estão em quilos (a perda de coleta e o peso comprado), e declarar o
 * campo cru convidaria de volta o defeito que esta versão corrigiu — 4 caixas
 * entrando na conta como "4". O que se soma é `qtd_kg`, e nada mais.
 */
export interface PerdaDeposito {
  data: string
  produto_id: string
  motivo: string
  /**
   * A mesma perda em quilos, convertida pela API pela unidade dela
   * (`perdas.un`), ao contrário de `entrada_itens.perda_kg`/
   * `saida_itens.perda_kg`, que já são kg por contrato e nunca convertem.
   * `null` = não convertível (produto sem peso médio): fica fora da soma e é
   * contada em `itens_sem_conversao` — nunca vira 1 nem 0.
   */
  qtd_kg?: number | null
  /** 0 ou 1 — cada linha desta rota é um lançamento. Ver perdas.ts. */
  itens_sem_conversao?: number
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
  /** Unidade PADRÃO do cadastro do produto (produtos.un) — só um rótulo do
   * cadastro. As quantidades abaixo NÃO estão nela: saem todas em kg. */
  un: string
  /** Em kg (a API converte cada lançamento pela unidade dele). */
  compra_qtd: number
  compra_valor: number
  /** Em kg — `entrada_itens.perda_kg` já é kg por contrato, sem conversão. */
  perda_coleta_qtd: number
  /** Em kg (a API converte cada lançamento pela unidade dele). */
  venda_qtd: number
  venda_valor: number
  /** Em kg — `perdas.qtd` é uma quantidade na unidade da própria perda, e por
   * isso a API converte (ao contrário de `perda_coleta_qtd`). */
  perda_deposito_qtd: number
  /**
   * Quantos lançamentos deste produto ficaram FORA das três quantidades
   * acima: unidade diferente de KG sem `produtos.peso_medio` cadastrado,
   * portanto não convertível em quilos. Um contador só para as três fontes
   * (compra, venda e perda de depósito) porque as cinco métricas da linha —
   * compra média, venda média, markup, margem e perda % — saem todas de
   * quantidades DESTE produto: qualquer lançamento de fora deixa a linha
   * inteira incompleta. Ver o comentário grande em api/src/routes/relatorios.ts.
   *
   * Opcional pelo mesmo motivo dos campos irmãos em EntradaResumo/SaidaResumo:
   * a API sempre envia, mas fixtures de teste montam agregados parciais e
   * ausente significa exatamente 0 (nada ficou de fora).
   */
  itens_sem_conversao?: number
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
 *
 * "Em atraso" (pra atrasoPorCliente/inadimplenciaPct) usa situacaoExibidaSaida
 * (derive/pagamento.ts), não `pag === 'Atrasado'` cru — mesma razão de
 * inadimplenciaPorCliente em derive/clientes.ts: desde que a interface
 * parou de gravar 'Atrasado' à mão, o campo cru só reflete registros
 * ANTIGOS, e filtrar por ele faria a inadimplência da carteira caminhar pra
 * zero conforme esses registros forem sendo substituídos por vendas novas
 * (sempre 'Pendente'/'Pago'), mesmo com dívida real se acumulando. Não é
 * infidelidade ao protótipo, é consequência de 'Atrasado' ter deixado de
 * ser um campo digitado. `hojeIso` é parâmetro pelo mesmo motivo de
 * situacaoExibidaSaida: função pura, testável sem mockar relógio.
 */
export function derivarRelatorioClientes(
  clientes: Cliente[],
  saidas: SaidaResumo[],
  de: string,
  ate: string,
  hojeIso: string,
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
  doPeriodo.filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado').forEach(p => {
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
  const valorAtraso = doPeriodo
    .filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado')
    .reduce((s, p) => s + (p.valor || 0), 0)

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
 *
 * "Em atraso" (o agrupamento `atrasados` abaixo) usa situacaoExibidaSaida
 * (derive/pagamento.ts), não `pag === 'Atrasado'` cru — mesma razão
 * documentada em derivarRelatorioClientes, acima: a interface parou de
 * gravar 'Atrasado' à mão, então o campo cru só continua correto pra
 * registros ANTIGOS (que situacaoExibidaSaida também reconhece, pelo
 * primeiro ramo da regra). Filtrar pelo campo gravado esvaziaria este
 * relatório aos poucos, o oposto do que uma lista de inadimplentes deveria
 * fazer conforme a dívida cresce.
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

  const atrasados = doPeriodo.filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado')
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
  /** Em kg — a API já converte cada item pela unidade dele. Incompleta
   * quando `itensSemConversao > 0`. */
  peso: number
  /** Itens dos pedidos desta rota, no período, que ficaram fora de `peso`
   * por não serem convertíveis em quilos (unidade ≠ KG sem
   * `produtos.peso_medio`). 0 = o total está completo. Ver
   * `SaidaResumo.itens_sem_conversao`. */
  itensSemConversao: number
  faturado: number
  ticket: number
}

export interface RelatorioPedidosTotais {
  pedidosNoPeriodo: number
  faturadoEntregue: number
  aReceber: number
  pedidosAtrasados: number
  /** Em kg de verdade, agora que a API converte cada item — o nome do campo
   * prometia quilos desde sempre, mas somava caixa com quilo no mesmo total.
   * Incompleta quando `itensSemConversao > 0`. */
  qtdEntregueKg: number
  /** Itens dos pedidos ENTREGUES do período que ficaram fora de
   * `qtdEntregueKg` por não serem convertíveis em quilos. */
  itensSemConversao: number
}

/** Ordem fixa de exibição dos status — mesma lista de `statusList` no
 * protótipo (linha 2645). Status com zero pedidos no período é descartado
 * (`.filter(x=>x.count>0)` no original). */
const ORDEM_STATUS: SaidaResumo['status'][] = ['Entregue', 'Em rota', 'Pendente', 'Devolvido', 'Cancelado']

/** Porta o bloco `relPedidosTot`/`relStatus`/`relRotas` (linhas 2645-2649 e
 * 2766-2772 do protótipo).
 *
 * `aReceber` NÃO precisou trocar para situacaoExibidaSaida: soma pedidos com
 * `pag` 'Atrasado' OU 'Pendente', e como 'Atrasado' derivado só existe a
 * partir de um `pag` gravado 'Pendente' (ver pagamento.ts), o conjunto
 * {pag==='Atrasado' ∪ pag==='Pendente'} já é idêntico ao conjunto
 * {situacao exibida==='Atrasado' ∪ situacao exibida==='Pendente'} —
 * matematicamente a mesma soma, com ou sem `hojeIso`.
 *
 * `pedidosAtrasados`, por outro lado, conta SÓ o subconjunto 'Atrasado' —
 * aí a troca importa: usa situacaoExibidaSaida (derive/pagamento.ts) pra não
 * subcontar pedidos 'Pendente' com vencimento já vencido, mesma razão
 * documentada em derivarRelatorioClientes/derivarRelatorioInadimplentes,
 * acima. `hojeIso` novo parâmetro por isso.
 *
 * `qtdEntregueKg` e o `peso` por rota vêm de `SaidaResumo.peso`, que a API
 * entrega em kg (cada item convertido pela unidade dele). Nem todo pedido é
 * 100% convertível: item em unidade diferente de KG cujo produto não tem
 * `peso_medio` cadastrado fica de fora do peso — a API conta esses itens em
 * `itens_sem_conversao` em vez de inventar um fator, e aqui esse contador é
 * somado por rota e no total, para a tela marcar a quantidade afetada em vez
 * de exibi-la como número fechado. Mesma convenção do relatório de compras
 * (derivarRelatorioCompras, abaixo).
 */
export function derivarRelatorioPedidos(
  saidas: SaidaResumo[],
  de: string,
  ate: string,
  hojeIso: string,
): { totais: RelatorioPedidosTotais; porStatus: LinhaStatusPedido[]; porRota: LinhaRota[] } {
  const doPeriodo = saidas.filter(s => noPeriodo(s.entrega, de, ate))
  const entregues = doPeriodo.filter(s => s.status === 'Entregue')
  const faturadoEntregue = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  const aReceber = doPeriodo
    .filter(p => p.pag === 'Atrasado' || p.pag === 'Pendente')
    .reduce((s, p) => s + (p.valor || 0), 0)
  const pedidosAtrasados = doPeriodo.filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado').length

  const porStatus = ORDEM_STATUS.map(status => {
    const arr = doPeriodo.filter(p => p.status === status)
    return { status, quantidade: arr.length, valor: arr.reduce((s, p) => s + (p.valor || 0), 0) }
  }).filter(s => s.quantidade > 0)

  const rotasAgg = new Map<string, { ped: number; peso: number; fat: number; semConversao: number }>()
  doPeriodo.forEach(p => {
    const r = p.rota || '—'
    const o = rotasAgg.get(r) ?? { ped: 0, peso: 0, fat: 0, semConversao: 0 }
    o.ped++
    o.peso += p.peso || 0
    o.fat += p.valor || 0
    o.semConversao += p.itens_sem_conversao || 0
    rotasAgg.set(r, o)
  })
  const porRota = Array.from(rotasAgg.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rota, o]) => ({
      rota, pedidos: o.ped, peso: o.peso, itensSemConversao: o.semConversao,
      faturado: o.fat, ticket: o.ped ? o.fat / o.ped : 0,
    }))

  return {
    totais: {
      pedidosNoPeriodo: doPeriodo.length,
      faturadoEntregue,
      aReceber,
      pedidosAtrasados,
      qtdEntregueKg: entregues.reduce((s, p) => s + (p.peso || 0), 0),
      // Só dos ENTREGUES, o mesmo conjunto de `qtdEntregueKg` — o contador
      // tem que descrever exatamente a soma que ele qualifica. A tabela por
      // rota tem o dela, sobre o conjunto dela (todos os pedidos do período).
      itensSemConversao: entregues.reduce((s, p) => s + (p.itens_sem_conversao || 0), 0),
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
  /** Em kg — a API já converte cada item pela unidade dele. Incompleta
   * quando `itensSemConversao > 0`. */
  qtd: number
  valor: number
  /** null quando qtd===0 (evita divisão por zero — vira '—' na tela).
   *
   * Quando `itensSemConversao > 0` este preço é por quilo de uma quantidade
   * INCOMPLETA — o valor dos itens sem peso médio entra no numerador (reais
   * são reais, independem da unidade) mas o peso deles não entra no
   * denominador, então o preço médio sai para cima. Não é um número para
   * exibir limpo: a tela marca a célula e explica o que ficou de fora. */
  precoMedio: number | null
  /**
   * Itens deste fornecedor, no período, que ficaram fora de `qtd` por não
   * serem convertíveis em quilos (unidade ≠ KG sem `produtos.peso_medio`).
   * 0 = o total está completo. Ver `EntradaResumo.itens_sem_conversao`.
   */
  itensSemConversao: number
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
  /** Em kg, igual a `LinhaCompraFornecedor.qtd` — incompleta quando
   * `itensSemConversao > 0`. */
  compradoQtd: number
  /** Total de itens do período que ficaram fora de `compradoQtd` (soma do
   * `itensSemConversao` de todas as linhas). */
  itensSemConversao: number
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
 *
 * `qtd` (e portanto `precoMedio = valor / qtd`) vem de `peso_total`, que a
 * API entrega em kg. Nem toda entrada é 100% conversível: item em unidade
 * diferente de KG cujo produto não tem `peso_medio` cadastrado fica de fora
 * do peso — a API conta esses itens em `itens_sem_conversao` em vez de
 * inventar um fator. Aqui esse contador é somado por fornecedor e no total,
 * para a tela marcar o preço médio afetado em vez de exibi-lo como número
 * limpo (ele sai para cima: o valor do item incomparável continua no
 * numerador, o peso dele não entra no denominador).
 */
export function derivarRelatorioCompras(
  fornecedores: Fornecedor[],
  entradas: EntradaResumo[],
  de: string,
  ate: string,
): { linhas: LinhaCompraFornecedor[]; totais: RelatorioComprasTotais } {
  const doPeriodo = entradas.filter(e => noPeriodo(e.data, de, ate))

  const SEM_FORNECEDOR = '—'
  const agg = new Map<string, {
    coletas: number; qtd: number; valor: number; perda: number; aPagar: number; semConversao: number
  }>()
  doPeriodo.forEach(en => {
    const k = en.fornecedor_id ?? SEM_FORNECEDOR
    const o = agg.get(k) ?? { coletas: 0, qtd: 0, valor: 0, perda: 0, aPagar: 0, semConversao: 0 }
    o.coletas++
    o.qtd += en.peso_total || 0
    o.valor += en.valor_total || 0
    o.perda += perdaColetaEfetiva(en)
    o.semConversao += en.itens_sem_conversao || 0
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
      itensSemConversao: o.semConversao,
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
      itensSemConversao: linhas.reduce((s, l) => s + l.itensSemConversao, 0),
      aPagarAoProdutor: linhas.reduce((s, l) => s + l.aPagar, 0),
    },
  }
}

// ------------------------------------------------------------ 5. ranking de produtos

export interface LinhaRelatorioProduto {
  produtoId: string
  nome: string
  /** Em kg — a API já converte cada lançamento pela unidade dele. Incompleta
   * quando `itensSemConversao > 0`. */
  compradoQtd: number
  /** Em kg, mesma regra de `compradoQtd`. */
  vendidoQtd: number
  faturamento: number
  /**
   * Lançamentos deste produto, no período, que ficaram fora das quantidades
   * por não serem convertíveis em quilos (unidade ≠ KG sem
   * `produtos.peso_medio`). Quando > 0, TODOS os números derivados desta
   * linha — compradoQtd, vendidoQtd, margem, markupPct e perdaPct — estão
   * calculados sobre quantidade incompleta e a tela os marca: o valor em
   * reais dos lançamentos de fora continua inteiro, mas o peso deles não
   * entra, então preço médio e markup saem para cima. Ver
   * `ProdutoAgregado.itens_sem_conversao`.
   */
  itensSemConversao: number
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
  /** Total de lançamentos do período que ficaram fora das quantidades (soma
   * do `itensSemConversao` de todas as linhas) — 0 quando o relatório inteiro
   * está completo. É o que decide se a nota de rodapé aparece. */
  itensSemConversao: number
}

/**
 * Porta o bloco `relProdutos`/`relProdutosTot` (linhas 2674-2699 do
 * protótipo) — a diferença é a ENTRADA: o original monta `prodAgg` varrendo
 * `itens` de cada entrada/saída em memória; aqui a soma por produto já vem
 * pronta de GET /api/relatorios/produtos (ver justificativa no topo do
 * arquivo e em api/src/routes/relatorios.ts). A partir do agregado, a conta
 * é a mesma: preço médio de compra/venda, markup, margem em R$ e % de perda.
 *
 * As três quantidades do agregado vêm da API EM KG, com cada lançamento
 * convertido pela unidade dele — antes disso, um produto comprado ora em
 * caixa ora em quilo tinha os dois somados no mesmo total e o
 * `cm = compra_valor / compra_qtd` daqui dividia reais por "caixas mais
 * quilos", o mesmo defeito de preço médio que derivarRelatorioCompras já
 * tinha. Lançamento não convertível (unidade ≠ KG sem `peso_medio`) fica
 * fora da quantidade e é contado em `itens_sem_conversao`; aqui esse contador
 * é repassado por linha e somado no total, para as duas telas que consomem
 * este relatório (Relatórios/aba Produtos e Produtos) marcarem os números
 * afetados em vez de exibi-los limpos.
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
      itensSemConversao: o.itens_sem_conversao || 0,
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
      itensSemConversao: linhas.reduce((s, l) => s + l.itensSemConversao, 0),
    },
  }
}

// ------------------------------------------------------------- 6. relatório de perdas

export interface LinhaPerdaMotivo {
  motivo: string
  /** Em kg: perda de coleta (já kg por contrato) + perda de depósito
   * convertida pela unidade dela. Incompleta quando `itensSemConversao > 0`. */
  qtd: number
  ocorrencias: number
  pct: number
  /**
   * Lançamentos de perda de DEPÓSITO com este motivo que ficaram fora de
   * `qtd` por não serem convertíveis em quilos. A perda de coleta nunca
   * entra nesta contagem: é kg por contrato, sempre completa.
   *
   * Contado por motivo, e não só no total, porque a marca vai na linha: um
   * motivo pode estar fechado e o vizinho não, e marcar os dois ensinaria a
   * ignorar a marca.
   */
  itensSemConversao: number
}

export interface LinhaPerdaProduto {
  nome: string
  /** Em kg — vem de `LinhaRelatorioProduto.compradoQtd`, já convertido pela
   * API. Incompleta quando `itensSemConversao > 0`. */
  compradoQtd: number
  perdaPct: number | null
  /**
   * Lançamentos deste produto que ficaram fora das quantidades por não serem
   * convertíveis em quilos — repassado de `LinhaRelatorioProduto`, que é a
   * fonte desta tabela. Quando > 0, tanto `compradoQtd` quanto `perdaPct`
   * estão calculados sobre quantidade incompleta: esta aba herdou os números
   * corrigidos de `derivarRelatorioProdutos` mas, até agora, não herdava a
   * sinalização — mostrava incompleto como número limpo, que é justamente o
   * que as abas Pedidos e Produtos deixaram de fazer.
   */
  itensSemConversao: number
}

export interface RelatorioPerdasTotais {
  /** Em kg — perda de coleta (kg por contrato) + perda de depósito
   * convertida pela unidade dela. Incompleta quando
   * `itensSemConversaoPerdaTotal > 0`. */
  perdaTotalQtd: number
  /** Mesmo `perdaMedia` do dashboard/financeiro: perda (coleta + depósito)
   * sobre o total comprado no período, não sobre o total perdido. */
  indicePerdaPct: number
  principalMotivo: string | null
  principalMotivoPct: number | null
  perdasNoDeposito: number
  /**
   * Três contadores, e não um, porque esta aba mostra números de TRÊS
   * origens diferentes e cada `*` precisa dizer a verdade sobre o número que
   * marca — marcar tudo com o mesmo contador acusaria de incompleto um
   * número fechado, que é o jeito mais rápido de ensinar o leitor a ignorar
   * o asterisco.
   *
   * `itensSemConversaoPerdaTotal`: perdas de depósito do período que não
   * converteram. Deixa incompletos `perdaTotalQtd` (cartão "Perda total") e
   * as linhas de "perdas por motivo" — os dois somam perda de coleta (kg,
   * sempre completa) com perda de depósito.
   */
  itensSemConversaoPerdaTotal: number
  /**
   * O anterior MAIS os itens de entrada que não entraram em `peso_total`.
   * Deixa incompleto `indicePerdaPct` (cartão "Índice de perdas"), que é uma
   * fração: perda no numerador, kg comprado no denominador — os dois lados
   * podem perder lançamentos, e por isso a marca dele conta os dois.
   */
  itensSemConversaoIndice: number
  /**
   * Soma do `itensSemConversao` das linhas de "perdas por produto" —
   * repassado de `derivarRelatorioProdutos`, que é a fonte daquela tabela
   * (outro agregado, outra rota: GET /api/relatorios/produtos). Não tem
   * relação com os dois acima e não deve ser somado a eles.
   */
  itensSemConversaoProduto: number
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
 * contas divergirem. Por reaproveitar, herda também o `itensSemConversao` de
 * cada linha: os números já vinham corrigidos (quantidades em kg), mas a
 * SINALIZAÇÃO do que ficou de fora não vinha junto, e uma quantidade
 * incompleta exibida limpa é pior que uma marcada — mesmo `*` das abas
 * Compras, Pedidos e Produtos.
 *
 * A perda de cada entrada usa perdaColetaEfetiva(en) (máximo entre
 * cabeçalho e soma dos itens), não `en.perda_kg` cru — mesmo raciocínio de
 * derivarRelatorioCompras (ver comentário em EntradaResumo/
 * perdaColetaEfetiva, acima): cabeçalho e soma dos itens descrevem o mesmo
 * evento de perda, somar contaria em dobro.
 *
 * ---- tudo em quilos, cada parcela pela unidade dela ----
 *
 * Esta função soma perdas de duas origens que NÃO nascem na mesma unidade:
 * a perda de coleta (`perda_kg` do cabeçalho / dos itens da entrada) é KG por
 * contrato para item de qualquer unidade e não converte; a perda de depósito
 * (`perdas.qtd`) está na unidade da própria perda e por isso converte — é
 * `pe.qtd_kg`, que GET /api/perdas passou a calcular, nunca `pe.qtd`.
 * Somá-las cruas era o defeito: no seed do protótipo, 4 CX de alface + 3 CX
 * de tomate entravam como "7" ao lado de 296 kg de coleta, quando pesam
 * 92 kg — `perdaTotalQtd` saía 303 em vez de 388, e `indicePerdaPct` 3,5% em
 * vez de 4,5%. Os dois saíam PARA BAIXO, que é a direção que esconde
 * sangria. Mesma regra e mesma leitura de api/src/routes/relatorios.ts e
 * estoque.ts, para as três telas não divergirem de novo.
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

  const agg = new Map<string, { qtd: number; ocor: number; semConv: number }>()
  entradasPeriodo.forEach(en => {
    const m = (en.motivo && en.motivo !== '—') ? en.motivo : 'não informado'
    const o = agg.get(m) ?? { qtd: 0, ocor: 0, semConv: 0 }
    const perda = perdaColetaEfetiva(en)
    // Em kg por contrato — não converte. Ver o comentário acima.
    o.qtd += perda
    if (perda > 0) o.ocor++
    agg.set(m, o)
  })
  perdasPeriodo.forEach(pe => {
    const m = pe.motivo || 'não informado'
    const o = agg.get(m) ?? { qtd: 0, ocor: 0, semConv: 0 }
    // `qtd_kg`, não `qtd`: a perda de depósito está na unidade dela e a API
    // já a converteu. Não convertível soma nada e é contada — a ocorrência
    // continua sendo contada, porque ela ACONTECEU; o que falta é o peso.
    o.qtd += pe.qtd_kg || 0
    o.semConv += pe.itens_sem_conversao || 0
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
      itensSemConversao: o.semConv,
    }))
    .sort((a, b) => b.qtd - a.qtd)

  const porProduto = produtosView
    .filter(p => p.perdaPct != null)
    .slice()
    .sort((a, b) => (b.perdaPct as number) - (a.perdaPct as number))
    .map(p => ({
      nome: p.nome,
      compradoQtd: p.compradoQtd,
      perdaPct: p.perdaPct,
      // Repassado, não recalculado: é a MESMA linha de
      // derivarRelatorioProdutos, e quantidade incompleta lá é quantidade
      // incompleta aqui.
      itensSemConversao: p.itensSemConversao,
    }))

  const entKgTot = entradasPeriodo.reduce((s, e) => s + (e.peso_total || 0), 0)
  const entPerdaTot = entradasPeriodo.reduce((s, e) => s + perdaColetaEfetiva(e), 0)
    + perdasPeriodo.reduce((s, p) => s + (p.qtd_kg || 0), 0)

  // Só as perdas de depósito: a perda de coleta é kg por contrato e nunca
  // fica de fora. Igual à soma dos contadores por motivo, calculada aqui
  // sobre a mesma lista para não depender da ordem das linhas.
  const semConversaoPerda = perdasPeriodo.reduce((s, p) => s + (p.itens_sem_conversao || 0), 0)
  // O denominador do índice (kg comprado) tem o contador dele desde 203fb28.
  const semConversaoCompra = entradasPeriodo.reduce((s, e) => s + (e.itens_sem_conversao || 0), 0)

  return {
    porMotivo,
    porProduto,
    totais: {
      perdaTotalQtd,
      indicePerdaPct: entKgTot ? (entPerdaTot / entKgTot) * 100 : 0,
      principalMotivo: porMotivo[0]?.motivo ?? null,
      principalMotivoPct: porMotivo[0]?.pct ?? null,
      perdasNoDeposito: perdasPeriodo.length,
      itensSemConversaoPerdaTotal: semConversaoPerda,
      itensSemConversaoIndice: semConversaoPerda + semConversaoCompra,
      itensSemConversaoProduto: porProduto.reduce((s, p) => s + p.itensSemConversao, 0),
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
