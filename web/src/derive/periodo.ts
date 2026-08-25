/**
 * A CONVENÇÃO DE PERÍODO DO SISTEMA INTEIRO — achado S-3 da auditoria
 * (docs/superpowers/auditoria-vs-prototipo.md), portado do seletor de
 * "Período" do cabeçalho global do protótipo (design/CRM Hortifruti.dc.html,
 * markup 95-101, efeito em 2157-2159).
 *
 * POR QUE ESTE MÓDULO EXISTE, e por que ele não nasceu junto de `financeiro.ts`
 *
 * Até agora o projeto tinha TRÊS convenções de "período" convivendo:
 *
 *   1. `mesDe()` (derive/clientes.ts) devolvia só 'MM' — junho/2025 e
 *      junho/2026 eram o mesmo período. Removida por esta mudança.
 *   2. `periodoDe()` + `noPeriodo()` (derive/financeiro.ts), 'AAAA-MM' ou
 *      'all' — a convenção correta, mas morando dentro do módulo financeiro.
 *   3. `noPeriodo(iso, de, ate)` (derive/relatorios.ts), intervalo 'AAAA-MM'
 *      De/Até — mais fina que a de cima, usada por Relatórios e Lançamentos.
 *
 * Enquanto o período era um controle LOCAL de duas telas, isso passava. Um
 * seletor global torna a divergência visível: o mesmo mês escolhido no
 * cabeçalho tem de significar exatamente a mesma coisa em todas as telas, ou
 * o usuário vê o total de uma tela não bater com o da vizinha e para de
 * confiar nos dois. Por isso a convenção 2 mudou de casa para cá (financeiro
 * a reexporta, para nenhum import existente quebrar) e a 1 morreu; a 3
 * continua onde está, e `intervaloDoPeriodo` abaixo é a ponte entre as duas.
 *
 * Sem React, sem fetch, sem `new Date()` — molde de derive/clientes.ts.
 */

/**
 * Período global: `'all'` (todo o histórico) ou um mês civil `'AAAA-MM'`.
 * É `string` e não uma união fechada porque os meses são gerados a partir da
 * data de hoje (`opcoesDePeriodo`), não enumerados à mão.
 */
export type Periodo = string

/** O valor de "sem recorte" — todo o histórico. Nomeado para nenhuma tela
 * comparar com a string `'all'` solta. */
export const PERIODO_TODOS: Periodo = 'all'

/** Quantos meses o seletor global oferece além de "Todo o período". Doze
 * cobre a comparação natural do negócio (este mês vs. o mesmo mês do ano
 * passado) sem virar uma lista de rolagem infinita. */
export const MESES_NO_SELETOR = 12

const DATA_RE = /^\d{4}-\d{2}-\d{2}/

/**
 * 'AAAA-MM' de uma data ISO. Vazio ou inválido devolve ''.
 *
 * O ano faz parte de propósito: somar junho/2025 com junho/2026 num mesmo
 * "período" produziria um resultado errado sem nenhum aviso — o tipo de erro
 * silencioso que este módulo existe para evitar.
 */
export function periodoDe(iso: string | null | undefined): string {
  return typeof iso === 'string' && DATA_RE.test(iso) ? iso.slice(0, 7) : ''
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * 'AAAA-MM' -> 'Junho/2026'. 'all' -> 'Todo o período'. Um rótulo só para
 * todo o app: duas cópias dariam duas grafias do mesmo mês em telas
 * vizinhas — e, com um seletor global, nas duas metades da MESMA tela.
 */
export function rotuloPeriodo(periodo: Periodo): string {
  if (periodo === PERIODO_TODOS) return 'Todo o período'
  const [ano, mes] = periodo.split('-')
  const nome = MESES[Number(mes) - 1] ?? mes
  return `${nome}/${ano}`
}

/** Filtra uma lista pelo período, lendo a data de cada item por `dataDe`.
 * `'all'` devolve a lista inteira (nem sequer copia). */
export function filtrarPorPeriodo<T>(
  itens: T[],
  periodo: Periodo,
  dataDe: (item: T) => string | null | undefined,
): T[] {
  if (periodo === PERIODO_TODOS) return itens
  return itens.filter(item => periodoDe(dataDe(item)) === periodo)
}

/**
 * Ponte para a convenção De/Até de derive/relatorios.ts (`noPeriodo(iso, de,
 * ate)`), que é um INTERVALO de meses e não um mês só: um mês civil é o
 * intervalo fechado [mês, mês], e 'all' é o intervalo sem limite nenhum
 * ('', ''), que lá significa "deixa tudo passar".
 *
 * É também o que o servidor entende: `GET /api/relatorios/produtos` aceita
 * `?de=AAAA-MM&ate=AAAA-MM` (api/src/routes/relatorios.ts).
 */
export function intervaloDoPeriodo(periodo: Periodo): { de: string; ate: string } {
  if (periodo === PERIODO_TODOS) return { de: '', ate: '' }
  return { de: periodo, ate: periodo }
}

/** `?de=…&ate=…` (com o `?`) para o período, ou '' quando é 'all'. Mantém a
 * montagem da query num lugar só — duas telas buscam o mesmo agregado. */
export function queryDePeriodo(periodo: Periodo): string {
  const { de, ate } = intervaloDoPeriodo(periodo)
  if (!de && !ate) return ''
  const query = new URLSearchParams()
  if (de) query.set('de', de)
  if (ate) query.set('ate', ate)
  return '?' + query.toString()
}

/**
 * Os meses oferecidos pelo seletor global: os `meses` mais recentes contados
 * a partir de `hojeIso` (inclusive), do mais novo para o mais antigo.
 *
 * POR QUE UMA JANELA FIXA, e não "os meses que têm movimento" (que é o
 * critério de `periodosDisponiveis` do Financeiro e de `periodosComFolha` dos
 * Funcionários, agora sem uso):
 *
 * - O seletor mora no Shell, que é a moldura das ONZE telas e dos DOIS papéis.
 *   Descobrir "quais meses têm movimento" exigiria o Shell buscar a base
 *   inteira (saídas + entradas + lançamentos) só para montar um `<select>` —
 *   e `GET /api/lancamentos` é admin-only (403 para colaborador), então as
 *   opções mudariam conforme quem está logado.
 * - A lista ficaria instável: lançar a primeira venda de um mês novo faria
 *   aparecer uma opção que não existia, e a lista buscada uma vez no login
 *   envelheceria em silêncio.
 * - Um mês sem movimento não é desonesto: as telas mostram travessão ou zero
 *   medido, que é a resposta certa para "quanto vendi em julho" quando não se
 *   vendeu nada em julho.
 *
 * Histórico mais antigo que a janela continua acessível por "Todo o período",
 * e Relatórios/Lançamentos mantêm o De/Até livre para qualquer mês.
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável sem mockar relógio — mesmo padrão de `situacaoExibidaSaida`.
 */
export function opcoesDePeriodo(hojeIso: string, meses: number = MESES_NO_SELETOR): string[] {
  const base = periodoDe(hojeIso)
  if (!base) return []
  const ano = Number(base.slice(0, 4))
  const mes = Number(base.slice(5, 7))
  const saida: string[] = []
  for (let i = 0; i < Math.max(0, meses); i++) {
    // Aritmética de mês em base 0 para o ano virar sozinho — sem `Date`, que
    // traria fuso horário para dentro de uma função pura de calendário.
    const total = (ano * 12 + (mes - 1)) - i
    const a = Math.floor(total / 12)
    const m = (total % 12) + 1
    saida.push(`${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}`)
  }
  return saida
}
