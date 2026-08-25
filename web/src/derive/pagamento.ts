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

/**
 * A sub-linha sob o chip de pagamento — "PIX · 10/06": COMO e QUANDO o
 * dinheiro se moveu de fato. Portada de `pagInfo` do protótipo, montada duas
 * vezes lá (entradas em design/CRM Hortifruti.dc.html:2517, saídas em 2414)
 * e uma vez só aqui: a regra é a mesma nas duas telas, e duas cópias de uma
 * regra igual é como as duas telas passam a discordar.
 *
 * `null` (a tela não desenha nada) enquanto não houver pagamento registrado.
 * Isso NÃO é o travessão de "não sei": um pedido pendente não tem forma nem
 * data de pagamento porque ainda não foi pago — a ausência já está dita pelo
 * chip logo acima, e repeti-la com um "—" fingiria que falta um dado que
 * ainda não existe.
 *
 * A situação vem DERIVADA (`situacaoExibidaSaida` nas saídas, o `pago`
 * gravado nas entradas, que não têm vencimento) para esta sub-linha nunca
 * contradizer o chip que ela acompanha.
 *
 * Diferença deliberada em relação ao protótipo: lá, uma entrada paga sem
 * data virava `"PIX · "` — um separador solto no fim da linha, resto de
 * concatenação, não informação. Aqui cada metade só entra se existir, e o
 * separador só aparece entre duas metades de verdade. Se as duas faltarem
 * (pago sem forma nem data registradas), o resultado é `null`: não há o que
 * dizer sobre um pagamento do qual não se registrou nada.
 */
export function infoPagamento(
  situacaoExibida: string,
  formaPag: string | null | undefined,
  dataPagIso: string | null | undefined,
): string | null {
  if (situacaoExibida !== 'Pago') return null
  const partes: string[] = []
  const forma = (formaPag ?? '').trim()
  if (forma) partes.push(forma)
  const data = dataBrCurta(dataPagIso)
  if (data) partes.push(data)
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * 'AAAA-MM-DD' -> 'DD/MM'. `null` para data ausente ou fora do formato —
 * nunca uma data inventada nem a string crua vazando para a tela.
 *
 * Vive aqui, e não numa tela, porque é metade de `infoPagamento`: uma função
 * que devolvesse os pedaços e deixasse a junção para cada tela empurraria de
 * volta às duas cópias da regra que esta unificação evita. O ano fica de
 * fora igual ao protótipo (`_fmtDate`) — a sub-linha acompanha um pedido do
 * período em vista, onde o ano é redundante.
 */
function dataBrCurta(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}` : null
}

/** Formato raso de uma saida (venda) usado só pelas duas funções abaixo —
 * mesmo padrão de tipo "por consumidor" que `SaidaBruta`
 * (screens/ClientesLista.tsx) e `SaidaFin` (derive/financeiro.ts): só os
 * campos de que o cálculo de limite de crédito precisa, não o tipo cheio
 * de ModalSaida.tsx. */
export interface SaidaParaLimite {
  id: string
  cliente_id: string | null
  pag: string
  venc: string | null | undefined
  valor: number
}

/**
 * Soma o valor das saídas de um cliente que ainda NÃO estão pagas — usa
 * `situacaoExibidaSaida` (não o `pag` gravado cru) pra decidir "paga" ou
 * não, mesma regra que `inadimplenciaPorCliente` (derive/clientes.ts) usa
 * pra atraso: filtrar por `pag === 'Pago'` na mão já causou defeito neste
 * projeto (a inadimplência ficava cega a atrasos calculados, não
 * gravados), e o mesmo bug se repetiria aqui.
 *
 * '—' ("não aplicável", típico de pedido cancelado/devolvido — ver
 * comentário em SaidasLista.tsx) fica de fora da soma de propósito: não é
 * "ainda não paga", é "pagamento não se aplica" — não representa dívida
 * nenhuma, e somar contaria pedido cancelado como se o cliente devesse
 * por ele.
 *
 * `ignorarId`, quando informado, exclui essa saída específica da soma —
 * usado ao EDITAR uma saída existente: a lista buscada de GET /api/saidas
 * já contém a versão GRAVADA (antiga) dessa mesma venda, e o valor
 * atualizado dela (ainda não salvo) é somado por fora, pelo chamador
 * (`avisoLimiteCredito`, abaixo, via seu parâmetro `estaVenda`). Sem
 * excluir aqui, o valor entraria duas vezes.
 */
export function valorEmAbertoCliente(
  saidas: SaidaParaLimite[],
  clienteId: string,
  hojeIso: string,
  ignorarId?: string | null,
): number {
  return saidas
    .filter(s => s.cliente_id === clienteId && s.id !== ignorarId)
    .filter(s => {
      const situacao = situacaoExibidaSaida(s.pag, s.venc, hojeIso)
      return situacao !== 'Pago' && situacao !== '—'
    })
    .reduce((soma, s) => soma + (s.valor || 0), 0)
}

/** Números concretos do aviso de limite de crédito — ver `avisoLimiteCredito`. */
export interface AvisoLimiteCredito {
  /** Limite de crédito cadastrado do cliente. */
  limite: number
  /** Soma das saídas do cliente ainda não pagas (`valorEmAbertoCliente`),
   * sem contar a venda sendo lançada/editada agora. */
  emAberto: number
  /** Total desta venda — os itens do formulário, ainda não salvos. */
  estaVenda: number
  /** Quanto `emAberto + estaVenda` passa de `limite`. Sempre > 0 quando o
   * aviso existe: a função devolve `null` em vez de um excedente <= 0. */
  excedente: number
}

/**
 * Decide se avisa que uma venda, somada ao que o cliente já deve, passa do
 * limite de crédito cadastrado — e devolve os números concretos pra exibir
 * (quanto já deve, quanto a venda soma, quanto passa do limite).
 *
 * DECISÃO DO DONO DO PRODUTO: isto é um AVISO, nunca um bloqueio — a venda
 * sempre pode ser salva estourando o limite (quem está no balcão às vezes
 * precisa vender pra um cliente estourado). Esta função só calcula os
 * números; quem decide mostrar ou não é o componente (ModalSaida.tsx), e
 * nada aqui nem lá impede o salvamento.
 *
 * `limite` ausente/vazio/zero significa "sem limite cadastrado" — mesmo
 * padrão de `CLIENTE_NOVO.limite` (derive/clientes.ts): o campo nasce ''
 * (não 0), então tratar 0 como "limite de R$ 0,00" faria todo cliente sem
 * cadastro de crédito disparar aviso em toda venda, virando ruído que
 * ninguém lê. Nesse caso a função sempre devolve `null`, mesmo que o
 * cliente já tenha saídas em aberto.
 *
 * `hojeIso`/`ignorarId`: ver `valorEmAbertoCliente`, que faz o trabalho de
 * somar o "em aberto".
 */
export function avisoLimiteCredito(
  limite: number | string | null | undefined,
  saidas: SaidaParaLimite[],
  clienteId: string,
  estaVenda: number,
  hojeIso: string,
  ignorarId?: string | null,
): AvisoLimiteCredito | null {
  const limiteNum = Number(limite) || 0
  if (limiteNum <= 0) return null

  const emAberto = valorEmAbertoCliente(saidas, clienteId, hojeIso, ignorarId)
  const excedente = emAberto + estaVenda - limiteNum
  if (excedente <= 0) return null

  return { limite: limiteNum, emAberto, estaVenda, excedente }
}
