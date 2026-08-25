/**
 * Os cartões de resumo das DUAS telas de rotina — Saídas (vendas) e Entradas
 * (compras). Portados de design/CRM Hortifruti.dc.html: `pedidoStats`
 * (markup 413, dados 2394-2399) e `entradaStats` (markup 471, dados
 * 2506-2507).
 *
 * POR QUE ESTE MÓDULO EXISTE, se relatorios.ts já calcula tudo isto:
 *
 * Os dois números centrais destas telas — "quanto os clientes me devem" e
 * "quanto devo ao produtor" — só existiam em Relatórios, que é tela de
 * ANÁLISE. Quem lança uma venda ou uma coleta trabalha em Saídas/Entradas e
 * nunca via nenhum dos dois. Trazê-los para a rotina não pode, porém,
 * significar somá-los de novo: um "A receber" na tela de rotina que
 * discorde do "A receber" do relatório é pior que não ter nenhum dos dois,
 * porque o dono deixa de saber em qual acreditar.
 *
 * Por isso aqui NÃO há aritmética de dinheiro nem de perda: as duas funções
 * abaixo chamam `derivarRelatorioPedidos`/`derivarRelatorioCompras`
 * (derive/relatorios.ts) com o período aberto ('' / '', que em `noPeriodo`
 * significa "sem recorte" — ver o comentário de lá) e só ADAPTAM o
 * resultado: escolhem os campos que viram cartão e aplicam a regra de
 * travessão descrita logo abaixo. Toda mudança de fórmula continua tendo um
 * lugar só.
 *
 * PERÍODO: estas telas ainda não têm seletor de período (achado S-3 da
 * auditoria, transversal a sete telas, fora do escopo deste módulo). Até
 * elas terem, "no período" aqui é a base inteira que a tela carregou, e é
 * isso que os rótulos dizem — nunca um recorte implícito que o usuário não
 * escolheu.
 *
 * TRAVESSÃO NUNCA VIRA ZERO: as duas funções devolvem `null` quando não há
 * lançamento nenhum, e a tela mostra travessão. Isso é diferente de um zero
 * MEDIDO — nenhuma venda em aberto porque tudo foi pago é `R$ 0,00`, e essa
 * é justamente a informação boa. Só a ausência de base vira travessão.
 * Mesma regra dentro de um cartão: `perdaMediaPct` é `null` quando não há
 * quilo recebido para dividir (não dá para medir), mas é `0` quando há
 * quilo e não houve perda (mediu-se, e deu zero).
 *
 * Sem React, sem fetch, sem formatação — o molde de derive/clientes.ts.
 */

import type { Health } from './clientes'
import {
  derivarRelatorioCompras,
  derivarRelatorioPedidos,
  type EntradaResumo,
  type SaidaResumo,
} from './relatorios'

/** Período aberto: `noPeriodo('', '')` deixa tudo passar (ver relatorios.ts).
 * Nomeado para o call site dizer "sem recorte" em vez de duas aspas soltas. */
const SEM_RECORTE = ''

/* ============================== saídas ============================== */

/** Os quatro cartões de Saídas — `pedidoStats` do protótipo (2394-2399). */
export interface ResumoSaidas {
  /** Cartão 1: quantos pedidos há na base. */
  pedidos: number
  /** Cartão 2: soma do valor dos pedidos com status 'Entregue'. */
  faturadoEntregue: number
  /** Sub-linha do cartão 2: quantos pedidos entregues compõem esse valor. */
  pedidosEntregues: number
  /**
   * Cartão 3, o que motivou este módulo: quanto os minimercados ainda devem
   * — soma dos pedidos cuja situação de pagamento não é 'Pago' nem '—'
   * (cancelado/devolvido não é dívida). Vem de
   * `derivarRelatorioPedidos().totais.aReceber`, exatamente o mesmo número
   * de Relatórios ▸ Pedidos.
   */
  aReceber: number
  /**
   * Sub-linha do cartão 3: quantos desses pedidos estão ATRASADOS. Contado
   * com `situacaoExibidaSaida` lá em relatorios.ts (vencimento decorrido,
   * não o `pag` gravado) — a única fonte de atraso deste projeto.
   */
  pedidosAtrasados: number
  /** Cartão 4: quilos entregues. Incompleto quando `itensSemConversao > 0`. */
  qtdEntregueKg: number
  /**
   * Itens dos pedidos ENTREGUES que ficaram fora de `qtdEntregueKg` por não
   * serem convertíveis em quilos (unidade ≠ KG sem `produtos.peso_medio`).
   * 0 = o total está completo. A tela marca o número com `*` e explica.
   */
  itensSemConversao: number
}

/**
 * Resumo da tela de Saídas. `null` quando não há saída nenhuma — travessão,
 * não `R$ 0,00` (ver o cabeçalho do módulo).
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável sem mockar relógio — mesmo padrão de `situacaoExibidaSaida`
 * e `derivarRelatorioInadimplentes`. Ele só influencia `pedidosAtrasados`.
 */
export function derivarResumoSaidas(saidas: SaidaResumo[], hojeIso: string): ResumoSaidas | null {
  if (saidas.length === 0) return null

  const { totais, porStatus } = derivarRelatorioPedidos(saidas, SEM_RECORTE, SEM_RECORTE, hojeIso)
  return {
    pedidos: totais.pedidosNoPeriodo,
    faturadoEntregue: totais.faturadoEntregue,
    // A contagem sai da tabela por status do próprio relatório, não de um
    // segundo `filter(status==='Entregue')` aqui: o número embaixo do valor
    // tem que contar exatamente os pedidos que o valor soma. `porStatus`
    // descarta status sem nenhum pedido, daí o `?? 0`.
    pedidosEntregues: porStatus.find(s => s.status === 'Entregue')?.quantidade ?? 0,
    aReceber: totais.aReceber,
    pedidosAtrasados: totais.pedidosAtrasados,
    qtdEntregueKg: totais.qtdEntregueKg,
    itensSemConversao: totais.itensSemConversao,
  }
}

/* ============================= entradas ============================= */

/**
 * Uma entrada ainda em aberto com o produtor: qualquer situação de pagamento
 * que não seja 'Pago'.
 *
 * Note a ASSIMETRIA com Saídas, que é do modelo de dados e está documentada
 * em derive/pagamento.ts: `entradas` não tem coluna de vencimento (é compra
 * do produtor, não venda a prazo), então aqui não existe atraso a derivar —
 * "a pagar ao produtor" é o total em aberto, sem recorte de atraso, e não há
 * sub-linha de atrasados como no cartão irmão de Saídas. Um `pago` gravado
 * como 'Atrasado' (dado anterior à mudança de comportamento) continua sendo
 * dívida e entra na soma, sem ser recalculado.
 *
 * Este predicado só CONTA quantas entradas estão em aberto; o VALOR delas
 * vem de `derivarRelatorioCompras().totais.aPagarAoProdutor`, nunca somado
 * de novo aqui.
 */
export function entradaEmAberto(en: { pago: string }): boolean {
  return en.pago !== 'Pago'
}

/**
 * Alvo de perda na coleta/transporte, em %. É o mesmo 10% que o protótipo
 * usa no sub do cartão ("meta ≤ 10%", linha 2507) e que
 * `METAS_DASHBOARD.perdaMetaPct` (derive/dashboard.ts) usa no KPI de perdas.
 * Fica aqui, e não importado de lá, porque as FAIXAS são diferentes — ver
 * `statusPerdaMedia`.
 */
export const META_PERDA_MEDIA_PCT = 10

/** Fim da faixa âmbar. Acima disto o cartão fica vermelho. */
export const PERDA_MEDIA_AMBAR_ATE_PCT = 15

/**
 * Semáforo do cartão de perda média: verde até 10%, âmbar até 15%, vermelho
 * acima — as faixas do próprio `entradaStats` do protótipo (linha 2507) e as
 * mesmas de `corPerda` em RelatoriosTela.tsx, que colore a coluna PERDA de
 * Relatórios ▸ Compras a partir do mesmo número.
 *
 * DIVERGÊNCIA CONHECIDA, do protótipo consigo mesmo: o KPI "Índice de
 * perdas" do Dashboard usa 10/13 (`statusIndiceDePerdas`, derive/dashboard.ts,
 * portado da linha 2356) em vez de 10/15. As duas faixas convivem no
 * protótipo original; esta função fica com a do cartão que ela colore, para
 * a tela de Entradas concordar com Relatórios ▸ Compras, que é a tela que
 * mostra exatamente esta mesma conta.
 *
 * Os limites são inclusivos nos dois lados (10,0% é verde; 15,0% é âmbar) —
 * "meta ≤ 10%" quer dizer que bater 10 em cheio é bater a meta.
 */
export function statusPerdaMedia(pct: number): Health {
  if (pct <= META_PERDA_MEDIA_PCT) return 'green'
  if (pct <= PERDA_MEDIA_AMBAR_ATE_PCT) return 'amber'
  return 'red'
}

/** Os cartões de Entradas — `entradaStats` do protótipo (2506-2507). */
export interface ResumoEntradas {
  /** Quantas coletas há na base. */
  coletas: number
  /** Quilos recebidos. Incompleto quando `itensSemConversao > 0`. */
  pesoRecebidoKg: number
  /**
   * Itens que ficaram fora de `pesoRecebidoKg` por não serem convertíveis em
   * quilos. Afeta TAMBÉM `perdaMediaPct`, que divide por esse peso: com o
   * denominador incompleto o índice sai PARA CIMA. A tela marca os dois
   * números com `*` e explica na nota de rodapé.
   */
  itensSemConversao: number
  /** Soma do valor de todas as coletas. */
  valorTotal: number
  /**
   * Quanto ainda se deve aos produtores — soma das coletas com
   * `pago !== 'Pago'`. Vem de
   * `derivarRelatorioCompras().totais.aPagarAoProdutor`, exatamente o mesmo
   * número de Relatórios ▸ Compras.
   */
  aPagarAoProdutor: number
  /** Sub-linha do cartão acima: quantas coletas compõem esse valor. */
  coletasEmAberto: number
  /**
   * Perda na coleta/transporte em kg — o número que a tela já mostrava
   * sozinho. Continua visível na sub-linha do cartão de perda, agora ao lado
   * do índice que lhe dá sentido.
   */
  perdaKg: number
  /**
   * `perdaKg` sobre `pesoRecebidoKg`, em %. `null` quando não há peso
   * recebido para dividir — travessão, não 0%: sem quilo comprado não existe
   * índice de perda, e "0,0%" fingiria uma coleta impecável. Zero MEDIDO
   * (houve peso e não houve perda) sai `0` normalmente.
   */
  perdaMediaPct: number | null
}

/**
 * Resumo da tela de Entradas. `null` quando não há entrada nenhuma —
 * travessão, não `R$ 0,00`.
 *
 * `perdaKg`/`perdaMediaPct` usam `perdaColetaEfetiva` (dentro de
 * `derivarRelatorioCompras`): o MAIOR entre a perda do cabeçalho da entrada
 * e a soma da perda dos itens dela, nunca a soma dos dois — os dois campos
 * descrevem o mesmo evento de perda em granularidades diferentes, e somar
 * contaria em dobro. É por isso que o cartão pode divergir da soma visual da
 * coluna PERDA da tabela, que mostra só o cabeçalho (`perda_kg`).
 */
export function derivarResumoEntradas(entradas: EntradaResumo[]): ResumoEntradas | null {
  if (entradas.length === 0) return null

  // `[]` de fornecedores: esta tela não precisa da quebra por fornecedor
  // (só dos totais), e o único uso de `fornecedores` lá dentro é resolver
  // id -> nome nas linhas, que aqui são descartadas.
  const { totais } = derivarRelatorioCompras([], entradas, SEM_RECORTE, SEM_RECORTE)
  return {
    coletas: totais.coletasNoPeriodo,
    pesoRecebidoKg: totais.compradoQtd,
    itensSemConversao: totais.itensSemConversao,
    valorTotal: totais.totalComprado,
    aPagarAoProdutor: totais.aPagarAoProdutor,
    coletasEmAberto: entradas.filter(entradaEmAberto).length,
    perdaKg: totais.perdaQtd,
    // `perdaNaColetaPct` já devolve 0 quando não há peso; aqui esse 0 vira
    // `null` porque a tela precisa distinguir "não deu para medir" de
    // "mediu e deu zero" — o relatório mostra 0,0% e segue, a tela mostra
    // travessão.
    perdaMediaPct: totais.compradoQtd > 0 ? totais.perdaNaColetaPct : null,
  }
}
