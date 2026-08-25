import { describe, it, expect } from 'vitest'
import {
  healthDoCliente,
  inadimplenciaPorCliente,
  ticketPorEntrega,
  derivarClientes,
  statusCobrancaCliente,
  ultimaCompraCliente,
  quantidadeEntregueCliente,
  atrasosDoCliente,
  pedidosRecentesCliente,
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

// ============ metricas da ficha do cliente (achados CF-2, CF-3, CF-5, CF-6)

describe('ultimaCompraCliente (CF-2)', () => {
  it('devolve a entrega mais recente entre os pedidos ENTREGUES', () => {
    const pedidos = [
      pedido({ id: '#1', entrega: '2026-05-02' }),
      pedido({ id: '#2', entrega: '2026-06-20' }),
      pedido({ id: '#3', entrega: '2026-03-11' }),
    ]
    expect(ultimaCompraCliente(pedidos, 'Mercado A')).toBe('2026-06-20')
  })

  it('nao independe da ordem do array (a API pode devolver em qualquer ordem)', () => {
    const pedidos = [
      pedido({ id: '#1', entrega: '2026-06-20' }),
      pedido({ id: '#2', entrega: '2026-05-02' }),
    ]
    expect(ultimaCompraCliente(pedidos, 'Mercado A')).toBe('2026-06-20')
  })

  it('ignora pedido nao entregue — um pedido em rota nao e compra feita', () => {
    const pedidos = [
      pedido({ id: '#1', entrega: '2026-05-02', status: 'Entregue' }),
      pedido({ id: '#2', entrega: '2026-08-30', status: 'Em rota' }),
      pedido({ id: '#3', entrega: '2026-09-30', status: 'Cancelado' }),
    ]
    expect(ultimaCompraCliente(pedidos, 'Mercado A')).toBe('2026-05-02')
  })

  it('ignora pedido de outro cliente', () => {
    const pedidos = [
      pedido({ id: '#1', entrega: '2026-05-02' }),
      pedido({ id: '#2', cliente: 'Outro', entrega: '2026-12-31' }),
    ]
    expect(ultimaCompraCliente(pedidos, 'Mercado A')).toBe('2026-05-02')
  })

  it('entrega vazia nao vira "ultima compra"', () => {
    expect(ultimaCompraCliente([pedido({ entrega: '' })], 'Mercado A')).toBeNull()
  })

  it('sem pedido entregue devolve null (travessao na tela)', () => {
    expect(ultimaCompraCliente([pedido({ status: 'Pendente' })], 'Mercado A')).toBeNull()
  })

  it('lista vazia (vendas indisponiveis) devolve null', () => {
    expect(ultimaCompraCliente([], 'Mercado A')).toBeNull()
  })
})

describe('quantidadeEntregueCliente (CF-3)', () => {
  it('soma o peso das entregas e conta quantas foram', () => {
    const pedidos = [
      pedido({ id: '#1', peso: 120 }),
      pedido({ id: '#2', peso: 80 }),
    ]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all'))
      .toEqual({ kg: 200, entregas: 2, itensSemConversao: 0 })
  })

  it('so conta pedido ENTREGUE — pendente/em rota ainda nao e quantidade entregue', () => {
    const pedidos = [
      pedido({ id: '#1', peso: 120 }),
      pedido({ id: '#2', peso: 500, status: 'Pendente' }),
      pedido({ id: '#3', peso: 700, status: 'Cancelado' }),
    ]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all')?.kg).toBe(120)
  })

  it('nao conta entrega de outro cliente', () => {
    const pedidos = [
      pedido({ id: '#1', peso: 120 }),
      pedido({ id: '#2', cliente: 'Outro', peso: 900 }),
    ]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all')?.kg).toBe(120)
  })

  it('RESPEITA o periodo', () => {
    const pedidos = [
      pedido({ id: '#1', entrega: '2026-06-10', peso: 120 }),
      pedido({ id: '#2', entrega: '2026-07-10', peso: 400 }),
    ]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', '2026-06')?.kg).toBe(120)
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', '2026-07')?.kg).toBe(400)
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all')?.kg).toBe(520)
  })

  it('sem entrega no periodo devolve null (travessao), nunca 0 kg', () => {
    const pedidos = [pedido({ entrega: '2026-06-10', peso: 120 })]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', '2026-08')).toBeNull()
  })

  it('lista vazia (vendas indisponiveis) devolve null', () => {
    expect(quantidadeEntregueCliente([], 'Mercado A', 'all')).toBeNull()
  })

  it('entrega existente com peso zero devolve 0 MEDIDO, nao null', () => {
    // Zero aqui e a medida (todos os itens ficaram sem conversao, por
    // exemplo); travessao seria dizer que ninguem mediu.
    const pedidos = [pedido({ peso: 0, itensSemConversao: 3 })]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all'))
      .toEqual({ kg: 0, entregas: 1, itensSemConversao: 3 })
  })

  it('soma os itens sem conversao das entregas, para a tela poder marcar o total', () => {
    const pedidos = [
      pedido({ id: '#1', peso: 120, itensSemConversao: 2 }),
      pedido({ id: '#2', peso: 80, itensSemConversao: 1 }),
    ]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all')?.itensSemConversao).toBe(3)
  })

  it('peso ausente conta como 0 na soma (fixture parcial), sem quebrar a conta', () => {
    const pedidos = [pedido({ id: '#1', peso: 120 }), pedido({ id: '#2' })]
    expect(quantidadeEntregueCliente(pedidos, 'Mercado A', 'all'))
      .toEqual({ kg: 120, entregas: 2, itensSemConversao: 0 })
  })
})

describe('atrasosDoCliente (CF-5)', () => {
  const HOJE_A = '2026-06-15'

  it('conta os pedidos atrasados e soma o valor deles', () => {
    const pedidos = [
      pedido({ id: '#1', valor: 300, pag: 'Pendente', venc: '2026-06-01' }),
      pedido({ id: '#2', valor: 200, pag: 'Pendente', venc: '2026-06-02' }),
      pedido({ id: '#3', valor: 900, pag: 'Pago' }),
    ]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)).toEqual({ quantidade: 2, valor: 500 })
  })

  it('usa a situacao DERIVADA: vencido gravado como Pendente conta como atraso', () => {
    const pedidos = [pedido({ valor: 300, pag: 'Pendente', venc: '2026-06-01' })]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)?.quantidade).toBe(1)
  })

  it('pendente ainda a vencer nao e atraso', () => {
    const pedidos = [pedido({ valor: 300, pag: 'Pendente', venc: '2026-12-01' })]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)).toEqual({ quantidade: 0, valor: 0 })
  })

  it('cliente com venda e sem atraso devolve zero MEDIDO, nao null', () => {
    expect(atrasosDoCliente([pedido({ pag: 'Pago' })], 'Mercado A', HOJE_A))
      .toEqual({ quantidade: 0, valor: 0 })
  })

  it('cliente sem venda nenhuma devolve null (travessao), nunca "0 atrasos"', () => {
    expect(atrasosDoCliente([], 'Mercado A', HOJE_A)).toBeNull()
  })

  it('so vendas canceladas/devolvidas devolvem null — nao ha o que cobrar', () => {
    const pedidos = [pedido({ status: 'Cancelado', pag: '—' })]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)).toBeNull()
  })

  it('venda cancelada nao entra no valor atrasado de quem tem atraso real', () => {
    const pedidos = [
      pedido({ id: '#1', status: 'Cancelado', pag: '—', valor: 5000 }),
      pedido({ id: '#2', valor: 300, pag: 'Pendente', venc: '2026-06-01' }),
    ]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)).toEqual({ quantidade: 1, valor: 300 })
  })

  it('nao conta atraso de outro cliente', () => {
    const pedidos = [pedido({ cliente: 'Outro', valor: 300, pag: 'Pendente', venc: '2026-06-01' })]
    expect(atrasosDoCliente(pedidos, 'Mercado A', HOJE_A)).toBeNull()
  })

  it('concorda com statusCobrancaCliente sobre haver ou nao o que cobrar', () => {
    // As duas linhas ficam no mesmo bloco da ficha: uma dizer travessao e a
    // outra "Em dia" seria a tela discordando de si mesma.
    const semCobranca = [pedido({ status: 'Cancelado', pag: '—' })]
    expect(atrasosDoCliente(semCobranca, 'Mercado A', HOJE_A)).toBeNull()
    expect(statusCobrancaCliente(semCobranca, 'Mercado A', HOJE_A)).toBeNull()

    const comCobranca = [pedido({ pag: 'Pago' })]
    expect(atrasosDoCliente(comCobranca, 'Mercado A', HOJE_A)).not.toBeNull()
    expect(statusCobrancaCliente(comCobranca, 'Mercado A', HOJE_A)).toBe('Em dia')
  })
})

describe('pedidosRecentesCliente (CF-6)', () => {
  it('devolve os mais recentes primeiro, limitado a quantos foram pedidos', () => {
    const pedidos = ['01', '02', '03', '04', '05'].map((n, i) => pedido({
      id: `#${n}`, numero: `PD-0${n}`, entrega: `2026-06-${10 + i}`,
    }))
    expect(pedidosRecentesCliente(pedidos, 'Mercado A', 4).map(p => p.numero))
      .toEqual(['PD-005', 'PD-004', 'PD-003', 'PD-002'])
  })

  it('inclui pedido NAO entregue — pendente, em rota, cancelado e devolvido', () => {
    const pedidos = [
      pedido({ id: '#1', numero: 'PD-001', status: 'Pendente' }),
      pedido({ id: '#2', numero: 'PD-002', status: 'Em rota' }),
      pedido({ id: '#3', numero: 'PD-003', status: 'Cancelado' }),
      pedido({ id: '#4', numero: 'PD-004', status: 'Devolvido' }),
    ]
    expect(pedidosRecentesCliente(pedidos, 'Mercado A', 4)).toHaveLength(4)
  })

  it('desempata pelo numero quando a entrega e a mesma (ordem estavel)', () => {
    const pedidos = [
      pedido({ id: '#1', numero: 'PD-001', entrega: '2026-06-10' }),
      pedido({ id: '#2', numero: 'PD-002', entrega: '2026-06-10' }),
    ]
    const ordem = pedidosRecentesCliente(pedidos, 'Mercado A', 4).map(p => p.numero)
    // Mesma resposta com o array na ordem inversa: sem o desempate, a ordem
    // exibida mudaria entre dois carregamentos sem nada ter mudado.
    const ordemInvertida = pedidosRecentesCliente(pedidos.slice().reverse(), 'Mercado A', 4).map(p => p.numero)
    expect(ordem).toEqual(['PD-002', 'PD-001'])
    expect(ordemInvertida).toEqual(ordem)
  })

  it('pedido sem entrega vai para o fim, mas continua na lista', () => {
    const pedidos = [
      pedido({ id: '#1', numero: 'PD-001', entrega: '' }),
      pedido({ id: '#2', numero: 'PD-002', entrega: '2026-06-10' }),
    ]
    expect(pedidosRecentesCliente(pedidos, 'Mercado A', 4).map(p => p.numero))
      .toEqual(['PD-002', 'PD-001'])
  })

  it('nao inclui pedido de outro cliente', () => {
    const pedidos = [pedido({ cliente: 'Outro', numero: 'PD-999' })]
    expect(pedidosRecentesCliente(pedidos, 'Mercado A', 4)).toEqual([])
  })

  it('lista vazia (vendas indisponiveis) devolve lista vazia', () => {
    expect(pedidosRecentesCliente([], 'Mercado A', 4)).toEqual([])
  })

  it('nao muta o array recebido', () => {
    const pedidos = [
      pedido({ id: '#1', numero: 'PD-001', entrega: '2026-06-01' }),
      pedido({ id: '#2', numero: 'PD-002', entrega: '2026-06-20' }),
    ]
    pedidosRecentesCliente(pedidos, 'Mercado A', 4)
    expect(pedidos.map(p => p.numero)).toEqual(['PD-001', 'PD-002'])
  })
})
