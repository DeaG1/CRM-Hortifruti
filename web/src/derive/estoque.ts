import { dataBrCurta } from './pagamento'

// Padrão de derive/fornecedores.ts e derive/clientes.ts: função pura, sem
// React, sem fetch, sem `new Date()` — a tela só exibe o que sai daqui.
//
// A conta pesada do estoque (quanto entrou, quanto saiu, quanto sobrou) mora
// em SQL, no endpoint agregado — ver o comentário grande de
// api/src/routes/estoque.ts. O que mora aqui é a parte que NÃO é somatório:
// decidir qual das três datas que a API devolve é "a última movimentação", e
// dar a ela um rótulo que não confunda perda com saída.

/**
 * Os três tipos de movimentação que a tela reconhece — os mesmos três da
 * conta do saldo (entradas − perdas − saídas), nem um a mais.
 *
 * PERDA É MOVIMENTAÇÃO, e é uma decisão: o dono falou em "entrada ou saída",
 * mas perda também tira mercadoria do depósito, também tem data própria, e
 * saber que o item perdeu 12 kg ontem muda a mesma decisão que saber que ele
 * vendeu 12 kg ontem. Fora do rastreamento, um item que só perde ficaria
 * eternamente "sem movimentação" enquanto o saldo derretia.
 *
 * O preço de incluir é que ela precisa ficar VISÍVEL como perda: o rótulo é
 * sempre impresso junto da data (`textoMovimentacao`), nunca só a data. Uma
 * perda exibida com cara de saída seria pior do que não exibi-la — a tela
 * diria que a mercadoria foi vendida.
 */
export const TIPOS_MOVIMENTACAO = ['entrada', 'saida', 'perda'] as const
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number]

/** Rótulo visível de cada tipo. Os três são distintos de propósito — ver
 * `TIPOS_MOVIMENTACAO` para por que "perda" não pode virar "saída". */
export const ROTULO_MOVIMENTACAO: Record<TipoMovimentacao, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  perda: 'Perda',
}

/**
 * Ordem de desempate quando duas fontes têm a MESMA data — e elas têm com
 * frequência: no hortifrúti a mercadoria comprada de madrugada no CEASA sai
 * para entrega no mesmo dia, então entrada e saída dividem a data o tempo
 * todo. As colunas do banco são `date` (sem hora), então não existe resposta
 * medida para "qual foi a última"; o que não pode acontecer é a tela alternar
 * entre dois rótulos a cada carregamento.
 *
 * A ordem escolhida vai do fim do fluxo para o começo — saída, depois perda,
 * depois entrada —, que é a sequência típica do dia: a mercadoria chega, uma
 * parte estraga, o resto sai. Empatadas na data, a saída é a mais provável de
 * ter sido a última coisa que aconteceu com aquele item.
 */
const PRECEDENCIA_NO_EMPATE: TipoMovimentacao[] = ['saida', 'perda', 'entrada']

/** As três datas cruas de GET /api/estoque — cada uma o `max()` da sua fonte,
 * em ISO 'AAAA-MM-DD', ou `null` quando aquela fonte nunca movimentou a
 * linha. Ver api/src/routes/estoque.ts para de que coluna sai cada uma (a da
 * saída é `entrega`, não `data_pedido`). */
export interface DatasMovimentacao {
  ultima_entrada: string | null
  ultima_saida: string | null
  ultima_perda: string | null
}

export interface UltimaMovimentacao {
  tipo: TipoMovimentacao
  /** ISO 'AAAA-MM-DD', como veio da API — é o que preserva o ANO, que
   * `texto` (formato curto) não mostra. A tela usa nos atributos que
   * precisam da data inteira. */
  data: string
  /** 'Entrada' | 'Saída' | 'Perda' */
  rotulo: string
  /** O que a célula imprime: 'Saída · 12/08'. */
  texto: string
}

/**
 * 'AAAA-MM-DD' -> 'DD/MM', via `dataBrCurta` (derive/pagamento.ts). NÃO é um
 * segundo formatador de data: é a mesma função, reusada pelo mesmo motivo que
 * `notaUltimoPreco` (derive/memoriaPreco.ts) a reusa. O projeto tem um
 * formatador curto só, e ele fica lá.
 *
 * Data que não casa com o formato volta crua em vez de virar `null`: a
 * movimentação ACONTECEU, e engolir a linha por causa de um formato
 * inesperado esconderia um evento real. O travessão é reservado para "não
 * houve movimentação", que é outra coisa.
 */
function curta(iso: string): string {
  return dataBrCurta(iso) ?? iso
}

/** 'Saída · 12/08' — rótulo SEMPRE junto da data. Ver `TIPOS_MOVIMENTACAO`:
 * é isto que impede uma perda de se passar por saída no meio da tabela. */
export function textoMovimentacao(tipo: TipoMovimentacao, dataIso: string): string {
  return `${ROTULO_MOVIMENTACAO[tipo]} · ${curta(dataIso)}`
}

/**
 * A última movimentação de uma linha da tabela: a mais recente entre as três
 * datas, com o tipo dela junto.
 *
 * `null` quando NENHUMA das três existe — e a tela imprime travessão. Isso é
 * alcançável de verdade: uma linha cuja única movimentação é uma saída ainda
 * sem data de entrega registrada entra na tabela (a quantidade é descontada
 * do saldo) sem produzir data nenhuma. Travessão nunca vira zero, nem a data
 * de hoje, nem '01/01/1970' — dizer "mexeu hoje" de um item parado desde maio
 * é exatamente o erro que este rastreamento existe para não cometer.
 *
 * Comparação lexicográfica sobre 'AAAA-MM-DD', que nesse formato é a mesma
 * ordem da cronológica — sem `Date`, sem fuso, igual a `situacaoExibidaSaida`
 * (derive/pagamento.ts).
 *
 * O empate resolve por `PRECEDENCIA_NO_EMPATE`: os candidatos são varridos
 * nessa ordem e a troca exige data ESTRITAMENTE maior, então o primeiro da
 * precedência sobrevive ao empate. Sem isso, a linha alternaria entre
 * "Entrada · 12/08" e "Saída · 12/08" conforme a ordem em que os campos
 * fossem lidos — a mesma classe de defeito que f8e2954 corrigiu no
 * desempate das coletas de um fornecedor.
 *
 * NÃO recebe período: estoque é posição acumulada e não segue o filtro global
 * (commit eae52e0, e a nota que a própria tela imprime). "A última vez que
 * mexeu em julho" não é a pergunta — um item parado desde maio apareceria
 * como nunca movimentado num julho qualquer.
 */
export function ultimaMovimentacao(datas: DatasMovimentacao): UltimaMovimentacao | null {
  const porTipo: Record<TipoMovimentacao, string | null> = {
    entrada: datas.ultima_entrada,
    saida: datas.ultima_saida,
    perda: datas.ultima_perda,
  }

  let melhor: { tipo: TipoMovimentacao; data: string } | null = null
  for (const tipo of PRECEDENCIA_NO_EMPATE) {
    const data = porTipo[tipo]
    if (!data) continue
    if (!melhor || data > melhor.data) melhor = { tipo, data }
  }
  if (!melhor) return null

  return {
    tipo: melhor.tipo,
    data: melhor.data,
    rotulo: ROTULO_MOVIMENTACAO[melhor.tipo],
    texto: textoMovimentacao(melhor.tipo, melhor.data),
  }
}

/** Uma linha do histórico, como chega de GET /api/estoque/movimentacoes. */
export interface MovimentacaoEstoque {
  produto_id: string
  un: string
  tipo: TipoMovimentacao
  /** ISO 'AAAA-MM-DD'. Movimentação sem data não vem — ver a query. */
  data: string
  /** Quantidade EM QUILOS, mesma convenção das quatro colunas da tabela.
   * `null` quando o lançamento não é convertível (unidade ≠ KG sem
   * `peso_medio` cadastrado): é um dos `itens_sem_conversao` da linha, e
   * zero fingiria uma quantidade medida. */
  qtd_kg: number | null
  /** Número da entrada/saída, ou o motivo da perda. */
  referencia: string
  /** Quantas movimentações a linha tem NO TOTAL — pode ser maior que
   * quantas vieram (a API devolve as mais recentes até um teto), para a tela
   * dizer "12 de 47" em vez de truncar calada. */
  total: number
}

/** Chave de uma linha da tabela: (produto, unidade lançada). É a mesma chave
 * do agregado (`group by produto_id, un` em buscarEstoque) e a mesma que a
 * tabela já usa como `key` do React — um produto lançado em CX e em KG são
 * duas linhas, e portanto dois históricos. */
export function chaveEstoque(produtoId: string, un: string): string {
  return `${produtoId}|${un}`
}

/**
 * Indexa o histórico plano da API por linha da tabela, para a tela achar o
 * histórico de um item expandido sem varrer o array inteiro a cada render.
 *
 * A ORDEM DENTRO DE CADA GRUPO É PRESERVADA, nunca reordenada aqui. Não é
 * economia: a API já devolve ordenado (data desc, criado_em desc, id desc) e
 * TRUNCA nas N mais recentes segundo essa ordem. Reordenar do lado de cá
 * poderia produzir uma lista que discorda do próprio corte — mostrando como
 * "as mais recentes" um conjunto escolhido por outro critério. O desempate
 * estável vive junto do corte, no `row_number()` da query.
 */
export function agruparMovimentacoes(
  movimentacoes: MovimentacaoEstoque[],
): Map<string, MovimentacaoEstoque[]> {
  const porChave = new Map<string, MovimentacaoEstoque[]>()
  movimentacoes.forEach(m => {
    const chave = chaveEstoque(m.produto_id, m.un)
    const atuais = porChave.get(chave)
    if (atuais) atuais.push(m)
    else porChave.set(chave, [m])
  })
  return porChave
}
