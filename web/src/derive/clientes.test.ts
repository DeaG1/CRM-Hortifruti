import { describe, it, expect } from 'vitest'
import {
  healthDoCliente,
  inadimplenciaPorCliente,
  ticketPorEntrega,
  derivarClientes,
  statusCobrancaCliente,
} from './clientes'
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
  const HOJE = '2026-06-15'

  it('e a fracao do faturado que esta atrasada', () => {
    const pedidos = [
      pedido({ valor: 1000, pag: 'Pago' }),
      pedido({ valor: 1000, pag: 'Atrasado' }),
    ]
    // faturado = so os Entregues = 2000; atrasado = 1000 => 50%
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBeCloseTo(50)
  })
  it('e zero quando nao ha faturamento', () => {
    expect(inadimplenciaPorCliente([], 'Mercado A', HOJE)).toBe(0)
  })
  it('ignora pedidos de outro cliente', () => {
    const pedidos = [pedido({ cliente: 'Outro', valor: 500, pag: 'Atrasado' })]
    expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(0)
  })

  // DEFEITO CORRIGIDO: desde que a UI parou de gravar 'Atrasado' (o seletor
  // de SaidasLista so oferece Pendente/Pago — ver derive/pagamento.ts),
  // 'Atrasado' passou a ser CALCULADO a partir de pag='Pendente' + venc
  // vencido. Filtrar so pelo `pag` gravado cru caminharia pra zero conforme
  // vendas antigas fossem substituidas por vendas novas.
  describe('deriva "atrasado" via situacaoExibidaSaida (nao so o pag gravado)', () => {
    it('pendente com vencimento passado conta como atrasada', () => {
      const pedidos = [pedido({ valor: 1000, pag: 'Pendente', venc: '2026-06-01' })]
      expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(100)
    })

    it('pendente com vencimento futuro NAO conta', () => {
      const pedidos = [pedido({ valor: 1000, pag: 'Pendente', venc: '2026-07-01' })]
      expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(0)
    })

    it('pendente sem vencimento NAO conta (nao inventa data default)', () => {
      const pedidos = [pedido({ valor: 1000, pag: 'Pendente', venc: null })]
      expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(0)
    })

    it('paga nunca conta, mesmo com vencimento passado', () => {
      const pedidos = [pedido({ valor: 1000, pag: 'Pago', venc: '2026-01-01' })]
      expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(0)
    })

    it('registro gravado como Atrasado (dado antigo) continua contando', () => {
      const pedidos = [pedido({ valor: 1000, pag: 'Atrasado', venc: null })]
      expect(inadimplenciaPorCliente(pedidos, 'Mercado A', HOJE)).toBe(100)
    })
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
    const saida = derivarClientes(clientes, pedidos, 'all', '2026-06-15')
    expect(saida.find(c => c.nome === 'A')!.participacao).toBe(75)
    expect(saida.find(c => c.nome === 'B')!.participacao).toBe(25)
  })

  it('filtra por periodo pelo mes da entrega', () => {
    const clientes = [cliente({ nome: 'A' })]
    const pedidos = [
      pedido({ cliente: 'A', entrega: '2026-06-10', valor: 1000 }),
      pedido({ cliente: 'A', entrega: '2026-05-10', valor: 9999 }),
    ]
    expect(derivarClientes(clientes, pedidos, '2026-06', '2026-06-15')[0].faturado).toBe(1000)
  })

  it('o periodo inclui o ANO: junho/2025 nao entra em junho/2026', () => {
    // O recorte era 'MM' (so o mes) ate o seletor de periodo virar global
    // (achado S-3). Com dois anos de historico, o 9999 de junho/2025 seria
    // somado ao faturamento de junho/2026 sem nenhum aviso.
    const clientes = [cliente({ nome: 'A' })]
    const pedidos = [
      pedido({ cliente: 'A', entrega: '2026-06-10', valor: 1000 }),
      pedido({ cliente: 'A', entrega: '2025-06-10', valor: 9999 }),
    ]
    expect(derivarClientes(clientes, pedidos, '2026-06', '2026-06-15')[0].faturado).toBe(1000)
  })
})

describe('statusCobrancaCliente', () => {
  const HOJE = '2026-06-15'

  it('venda vencida e nao paga deixa o cliente Atrasado', () => {
    // `pag` GRAVADO e 'Pendente' — o atraso vem do vencimento decorrido,
    // via situacaoExibidaSaida. Comparar com o campo cru daria "Em dia".
    const pedidos = [pedido({ pag: 'Pendente', venc: '2026-06-01' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Atrasado')
  })

  it('venda gravada como Atrasado (dado legado) tambem conta', () => {
    expect(statusCobrancaCliente([pedido({ pag: 'Atrasado' })], 'Mercado A', HOJE)).toBe('Atrasado')
  })

  it('tudo pago fica Em dia', () => {
    const pedidos = [pedido({ pag: 'Pago' }), pedido({ id: '#2', pag: 'Pago' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Em dia')
  })

  it('venda pendente ainda NAO vencida fica Em dia — pendente nao e atraso', () => {
    const pedidos = [pedido({ pag: 'Pendente', venc: '2026-07-01' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Em dia')
  })

  it('venda que vence HOJE ainda nao esta atrasada', () => {
    const pedidos = [pedido({ pag: 'Pendente', venc: HOJE })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Em dia')
  })

  it('venda pendente SEM vencimento fica Em dia — nao ha data pra vencer', () => {
    const pedidos = [pedido({ pag: 'Pendente', venc: null })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Em dia')
  })

  it('uma unica venda atrasada no meio de varias pagas ja deixa Atrasado', () => {
    const pedidos = [
      pedido({ id: '#1', pag: 'Pago' }),
      pedido({ id: '#2', pag: 'Pendente', venc: '2026-05-30' }),
      pedido({ id: '#3', pag: 'Pago' }),
    ]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Atrasado')
  })

  it('atraso conta em pedido de qualquer status, nao so entregue', () => {
    const pedidos = [pedido({ status: 'Em rota', pag: 'Pendente', venc: '2026-06-01' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Atrasado')
  })

  it('cliente SEM venda nenhuma devolve null (travessao), nunca "Em dia"', () => {
    expect(statusCobrancaCliente([], 'Mercado A', HOJE)).toBeNull()
  })

  it('vendas so de OUTROS clientes tambem devolvem null para este', () => {
    const pedidos = [pedido({ cliente: 'Outro', pag: 'Pendente', venc: '2026-01-01' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBeNull()
  })

  it('vendas so com pagamento nao aplicavel (cancelada/devolvida) devolvem null', () => {
    const pedidos = [pedido({ status: 'Cancelado', pag: '—', venc: '2026-01-01' })]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBeNull()
  })

  it('venda cancelada nao apaga o atraso de outra venda real', () => {
    const pedidos = [
      pedido({ id: '#1', status: 'Cancelado', pag: '—' }),
      pedido({ id: '#2', pag: 'Pendente', venc: '2026-06-01' }),
    ]
    expect(statusCobrancaCliente(pedidos, 'Mercado A', HOJE)).toBe('Atrasado')
  })
})
