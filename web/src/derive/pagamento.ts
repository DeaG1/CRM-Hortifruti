// Padrão de derive/clientes.ts: função pura, testada isoladamente, sem
// React/fetch/formatação — usada pelo chip editável de EntradasLista e
// SaidasLista (Task do dono do produto: "status de pagamento editável na
// linha da tabela, com Atrasado calculado em vez de escolhido") e,
// possivelmente, por relatórios futuros que precisem da mesma regra.
//
// ASSIMETRIA ENTRE ENTRADAS E SAÍDAS (de propósito, do modelo de dados —
// não descuido): `saidas` tem uma coluna `venc` (vencimento); `entradas`
// não tem nenhuma data de vencimento — é uma compra do produtor, não uma
// venda a prazo. Por isso só saídas ganham uma função de derivação aqui:
// sem vencimento não há "atraso" para calcular, e a tela de Entradas
// simplesmente exibe o valor gravado em `pago` sem nenhum cálculo (ver
// comentário em EntradasLista.tsx, junto de onde o valor é lido).

/**
 * As únicas duas situações que o usuário pode ESCOLHER no seletor inline
 * da tabela (chip editável de EntradasLista/SaidasLista). 'Atrasado' fica
 * de fora de propósito — passa a ser sempre CALCULADO a partir do
 * vencimento, nunca escolhido à mão: decisão do dono do produto, porque um
 * status manual pode contradizer a data (um registro "Atrasado" com
 * vencimento daqui a duas semanas, ou "Pendente" esquecido com vencimento
 * do mês passado) e torna a inadimplência da carteira não confiável.
 */
export const SITUACOES_PAGAMENTO_ESCOLHIVEIS = ['Pendente', 'Pago'] as const
export type SituacaoPagamentoEscolhivel = (typeof SITUACOES_PAGAMENTO_ESCOLHIVEIS)[number]

/**
 * Situação de pagamento a EXIBIR para uma saída (venda) — o dado que
 * alimenta o chip da tabela (SaidasLista) e qualquer relatório que precise
 * da mesma regra de atraso.
 *
 * Regra, na ordem em que é aplicada:
 *
 *   1. `pag` gravado = 'Atrasado' → mostra Atrasado. `saidas.pag` aceita
 *      esse valor no CHECK da coluna (e continuará aceitando — esta
 *      mudança não migra dado nenhum), então um registro gravado assim
 *      ANTES desta mudança de comportamento (quando "Atrasado" ainda era
 *      escolhido à mão) precisa continuar sendo exibido como Atrasado, com
 *      fidelidade ao que já está no banco.
 *   2. `pag` gravado = 'Pendente' E existe `venc` E `venc` já passou
 *      (estritamente antes de `hojeIso`, não "vence hoje") → mostra
 *      Atrasado. Esta é a regra NOVA: o cálculo substitui a escolha manual.
 *   3. Qualquer outro caso (Pago, Pendente sem vencimento vencido/sem
 *      vencimento, ou '—' — "não aplicável", usado em pedido
 *      cancelado/devolvido) → mostra o valor gravado sem alteração.
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável — mesmo padrão de derivarRelatorioInadimplentes
 * (derive/relatorios.ts). Comparação de datas é lexicográfica sobre o
 * formato 'AAAA-MM-DD' (mesma ordem que a cronológica nesse formato, sem
 * precisar de `Date`).
 */
export function situacaoExibidaSaida(
  pag: string,
  venc: string | null | undefined,
  hojeIso: string,
): string {
  if (pag === 'Atrasado') return 'Atrasado'
  if (pag === 'Pendente' && venc && venc < hojeIso) return 'Atrasado'
  return pag
}

/**
 * Valor efetivamente selecionado no `<select>` de duas opções
 * (Pendente/Pago) para uma situação exibida qualquer. 'Atrasado' mapeia
 * para 'Pendente' — ele é a mesma opção "ainda não pago", só com o rótulo
 * trocado (ver `rotuloOpcaoPendente`) para reaproveitar a mesma `<option>`
 * sem oferecer um terceiro valor selecionável. Qualquer outro valor (ex.:
 * '—', só possível em saídas) também cai em 'Pendente': o seletor de duas
 * opções não tem como representá-lo à parte, mas essa situação nem chega a
 * usar o seletor (SaidasLista mantém o badge estático de sempre quando
 * `pag === '—'` — ver comentário lá).
 */
export function valorSelecionavelPagamento(situacaoExibida: string): SituacaoPagamentoEscolhivel {
  return situacaoExibida === 'Pago' ? 'Pago' : 'Pendente'
}

/**
 * Rótulo da opção "ainda não pago" dentro do seletor — mostra "Atrasado"
 * quando for o caso, mas o VALOR do `<option>` continua sendo 'Pendente'
 * (`valorSelecionavelPagamento`): só o texto muda, nunca o valor. É assim
 * que o onChange do seletor nunca produz 'Atrasado' como escolha do
 * usuário, mesmo que a linha mostre "Atrasado" no fechado.
 */
export function rotuloOpcaoPendente(situacaoExibida: string): string {
  return situacaoExibida === 'Atrasado' ? 'Atrasado' : 'Pendente'
}
