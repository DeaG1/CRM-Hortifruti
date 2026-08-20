import { describe, it, expect } from 'vitest'
import { healthDoCliente, inadimplenciaPorCliente, ticketPorEntrega, derivarClientes } from './clientes'
import type { Cliente, Pedido } from './clientes'

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', status: 'ativo', tend: '→', ...over,
} as Cliente)

const pedido = (over: Partial<Pedido> = {}): Pedido => ({
  id: '#1', cliente: 'Mercado A', entrega: '2026-06-10',
  valor: 1000, status: 'Entregue', pag: 'Pago', ...over,
} as Pedido)

describe('healthDoCliente', () => {
  it('inadimplente e sempre vermelho', () => {
    expect(healthDoCliente(cliente({ status: 'inadimplente' }), 0, 1000)).toBe('red')
  })
  it('inativo e sempre vermelho', () => {
    expect(healthDoCliente(cliente({ status: 'inativo' }), 0, 1000)).toBe('red')
  })
  it('inadimplencia acima de 2% e vermelho', () => {
    expect(healthDoCliente(cliente(), 2.1, 1000)).toBe('red')
  })
  it('ticket abaixo de 150 e vermelho', () => {
    expect(healthDoCliente(cliente(), 0, 149)).toBe('red')
  })
  it('ticket zero nao penaliza (cliente sem entrega no periodo)', () => {
    expect(healthDoCliente(cliente(), 0, 0)).toBe('green')
  })
  it('inadimplencia entre 1 e 2% e ambar', () => {
    expect(healthDoCliente(cliente(), 1.5, 1000)).toBe('amber')
  })
  it('tendencia de queda e ambar', () => {
    expect(healthDoCliente(cliente({ tend: '↓' }), 0, 1000)).toBe('amber')
  })
  it('em negociacao e ambar', () => {
    expect(healthDoCliente(cliente({ status: 'negociacao' }), 0, 1000)).toBe('amber')
  })
  it('saudavel e verde', () => {
    expect(healthDoCliente(cliente(), 0.5, 500)).toBe('green')
  })
})

describe('inadimplenciaPorCliente', () => {
  it('e a fracao do faturado que esta atrasada', () => {
    const pedidos = [
      pedido({ valor: 1000, pag: 'Pago' }),
      pedido({ valor: 1000, pag: 'Atrasado' }),
    ]
    // faturado = so os Entregues = 2000; atrasado = 1000 => 50%
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A')).toBeCloseTo(50)
  })
  it('e zero quando nao ha faturamento', () => {
    expect(inadimplenciaPorCliente([], 'Mercado A')).toBe(0)
  })
  it('ignora pedidos de outro cliente', () => {
    const pedidos = [pedido({ cliente: 'Outro', valor: 500, pag: 'Atrasado' })]
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A')).toBe(0)
  })
})

describe('ticketPorEntrega', () => {
  it('e a media do valor das entregas', () => {
    const pedidos = [pedido({ valor: 1000 }), pedido({ valor: 500 })]
    expect(ticketPorEntrega(pedidos, 'Mercado A')).toBe(750)
  })
  it('conta apenas pedidos entregues', () => {
    const pedidos = [pedido({ valor: 1000 }), pedido({ valor: 999, status: 'Cancelado' })]
    expect(ticketPorEntrega(pedidos, 'Mercado A')).toBe(1000)
  })
  it('e zero sem entregas', () => {
    expect(ticketPorEntrega([], 'Mercado A')).toBe(0)
  })
})

describe('derivarClientes', () => {
  it('calcula participacao sobre o faturamento total', () => {
    const clientes = [cliente({ nome: 'A' }), cliente({ id: '2', nome: 'B' })]
    const pedidos = [
      pedido({ cliente: 'A', valor: 750 }),
      pedido({ cliente: 'B', valor: 250 }),
    ]
    const saida = derivarClientes(clientes, pedidos, 'all')
    expect(saida.find(c => c.nome === 'A')!.participacao).toBe(75)
    expect(saida.find(c => c.nome === 'B')!.participacao).toBe(25)
  })

  it('filtra por periodo pelo mes da entrega', () => {
    const clientes = [cliente({ nome: 'A' })]
    const pedidos = [
      pedido({ cliente: 'A', entrega: '2026-06-10', valor: 1000 }),
      pedido({ cliente: 'A', entrega: '2026-05-10', valor: 9999 }),
    ]
    expect(derivarClientes(clientes, pedidos, '06')[0].faturado).toBe(1000)
  })
})
