/**
 * SALDO EM CAIXA — achado S-4 da auditoria
 * (docs/superpowers/auditoria-vs-prototipo.md), portado do badge do cabeçalho
 * do protótipo (design/CRM Hortifruti.dc.html, markup 103-108, cálculo em
 * 2321-2323, exposto em 2864).
 *
 * ---- O QUE MUDA EM RELAÇÃO AO PROTÓTIPO (decisão do dono do produto) ----
 *
 * O `cashAll` do protótipo contradiz o próprio rótulo. Ele soma as vendas
 * pagas e — apesar do comentário na linha 2321 dizer "− compras pagas −
 * lançamentos" — o que a tela mostra é um número que só cresce: é "total
 * recebido" com nome de saldo. Caixa de verdade sobe E desce.
 *
 * Aqui o saldo é `recebido − pago ao produtor − lançamentos pagos`. Os três
 * insumos já existem: GET /api/saidas, GET /api/entradas e GET /api/lancamentos.
 *
 * ---- O QUE CONTA COMO "PAGO" EM CADA UMA DAS TRÊS FONTES ----
 *
 * 1. SAÍDAS (dinheiro que ENTROU) — `situacaoExibidaSaida(pag, venc, hoje)
 *    === 'Pago'`, NUNCA `s.pag === 'Pago'` escrito à mão. Comparar o campo
 *    gravado direto já causou defeito real neste projeto (a inadimplência
 *    ficava cega a atrasos calculados, não gravados — ver o comentário de
 *    `valorEmAbertoCliente` em derive/pagamento.ts). Hoje as duas formas dão
 *    o mesmo resultado para 'Pago'; a regra derivada é a única fonte de
 *    situação de pagamento do projeto, e é ela que continuará valendo se a
 *    regra mudar. Saída cancelada/devolvida (`pag === '—'`) não entra: não é
 *    dinheiro recebido nem a receber.
 *
 * 2. ENTRADAS (dinheiro que SAIU para o produtor) — `!entradaEmAberto(en)`,
 *    o mesmo predicado que o cartão "A pagar ao produtor" de EntradasLista
 *    usa para o lado oposto (derive/resumoOperacional.ts). Uma entrada é
 *    "paga" quando `pago === 'Pago'`; `pago` gravado como 'Atrasado' (dado
 *    anterior à mudança de comportamento) continua sendo dívida e NÃO sai do
 *    caixa. `entradas` não tem coluna de vencimento — é compra do produtor,
 *    não venda a prazo —, então aqui não há atraso a derivar (assimetria
 *    documentada em derive/pagamento.ts).
 *
 *    `data_pag` diz QUANDO se pagou, não SE se pagou: uma entrada marcada
 *    'Pago' sem data (possível via PUT completo do modal) é dinheiro que
 *    saiu do mesmo jeito. Exigir a data aqui inflaria o saldo silenciosamente
 *    — exatamente o defeito que este cálculo veio consertar.
 *
 * 3. LANÇAMENTOS (frete, gasolina, salário, impostos…) — TODOS entram.
 *    A tabela `lancamentos` não tem coluna de situação de pagamento nem de
 *    vencimento (ver CAMPOS em api/src/routes/lancamentos.ts: data,
 *    categoria, descricao, valor, funcionario_id): um lançamento É o registro
 *    de uma despesa já feita. Não existe "lançamento pendente" para separar,
 *    e inventar um filtro sobre um campo que não existe seria pior que somar
 *    todos. Mesmo critério do protótipo (2323, `lancRaw.reduce(...)`, sem
 *    filtro) e de `custoTotal` no Dashboard.
 *
 * ---- O SALDO NÃO SEGUE O FILTRO DE PERÍODO ----
 *
 * Caixa é uma POSIÇÃO acumulada até hoje, não um fluxo do mês. "Quanto tenho
 * em caixa em junho" não é uma pergunta com resposta: o dinheiro de maio que
 * não foi gasto continua lá em junho. Recortar o saldo por mês produziria um
 * número que parece o caixa e não é — a mesma classe de erro do `cashAll`
 * original. Por isso `saldoEmCaixa` não recebe período nenhum, e o rótulo do
 * badge diz "acumulado" para o leitor não esperar que ele acompanhe o
 * seletor do cabeçalho. O fluxo do período já é a tela Financeiro (receita −
 * custos do período), que é outra pergunta e tem outro lugar.
 *
 * ---- NUNCA UM SALDO PARCIAL ----
 *
 * As três parcelas são obrigatórias. Se qualquer fonte não carregar, a função
 * devolve `null` (o badge vira travessão) em vez de somar as que vieram: um
 * saldo sem as compras seria maior que o real, um saldo sem as vendas seria
 * negativo por construção, e os dois PARECEM o caixa. Travessão é a única
 * resposta honesta — e é diferente de zero, que aqui é uma medida legítima
 * (entrou tanto quanto saiu), assim como o negativo (saiu mais do que
 * entrou), que é informação de verdade e precisa aparecer como tal.
 *
 * Sem React, sem fetch, sem formatação — molde de derive/clientes.ts.
 */

import { situacaoExibidaSaida } from './pagamento'
import { entradaEmAberto } from './resumoOperacional'

/** Saída (venda) como GET /api/saidas devolve — só os campos que o caixa usa.
 * Mesmo padrão de tipo raso por consumidor de `SaidaFin`/`SaidaResumo`. */
export interface SaidaCaixa {
  pag: string
  venc?: string | null
  valor?: number
}

/** Entrada (compra) como GET /api/entradas devolve — idem. */
export interface EntradaCaixa {
  pago: string
  valor_total?: number
}

/** Lançamento como GET /api/lancamentos devolve — idem. */
export interface LancamentoCaixa {
  valor?: number
}

/** As três parcelas do saldo, para o badge poder explicar de onde vem o
 * número (o `title`) sem refazer nenhuma soma por fora. */
export interface Caixa {
  /** Soma das vendas cuja situação EXIBIDA é 'Pago'. */
  recebido: number
  /** Soma das compras com `pago === 'Pago'`. */
  pagoAoProdutor: number
  /** Soma de todos os lançamentos (a tabela não tem situação de pagamento). */
  lancamentosPagos: number
  /** `recebido − pagoAoProdutor − lancamentosPagos`. Pode ser negativo. */
  saldo: number
}

/** Total recebido dos clientes — parcela 1. Ver o cabeçalho do módulo. */
export function recebidoDeClientes(saidas: SaidaCaixa[], hojeIso: string): number {
  return saidas
    .filter(s => situacaoExibidaSaida(s.pag, s.venc, hojeIso) === 'Pago')
    .reduce((soma, s) => soma + (s.valor || 0), 0)
}

/** Total já pago aos produtores — parcela 2. Ver o cabeçalho do módulo. */
export function pagoAosProdutores(entradas: EntradaCaixa[]): number {
  return entradas
    .filter(e => !entradaEmAberto(e))
    .reduce((soma, e) => soma + (e.valor_total || 0), 0)
}

/** Total dos lançamentos — parcela 3. Ver o cabeçalho do módulo. */
export function lancamentosPagos(lancamentos: LancamentoCaixa[]): number {
  return lancamentos.reduce((soma, l) => soma + (l.valor || 0), 0)
}

/**
 * O saldo em caixa acumulado, com as três parcelas abertas — ou `null`
 * quando QUALQUER uma das fontes não está disponível (`null` = ainda
 * carregando ou a busca falhou; `[]` = carregou e não há nenhum registro,
 * que é uma medida válida e vale zero).
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável sem mockar relógio — só influencia a parcela 1, via
 * `situacaoExibidaSaida`.
 */
export function calcularCaixa(
  saidas: SaidaCaixa[] | null,
  entradas: EntradaCaixa[] | null,
  lancamentos: LancamentoCaixa[] | null,
  hojeIso: string,
): Caixa | null {
  if (saidas === null || entradas === null || lancamentos === null) return null

  const recebido = recebidoDeClientes(saidas, hojeIso)
  const pagoProdutor = pagoAosProdutores(entradas)
  const lancTotal = lancamentosPagos(lancamentos)
  return {
    recebido,
    pagoAoProdutor: pagoProdutor,
    lancamentosPagos: lancTotal,
    saldo: recebido - pagoProdutor - lancTotal,
  }
}

/** Só o número, para quem não precisa das parcelas. `null` pelas mesmas
 * regras de `calcularCaixa`. */
export function saldoEmCaixa(
  saidas: SaidaCaixa[] | null,
  entradas: EntradaCaixa[] | null,
  lancamentos: LancamentoCaixa[] | null,
  hojeIso: string,
): number | null {
  return calcularCaixa(saidas, entradas, lancamentos, hojeIso)?.saldo ?? null
}
