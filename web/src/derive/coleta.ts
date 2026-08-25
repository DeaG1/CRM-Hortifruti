/**
 * As duas contas de uma COLETA (entrada de compra) que aparecem por LINHA e
 * por ITEM, e não em cartão de resumo: a quantidade convertida em quilos e a
 * perda de coleta em % do que foi recebido.
 *
 * Por que um módulo próprio, e não mais uma função em relatorios.ts: as duas
 * são consumidas por uma TELA de rotina (EntradasLista.tsx) e por um MODAL
 * de lançamento (ModalEntrada.tsx), que trabalham com rascunho — item ainda
 * sendo digitado, sem id, sem passar pela API. `derive/relatorios.ts` fala de
 * agregados já persistidos (`EntradaResumo`, `ProdutoAgregado`); nada ali
 * descreve um item em edição. Manter as duas coisas separadas evita que o
 * modal comece a importar tipos de relatório para digitar uma caixa de
 * alface.
 *
 * Sem React, sem fetch, sem formatação — o molde de derive/clientes.ts.
 * Percentual sai CRU (sem toFixed/toLocaleString); quem desenha formata.
 */

/**
 * A quantidade de um item convertida em quilos, pela MESMA regra da API
 * (api/src/routes/entradas.ts, GET /, e api/src/routes/estoque.ts):
 *
 *   item em 'KG'  -> conta `qtd`, não converte;
 *   outra unidade -> conta `qtd * pesoMedio` (peso de UMA embalagem, em kg),
 *                    e SÓ quando `pesoMedio > 0`.
 *
 * `null` = não convertível: unidade diferente de KG com `produtos.peso_medio`
 * zero ou ausente ("não informado", ver a migration 009). Nunca 1 nem 0
 * disfarçados de peso — uma caixa não pesa um quilo, e um zero aqui entraria
 * numa soma como se a caixa fosse vazia. Quem chama tem de tratar o `null`:
 * ou deixa o número de fora e conta quantos ficaram (`somarQtdEmKg`), ou
 * mostra travessão.
 *
 * Duas regras de conversão divergentes (uma no servidor, outra na tela)
 * seriam pior que o bug original — por isso esta função é o único lugar do
 * front que sabe converter, e repete literalmente o `case` do SQL.
 */
export function qtdEmKg(un: string, qtd: number, pesoMedio: number): number | null {
  const q = Number(qtd) || 0
  if (un === 'KG') return q
  const fator = Number(pesoMedio) || 0
  if (fator <= 0) return null
  return q * fator
}

/** Soma em quilos de uma lista de itens, com a contagem do que ficou de fora. */
export interface TotalEmKg {
  /** Soma dos itens convertíveis, em kg. Incompleta quando
   * `itensSemConversao > 0`. */
  kg: number
  /**
   * Quantos itens ficaram FORA de `kg` por não serem convertíveis. Mesmo
   * significado de `itens_sem_conversao` nas rotas da API — a tela marca o
   * número com `*` e explica, em vez de exibir uma soma menor em silêncio.
   */
  itensSemConversao: number
}

/**
 * Soma os itens em quilos, cada parcela pela unidade dela, e conta os que não
 * converteram. Item sem produto escolhido (`pesoMedio` desconhecido) em
 * unidade diferente de KG cai no mesmo caso de "não convertível": ele existe
 * e tem quantidade, mas ainda não há como pesá-lo.
 */
export function somarQtdEmKg(
  itens: { un: string; qtd: number; pesoMedio: number }[],
): TotalEmKg {
  let kg = 0
  let itensSemConversao = 0
  for (const it of itens) {
    const emKg = qtdEmKg(it.un, it.qtd, it.pesoMedio)
    if (emKg === null) itensSemConversao++
    else kg += emKg
  }
  return { kg, itensSemConversao }
}

/**
 * Perda de coleta em % do que foi recebido — `perdaKg / pesoKg * 100`.
 *
 * OS DOIS LADOS JÁ ESTÃO EM QUILOS, e por motivos diferentes: a perda de
 * coleta é kg POR CONTRATO para item de qualquer unidade (nome da coluna
 * `entrada_itens.perda_kg`, rótulo em ModalEntrada.tsx, total do rodapé do
 * mesmo modal) e nunca converte; o peso recebido converte, e quem converte é
 * `qtdEmKg` acima (ou a API, quando o número vem pronto em `peso_total`).
 * Dividir kg por caixa é a versão por linha do defeito que 203fb28/35f3a2e
 * fecharam nos totais — por isso esta função não aceita unidade nenhuma:
 * quem chama já tem de chegar com quilos dos dois lados.
 *
 * `null` quando não há peso recebido para dividir: não dá para medir uma
 * fração sem denominador, e "0,0%" ali afirmaria que nada se perdeu — a
 * leitura tranquilizadora exatamente onde não se mediu nada. O protótipo já
 * fazia isto certo (`en.pesoKg ? ppct.toFixed(1)+'%' : '—'`,
 * design/CRM Hortifruti.dc.html:2513) e a tela segue.
 *
 * Zero MEDIDO (houve peso recebido e nenhuma perda) sai `0` normalmente: é o
 * bom resultado da coleta, e travessão no lugar dele esconderia a boa
 * notícia com a mesma força com que um zero falso esconde a má.
 */
export function perdaColetaPct(perdaKg: number, pesoKg: number): number | null {
  const peso = Number(pesoKg) || 0
  if (peso <= 0) return null
  return ((Number(perdaKg) || 0) / peso) * 100
}
