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
