import type { Lancamento } from './lancamentos'

// Molde: derive/clientes.ts — funções puras, testadas isoladamente, sem
// React/fetch/formatação. Financeiro não guarda dado próprio (comentário em
// App.tsx): tudo aqui é derivado de saídas (vendas), entradas (compras) e
// lançamentos, os três já expostos por /api/saidas, /api/entradas e
// /api/lancamentos.
//
// Lógica portada com fidelidade de .superpowers/design-telas/logica-financeiro.txt
// (receita, custos, lucro) e .superpowers/design-telas/logica-dashboard.txt
// linhas 26-37 (ciclo de caixa). Onde a lógica original usa um campo que não
// existe no schema real (ex.: `p.recebDias` já vinha pronto no protótipo),
// este arquivo recalcula o equivalente a partir das datas reais — mesmo
// resultado, dado que o protótipo não expõe como esse campo era montado.
//
// CORREÇÃO AUTORIZADA (2026-08-22): três defeitos de cálculo, portados com
// fidelidade do protótipo/To Do original, foram revisados e confirmados
// como erro pelo dono do negócio — a correção abaixo diverge de propósito
// do texto original, não é um bug novo. Ver o comentário de cada função:
// calcularCicloCaixa (soma → subtração, CCC padrão), diasRecebimento
// (inclui recebimento no mesmo dia na média) e diasEstoque (usa o período
// filtrado em vez do histórico acumulado inteiro / 30 fixo).

/* ============================== tipos ============================== */

/**
 * Saída (venda) como a listagem devolve (api/src/routes/saidas.ts, GET /):
 * cabeçalho + valor/peso agregados dos itens. Só os campos que os cálculos
 * daqui usam — não é o mesmo tipo de ModalSaida.tsx de propósito (este
 * módulo não depende de components/, mesmo padrão de derive/clientes.ts com
 * seu próprio `Pedido`).
 */
export interface SaidaFin {
  id: string
  entrega: string | null // ISO aaaa-mm-dd
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  data_pag: string | null // ISO aaaa-mm-dd; null enquanto não pago
  valor?: number
  peso?: number
}

/** Entrada (compra) como a listagem devolve (api/src/routes/entradas.ts, GET /). */
export interface EntradaFin {
  id: string
  data: string // ISO aaaa-mm-dd
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  /** Perda na coleta/transporte, antes de entrar no depósito (coluna do
   * cabeçalho de `entradas`; perda de depósito é outra tabela, `perdas`,
   * fora do escopo desta tela — ver comentário em diasEstoque). */
  perda_kg: number
  valor_total?: number
  peso_total?: number
}

export interface CustoCategoria {
  categoria: string
  valor: number
}

export interface Resultado {
  receitaBruta: number
  /** Primeira linha é sempre "Compra de mercadoria" (das entradas); o resto
   * são as categorias de lançamentos agrupadas, maior valor primeiro. */
  custos: CustoCategoria[]
  custoTotal: number
  lucroLiquido: number
  /** % do lucro sobre a receita bruta. 0 quando não há receita no período. */
  pctLucro: number
}

/**
 * Cada componente é `null` quando não há dado suficiente no período para
 * calculá-lo — nunca 0 (ver calcularCicloCaixa). `total` só existe quando os
 * três componentes existem; do contrário também é `null`.
 */
export interface CicloCaixa {
  pagamentoProdutor: number | null
  estoque: number | null
  recebimento: number | null
  total: number | null
}

/* ============================== período ============================== */

const DATA_RE = /^\d{4}-\d{2}-\d{2}/

/**
 * 'AAAA-MM' de uma data ISO. Diferente de `mesDe()` em derive/clientes.ts
 * (que devolve só 'MM', 2 dígitos, e por isso confunde o mesmo mês em anos
 * diferentes): o financeiro soma dinheiro real, e juntar junho/2025 com
 * junho/2026 num mesmo "período" produziria um resultado errado sem nenhum
 * aviso — o tipo de erro silencioso que este módulo existe para evitar.
 * Vazio ou inválido devolve ''.
 */
export function periodoDe(iso: string | null | undefined): string {
  return typeof iso === 'string' && DATA_RE.test(iso) ? iso.slice(0, 7) : ''
}

function noPeriodo<T>(itens: T[], periodo: string, dataDe: (item: T) => string | null): T[] {
  if (periodo === 'all') return itens
  return itens.filter(item => periodoDe(dataDe(item)) === periodo)
}

/* ============================ resultado ============================ */

/**
 * Receita bruta do período: soma do `valor` das saídas com status Entregue,
 * filtradas pelo mês de `entrega`. Portado de logica-financeiro.txt linha 7
 * ("receitaBruta = receitaFat; // vem dos pedidos entregues no período").
 * Saída cancelada, devolvida ou ainda em rota não entra — mesmo critério de
 * `derivarClientes` em clientes.ts para "faturado".
 */
export function receitaBrutaPeriodo(saidas: SaidaFin[], periodo: string): number {
  return noPeriodo(saidas, periodo, s => s.entrega)
    .filter(s => s.status === 'Entregue')
    .reduce((soma, s) => soma + (s.valor || 0), 0)
}

/**
 * Custo de compra de mercadoria do período: soma do `valor_total` das
 * entradas, filtradas pelo mês de `data`. Portado de logica-financeiro.txt
 * linha 3 ("compraMercadoria = entradasPeriodo.reduce(...)"). Diferente da
 * receita, aqui não há filtro por `pago` — o protótipo soma toda entrada do
 * período, paga ou não (é custo incorrido, não caixa).
 */
export function compraMercadoriaPeriodo(entradas: EntradaFin[], periodo: string): number {
  return noPeriodo(entradas, periodo, e => e.data)
    .reduce((soma, e) => soma + (e.valor_total || 0), 0)
}

/**
 * Lançamentos do período agrupados por categoria, maior valor primeiro.
 * Categoria é enum fechado no servidor (api/src/routes/lancamentos.ts,
 * CATEGORIAS) — nunca precisa de normalização de texto aqui.
 */
export function custosPorCategoria(lancamentos: Lancamento[], periodo: string): CustoCategoria[] {
  const porCategoria = new Map<string, number>()
  for (const l of noPeriodo(lancamentos, periodo, l => l.data)) {
    porCategoria.set(l.categoria, (porCategoria.get(l.categoria) || 0) + (l.valor || 0))
  }
  return [...porCategoria.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor)
}

/**
 * Resultado do período: receita bruta − custos (compra de mercadoria + cada
 * categoria de lançamento) = lucro líquido. Portado de
 * logica-financeiro.txt linhas 1-10. `financeiro.html` (linhas 10, 18-23)
 * confirma que "Compra de mercadoria" aparece como a primeira linha de
 * custo, seguida das categorias de lançamento — daí `custos` combinar as
 * duas fontes num único vetor ordenado.
 */
export function calcularResultado(
  saidas: SaidaFin[],
  entradas: EntradaFin[],
  lancamentos: Lancamento[],
  periodo: string,
): Resultado {
  const receitaBruta = receitaBrutaPeriodo(saidas, periodo)
  const compra = compraMercadoriaPeriodo(entradas, periodo)
  const custos: CustoCategoria[] = [
    { categoria: 'Compra de mercadoria', valor: compra },
    ...custosPorCategoria(lancamentos, periodo),
  ]
  const custoTotal = custos.reduce((soma, c) => soma + c.valor, 0)
  const lucroLiquido = receitaBruta - custoTotal
  const pctLucro = receitaBruta ? (lucroLiquido / receitaBruta) * 100 : 0
  return { receitaBruta, custos, custoTotal, lucroLiquido, pctLucro }
}

/* =========================== ciclo de caixa =========================== */

/** Dias entre duas datas ISO ('aaaa-mm-dd'), arredondado. `null` se alguma
 * das duas for inválida. Meia-noite UTC dos dois lados — colunas `date` do
 * Postgres não carregam hora, então não há fuso horário a normalizar. */
function diasEntre(deIso: string, ateIso: string): number | null {
  if (!DATA_RE.test(deIso) || !DATA_RE.test(ateIso)) return null
  const de = new Date(`${deIso.slice(0, 10)}T00:00:00Z`).getTime()
  const ate = new Date(`${ateIso.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(de) || Number.isNaN(ate)) return null
  return Math.round((ate - de) / 86_400_000)
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((s, v) => s + v, 0) / valores.length
}

/**
 * Dias médios de recebimento: `data_pag − entrega` das saídas Entregues do
 * período, só quando ambas as datas existem. Portado de
 * logica-dashboard.txt linha 27-28 ("pagosPeriodo = pedidosPeriodo.filter(
 * p=>p.status==='Entregue' && p.recebDias>0)"): o protótipo já trazia
 * `recebDias` pronto no objeto pedido; aqui ele é recalculado da mesma
 * forma (dias entre a entrega e o pagamento).
 *
 * DEFEITO CORRIGIDO (autorizado pelo dono do negócio): o protótipo filtrava
 * `recebDias > 0`, excluindo da média justamente os recebimentos no MESMO
 * DIA da entrega — os melhores clientes, os que pagam à vista. O efeito
 * era perverso: quanto mais gente pagava rápido, pior (mais alto) ficava o
 * indicador, porque esses zeros eram descartados em vez de puxar a média
 * pra baixo. Fidelidade ao protótipo, não escolha nova — mas sinalizado no
 * relatório de entrega como comportamento estranho, e agora confirmado como
 * erro. A correção troca `d > 0` por `d >= 0`: 0 dias (pago no mesmo dia)
 * ENTRA na média; só continua de fora o que teria dado negativo (pagamento
 * registrado antes da entrega — erro de digitação, não recebimento real).
 *
 * Isso é diferente de "sem data de pagamento" (`data_pag` nulo): o `map`
 * abaixo já devolve `null` nesse caso (não 0), e o filtro de tipo
 * (`d !== null`) descarta esse `null` antes mesmo do `d >= 0` — os dois
 * casos (pago no mesmo dia vs. sem data de pagamento) já eram, e continuam,
 * distinguíveis com o dado disponível hoje (`data_pag: string | null`).
 *
 * `null` quando não há nenhuma saída paga com as duas datas no período —
 * nunca 0 (o protótipo caía num "senão 12" fixo; aqui a tela mostra "—").
 */
export function diasRecebimento(saidas: SaidaFin[], periodo: string): number | null {
  const dias = noPeriodo(saidas, periodo, s => s.entrega)
    .filter(s => s.status === 'Entregue')
    .map(s => (s.entrega && s.data_pag) ? diasEntre(s.entrega, s.data_pag) : null)
    .filter((d): d is number => d !== null && d >= 0)
  const m = media(dias)
  return m === null ? null : Math.round(m)
}

/**
 * Dias médios de pagamento ao produtor: `data_pag − data` das entradas
 * pagas do período. Este componente NÃO existe no protótipo — lá,
 * `cicloPag` era uma constante fixa = 3 ("prazo de pagamento ao produtor
 * (referência do estudo)", logica-dashboard.txt linha 34), nunca calculada
 * de dado real. É exatamente o que o To Do do cliente pede para corrigir
 * ("dias de pagamento ao produtor (data do pagamento − data da entrada)") —
 * implementado aqui do zero, sem um formato do protótipo para seguir.
 *
 * Diferente de diasRecebimento, aceita diferença 0 (pagar no mesmo dia da
 * entrada é uma informação válida, não motivo pra excluir): só descarta
 * negativos, que seriam erro de digitação (pagamento antes da entrada
 * existir). `null` quando não há nenhuma entrada paga com `data_pag` no
 * período.
 */
export function diasPagamentoProdutor(entradas: EntradaFin[], periodo: string): number | null {
  const dias = noPeriodo(entradas, periodo, e => e.data)
    .filter(e => e.pago === 'Pago')
    .map(e => e.data_pag ? diasEntre(e.data, e.data_pag) : null)
    .filter((d): d is number => d !== null && d >= 0)
  const m = media(dias)
  return m === null ? null : Math.round(m)
}

/**
 * Número de dias corridos a usar como divisor do ritmo de saída em
 * `diasEstoque` — suporte da correção do defeito de giro de estoque
 * (ver comentário de `diasEstoque` logo abaixo). Três casos:
 *
 * 1. `periodo` = 'AAAA-MM': dias corridos do MÊS CIVIL correspondente
 *    (28-31, conforme o mês) — propriedade do calendário, não do dado.
 * 2. `periodo` = 'all': "todo o período" aqui é literalmente todo o
 *    histórico presente nos itens informados, então seu "número real de
 *    dias" é o intervalo entre a data mais antiga e a mais recente entre
 *    elas (não um valor fixo). Cresce junto com o histórico cadastrado —
 *    ao contrário do "/30" fixo antigo, a proporção volume/dias continua
 *    representativa mesmo com meses (ou anos) de dado acumulado.
 * 3. Nenhuma data utilizável entre as informadas (ex.: only saídas sem
 *    `entrega` preenchida, período 'all') — caso degenerado em que não dá
 *    pra medir o período real. Cai numa janela explícita de 30 dias,
 *    documentada aqui: é a "janela recente" pedida para quando não há como
 *    determinar o período de fato, usada só como último recurso.
 */
function diasDoPeriodo(periodo: string, datas: (string | null | undefined)[]): number {
  const mesCivil = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (periodo !== 'all' && mesCivil) {
    const ano = Number(mesCivil[1])
    const mes = Number(mesCivil[2])
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate() // dia 0 do mês seguinte = último dia deste mês
  }
  const validas = datas.filter((d): d is string => typeof d === 'string' && DATA_RE.test(d))
  if (validas.length === 0) return 30 // janela recente explícita: nenhuma data pra medir o período real
  const tempos = validas.map(d => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime())
  return Math.max(1, Math.round((Math.max(...tempos) - Math.min(...tempos)) / 86_400_000) + 1)
}

/**
 * Giro de estoque, em dias: quanto tempo o saldo atual duraria no ritmo de
 * saída. Portado de logica-dashboard.txt linhas 29-33
 * ("qEnt - qPer - qSai) / (qSai/30)").
 *
 * DEFEITO CORRIGIDO (autorizado pelo dono do negócio): a versão portada
 * usava o volume de TODA a entrada/saída já cadastrada (sem filtrar por
 * período) dividido por 30 fixo, como se fosse sempre um "ritmo diário
 * recente" — só é uma boa aproximação enquanto o histórico cadastrado
 * cobre uns 30 dias. Com três meses de operação o número já não significa
 * o que promete, e piora (encolhe) sozinho a cada mês que passa, sem nada
 * ter mudado no ritmo real do negócio: o numerador (saldo) cresce muito
 * mais devagar que o denominador (saída acumulada de todo o histórico/30),
 * então o giro calculado tende a zero conforme a base envelhece.
 *
 * A correção usa o PERÍODO EFETIVAMENTE FILTRADO — mesmo `periodo` de
 * `calcularCicloCaixa`/`noPeriodo`, já usado pelos outros dois componentes
 * do ciclo — em vez do histórico inteiro, e divide pelo número REAL de
 * dias desse período (`diasDoPeriodo`, acima): dias corridos do mês civil
 * quando um mês está selecionado, ou o intervalo real de datas presentes
 * quando o filtro é 'all' (que aqui cresce junto com o histórico, ao
 * contrário do "/30" fixo). Uma tela sem filtro de período algum cairia no
 * mesmo `diasDoPeriodo('all', ...)`, que por sua vez só usa a janela fixa
 * de 30 dias como último recurso, quando nem isso dá pra medir.
 *
 * `qPer` (perda) usa `perda_kg` do cabeçalho da entrada (perda na coleta/
 * transporte) — é o campo equivalente disponível na resposta de
 * GET /api/entradas dentro do escopo desta tela (só /api/saidas,
 * /api/entradas e /api/lancamentos); o protótipo somava a perda por ITEM da
 * entrada, um dado que exigiria uma chamada por entrada (GET /:id) e está
 * fora desse escopo. A perda de depósito (tabela `perdas`, pós-entrada) não
 * entra por não estar entre as três APIs desta tela.
 *
 * `null` quando não há nenhuma saída no período (qSai <= 0) — não há ritmo
 * de saída para estimar um giro, e um "giro 0" ou "giro infinito" seria
 * enganoso.
 */
export function diasEstoque(entradas: EntradaFin[], saidas: SaidaFin[], periodo: string): number | null {
  const entradasPeriodo = noPeriodo(entradas, periodo, e => e.data)
  const saidasPeriodo = noPeriodo(saidas, periodo, s => s.entrega)
  const qEnt = entradasPeriodo.reduce((s, e) => s + (e.peso_total || 0), 0)
  const qPer = entradasPeriodo.reduce((s, e) => s + (e.perda_kg || 0), 0)
  const saidasValidas = saidasPeriodo.filter(s => s.status !== 'Cancelado' && s.status !== 'Devolvido')
  const qSai = saidasValidas.reduce((s, x) => s + (x.peso || 0), 0)
  if (qSai <= 0) return null
  const dias = diasDoPeriodo(periodo, [...entradasPeriodo.map(e => e.data), ...saidasPeriodo.map(s => s.entrega)])
  return Math.max(1, Math.round(Math.max(0, qEnt - qPer - qSai) / (qSai / dias)))
}

/**
 * Ciclo de caixa completo — item do To Do do cliente:
 *
 *   "Ciclo de caixa completo — Hoje usa só os dias de recebimento. Somar:
 *   dias de pagamento ao produtor (data do pagamento − data da entrada) +
 *   dias de estoque (giro real) + dias de recebimento."
 *
 * Fórmula: total = estoque + recebimento − pagamentoProdutor.
 *
 * DEFEITO CORRIGIDO (autorizado pelo dono do negócio, 2026-08-22): o texto
 * do To Do acima diz "somar" os três componentes, e a versão anterior
 * deste arquivo seguia isso à risca (total = pagamentoProdutor + estoque +
 * recebimento). Isto é o Ciclo de Conversão de Caixa (CCC), a métrica
 * padrão — e o CCC clássico SUBTRAI o prazo de pagamento ao fornecedor, não
 * soma: em logica-dashboard.txt linha 35, `cicloDias = cicloEst + cicloReceb
 * - cicloPag`, mesma direção. O prazo que o produtor concede TRABALHA A
 * FAVOR do caixa — se você recebe do minimercado em 14 dias mas só paga o
 * produtor em 30, é o produtor quem financia seu capital de giro nesse
 * intervalo. Somando (como a versão anterior fazia), o indicador piorava
 * justamente quando a negociação com o produtor era boa — o oposto do que
 * deveria sinalizar. O dono do negócio revisou e confirmou: é erro de
 * cálculo, não uma divergência deliberada do CCC clássico como o comentário
 * anterior desta função registrava — a soma era fiel ao texto do To Do
 * (nunca testada contra a leitura financeira padrão), a subtração é a
 * correção. Consequência prática: com a fórmula certa, o semáforo de
 * `statusCicloDeCaixa`/`METAS_DASHBOARD.cicloCaixaMetaDias` (dashboard.ts,
 * meta ≤13 dias) volta a fazer sentido para este número — ele era calibrado
 * para a subtração, nunca para a soma — e a tela financeira (FinanceiroTela)
 * volta a mostrá-lo, em vez da nota "sem meta definida" que existia
 * enquanto a fórmula estava errada.
 *
 * Cada componente que não puder ser calculado com os dados do período (sem
 * saída entregue e paga, sem entrada paga, ou sem saída para estimar o
 * giro) volta como `null` — nunca 0. Um ciclo de caixa com um componente
 * "zerado" silenciosamente mentiria pra menos; a tela mostra "—" e explica
 * o motivo, em vez de inventar um número. Pelo mesmo motivo, `total` só é
 * calculado quando os três componentes existem — usar um `null` como 0
 * distorceria o total do mesmo jeito que um componente zerado distorceria.
 */
export function calcularCicloCaixa(entradas: EntradaFin[], saidas: SaidaFin[], periodo: string): CicloCaixa {
  const pagamentoProdutor = diasPagamentoProdutor(entradas, periodo)
  const estoque = diasEstoque(entradas, saidas, periodo)
  const recebimento = diasRecebimento(saidas, periodo)
  const completo = pagamentoProdutor !== null && estoque !== null && recebimento !== null
  return {
    pagamentoProdutor,
    estoque,
    recebimento,
    total: completo ? estoque + recebimento - pagamentoProdutor : null,
  }
}
