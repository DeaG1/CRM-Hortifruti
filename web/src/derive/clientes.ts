export type StatusCliente = 'ativo' | 'negociacao' | 'inadimplente' | 'inativo'
export type Tendencia = '↑' | '→' | '↓'
export type Health = 'green' | 'amber' | 'red'

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
  cobranca: 'Em dia', forma: 'PIX', limite: '' as number | string, prazo: 14, tend: '→', obs: '',
}

export interface Pedido {
  id: string
  cliente: string
  entrega: string          // ISO: aaaa-mm-dd
  valor: number
  status: 'Entregue' | 'Em rota' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
}

export interface ClienteDerivado extends Cliente {
  faturado: number
  entregas: number
  ticketEntrega: number
  participacao: number
  inadimplencia: number
  health: Health
}

/** Mes de uma data ISO, como '06'. Vazio se a data for invalida. */
export function mesDe(iso: string): string {
  return typeof iso === 'string' && iso.length >= 7 ? iso.slice(5, 7) : ''
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

export function inadimplenciaPorCliente(pedidos: Pedido[], nome: string): number {
  const meus = doCliente(pedidos, nome)
  const faturado = meus
    .filter(p => p.status === 'Entregue')
    .reduce((s, p) => s + (p.valor || 0), 0)
  if (faturado <= 0) return 0
  const atrasado = meus
    .filter(p => p.pag === 'Atrasado')
    .reduce((s, p) => s + (p.valor || 0), 0)
  return (atrasado / faturado) * 100
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
): ClienteDerivado[] {
  const doPeriodo = periodo === 'all'
    ? pedidos
    : pedidos.filter(p => mesDe(p.entrega) === periodo)

  const entregues = doPeriodo.filter(p => p.status === 'Entregue')
  const faturamentoTotal = entregues.reduce((s, p) => s + (p.valor || 0), 0)

  return clientes.map(c => {
    const meus = entregues.filter(p => p.cliente === c.nome)
    const faturado = meus.reduce((s, p) => s + (p.valor || 0), 0)
    const ticketEntrega = ticketPorEntrega(doPeriodo, c.nome)
    const inadimplencia = inadimplenciaPorCliente(doPeriodo, c.nome)
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
