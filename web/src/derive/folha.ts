import { dataBrCurta } from './pagamento'

/**
 * O QUE TODA FOLHA IMPRESSA DESTE SISTEMA TEM EM COMUM.
 *
 * Existem três folhas, e elas nasceram em momentos diferentes:
 *
 *   1. o ROMANEIO de entregas (Saídas) — a folha que o motorista leva;
 *   2. a folha de CONTAGEM FÍSICA (Estoque) — a prancheta da câmara fria;
 *   3. a folha de CONFERÊNCIA da carga (Entradas) — o que chegou do produtor.
 *
 * As três respondem perguntas diferentes, mas resolvem os MESMOS problemas de
 * apresentação: dizer uma data sem ambiguidade, escrever quantidade na
 * unidade em que ela foi lançada, formatar dinheiro sem inventar zero, e
 * guardar/normalizar a escolha de "o que sai na folha".
 *
 * Este módulo é o único lugar onde essas quatro coisas moram. O motivo é
 * direto: as três folhas foram feitas para ser corrigidas juntas. Uma cópia
 * por tela é como uma delas fica para trás na próxima correção — e a que
 * ficar para trás vai ser justamente a que ninguém abriu no mês em que o
 * defeito apareceu.
 *
 * Molde de derive/clientes.ts e derive/estoque.ts: funções puras, sem React,
 * sem fetch, sem `new Date()`. Quem precisa de "hoje" recebe a data por
 * parâmetro, para o teste não depender de relógio.
 */

// ======================================= a escolha de "o que sai na folha"

/**
 * Um campo OPCIONAL de uma folha — uma caixa no painel "O que sai na folha".
 *
 * O que NÃO vira um destes é fixo por decisão, e cada folha publica a própria
 * lista de fixos em texto (`CAMPOS_FIXOS_*`) para a escolha ser honesta:
 * "escolha o que sai" com metade saindo em silêncio seria meia verdade.
 */
export interface DefinicaoCampoFolha<C extends string = string> {
  chave: C
  rotulo: string
  /** Em que bloco da folha ele aparece — vira o agrupamento do painel. */
  grupo: string
  /** Marcado ao abrir pela primeira vez (e sempre que a preferência gravada
   * não puder ser lida). */
  padrao: boolean
  /** Por que ele vem (ou não vem) marcado — texto mostrado ao usuário. */
  ajuda: string
}

/** A escolha do usuário para uma folha: um booleano por campo opcional. */
export type CamposDaFolha<C extends string> = Record<C, boolean>

/**
 * A escolha inicial — e a de segurança: é para cá que se cai quando a
 * preferência gravada não pode ser lida ou está corrompida.
 *
 * Nas três folhas os campos de PREÇO têm `padrao: false`, então nenhuma falha
 * de armazenamento consegue vazar valor para uma folha que circula. Ver o
 * comentário de `normalizarCamposFolha`.
 */
export function padroesDeCampos<C extends string>(
  defs: readonly DefinicaoCampoFolha<C>[],
): CamposDaFolha<C> {
  return Object.fromEntries(defs.map(d => [d.chave, d.padrao])) as CamposDaFolha<C>
}

/**
 * Transforma QUALQUER COISA numa escolha de campos válida.
 *
 * A entrada vem de `JSON.parse` de uma string do `localStorage`, que é
 * território hostil: pode ser `null`, um número, um array, um objeto de uma
 * versão anterior do app (com um campo que já não existe, ou faltando um que
 * passou a existir), ou lixo que uma extensão deixou. Nada disso pode virar
 * exceção nem um objeto meio preenchido cujo `undefined` a tela leia como
 * "marcado" por acidente.
 *
 * A regra: chave desconhecida é DESCARTADA, chave faltando ou com valor
 * não-booleano cai no PADRÃO daquele campo. Isso dá duas garantias que
 * importam: acrescentar um campo novo ao app não invalida a preferência
 * gravada de ninguém (o campo novo entra com o padrão dele), e nenhum lixo
 * gravado consegue LIGAR um campo de preço — só um `true` booleano na chave
 * certa liga, e o padrão dele é `false`.
 */
export function normalizarCamposFolha<C extends string>(
  defs: readonly DefinicaoCampoFolha<C>[],
  bruto: unknown,
): CamposDaFolha<C> {
  const objeto = (typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto))
    ? bruto as Record<string, unknown>
    : {}
  const campos = {} as CamposDaFolha<C>
  for (const def of defs) {
    const valor = objeto[def.chave]
    campos[def.chave] = typeof valor === 'boolean' ? valor : def.padrao
  }
  return campos
}

/**
 * Os grupos do painel, na ordem em que aparecem pela primeira vez na lista de
 * campos. A ordem sai da MESMA fonte que decide os campos — um array de nomes
 * de grupo escrito à parte, no componente, é o tipo de duplicação que fica
 * desatualizada no dia em que alguém acrescenta um campo de um grupo novo e a
 * caixa dele simplesmente não aparece na tela, sem erro nenhum.
 */
export function gruposDeCampos<C extends string>(
  defs: readonly DefinicaoCampoFolha<C>[],
): string[] {
  const vistos: string[] = []
  for (const d of defs) if (!vistos.includes(d.grupo)) vistos.push(d.grupo)
  return vistos
}

// ================================================== a data que a folha carimba

const DIAS_DA_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
]

/**
 * A DATA GRANDE DA FOLHA: "sexta-feira, 28/08/2026".
 *
 * Folha do dia errado na mão de quem confere é PIOR que folha nenhuma: sem
 * folha a pessoa pergunta; com a folha errada ela confere confiante e aceita
 * a carga trocada, ou conta o estoque contra uma posição de duas semanas
 * atrás. Por isso a data sai por extenso e com o dia da semana junto — o dia
 * da semana é a redundância que faz o erro saltar aos olhos de quem pegou a
 * folha de ontem por engano ("mas hoje é sexta").
 *
 * `dataBrCurta` (derive/pagamento.ts) faz o DD/MM — o formatador único do
 * projeto. O ano é acrescentado aqui porque a folha vira papel e pode ser
 * arquivada: "28/08" sozinho num arquivo morto não diz de que ano é.
 *
 * O dia da semana sai de `Date.UTC` + tabela de nomes, e não de
 * `toLocaleDateString('pt-BR', { weekday })`: a tabela é determinística em
 * qualquer runtime (o teste não depende de ICU instalado) e o `Date.UTC` não
 * tem fuso para escorregar um dia. `null` para data ausente ou impossível
 * (30/02, mês 13) — nunca uma data inventada e nunca a string crua vazando
 * para a folha.
 */
export function dataPorExtensoFolha(iso: string | null | undefined): string | null {
  const curta = dataBrCurta(iso)
  if (!curta) return null
  const texto = String(iso)
  const ano = Number(texto.slice(0, 4))
  const mes = Number(texto.slice(5, 7))
  const dia = Number(texto.slice(8, 10))
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  // Round-trip: 2026-02-30 vira 02/03 no Date, e os componentes deixam de
  // bater. Data impossível não pode virar uma data plausível na folha.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null
  }
  return `${DIAS_DA_SEMANA[d.getUTCDay()]}, ${curta}/${ano}`
}

/**
 * O dia vizinho de uma data ISO — o que os botões ◀ / ▶ das folhas fazem.
 *
 * Existe para percorrer o histórico sem digitar data nenhuma. Digitar é onde
 * o erro de dia nasce, e o dia errado na folha é o risco central de todas
 * elas.
 *
 * `Date.UTC` + `setUTCDate` atravessa fim de mês, ano bissexto e virada de
 * ano sozinho, e o UTC evita o escorregão de um dia que o horário local
 * produziria em fusos com verão. Data inválida volta INTACTA em vez de virar
 * uma data qualquer: navegar a partir de lixo não pode produzir um dia
 * plausível.
 */
export function diaVizinhoFolha(iso: string | null | undefined, passo: number): string {
  const texto = String(iso ?? '')
  if (!dataPorExtensoFolha(texto)) return texto
  const d = new Date(Date.UTC(
    Number(texto.slice(0, 4)), Number(texto.slice(5, 7)) - 1, Number(texto.slice(8, 10)),
  ))
  d.setUTCDate(d.getUTCDate() + passo)
  return d.toISOString().slice(0, 10)
}

// ====================================================== números que a folha diz

/**
 * "45 UN", "10,5 CX", "30 KG" — a quantidade com a UNIDADE COLADA.
 *
 * A unidade não vira cabeçalho de coluna e não desce para uma legenda: uma
 * folha com linhas lançadas em caixa e em quilo teria um cabeçalho mentindo na
 * maioria delas. É a decisão de 88318ee ("ROTULOS DAS COLUNAS"), aplicada às
 * folhas impressas pelo mesmo motivo — quem confere conta CAIXA, não quilo
 * convertido.
 *
 * Até três casas (a precisão de `saida_itens.qtd`/`entrada_itens.qtd`,
 * numeric(12,3)) e sem casas forçadas: "45 UN", não "45,000 UN". Quantidade
 * não finita vira travessão — nunca `0`, que afirmaria "nada a conferir" onde
 * a verdade é "não sei quanto".
 */
export function quantidadeNaUnidade(qtd: number, un: string): string {
  if (!Number.isFinite(qtd)) return '—'
  const numero = qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const unidade = (un ?? '').trim()
  return unidade ? `${numero} ${unidade}` : numero
}

/**
 * "R$ 12,50". `null` quando NÃO HÁ VALOR a dizer — e as duas situações que
 * levam a isso são a mesma coisa neste projeto:
 *
 *   - não finito: não dá para afirmar valor nenhum;
 *   - `<= 0`: os modais gravam 0 quando o campo de preço fica vazio (ver
 *     `salvar` em ModalSaida.tsx e o `preco > 0` de GET /ultimos-precos),
 *     então zero aqui quase sempre significa "ninguém preencheu", não
 *     "vendido de graça".
 *
 * `null` vira travessão na folha, nunca "R$ 0,00" — que afirmaria um preço
 * medido de zero. Sempre duas casas: numa folha que pode ir para conferência
 * de nota, "R$ 12,5" é uma ambiguidade cara.
 */
export function dinheiroFolha(valor: number): string | null {
  if (!Number.isFinite(valor) || valor <= 0) return null
  return 'R$ ' + valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/**
 * "3 clientes · 4 pedidos · 12 itens" — a frase de conferência do topo.
 *
 * Quem confere bate isso contra a pilha ANTES de conferir item a item: se são
 * 12 itens e ele separou 11, descobre com a folha na mão, não na porta do
 * cliente.
 *
 * Singular e plural escritos por extenso, sem "(s)": a folha é impressa e
 * lida com pressa, e "1 cliente(s)" é o tipo de detalhe que faz o leitor
 * duvidar do resto do documento.
 */
export function contagemPorExtenso(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}
