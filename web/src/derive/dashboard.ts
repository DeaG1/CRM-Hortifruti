import type { Cliente, Health } from './clientes'
import type { Lancamento } from './lancamentos'
import { diasEstoque, calcularCicloCaixa } from './financeiro'
import { derivarRelatorioProdutos, type ProdutoAgregado, perdaColetaEfetiva } from './relatorios'
import { situacaoExibidaSaida } from './pagamento'

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
  /** Vencimento (ISO), necessário para inadimplenciaGeral() derivar
   * 'Atrasado' via situacaoExibidaSaida (derive/pagamento.ts) em vez do
   * `pag` gravado cru — ver o comentário grande em inadimplenciaGeral, mais
   * abaixo. Já vem de GET /api/saidas; só não estava modelado aqui. Opcional
   * pelo mesmo motivo de `valor`/`peso` acima: fixtures de teste parciais. */
  venc?: string | null
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
  /** Em kg — GET /api/entradas converte cada item pela unidade dele. */
  peso_total: number
  /**
   * Itens desta entrada que ficaram FORA de `peso_total` por não serem
   * convertíveis em quilos (unidade diferente de KG sem `produtos.peso_medio`
   * cadastrado). Vem de GET /api/entradas desde 203fb28; só não estava
   * modelado aqui. É o que torna o DENOMINADOR do índice de perdas
   * (kg recebido) incompleto — ver indiceDePerdas.
   *
   * Opcional pelo mesmo motivo de `perda_itens_qtd`: a API sempre envia, mas
   * fixtures de teste montam entradas parciais e ausente significa
   * exatamente 0 (nada ficou de fora).
   */
  itens_sem_conversao?: number
}

/**
 * Uma perda de depósito, como GET /api/perdas devolve — ver
 * api/src/routes/perdas.ts.
 *
 * `qtd` (a quantidade na unidade da PRÓPRIA perda, 'CX', 'DZ'…) NÃO está
 * declarada aqui de propósito, embora a API a envie: este módulo soma perdas
 * com números que já estão em quilos, e declarar o campo cru convidaria de
 * volta exatamente o defeito que esta versão corrigiu — 4 caixas de alface
 * entrando na conta como "4" ao lado de 296 kg. O que se soma aqui é
 * `qtd_kg`, e nada mais. (A interface é deliberadamente mínima, como as duas
 * acima: só os campos que a Saúde do Negócio consome.)
 */
export interface Perda {
  /** Data da perda de deposito, ISO 'aaaa-mm-dd' — `pd.*` no select de
   * GET /api/perdas ja traz a coluna. Declarada agora porque o filtro de
   * periodo global (achado S-3) recorta esta lista pela data do evento;
   * opcional so para as fixtures de teste, que montam perdas parciais. */
  data?: string | null
  /**
   * A mesma perda em quilos, convertida pela API pela unidade dela.
   * `null`/ausente = não convertível (produto sem peso médio cadastrado):
   * fica fora da soma e é contada em `itens_sem_conversao`. Nunca vira 1 nem
   * 0 disfarçado de perda real.
   */
  qtd_kg?: number | null
  /** 0 ou 1 — cada linha desta rota é um lançamento. Ver perdas.ts. */
  itens_sem_conversao?: number
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
  /**
   * Faturado de UM cliente no período (métrica "Faturado / mês" da ficha) —
   * mesma meta 3.500–3.800 dos dois acima, mas faixa âmbar PRÓPRIA, a partir
   * de 2.000 (protótipo, `design/CRM Hortifruti.dc.html` 2234). Não é
   * descuido nem duplicação: `ticketMesAmbarAte` classifica a MÉDIA da
   * carteira (receita ÷ minimercados atendidos), onde 2.900 já é um mês
   * ruim; aqui se classifica UM minimercado, onde a dispersão entre o maior
   * e o menor cliente é normal e 2.900 ainda é um cliente saudável. Mesma
   * meta, réguas diferentes porque as duas perguntas são diferentes.
   */
  faturadoClienteAmbarAte: 2000,
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
  | { disponivel: true; valor: number; itensSemConversao?: number }
  | { disponivel: false; motivo: string }

/**
 * Um indicador tem três estados, não dois: "sei" (`disponivel: true` sem
 * mais nada), "não sei" (`disponivel: false` + motivo) e o terceiro, que
 * este campo introduz — "sei, mas a conta ignorou lançamentos".
 *
 * `itensSemConversao` > 0 significa que o número saiu de uma soma da qual
 * ficaram de fora lançamentos em unidade diferente de KG sem peso médio
 * cadastrado no produto (a API prefere deixá-los fora a inventar um fator —
 * ver `itens_sem_conversao` em api/src/routes/perdas.ts e irmãs). O número
 * continua sendo o melhor disponível e continua sendo exibido; o que não
 * pode é aparecer LIMPO, como se fechasse. Quem desenha o cartão marca.
 *
 * Ausente é indistinguível de 0 (nada ficou de fora) — por isso o helper só
 * inclui o campo quando ele tem o que dizer, e o caso normal continua sendo
 * um objeto de dois campos.
 */
const disponivel = (valor: number, itensSemConversao = 0): Indicador =>
  itensSemConversao > 0 ? { disponivel: true, valor, itensSemConversao } : { disponivel: true, valor }
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
 *
 * ---- os três termos, e por que só agora eles estão na mesma unidade ----
 *
 * As perdas do sistema não nascem todas em quilos, e o defeito que esta
 * versão fecha era exatamente somá-las como se nascessem:
 *
 *   perda de coleta (entrada_itens.perda_kg / entradas.perda_kg) -> KG por
 *     contrato, para item de qualquer unidade (nome da coluna, rótulo em
 *     ModalEntrada.tsx e total do rodapé do mesmo modal). NÃO converte.
 *   perda de depósito (perdas.qtd) -> na unidade da PRÓPRIA perda
 *     (perdas.un). CONVERTE — é `p.qtd_kg`, que GET /api/perdas passou a
 *     calcular, e nunca `p.qtd`.
 *   kg recebido (entradas.peso_total) -> já vem em kg desde 203fb28.
 *
 * Antes disto, `p.qtd` cru entrava na soma: no seed do protótipo, 4 CX de
 * alface + 3 CX de tomate somavam "7" ao lado de 296 kg de perda de coleta,
 * quando pesam 92 kg. O índice saía 3,5% em vez de 4,5% — e "para baixo" é a
 * direção perigosa neste indicador específico: ele é o que o dono usa para
 * decidir se a operação está sangrando, e um número menor que a realidade diz
 * "está tudo bem" justamente quando não está. (Nas outras telas o erro sai
 * para cima, porque lá o que falta é denominador.)
 *
 * ---- perda de coleta: cabeçalho vs. soma dos itens ----
 *
 * perdaColetaEfetiva, e não `en.perda_kg` cru: o total no cabeçalho da
 * entrada e a soma das perdas dos itens são o MESMO evento em duas
 * granularidades — o protótipo recalcula o cabeçalho a partir dos itens ao
 * salvar (design/CRM Hortifruti.dc.html:2037). Usar o campo cru aqui, com o
 * estoque e os relatórios já reconciliando, faria o índice de perdas do
 * painel divergir do número das outras telas — e nada é pior num painel do
 * que dois indicadores que deveriam bater e não batem.
 *
 * ---- o que ficou de fora ----
 *
 * `itensSemConversao` soma os DOIS lados da fração, porque os dois podem
 * estar incompletos por lançamentos não convertíveis: as perdas de depósito
 * (numerador) e os itens de entrada que não entraram em `peso_total`
 * (denominador). Não dá para saber a direção do desvio quando os dois lados
 * perdem lançamentos — daí a marca no cartão dizer que a conta ignorou
 * lançamentos, sem prometer para que lado. A perda de coleta nunca entra
 * nessa contagem: ela é kg por contrato, sempre completa.
 */
export function indiceDePerdas(entradas: Entrada[], perdas: Perda[]): Indicador {
  const kgRecebido = entradas.reduce((s, en) => s + (en.peso_total || 0), 0)
  if (kgRecebido === 0) return indisponivel('sem compras (entradas) registradas')
  const perdaEntradas = entradas.reduce((s, en) => s + perdaColetaEfetiva(en), 0)
  const perdaDeposito = perdas.reduce((s, p) => s + (p.qtd_kg || 0), 0)
  const semConversao = perdas.reduce((s, p) => s + (p.itens_sem_conversao || 0), 0)
    + entradas.reduce((s, en) => s + (en.itens_sem_conversao || 0), 0)
  return disponivel(((perdaEntradas + perdaDeposito) / kgRecebido) * 100, semConversao)
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
 * atraso vem de TODOS os pedidos do período em atraso (qualquer status),
 * não só dos entregues; o denominador é só a receita dos entregues. Essa
 * assimetria (numerador "qualquer status", denominador só Entregue) é fiel
 * ao protótipo, já reportada ao dono do produto, e NÃO é o que esta função
 * corrige — não mexer nela aqui.
 *
 * "Em atraso" usa situacaoExibidaSaida (derive/pagamento.ts), não mais
 * `pag === 'Atrasado'` cru: desde que a interface parou de gravar
 * 'Atrasado' à mão (o seletor só oferece Pendente/Pago; 'Atrasado' passou a
 * ser CALCULADO a partir de `pag==='Pendente'` + vencimento vencido),
 * filtrar pelo campo gravado faria este indicador caminhar pra zero
 * conforme as vendas antigas ('Atrasado' gravado à mão) fossem sendo
 * substituídas por vendas novas — mostrando carteira saudável com dívida
 * real se acumulando. Não é infidelidade ao protótipo: é a consequência
 * necessária de 'Atrasado' ter deixado de ser um campo digitado.
 * `hojeIso` é parâmetro (não `new Date()` interno) pelo mesmo motivo de
 * situacaoExibidaSaida: função pura, testável sem mockar relógio.
 */
export function inadimplenciaGeral(saidas: Saida[], hojeIso: string): Indicador {
  const receita = receitaBruta(saidas)
  if (!receita.disponivel) return receita
  const valorAtraso = saidas
    .filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado')
    .reduce((s, p) => s + (p.valor || 0), 0)
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
 * cicloDeCaixa() abaixo para a mesma decisão.
 *
 * PERÍODO (achado S-3 da auditoria): recebe o período do cabeçalho global e
 * repassa a `diasEstoque`, que é quem sabe transformá-lo em número de dias
 * (mês civil quando um mês está escolhido; intervalo real das datas quando é
 * 'all'). As listas chegam INTEIRAS de propósito — filtrar antes e passar
 * 'all' faria a janela de dias ser medida pelo intervalo entre a primeira e a
 * última data sobreviventes, e um mês com uma venda só valeria "1 dia".
 * `'all'` continua sendo o padrão, então quem já chamava sem período não
 * muda de comportamento.
 */
export function giroDeEstoque(entradas: Entrada[], saidas: Saida[], periodo = 'all'): Indicador {
  const dias = diasEstoque(entradas, saidas, periodo)
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
 * que a tela Financeiro — inclusive no recorte: o `periodo` do cabeçalho
 * global desce inteiro para lá, pelas mesmas razões descritas em
 * `giroDeEstoque` acima (as listas chegam completas, quem mede a janela de
 * dias é derive/financeiro.ts).
 */
export function cicloDeCaixa(entradas: Entrada[], saidas: Saida[], periodo = 'all'): Indicador {
  const { total } = calcularCicloCaixa(entradas, saidas, periodo)
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

/**
 * Semáforo do "Faturado / mês" de UM cliente (ficha do cliente, achado CF-4).
 * Mesma meta de `statusTicketMes`, faixa âmbar própria — ver
 * `METAS_DASHBOARD.faturadoClienteAmbarAte` para o porquê de as duas réguas
 * não serem a mesma.
 */
export function statusFaturadoCliente(v: number): Health {
  if (v >= METAS_DASHBOARD.ticketMesMetaBaixo) return 'green'
  if (v >= METAS_DASHBOARD.faturadoClienteAmbarAte) return 'amber'
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
