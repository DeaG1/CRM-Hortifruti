import type { Cliente, Health } from './clientes'
import type { Lancamento } from './lancamentos'
import { diasEstoque, calcularCicloCaixa } from './financeiro'
import { derivarRelatorioProdutos, type ProdutoAgregado, perdaColetaEfetiva } from './relatorios'

/**
 * Formas mínimas de Saida/Entrada/Perda como a API devolve (ver
 * api/src/routes/saidas.ts, entradas.ts, perdas.ts), só com os campos que a
 * Saúde do Negócio consome. Os tipos "cheios" já existem em
 * components/ModalSaida.tsx, ModalEntrada.tsx e ModalPerda.tsx — não foram
 * reimportados daqui de propósito (um módulo `derive/*` puro não deveria
 * depender de um arquivo de componente) e não existe ainda um
 * `derive/saidas.ts` / `derive/entradas.ts` / `derive/perdas.ts` pra
 * importar em vez disso. Fica anotado no relatório da tarefa (de novo, ainda
 * não resolvido): quando esses módulos existirem, estas três interfaces
 * devem ser substituídas por eles — hoje o mesmo par Saida/Entrada é
 * redeclarado de forma independente em derive/financeiro.ts (SaidaFin/
 * EntradaFin) e derive/relatorios.ts (SaidaResumo/EntradaResumo).
 *
 * `id`/`peso` (Saida) e `id`/`data`/`pago`/`data_pag` (Entrada) foram
 * adicionados aqui (antes só os campos que os indicadores "—" avisavam
 * faltar) porque giroDeEstoque()/cicloDeCaixa() agora IMPORTAM as funções
 * equivalentes de derive/financeiro.ts (diasEstoque/calcularCicloCaixa) em
 * vez de recalcular a mesma conta — ver os dois comentários mais abaixo. Os
 * campos já vinham de GET /api/saidas e GET /api/entradas de qualquer jeito
 * (paraJson/paraJsonLista nas duas rotas); só não estavam modelados aqui.
 * `status` teve que virar o union exato (em vez de `string`) pelo mesmo
 * motivo: é o tipo que SaidaFin declara, e TypeScript não aceita passar um
 * `string` largo onde a função importada espera um union fechado. `pag`
 * continua `string` — nenhuma função importada precisa dele.
 */
export interface Saida {
  id: string
  cliente_id: string | null
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: string
  entrega: string | null
  data_pag: string | null
  valor?: number
  peso?: number
}

export interface Entrada {
  id: string
  data: string
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  perda_kg: number
  /** Soma de `entrada_itens.perda_kg`, que GET /api/entradas devolve ao lado
   * do total do cabecalho. Os dois sao o MESMO evento de perda em
   * granularidades diferentes — ver perdaColetaEfetiva em derive/relatorios.ts.
   *
   * Opcional de proposito: a API sempre envia, mas os testes montam entradas
   * parciais, e `perdaColetaEfetiva` ja trata ausencia como zero. Exigir o
   * campo aqui obrigaria a reescrever dezenas de fixtures sem ganho de
   * correcao — o valor ausente e indistinguivel de zero para esta conta. */
  perda_itens_qtd?: number
  valor_total: number
  peso_total: number
}

export interface Perda {
  qtd: number
}

/**
 * Metas fixas do estudo original, portadas de design/CRM Hortifruti.dc.html
 * (linhas 2350-2391). O To Do do cliente pede uma tela de configuração pra
 * elas no futuro — por ora ficam aqui, um único objeto nomeado e comentado,
 * pra essa migração ser trocar estes valores por uma leitura de API sem
 * mexer em quem os usa. NENHUM destes números deve ser repetido solto em
 * outro arquivo desta tela.
 */
export const METAS_DASHBOARD = {
  /** Índice de perdas (%) — meta ≤10%, âmbar até 13%, vermelho acima. */
  perdaMetaPct: 10,
  perdaAmbarAtePct: 13,
  /** Markup médio venda/compra (%) — meta ≥60%, sem faixa âmbar (só bate ou não). */
  markupMetaPct: 60,
  /** Nº de minimercados ativos (KPI) — meta ~35, âmbar a partir de 25. */
  clientesAtivosMeta: 35,
  clientesAtivosAmbarAte: 25,
  /** Minimercados ativos (cartão do topo) — referência de "equilíbrio" do
   * estudo, DIFERENTE da meta do KPI acima (a mesma métrica é comparada
   * contra dois números diferentes em dois lugares — assim no protótipo). */
  clientesAtivosEquilibrio: 20,
  /** Ticket médio por entrega (R$) — meta ≥430, âmbar a partir de 150. */
  ticketEntregaMeta: 430,
  ticketEntregaAmbarAte: 150,
  /** Ticket médio por minimercado/mês (R$) — meta 3.500–3.800, âmbar a partir de 3.000. */
  ticketMesMetaBaixo: 3500,
  ticketMesMetaAlto: 3800,
  ticketMesAmbarAte: 3000,
  /** Inadimplência (%) — meta ≤1%, âmbar até 2%. */
  inadimplenciaMetaPct: 1,
  inadimplenciaAmbarAtePct: 2,
  /** Giro de estoque (dias) — meta ≤4d; sem faixa vermelha no estudo (pior caso é âmbar). */
  giroEstoqueMetaDias: 4,
  /** Ciclo de caixa (dias) — meta ≤13d, âmbar até 16d. */
  cicloCaixaMetaDias: 13,
  cicloCaixaAmbarAteDias: 16,
  /** Prazo de pagamento ao produtor — referência fixa do estudo original, não
   * uma meta. NÃO é mais usada por cicloDeCaixa() (que hoje importa
   * calcularCicloCaixa() de derive/financeiro.ts e usa o prazo REAL,
   * data_pag − data de cada entrada paga, em vez desta constante) — mantida
   * aqui só como registro histórico do valor que o protótipo assumia. */
  cicloPagamentoProdutorDias: 3,
  /** Concentração de carteira — cliente acima disso é destacado em vermelho. */
  concentracaoCarteiraAlertaPct: 15,
  quantosClientesNaCarteira: 5,
  /** Fatores dos cenários pessimista/otimista sobre o lucro líquido realizado. */
  cenarioPessimistaFator: 0.55,
  cenarioOtimistaFator: 1.5,
} as const

/**
 * Resultado de um indicador que pode não ser calculável por falta de dado de
 * base (sem vendas no período, sem compras, sem histórico) — nunca um número
 * fantasma. `0` não pode fazer esse papel aqui porque, para vários destes
 * indicadores (lucro líquido, por exemplo), zero É uma medida real e válida
 * ("a operação empatou") — bem diferente de "não sei". `disponivel: false` é
 * o único jeito de dizer "não sei" sem mentir com um número.
 */
export type Indicador =
  | { disponivel: true; valor: number }
  | { disponivel: false; motivo: string }

const disponivel = (valor: number): Indicador => ({ disponivel: true, valor })
const indisponivel = (motivo: string): Indicador => ({ disponivel: false, motivo })

function entreguesDe(saidas: Saida[]): Saida[] {
  return saidas.filter(s => s.status === 'Entregue')
}

/** Receita bruta = soma do valor dos pedidos entregues. Sem nenhum pedido
 * entregue não é "R$ 0 de receita" (isso seria um fato mensurável) — é "não
 * há base pra medir receita ainda", daí indisponível em vez de zero. */
export function receitaBruta(saidas: Saida[]): Indicador {
  const entregues = entreguesDe(saidas)
  if (entregues.length === 0) return indisponivel('sem pedidos entregues registrados')
  return disponivel(entregues.reduce((s, p) => s + (p.valor || 0), 0))
}

/**
 * Custo total = compra de mercadoria (entradas) + lançamentos (despesas).
 * Sempre calculável: é uma soma sobre o que já está cadastrado, e zero aqui
 * é uma medida real ("nada foi lançado ainda"), não uma lacuna de dado —
 * diferente de uma média/razão, que fica indefinida sem denominador.
 */
export function custoTotal(entradas: Entrada[], lancamentos: Lancamento[]): number {
  const compraMercadoria = entradas.reduce((s, en) => s + (en.valor_total || 0), 0)
  const lancTotal = lancamentos.reduce((s, l) => s + (l.valor || 0), 0)
  return compraMercadoria + lancTotal
}

/** Lucro líquido = receita bruta − custo total. Indisponível sempre que a
 * receita for (não dá pra apurar resultado sem base de receita). */
export function lucroLiquido(receita: Indicador, custo: number): Indicador {
  if (!receita.disponivel) return receita
  return disponivel(receita.valor - custo)
}

/** % de lucro sobre a receita. `receita.valor === 0` cai no mesmo fallback a
 * 0% do protótipo original (design/CRM Hortifruti.dc.html:2319) — caso
 * extremo (pedidos entregues somando exatamente R$0), não uma lacuna de
 * dado, por isso não vira indisponível. */
export function percentualLucro(receita: Indicador, lucro: Indicador): Indicador {
  if (!receita.disponivel) return receita
  if (!lucro.disponivel) return lucro
  if (receita.valor === 0) return disponivel(0)
  return disponivel((lucro.valor / receita.valor) * 100)
}

/**
 * Índice de perdas (%) = (perda registrada nas entradas + perda de depósito)
 * sobre o total recebido (kg). Porta perdaMedia de
 * design/CRM Hortifruti.dc.html:2167-2174. Sem nenhuma entrada registrada
 * não há denominador (kg recebido) — indisponível, não 0%.
 */
export function indiceDePerdas(entradas: Entrada[], perdas: Perda[]): Indicador {
  const kgRecebido = entradas.reduce((s, en) => s + (en.peso_total || 0), 0)
  if (kgRecebido === 0) return indisponivel('sem compras (entradas) registradas')
  // perdaColetaEfetiva, e nao `en.perda_kg` cru: o total no cabecalho da
  // entrada e a soma das perdas dos itens sao o MESMO evento em duas
  // granularidades — o prototipo recalcula o cabecalho a partir dos itens ao
  // salvar (design/CRM Hortifruti.dc.html:2037). Usar o campo cru aqui, com o
  // estoque e os relatorios ja reconciliando, faria o indice de perdas do
  // painel divergir do numero das outras telas — e nada e pior num painel do
  // que dois indicadores que deveriam bater e nao batem.
  const perdaEntradas = entradas.reduce((s, en) => s + perdaColetaEfetiva(en), 0)
  const perdaDeposito = perdas.reduce((s, p) => s + (p.qtd || 0), 0)
  return disponivel(((perdaEntradas + perdaDeposito) / kgRecebido) * 100)
}

/** Ticket médio por entrega = receita bruta / nº de pedidos entregues. */
export function ticketMedioPorEntrega(saidas: Saida[]): Indicador {
  const entregues = entreguesDe(saidas)
  if (entregues.length === 0) return indisponivel('sem pedidos entregues registrados')
  const total = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  return disponivel(total / entregues.length)
}

/** Ticket médio por minimercado = receita bruta / nº de clientes distintos
 * atendidos (que tiveram ao menos 1 pedido entregue) — não é o mesmo
 * denominador do KPI acima (nº de pedidos), nem o mesmo do "clientes
 * ativos" (cadastro): é quem comprou de fato. Pedidos sem cliente
 * identificado (cliente_id nulo) não entram na contagem de clientes. */
export function ticketMedioPorMinimercado(saidas: Saida[]): Indicador {
  const entregues = entreguesDe(saidas)
  if (entregues.length === 0) return indisponivel('sem pedidos entregues registrados')
  const total = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  const clientesAtendidos = new Set(entregues.map(p => p.cliente_id).filter((id): id is string => !!id))
  if (clientesAtendidos.size === 0) return indisponivel('nenhum pedido entregue tem cliente identificado')
  return disponivel(total / clientesAtendidos.size)
}

/**
 * Inadimplência GERAL (não é a média por cliente de derive/clientes.ts —
 * outra métrica, outro escopo): quanto do faturado está atrasado, na
 * operação inteira. Porta design/CRM Hortifruti.dc.html:2162-2166: valor em
 * atraso vem de TODOS os pedidos do período com pag='Atrasado' (qualquer
 * status), não só dos entregues; o denominador é só a receita dos
 * entregues.
 */
export function inadimplenciaGeral(saidas: Saida[]): Indicador {
  const receita = receitaBruta(saidas)
  if (!receita.disponivel) return receita
  const valorAtraso = saidas.filter(p => p.pag === 'Atrasado').reduce((s, p) => s + (p.valor || 0), 0)
  return disponivel((valorAtraso / receita.valor) * 100)
}

/** Contagem simples — sempre calculável, e zero clientes ativos é uma
 * medida real (e grave), não uma lacuna de dado. */
export function clientesAtivos(clientes: Cliente[]): number {
  return clientes.filter(c => c.status === 'ativo').length
}

/**
 * Markup médio (venda/compra por produto) = média simples do markup de cada
 * produto movimentado — (preço médio de venda − preço médio de compra) /
 * preço médio de compra × 100, só dos produtos com AMBOS os preços médios
 * apuráveis. Porta com fidelidade design/CRM Hortifruti.dc.html:2324-2333
 * (`markups.reduce(...)/markups.length`, média não ponderada pelo volume —
 * um produto pequeno pesa igual a um grande na média, fidelidade ao
 * original, não uma escolha nova).
 *
 * Antes disto era um caso de "a API não expõe o dado necessário" (preço por
 * PRODUTO só existe em entrada_itens/saida_itens, e GET /api/entradas e
 * GET /api/saidas só devolvem o cabeçalho agregado) — destravado agora que
 * GET /api/relatorios/produtos soma isso em SQL (ver seu comentário em
 * api/src/routes/relatorios.ts).
 *
 * A conta em si (preço médio de compra/venda por produto, markup%) NÃO é
 * recalculada aqui: vem de derivarRelatorioProdutos() (derive/relatorios.ts),
 * que já implementa exatamente essa fórmula por linha para a tela de
 * Relatórios — reimplementá-la aqui duplicaria a mesma conta em dois
 * módulos (o risco que este endpoint foi criado para evitar). Só a MÉDIA
 * entre produtos é responsabilidade desta função.
 */
export function markupMedio(agregados: ProdutoAgregado[]): Indicador {
  const { linhas } = derivarRelatorioProdutos(agregados, agregados.length)
  const markups = linhas.map(l => l.markupPct).filter((v): v is number => v !== null)
  if (markups.length === 0) {
    return indisponivel('sem produtos com preço médio de compra e venda apurável no período')
  }
  return disponivel(markups.reduce((s, v) => s + v, 0) / markups.length)
}

/**
 * Giro de estoque (dias): quanto tempo o saldo atual duraria no ritmo de
 * saída. Antes indisponível por engano — a fórmula original (design/CRM
 * Hortifruti.dc.html:2338-2342) soma kg recebido, kg perdido e kg vendido,
 * e esses TOTAIS já vêm no cabeçalho de GET /api/entradas (peso_total,
 * perda_kg) e GET /api/saidas (peso); nunca precisou do detalhamento por
 * item que bloqueava o markup. O bloqueio real era só um campo (`peso`)
 * que faltava no tipo `Saida` local acima.
 *
 * A conta é IMPORTADA de derive/financeiro.ts (diasEstoque), não
 * reimplementada aqui: é a mesma fórmula, e outro agente mexe em
 * financeiro.ts (inclusive no ciclo de caixa, que usa este mesmo giro) ao
 * mesmo tempo — duas cópias da mesma conta divergiriam cedo ou tarde. Ver
 * cicloDeCaixa() abaixo para a mesma decisão. Este painel nunca teve
 * seletor de período (opera sobre a base inteira), então chama
 * diasEstoque() com periodo='all' — o mesmo "all" que as outras telas usam
 * quando não há filtro ativo (ver noPeriodo em financeiro.ts).
 */
export function giroDeEstoque(entradas: Entrada[], saidas: Saida[]): Indicador {
  const dias = diasEstoque(entradas, saidas, 'all')
  if (dias === null) return indisponivel('sem saídas com peso registrado para estimar o giro de estoque')
  return disponivel(dias)
}

/**
 * Ciclo de caixa completo (dias). Delegado inteiramente a
 * calcularCicloCaixa() (derive/financeiro.ts) em vez de reimplementado
 * aqui — decisão deliberada, não a fórmula original desta tela.
 *
 * O protótipo (design/CRM Hortifruti.dc.html:2344) calculava
 * `giro + recebimento − 3` (constante fixa de prazo ao produtor, nunca
 * calculada de dado real) para ESTE painel. derive/financeiro.ts, corrigido
 * por outro agente com autorização do dono do negócio, também SUBTRAI o
 * prazo ao produtor (CCC padrão: quem financia o caixa nesse intervalo é o
 * produtor) — só que com o prazo REAL (data_pag − data de cada entrada
 * paga) em vez da constante fixa de 3 dias do protótipo. Ver o comentário
 * de calcularCicloCaixa() para a justificativa completa da correção.
 *
 * Reimplementar aqui a constante fixa antiga, à parte, faria o Dashboard e
 * a tela Financeiro mostrarem dois números diferentes de "ciclo de caixa"
 * ao mesmo tempo — exatamente o problema que este endpoint (e a instrução
 * desta tarefa) pediu para evitar. Por isso este painel usa a MESMA função
 * que a tela Financeiro. Mesmo raciocínio do giro acima quanto a
 * `periodo='all'` (esta tela não tem seletor de período).
 */
export function cicloDeCaixa(entradas: Entrada[], saidas: Saida[]): Indicador {
  const { total } = calcularCicloCaixa(entradas, saidas, 'all')
  if (total === null) {
    return indisponivel(
      'requer giro de estoque, recebimento e pagamento ao produtor calculáveis ao mesmo tempo (falta ao menos um)',
    )
  }
  return disponivel(total)
}

/**
 * Média de dias entre entrega e pagamento, só dos pedidos entregues com
 * ambas as datas. NÃO alimenta mais cicloDeCaixa() (que agora importa o
 * equivalente — diasRecebimento() — de derive/financeiro.ts junto com o
 * resto do ciclo completo); mantida exportada e testada porque ainda é a
 * única forma de mostrar o componente "recebimento" isolado, caso uma tela
 * futura precise dele sem o ciclo inteiro.
 *
 * DEFEITO CORRIGIDO (autorizado pelo dono do negócio): esta função tinha a
 * MESMA duplicação de defeito que diasRecebimento() em derive/financeiro.ts
 * — filtro `recebDias > 0`, fiel ao protótipo, que excluía da média
 * justamente os recebimentos no MESMO DIA da entrega (os clientes que pagam
 * à vista), piorando o indicador quanto mais gente pagasse rápido. Corrigido
 * aqui do mesmo jeito, para as duas contas não divergirem de novo: `>= 0`
 * inclui o recebimento no mesmo dia (0) e só descarta o que der negativo
 * (pagamento registrado antes da entrega, erro de digitação). "Sem data de
 * pagamento" (`data_pag` nulo) já é filtrado antes, pelo `.filter(p => ...
 * !!p.data_pag)` acima — continua de fora, não vira um 0 disfarçado.
 */
export function cicloRecebimentoDias(saidas: Saida[]): Indicador {
  const comRecebimento = entreguesDe(saidas)
    .filter(p => !!p.entrega && !!p.data_pag)
    .map(p => diasEntre(p.entrega as string, p.data_pag as string))
    .filter(dias => dias >= 0)
  if (comRecebimento.length === 0) return indisponivel('sem pedidos entregues com data de recebimento registrada')
  return disponivel(comRecebimento.reduce((s, d) => s + d, 0) / comRecebimento.length)
}

function diasEntre(isoInicio: string, isoFim: string): number {
  const inicio = new Date(`${isoInicio}T00:00:00Z`).getTime()
  const fim = new Date(`${isoFim}T00:00:00Z`).getTime()
  return Math.round((fim - inicio) / 86_400_000)
}

// ---------------- classificação (semáforo) ----------------
// Tomam o número já calculado (nunca o Indicador) — quem chama só chama
// quando o indicador está disponível. Todos os limiares vêm de
// METAS_DASHBOARD; nenhum número de meta é repetido aqui.

export function statusIndiceDePerdas(pct: number): Health {
  if (pct <= METAS_DASHBOARD.perdaMetaPct) return 'green'
  if (pct <= METAS_DASHBOARD.perdaAmbarAtePct) return 'amber'
  return 'red'
}

export function statusMarkup(pct: number): Health {
  return pct >= METAS_DASHBOARD.markupMetaPct ? 'green' : 'red'
}

export function statusClientesAtivosKpi(n: number): Health {
  if (n >= METAS_DASHBOARD.clientesAtivosMeta) return 'green'
  if (n >= METAS_DASHBOARD.clientesAtivosAmbarAte) return 'amber'
  return 'red'
}

export function statusEquilibrioClientes(n: number): Health {
  return n >= METAS_DASHBOARD.clientesAtivosEquilibrio ? 'green' : 'red'
}

export function statusTicketMes(v: number): Health {
  if (v >= METAS_DASHBOARD.ticketMesMetaBaixo) return 'green'
  if (v >= METAS_DASHBOARD.ticketMesAmbarAte) return 'amber'
  return 'red'
}

export function statusTicketEntrega(v: number): Health {
  if (v >= METAS_DASHBOARD.ticketEntregaMeta) return 'green'
  if (v >= METAS_DASHBOARD.ticketEntregaAmbarAte) return 'amber'
  return 'red'
}

export function statusInadimplencia(pct: number): Health {
  if (pct <= METAS_DASHBOARD.inadimplenciaMetaPct) return 'green'
  if (pct <= METAS_DASHBOARD.inadimplenciaAmbarAtePct) return 'amber'
  return 'red'
}

/** Sem faixa vermelha — o pior resultado no estudo original pra este KPI é âmbar. */
export function statusGiroDeEstoque(dias: number): Health {
  return dias <= METAS_DASHBOARD.giroEstoqueMetaDias ? 'green' : 'amber'
}

export function statusCicloDeCaixa(dias: number): Health {
  if (dias <= METAS_DASHBOARD.cicloCaixaMetaDias) return 'green'
  if (dias <= METAS_DASHBOARD.cicloCaixaAmbarAteDias) return 'amber'
  return 'red'
}

export function statusLucro(valor: number): Health {
  return valor > 0 ? 'green' : 'red'
}

// ---------------- concentração de carteira ----------------

export interface ItemCarteira {
  nome: string
  /** % do faturamento total (arredondado, só para exibição). */
  percentual: number
  /** Largura da barra relativa ao maior cliente (0–100), só para exibição. */
  larguraBarraPct: number
  /** true = participação acima de METAS_DASHBOARD.concentracaoCarteiraAlertaPct. */
  destaque: boolean
  /** true = linha "Demais N clientes" (agregado), não um cliente real. */
  agregado: boolean
}

export type ResultadoCarteira =
  | { disponivel: true; itens: ItemCarteira[]; top5TextoPct: number }
  | { disponivel: false; motivo: string }

/**
 * Porta a concentração de carteira de
 * design/CRM Hortifruti.dc.html:2365-2372: top N clientes por faturamento
 * (entregue), participação sobre a receita total, e o restante agrupado.
 * Cliente sem nome resolvido (removido do cadastro depois da venda) cai em
 * "Cliente removido" em vez de sumir do total.
 */
export function concentracaoDeCarteira(clientes: Cliente[], saidas: Saida[]): ResultadoCarteira {
  const entregues = entreguesDe(saidas)
  if (entregues.length === 0) return { disponivel: false, motivo: 'sem pedidos entregues registrados' }

  const faturadoPorCliente = new Map<string, number>()
  for (const p of entregues) {
    if (!p.cliente_id) continue
    faturadoPorCliente.set(p.cliente_id, (faturadoPorCliente.get(p.cliente_id) || 0) + (p.valor || 0))
  }

  const receitaTotal = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  const denominador = receitaTotal || 1 // guarda de divisão por zero, não caso de dado insuficiente (já garantido acima)

  const ordenados = [...faturadoPorCliente.entries()]
    .filter(([, fat]) => fat > 0)
    .sort((a, b) => b[1] - a[1])

  const n = METAS_DASHBOARD.quantosClientesNaCarteira
  const top = ordenados.slice(0, n)
  const resto = ordenados.slice(n).reduce((s, [, fat]) => s + fat, 0)

  // Escala das barras: relativa ao MAIOR cliente (não a 100% da receita) —
  // assim o líder sempre preenche a barra inteira, mesmo com pouca
  // concentração real.
  const maiorPct = top.length ? (top[0][1] / denominador) * 100 : 1

  const itens: ItemCarteira[] = top.map(([clienteId, fat]) => {
    const percentualReal = (fat / denominador) * 100
    return {
      nome: clientes.find(c => c.id === clienteId)?.nome ?? 'Cliente removido',
      percentual: Math.round(percentualReal),
      larguraBarraPct: maiorPct ? Math.round((percentualReal / maiorPct) * 100) : 0,
      destaque: percentualReal > METAS_DASHBOARD.concentracaoCarteiraAlertaPct,
      agregado: false,
    }
  })

  if (resto > 0) {
    itens.push({
      nome: `Demais ${ordenados.length - top.length} clientes`,
      percentual: Math.round((resto / denominador) * 100),
      larguraBarraPct: 100,
      destaque: false,
      agregado: true,
    })
  }

  const top5TextoPct = Math.round((top.reduce((s, [, fat]) => s + fat, 0) / denominador) * 100)
  return { disponivel: true, itens, top5TextoPct }
}

// ---------------- cenários (realizado × projeções) ----------------

export interface Cenario {
  nome: 'Pessimista' | 'Realista' | 'Otimista'
  valor: number
  larguraBarraPct: number
}

export type ResultadoCenarios =
  | { disponivel: true; cenarios: Cenario[]; lucro: number; percentualLucro: number }
  | { disponivel: false; motivo: string }

/**
 * Porta os cenários de design/CRM Hortifruti.dc.html:2373-2380. O piso
 * `Math.max(lucroLiquido, 1)` é do protótipo original: quando o lucro
 * líquido é zero ou negativo, pessimista/otimista colapsam pra valores
 * minúsculos (1 e 2) em vez de escalar sobre um lucro negativo real — é uma
 * decisão estranha, mas é a do estudo, portada como está (não inventar uma
 * escala "melhor" aqui).
 */
export function cenariosDeResultado(receita: Indicador, custo: number): ResultadoCenarios {
  const lucro = lucroLiquido(receita, custo)
  if (!lucro.disponivel) return { disponivel: false, motivo: lucro.motivo }
  const pct = percentualLucro(receita, lucro)
  const pctValor = pct.disponivel ? pct.valor : 0

  const base = Math.max(lucro.valor, 1)
  const pessimista = Math.round(base * METAS_DASHBOARD.cenarioPessimistaFator)
  const otimista = Math.round(base * METAS_DASHBOARD.cenarioOtimistaFator)
  const escala = Math.max(otimista, lucro.valor, 1)

  const cenarios: Cenario[] = [
    { nome: 'Pessimista', valor: pessimista, larguraBarraPct: Math.round((pessimista / escala) * 100) },
    { nome: 'Realista', valor: lucro.valor, larguraBarraPct: Math.round((Math.max(0, lucro.valor) / escala) * 100) },
    { nome: 'Otimista', valor: otimista, larguraBarraPct: 100 },
  ]

  return { disponivel: true, cenarios, lucro: lucro.valor, percentualLucro: pctValor }
}
