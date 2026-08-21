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
 * O filtro `> 0` (exclui recebimento no mesmo dia da entrega) é fidelidade
 * ao protótipo, não uma escolha nova — sinalizado no relatório de entrega
 * como um comportamento estranho a confirmar com o cliente, porque descarta
 * exatamente os pagamentos mais rápidos da média.
 *
 * `null` quando não há nenhuma saída paga com as duas datas no período —
 * nunca 0 (o protótipo caía num "senão 12" fixo; aqui a tela mostra "—").
 */
export function diasRecebimento(saidas: SaidaFin[], periodo: string): number | null {
  const dias = noPeriodo(saidas, periodo, s => s.entrega)
    .filter(s => s.status === 'Entregue')
    .map(s => (s.entrega && s.data_pag) ? diasEntre(s.entrega, s.data_pag) : null)
    .filter((d): d is number => d !== null && d > 0)
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
 * Giro de estoque, em dias: quanto tempo o saldo atual duraria no ritmo de
 * saída. Portado de logica-dashboard.txt linhas 29-33
 * ("qEnt - qPer - qSai) / (qSai/30)"). Fidelidade inclui duas
 * características que podem parecer estranhas — registradas aqui e no
 * relatório de entrega, não corrigidas em silêncio:
 *
 * 1. Usa o volume de TODA a entrada/saída já cadastrada (não filtra por
 *    período) — mesmo comportamento do protótipo, que soma `entradasRaw`/
 *    `pedidosRaw` (não `entradasPeriodo`/`pedidosPeriodo`) aqui.
 * 2. Divide o total de saída acumulado por 30 para estimar um "ritmo
 *    diário" — só é uma boa aproximação se o histórico cadastrado cobrir
 *    ~30 dias; com uma base maior, o giro calculado tende a encolher
 *    artificialmente (o denominador cresce mais rápido que um "ritmo
 *    recente" real).
 *
 * `qPer` (perda) usa `perda_kg` do cabeçalho da entrada (perda na coleta/
 * transporte) — é o campo equivalente disponível na resposta de
 * GET /api/entradas dentro do escopo desta tela (só /api/saidas,
 * /api/entradas e /api/lancamentos); o protótipo somava a perda por ITEM da
 * entrada, um dado que exigiria uma chamada por entrada (GET /:id) e está
 * fora desse escopo. A perda de depósito (tabela `perdas`, pós-entrada) não
 * entra por não estar entre as três APIs desta tela.
 *
 * `null` quando não há nenhuma saída (qSai <= 0) — não há ritmo de saída
 * para estimar um giro, e um "giro 0" ou "giro infinito" seria enganoso.
 */
export function diasEstoque(entradas: EntradaFin[], saidas: SaidaFin[]): number | null {
  const qEnt = entradas.reduce((s, e) => s + (e.peso_total || 0), 0)
  const qPer = entradas.reduce((s, e) => s + (e.perda_kg || 0), 0)
  const qSai = saidas
    .filter(s => s.status !== 'Cancelado' && s.status !== 'Devolvido')
    .reduce((s, x) => s + (x.peso || 0), 0)
  if (qSai <= 0) return null
  return Math.max(1, Math.round(Math.max(0, qEnt - qPer - qSai) / (qSai / 30)))
}

/**
 * Ciclo de caixa completo — item do To Do do cliente:
 *
 *   "Ciclo de caixa completo — Hoje usa só os dias de recebimento. Somar:
 *   dias de pagamento ao produtor (data do pagamento − data da entrada) +
 *   dias de estoque (giro real) + dias de recebimento."
 *
 * Fórmula: total = pagamentoProdutor + estoque + recebimento (SOMA).
 *
 * Isto é uma divergência DELIBERADA do protótipo, sinalizada no relatório
 * de entrega, não uma correção silenciosa: em logica-dashboard.txt linha
 * 35, `cicloDias = cicloEst + cicloReceb - cicloPag` — no espírito do Cash
 * Conversion Cycle clássico, que SUBTRAI os dias que a mercadoria ainda não
 * foi paga ao fornecedor (esse dinheiro ainda não saiu do caixa, então
 * "encurta" o ciclo). Só que lá `cicloPag` é a constante fixa 3
 * ("referência do estudo"), nunca calculada de dado real — exatamente o
 * ponto que o To Do pede para corrigir: computar de verdade a partir de
 * `data_pag − data` de cada entrada paga, e SOMAR (não subtrair) ao total.
 * Este arquivo segue o texto do To Do à risca. Quem revisar os números deve
 * saber que a leitura financeira padrão de CCC subtrairia esse componente;
 * aqui ele soma, por pedido explícito do cliente.
 *
 * Cada componente que não puder ser calculado com os dados do período (sem
 * saída entregue e paga, sem entrada paga, ou sem saída para estimar o
 * giro) volta como `null` — nunca 0. Um ciclo de caixa com um componente
 * "zerado" silenciosamente mentiria pra menos; a tela mostra "—" e explica
 * o motivo, em vez de inventar um número. Pelo mesmo motivo, `total` só é
 * calculado quando os três componentes existem — somar um `null` como 0
 * distorceria o total do mesmo jeito que um componente zerado distorceria.
 */
export function calcularCicloCaixa(entradas: EntradaFin[], saidas: SaidaFin[], periodo: string): CicloCaixa {
  const pagamentoProdutor = diasPagamentoProdutor(entradas, periodo)
  const estoque = diasEstoque(entradas, saidas)
  const recebimento = diasRecebimento(saidas, periodo)
  const completo = pagamentoProdutor !== null && estoque !== null && recebimento !== null
  return {
    pagamentoProdutor,
    estoque,
    recebimento,
    total: completo ? pagamentoProdutor + estoque + recebimento : null,
  }
}
