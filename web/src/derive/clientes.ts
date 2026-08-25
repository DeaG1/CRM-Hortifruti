import { situacaoExibidaSaida } from './pagamento'
import { filtrarPorPeriodo } from './periodo'

export type StatusCliente = 'ativo' | 'negociacao' | 'inadimplente' | 'inativo'
export type Tendencia = '↑' | '→' | '↓'
export type Health = 'green' | 'amber' | 'red'

/**
 * Status de cobranca DERIVADO das vendas do cliente (`statusCobrancaCliente`)
 * — nao confundir com a coluna de cadastro `clientes.cobranca`, que ninguem
 * escreve nem le mais (ver o comentario no campo `cobranca` da interface
 * abaixo). A AUSENCIA de status (`null`, devolvido por
 * `statusCobrancaCliente`) e um terceiro estado legitimo, nao um erro:
 * significa "nao ha o que cobrar" e vira travessao na tela.
 */
export type StatusCobranca = 'Em dia' | 'Atrasado'

export interface Cliente {
  id: string
  nome: string
  resp: string
  rota: string
  freq: string
  status: StatusCliente
  tend: Tendencia
  limite: number
  prazo: number
  // Campos de cadastro/crédito adicionais — a API sempre os devolve (default
  // '' ou 'Em dia'/'PIX' no schema), mas ficam opcionais aqui pra nao quebrar
  // os fixtures de teste existentes que so preenchem o subconjunto usado nas
  // derivacoes (id, nome, status, tend, ...).
  cnpj?: string
  tel?: string
  email?: string
  endereco?: string
  /** CAMPO FANTASMA — nao usar para decidir nada. A coluna
   * `clientes.cobranca` existe (`db/migrations/004_clientes.sql`), nasce
   * 'Em dia' por default e NENHUMA tela a escreve: nao ha campo pra ela no
   * ModalCliente. Ate a correcao do achado CF-1 da auditoria, a ficha do
   * cliente exibia este valor cru como "Status de cobranca" — ou seja,
   * "Em dia" para todo cliente, para sempre, inclusive inadimplente. O
   * status agora vem de `statusCobrancaCliente` (derivado das vendas). O
   * campo continua declarado aqui so porque GET/POST/PUT /api/clientes
   * ainda o trafega (`CAMPOS` em api/src/routes/clientes.ts); a remocao da
   * coluna e uma migracao de esquema a decidir a parte. */
  cobranca?: string
  forma?: string
  obs?: string
}

/**
 * Valores iniciais copiados de newCliente() no protótipo
 * (design/CRM Hortifruti.dc.html:1819-1821). Vive aqui (e não em
 * ModalCliente.tsx, que a consome) porque um componente só pode exportar
 * componentes sem quebrar o fast refresh — mesma razão que levou
 * `Papel`/`Tela`/`ADMIN_ONLY_SCREENS` para `telas.ts` na Task 9.
 */
// `limite: ''` (nao 0), igual a VEICULO_NOVO.ano em derive/veiculos.ts: campo
// numerico comeca vazio (com placeholder) em vez de 0 pre-preenchido — abrir
// com 0 ja escrito faz quem digita esquecer de apagar o zero primeiro e
// gravar "0250" em vez de "250" (bug real reportado pelo dono do produto).
// `as number | string` pela mesma razao do comentario em VEICULO_NOVO: ao
// editar, o spread `{ ...CLIENTE_NOVO, ...cliente }` sobrescreve com o
// numero real vindo da API, entao o campo precisa aceitar os dois tipos.
// `prazo` continua com o default 14 — e uma sugestao util (prazo comum de
// pagamento), nao um zero atrapalhando; so campos cujo default e 0 viram
// vazio.
export const CLIENTE_NOVO = {
  nome: '', resp: '', cnpj: '', tel: '', email: '', endereco: '',
  rota: 'Sul A', freq: '2×/sem · Seg e Qui', status: 'ativo',
  // `cobranca` continua no rascunho so pra manter o corpo do POST/PUT igual
  // ao que a API aceita hoje (`CAMPOS` em api/src/routes/clientes.ts) — ela
  // nao tem campo no formulario e nao alimenta mais nenhuma tela: o status
  // de cobranca exibido vem de `statusCobrancaCliente`. Ver o comentario no
  // campo `cobranca` da interface `Cliente`.
  cobranca: 'Em dia', forma: 'PIX', limite: '' as number | string, prazo: 14, tend: '→', obs: '',
}

export interface Pedido {
  id: string
  cliente: string
  entrega: string          // ISO: aaaa-mm-dd
  valor: number
  /** 'Pendente' (pedido lançado, ainda não entregue) foi acrescentado aqui
   * quando as telas passaram a alimentar `Pedido` com GET /api/saidas de
   * verdade (ver ClientesLista.tsx/ClienteFicha.tsx): o union original,
   * herdado do protótipo, não previa esse valor porque não existia dado
   * real pra testar contra. Nenhuma função deste arquivo faz switch
   * exaustivo sobre `status` (todas comparam só com `=== 'Entregue'`), e
   * `inadimplenciaPorCliente` PRECISA que pedidos 'Pendente' continuem no
   * array (o numerador dela conta atraso de QUALQUER status, de propósito —
   * ver o comentário grande na função) — descartá-los antes de chegar aqui
   * quebraria esse comportamento em silêncio. */
  status: 'Pendente' | 'Entregue' | 'Em rota' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  /** Vencimento (ISO), usado por `situacaoExibidaSaida` (derive/pagamento.ts)
   * pra derivar 'Atrasado' quando `pag` gravado é 'Pendente'. Já vem de
   * GET /api/saidas (ver api/src/routes/saidas.ts); opcional aqui só pra
   * não obrigar os fixtures de teste existentes a declarar o campo — ausente
   * e `null` significam a mesma coisa pra situacaoExibidaSaida (sem
   * vencimento não há "atraso" pra calcular). */
  venc?: string | null
  /**
   * Número do pedido (`saidas.numero`, o identificador que a coluna PEDIDO de
   * SaidasLista mostra) — é por ele que se acha o pedido na tela de Saídas.
   * Opcional porque nem todo consumidor de `Pedido` precisa dele (a carteira
   * de ClientesLista agrupa por cliente, não por pedido) e porque os fixtures
   * de teste anteriores a "Pedidos recentes" não o declaram.
   */
  numero?: string
  /**
   * Quantidade da venda, SEMPRE em kg — `peso` de GET /api/saidas, que a API
   * converte item a item pela unidade de cada um (ver `SaidaResumo.peso` em
   * derive/relatorios.ts). Nunca somar com quantidade em outra unidade.
   * Opcional pelo mesmo motivo de `numero`; ausente e 0 NÃO significam a
   * mesma coisa para quem exibe (ver `quantidadeEntregueCliente`), mas as
   * duas funções que o leem tratam ausente como 0 na soma.
   */
  peso?: number
  /**
   * Itens desta venda que ficaram FORA de `peso` por não serem convertíveis
   * em quilos (unidade ≠ KG sem `produtos.peso_medio`) — repassado de
   * `itens_sem_conversao` de GET /api/saidas. Quem soma `peso` precisa somar
   * isto junto e marcar o total com `*`, senão exibe quantidade incompleta
   * como número fechado. Mesma convenção de EntradaResumo/SaidaResumo/
   * ProdutoAgregado.
   */
  itensSemConversao?: number
}

export interface ClienteDerivado extends Cliente {
  faturado: number
  entregas: number
  ticketEntrega: number
  participacao: number
  inadimplencia: number
  health: Health
}


function doCliente(pedidos: Pedido[], nome: string) {
  return pedidos.filter(p => p.cliente === nome)
}

export function ticketPorEntrega(pedidos: Pedido[], nome: string): number {
  const entregues = doCliente(pedidos, nome).filter(p => p.status === 'Entregue')
  if (entregues.length === 0) return 0
  const total = entregues.reduce((s, p) => s + (p.valor || 0), 0)
  return Math.round(total / entregues.length)
}

/**
 * Fração do faturado do cliente que está atrasada. Usa `situacaoExibidaSaida`
 * (derive/pagamento.ts) para decidir "atrasado", não o `pag` gravado cru.
 *
 * Até a Task que tornou 'Atrasado' um valor CALCULADO (a interface só grava
 * 'Pendente'/'Pago' agora; 'Atrasado' passa a ser derivado de
 * `pag==='Pendente'` + vencimento vencido — ver o comentário no topo de
 * pagamento.ts), filtrar por `pag === 'Atrasado'` bastava, porque era o
 * único jeito de um registro ficar assim. Continuar filtrando pelo campo
 * cru faria a inadimplência da carteira caminhar pra zero conforme as
 * vendas antigas (gravadas 'Atrasado' à mão) fossem sendo substituídas por
 * vendas novas — mesmo com dívida real se acumulando: o número não some,
 * ele mente com aparência de normalidade. Não é infidelidade ao protótipo,
 * é a consequência necessária de 'Atrasado' ter deixado de ser um campo
 * digitado; manter o filtro antigo preservaria a letra e perderia o
 * sentido. `hojeIso` é parâmetro (não `new Date()` interno) pelo mesmo
 * motivo de situacaoExibidaSaida: função pura, testável sem mockar relógio.
 *
 * ASSIMETRIA JÁ CONHECIDA, NÃO CORRIGIR AQUI: o numerador (atrasado)
 * considera pedidos de QUALQUER status, mas o denominador (faturado) só
 * conta `status === 'Entregue'` — fiel ao protótipo original, já reportada
 * ao dono do produto. Não é o defeito que esta função corrige.
 */
export function inadimplenciaPorCliente(pedidos: Pedido[], nome: string, hojeIso: string): number {
  const meus = doCliente(pedidos, nome)
  const faturado = meus
    .filter(p => p.status === 'Entregue')
    .reduce((s, p) => s + (p.valor || 0), 0)
  if (faturado <= 0) return 0
  const atrasado = meus
    .filter(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso) === 'Atrasado')
    .reduce((s, p) => s + (p.valor || 0), 0)
  return (atrasado / faturado) * 100
}

/**
 * Status de cobrança do cliente — DERIVADO das vendas dele, nunca lido de
 * um campo de cadastro.
 *
 * Portado de `cCobranca = cAtrasados.length>0 ? 'Atrasado' : 'Em dia'`
 * (protótipo, `design/CRM Hortifruti.dc.html` ~2223), com duas diferenças
 * deliberadas:
 *
 *  1. O protótipo filtra `p.pag==='Atrasado'` (o campo gravado). Aqui vale
 *     `situacaoExibidaSaida` (derive/pagamento.ts), pela mesma razão já
 *     documentada em `inadimplenciaPorCliente`: 'Atrasado' deixou de ser um
 *     valor que alguém digita e passou a ser calculado do vencimento.
 *     Comparar com o `pag` cru deixaria o status cego a toda venda vencida
 *     gravada como 'Pendente' — que é o caso NORMAL hoje — e ele voltaria a
 *     dizer "Em dia" para quem deve.
 *
 *  2. O protótipo devolve 'Em dia' também para cliente sem venda nenhuma
 *     (`cAtrasados.length>0` é falso quando não há pedido algum). Aqui esse
 *     caso devolve `null` — "não há o que cobrar" — e a tela mostra
 *     travessão. Cliente sem venda não está em dia com coisa alguma, e o
 *     defeito que esta função corrige (CF-1 da auditoria) foi exatamente um
 *     "Em dia" verde exibido sem apuração nenhuma por trás: um travessão faz
 *     o usuário procurar o dado, um "Em dia" falso faz ele parar de
 *     procurar. Vale também quando as vendas não puderam ser carregadas
 *     (lista vazia por falha de GET /api/saidas): travessão, nunca "Em dia"
 *     por omissão.
 *
 * Vendas com situação '—' ("pagamento não se aplica" — pedido cancelado ou
 * devolvido, ver SaidasLista.tsx) não contam nem como dívida nem como
 * adimplência, mesma exclusão que `valorEmAbertoCliente` faz: um cliente
 * cujos únicos pedidos foram cancelados também cai no `null`.
 *
 * Não é filtrada por período de propósito — o protótipo usa `pedidosRaw`
 * (todos), não os do período (`pedidosPeriodo`): dívida vencida em maio
 * continua sendo dívida em agosto, some do recorte mas não do caixa.
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) pelo mesmo motivo das
 * vizinhas: função pura, testável sem mockar relógio.
 */
export function statusCobrancaCliente(
  pedidos: Pedido[],
  nome: string,
  hojeIso: string,
): StatusCobranca | null {
  const cobraveis = doCliente(pedidos, nome)
    .map(p => situacaoExibidaSaida(p.pag, p.venc, hojeIso))
    .filter(situacao => situacao !== '—')
  if (cobraveis.length === 0) return null
  return cobraveis.some(situacao => situacao === 'Atrasado') ? 'Atrasado' : 'Em dia'
}

/**
 * Data ISO da última compra do cliente — a entrega mais recente entre os
 * pedidos JÁ ENTREGUES dele. `null` quando ele nunca teve pedido entregue
 * (ou quando as vendas não puderam ser carregadas): travessão, nunca uma
 * data inventada nem a data de um pedido que ainda não chegou.
 *
 * Portado de `cUltPed`/`cUlt` (protótipo, `design/CRM Hortifruti.dc.html`
 * ~2226-2227). Como no protótipo, NÃO é filtrada por período: "última
 * compra" é um fato sobre o cliente, não sobre o recorte — se ele não
 * comprou no mês escolhido, a resposta certa é a data em que comprou pela
 * última vez, não um travessão. Achado CF-2 da auditoria.
 *
 * Entrega vazia (pedido entregue sem data registrada) fica de fora: uma
 * string vazia perderia a comparação de qualquer jeito, e devolvê-la seria
 * exibir "—" com aparência de data ausente do sistema.
 */
export function ultimaCompraCliente(pedidos: Pedido[], nome: string): string | null {
  const datas = doCliente(pedidos, nome)
    .filter(p => p.status === 'Entregue' && !!p.entrega)
    .map(p => p.entrega)
  if (datas.length === 0) return null
  // 'AAAA-MM-DD' ordena igual como texto e como data — mesma comparação que
  // `entregasCliente` usa em ClienteFicha.tsx para ordenar o histórico.
  return datas.reduce((maior, d) => (d > maior ? d : maior))
}

/**
 * Quantidade entregue ao cliente, em QUILOS, mais quantas entregas a
 * compuseram. Portado de `cVolume` + `cEntregues.length` (protótipo ~2218 e
 * 2233, métrica "Qtd no período") — achado CF-3.
 *
 * `null` quando o cliente não teve nenhuma entrega entre os pedidos
 * recebidos (sem venda no recorte, ou GET /api/saidas fora do ar e a lista
 * vazia): travessão, nunca "0 kg", que afirmaria uma medição que ninguém
 * fez. Com entregas, a soma é devolvida mesmo se der zero — aí o zero É a
 * medida (entregas cujos itens todos ficaram sem conversão, por exemplo).
 *
 * RESPEITA O PERÍODO, como o protótipo (que soma sobre `pedidosPeriodo`) e
 * como o rótulo da métrica promete ("Qtd no período"). Recebe `periodo` e
 * filtra aqui dentro, com a mesma `filtrarPorPeriodo` de `derivarClientes` —
 * as duas métricas da mesma tela precisam recortar pelo mesmo critério, e
 * deixar o recorte para a tela seria abrir a porta para elas divergirem.
 *
 * `itensSemConversao` sai somado junto: quem exibe o kg tem que marcar com
 * `*` quando ele for > 0, senão mostra quantidade incompleta como fechada.
 */
export function quantidadeEntregueCliente(
  pedidos: Pedido[],
  nome: string,
  periodo: string,
): { kg: number; entregas: number; itensSemConversao: number } | null {
  const doPeriodo = filtrarPorPeriodo(pedidos, periodo, p => p.entrega)
  const entregues = doCliente(doPeriodo, nome).filter(p => p.status === 'Entregue')
  if (entregues.length === 0) return null
  return {
    kg: entregues.reduce((s, p) => s + (p.peso || 0), 0),
    entregas: entregues.length,
    itensSemConversao: entregues.reduce((s, p) => s + (p.itensSemConversao || 0), 0),
  }
}

/**
 * Histórico de atrasos do cliente: quantos pedidos dele estão atrasados e
 * quanto somam. Portado de `cAtrasados` (protótipo ~2222, exibido em 2250) —
 * achado CF-5.
 *
 * Atraso vem de `situacaoExibidaSaida`, nunca do `pag` gravado, pela mesma
 * razão já documentada em `inadimplenciaPorCliente` e
 * `statusCobrancaCliente`: 'Atrasado' é calculado do vencimento, e comparar
 * com o campo cru deixaria de fora justamente a venda vencida gravada como
 * 'Pendente' — o caso normal.
 *
 * `null` quando o cliente não tem NENHUMA venda cobrável (sem venda, ou só
 * canceladas/devolvidas, ou /api/saidas fora do ar): travessão. Com vendas
 * cobráveis e nenhuma atrasada devolve `{ quantidade: 0 }` — zero MEDIDO, que
 * a tela mostra como "0 atrasos" e é a boa notícia que o dono quer ver. Essa
 * é a distinção que o projeto inteiro faz entre `—` e `0`, e é o mesmo corte
 * de `statusCobrancaCliente` (as duas linhas ficam no mesmo bloco da ficha e
 * não podem discordar sobre haver ou não o que cobrar).
 *
 * Como o status de cobrança, NÃO é filtrada por período (o protótipo usa
 * `pedidosRaw`): dívida vencida em maio continua sendo dívida em agosto.
 */
export function atrasosDoCliente(
  pedidos: Pedido[],
  nome: string,
  hojeIso: string,
): { quantidade: number; valor: number } | null {
  const cobraveis = doCliente(pedidos, nome)
    .map(p => ({ pedido: p, situacao: situacaoExibidaSaida(p.pag, p.venc, hojeIso) }))
    .filter(({ situacao }) => situacao !== '—')
  if (cobraveis.length === 0) return null
  const atrasados = cobraveis.filter(({ situacao }) => situacao === 'Atrasado')
  return {
    quantidade: atrasados.length,
    valor: atrasados.reduce((s, { pedido }) => s + (pedido.valor || 0), 0),
  }
}

/**
 * Os `quantos` pedidos mais recentes do cliente, de QUALQUER status —
 * portado de `sel.pedidos` (protótipo 2252-2255), achado CF-6.
 *
 * Inclui pendente, em rota, cancelado e devolvido de propósito: a pergunta
 * do bloco é "o que está acontecendo com este cliente", e um pedido em rota
 * é exatamente o que o vendedor precisa ver antes de ligar para ele. O
 * bloco anterior desta ficha só mostrava `status === 'Entregue'` e escondia
 * tudo o que ainda não chegou.
 *
 * Ordem: entrega mais recente primeiro, com desempate por `numero` (também
 * decrescente) — sem o desempate, dois pedidos do mesmo dia sairiam na ordem
 * em que a API os devolveu, e a lista mudaria de ordem entre dois
 * carregamentos sem nada ter mudado. Pedido sem data de entrega ordena por
 * último ('' perde toda comparação), mas continua na lista: ele existe e
 * some-lo seria esconder um pedido real.
 *
 * Não é filtrada por período, como no protótipo (`pedidosRaw`): "pedidos
 * recentes" é uma janela por CONTAGEM, não por mês — recortar por mês
 * esvaziaria o bloco justamente no cliente que parou de comprar, que é
 * quando ele mais importa.
 */
export function pedidosRecentesCliente(pedidos: Pedido[], nome: string, quantos: number): Pedido[] {
  return doCliente(pedidos, nome)
    .slice()
    .sort((a, b) =>
      (b.entrega || '').localeCompare(a.entrega || '')
      || (b.numero || '').localeCompare(a.numero || ''))
    .slice(0, quantos)
}

/**
 * Portado de healthOf() do prototipo. As faixas (2% de inadimplencia,
 * ticket de 150 e 430) sao metas de negocio — viram configuracao na Fase 5.
 * Ticket zero significa "sem entrega no periodo" e nao penaliza.
 */
export function healthDoCliente(
  cliente: Pick<Cliente, 'status' | 'tend'>,
  inadPct: number,
  ticketEntrega: number,
): Health {
  if (!cliente || !cliente.status) return 'green'
  if (cliente.status === 'inadimplente' || cliente.status === 'inativo') return 'red'
  const inad = inadPct || 0
  const te = ticketEntrega || 0
  if (inad > 2 || (te > 0 && te < 150)) return 'red'
  if (inad > 1 || (te > 0 && te < 430) || cliente.tend === '↓' || cliente.status === 'negociacao') {
    return 'amber'
  }
  return 'green'
}

export function derivarClientes(
  clientes: Cliente[],
  pedidos: Pedido[],
  periodo: string,
  hojeIso: string,
): ClienteDerivado[] {
  // `filtrarPorPeriodo` (derive/periodo.ts), e não o antigo `mesDe` local
  // que devolvia só 'MM': o seletor de período agora é GLOBAL (achado S-3),
  // e um recorte que ignora o ano juntaria junho/2025 com junho/2026 no
  // mesmo "junho" — o ticket e a inadimplência da carteira sairiam errados
  // sem nenhum aviso assim que a base passasse de doze meses.
  const doPeriodo = filtrarPorPeriodo(pedidos, periodo, p => p.entrega)

  const entregues = doPeriodo.filter(p => p.status === 'Entregue')
  const faturamentoTotal = entregues.reduce((s, p) => s + (p.valor || 0), 0)

  return clientes.map(c => {
    const meus = entregues.filter(p => p.cliente === c.nome)
    const faturado = meus.reduce((s, p) => s + (p.valor || 0), 0)
    const ticketEntrega = ticketPorEntrega(doPeriodo, c.nome)
    const inadimplencia = inadimplenciaPorCliente(doPeriodo, c.nome, hojeIso)
    return {
      ...c,
      faturado,
      entregas: meus.length,
      ticketEntrega,
      participacao: faturamentoTotal > 0
        ? Math.round((faturado / faturamentoTotal) * 100)
        : 0,
      inadimplencia,
      health: healthDoCliente(c, inadimplencia, ticketEntrega),
    }
  })
}
