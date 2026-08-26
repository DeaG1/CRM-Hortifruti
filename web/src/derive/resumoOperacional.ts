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
 * Por isso aqui quase não há aritmética própria: as duas funções abaixo
 * chamam `derivarRelatorioPedidos`/`derivarRelatorioCompras`
 * (derive/relatorios.ts) com o período aberto ('' / '', que em `noPeriodo`
 * significa "sem recorte" — ver o comentário de lá) e só ADAPTAM o
 * resultado: escolhem os campos que viram cartão e aplicam a regra de
 * travessão descrita logo abaixo. Toda mudança de fórmula de dinheiro
 * continua tendo um lugar só.
 *
 * A ÚNICA EXCEÇÃO é o cartão "Índice de perdas" de Entradas, e de propósito:
 * `derivarResumoEntradas` chama `indiceDePerdas` (derive/dashboard.ts) — a
 * MESMA função que alimenta o KPI "Índice de perdas" do painel — em vez de
 * recalcular a fração aqui. Antes desta versão o cartão somava só a perda de
 * coleta (o dado que esta tela já carregava) e o painel somava coleta +
 * depósito: dois números com o mesmo nome em telas vizinhas. Ver o
 * comentário grande de `indiceDePerdas` para o raciocínio completo (kg por
 * unidade, `perdaColetaEfetiva`, itens sem conversão) — não repetido aqui.
 *
 * PERÍODO: as duas telas têm o seletor global (achado S-3 da auditoria) desde
 * eae52e0, mas o recorte é aplicado pela TELA, antes de chamar as funções
 * deste módulo — `derivarResumoSaidas`/`derivarResumoEntradas` recebem a
 * lista JÁ FILTRADA e continuam sem saber o que é "período"; "no período"
 * nos comentários abaixo é sempre a lista que a tela decidiu passar.
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

import { indiceDePerdas, type Perda } from './dashboard'
import {
  derivarRelatorioCompras,
  derivarRelatorioPedidos,
  perdaColetaEfetiva,
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
   * Cartão 3, o que motivou este módulo: quanto os clientes ainda devem
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

/** Os cartões de Entradas — `entradaStats` do protótipo (2506-2507), com o
 * cartão de perda unificado ao KPI do painel (ver o cabeçalho do módulo). */
export interface ResumoEntradas {
  /** Quantas coletas há na base. */
  coletas: number
  /** Quilos recebidos. Incompleto quando `itensSemConversao > 0`. */
  pesoRecebidoKg: number
  /**
   * Itens de ENTRADA (só o lado do denominador) que ficaram fora de
   * `pesoRecebidoKg` por não serem convertíveis em quilos. Marca só o
   * cartão PESO RECEBIDO (e a célula por linha) — o cartão ÍNDICE DE PERDAS
   * tem o contador dele próprio, `itensSemConversaoIndice`, que soma TAMBÉM
   * o lado das perdas de depósito e por isso pode ser maior que este.
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
   * Perda de coleta + perda de depósito, em kg — o numerador de
   * `perdaMediaPct`, para a sub-linha do cartão continuar mostrando o
   * quilo absoluto ao lado do índice. `null` só quando as perdas de
   * depósito não puderam ser carregadas (ver o parâmetro `perdas` abaixo):
   * nesse caso não dá para afirmar o total sem elas, e mostrar só a perda
   * de coleta como se fosse o total reintroduziria em silêncio a
   * divergência que esta unificação existe para fechar — por isso a tela
   * mostra travessão em vez de um número parcial.
   */
  perdaKg: number | null
  /**
   * `perdaKg` sobre `pesoRecebidoKg`, em % — o MESMO valor que
   * `indiceDePerdas` (derive/dashboard.ts) calcula para o KPI do painel,
   * neste mesmo recorte. `null` quando não há peso recebido para dividir OU
   * quando as perdas de depósito não carregaram — os dois são "não dá para
   * medir", nunca 0%. Zero MEDIDO (houve peso, perdas carregaram, e não
   * houve perda nenhuma) sai `0` normalmente.
   */
  perdaMediaPct: number | null
  /**
   * Itens de ENTRADA + itens de PERDA DE DEPÓSITO que ficaram fora da conta
   * de `perdaMediaPct` por não serem convertíveis em quilos — o mesmo
   * `itensSemConversao` que `indiceDePerdas` devolve. Pode ser MAIOR que
   * `itensSemConversao` (que só conta o lado das entradas): um item de
   * perda de depósito sem peso médio cadastrado marca este cartão sem
   * marcar o de peso recebido. `0` quando as perdas não carregaram — não há
   * nada para marcar quando o cartão inteiro já é travessão por outro
   * motivo mais grave.
   */
  itensSemConversaoIndice: number
}

/**
 * Resumo da tela de Entradas. `null` quando não há entrada nenhuma —
 * travessão, não `R$ 0,00`.
 *
 * `perdas`: a lista de perdas de depósito do MESMO recorte (a tela filtra
 * pelo período global antes de chamar, igual às entradas — ver o cabeçalho
 * do módulo) — ou `null` quando `GET /api/perdas` falhou. `null` é
 * DIFERENTE de `[]` (perdas carregaram e não há nenhuma no período, um
 * resultado válido: `perdaMediaPct` sai só da perda de coleta, que é
 * exatamente o índice do painel nesse mesmo caso). Com `null`, `perdaKg` e
 * `perdaMediaPct` saem os dois `null` (travessão) — nunca a perda de coleta
 * sozinha se fazendo passar pelo total. A falha é isolada a este UM cartão;
 * os outros quatro (que não dependem de perdas de depósito) continuam
 * normais. Ver o aviso `role="status"` em EntradasLista.tsx.
 */
export function derivarResumoEntradas(entradas: EntradaResumo[], perdas: Perda[] | null): ResumoEntradas | null {
  if (entradas.length === 0) return null

  // `[]` de fornecedores: esta tela não precisa da quebra por fornecedor
  // (só dos totais), e o único uso de `fornecedores` lá dentro é resolver
  // id -> nome nas linhas, que aqui são descartadas.
  const { totais } = derivarRelatorioCompras([], entradas, SEM_RECORTE, SEM_RECORTE)

  let perdaKg: number | null = null
  let perdaMediaPct: number | null = null
  let itensSemConversaoIndice = 0

  if (perdas !== null) {
    // `indiceDePerdas` (derive/dashboard.ts) é a MESMA função que o painel
    // usa para o KPI "Índice de perdas" — reaproveitada, não recalculada,
    // para as duas telas nunca poderem divergir de novo (era exatamente
    // essa divergência que motivou esta mudança). `id: en.numero` é um
    // valor sintético: `indiceDePerdas` nunca lê esse campo (só soma
    // peso/perda), ele só é obrigatório no TIPO porque o mesmo módulo tem
    // outras funções (giroDeEstoque, cicloDeCaixa) que precisam de um id
    // de verdade — EntradaResumo (relatorios.ts) não carrega um.
    const paraIndice = entradas.map(en => ({ ...en, id: en.numero }))
    const indice = indiceDePerdas(paraIndice, perdas)
    perdaMediaPct = indice.disponivel ? indice.valor : null
    itensSemConversaoIndice = indice.disponivel ? (indice.itensSemConversao ?? 0) : 0
    // O kg absoluto (sub-linha do cartão) não é algo que `indiceDePerdas`
    // devolve (só a fração em %) — soma-se aqui o MESMO numerador que ela
    // soma por dentro (perda de coleta via `perdaColetaEfetiva`, perda de
    // depósito via `qtd_kg`), nunca uma conta nova. Independe do
    // denominador: mesmo sem peso recebido (índice indisponível), o total
    // perdido continua sendo uma medida real.
    perdaKg = entradas.reduce((s, en) => s + perdaColetaEfetiva(en), 0)
      + perdas.reduce((s, p) => s + (p.qtd_kg || 0), 0)
  }

  return {
    coletas: totais.coletasNoPeriodo,
    pesoRecebidoKg: totais.compradoQtd,
    itensSemConversao: totais.itensSemConversao,
    valorTotal: totais.totalComprado,
    aPagarAoProdutor: totais.aPagarAoProdutor,
    coletasEmAberto: entradas.filter(entradaEmAberto).length,
    perdaKg,
    perdaMediaPct,
    itensSemConversaoIndice,
  }
}
