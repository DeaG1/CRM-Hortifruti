import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DashboardTela } from './DashboardTela'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import type { Saida, Entrada, Perda } from '../derive/dashboard'
import type { Lancamento } from '../derive/lancamentos'

// Mesmo mock do molde (ClientesLista.test.tsx): so `api.get` e substituido,
// ErroApi continua a classe real (o componente faz `err instanceof ErroApi`).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14, ...over,
})

const saida = (over: Partial<Saida> = {}): Saida => ({
  cliente_id: '1', status: 'Entregue', pag: 'Pago', entrega: '2026-06-10', data_pag: '2026-06-10',
  valor: 1000, ...over,
})

const entrada = (over: Partial<Entrada> = {}): Entrada => ({
  perda_kg: 0, valor_total: 0, peso_total: 0, ...over,
})

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-10', categoria: 'Frete', descricao: '', valor: 0, funcionario_id: null, ...over,
} as Lancamento)

interface Dados {
  clientes?: Cliente[]
  saidas?: Saida[]
  entradas?: Entrada[]
  lancamentos?: Lancamento[]
  perdas?: Perda[]
}

/** api.get e chamado 5x em paralelo (Promise.all) dentro do componente — o
 * mock precisa responder de acordo com a rota pedida, nao com a ordem. */
function mockApiPara(dados: Dados) {
  mockGet.mockImplementation((rota: unknown) => {
    switch (rota) {
      case '/api/clientes': return Promise.resolve(dados.clientes ?? [])
      case '/api/saidas': return Promise.resolve(dados.saidas ?? [])
      case '/api/entradas': return Promise.resolve(dados.entradas ?? [])
      case '/api/lancamentos': return Promise.resolve(dados.lancamentos ?? [])
      case '/api/perdas': return Promise.resolve(dados.perdas ?? [])
      default: return Promise.reject(new Error('rota inesperada: ' + String(rota)))
    }
  })
}

function cartao(rotulo: string): HTMLElement {
  const el = screen.getByText(rotulo).closest('.dashboard-kpi-card')
  if (!el) throw new Error(`card "${rotulo}" nao encontrado`)
  return el as HTMLElement
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('DashboardTela — os quatro estados', () => {
  it('carregando: mostra indicador enquanto as chamadas estao pendentes', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os dados do painel.')
  })

  it('vazio: mostra "nenhum cliente cadastrado" quando nao ha nenhum cliente', async () => {
    mockApiPara({ clientes: [] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum cliente cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: renderiza as secoes do painel', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Painel de indicadores')).toBeInTheDocument()
    expect(screen.getByText('Concentração de carteira')).toBeInTheDocument()
    expect(screen.getByText('Cenário realizado vs. projeções')).toBeInTheDocument()
  })
})

describe('DashboardTela — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<DashboardTela onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('DashboardTela — indicador sem dado mostra travessao, nunca zero', () => {
  it('sem nenhum pedido entregue: receita bruta e os KPIs financeiros ficam em "—"', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')

    // cartao do topo
    expect(within(screen.getByText('Receita bruta').closest('.dashboard-card-topo') as HTMLElement).getByText('—')).toBeInTheDocument()

    // KPIs que dependem de pedidos entregues
    for (const rotulo of ['Ticket médio / minimercado', 'Ticket médio por entrega', 'Inadimplência por cliente']) {
      const card = cartao(rotulo)
      expect(within(card).getByText('—')).toBeInTheDocument()
      expect(within(card).getByText('sem dado')).toBeInTheDocument()
    }

    // nenhum "R$ 0" nem "0%" nesses cartoes — teria que ser travessao, nunca zero
    expect(screen.queryByText('R$ 0')).not.toBeInTheDocument()
  })

  it('markup e giro de estoque ficam sempre em "—" (dado por item nao exposto pela API)', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 5000 })],
      entradas: [entrada({ valor_total: 2000, peso_total: 200, perda_kg: 5 })],
    })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')

    expect(within(cartao('Markup médio (venda/compra)')).getByText('—')).toBeInTheDocument()
    expect(within(cartao('Giro de estoque (dias)')).getByText('—')).toBeInTheDocument()
    expect(within(cartao('Ciclo de caixa (dias)')).getByText('—')).toBeInTheDocument()
  })
})

describe('DashboardTela — KPI bate a meta / fora da meta', () => {
  it('indice de perdas dentro da meta (<=10%) aparece como "na meta"', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50 })], // 5% de perda
    })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('5,0%')).toBeInTheDocument()
    expect(within(card).getByText('na meta')).toBeInTheDocument()
  })

  it('indice de perdas fora da meta (>13%) aparece como "fora da meta"', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 200 })], // 20% de perda
    })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('20,0%')).toBeInTheDocument()
    expect(within(card).getByText('fora da meta')).toBeInTheDocument()
  })

  it('ticket medio por entrega bate a meta (>=R$430)', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [saida({ valor: 500 })] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Ticket médio por entrega')
    expect(within(card).getByText('R$ 500')).toBeInTheDocument()
    expect(within(card).getByText('na meta')).toBeInTheDocument()
  })

  it('ticket medio por entrega fica fora da meta (<R$150)', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [saida({ valor: 100 })] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Ticket médio por entrega')
    expect(within(card).getByText('R$ 100')).toBeInTheDocument()
    expect(within(card).getByText('fora da meta')).toBeInTheDocument()
  })
})

describe('DashboardTela — custo total inclui entradas e lancamentos', () => {
  it('lucro liquido desconta compras (entradas) e despesas (lancamentos) da receita', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 300 })],
      lancamentos: [lancamento({ valor: 200 })],
    })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = screen.getByText('Lucro líquido op.').closest('.dashboard-card-topo') as HTMLElement
    // 1000 (receita) - 300 (entradas) - 200 (lancamentos) = 500
    expect(within(card).getByText('R$ 500')).toBeInTheDocument()
  })
})

describe('DashboardTela — concentracao de carteira', () => {
  it('mostra a participacao de cada cliente e destaca quem passa de 15%', async () => {
    mockApiPara({
      clientes: [cliente({ id: 'c1', nome: 'Mercado A' }), cliente({ id: 'c2', nome: 'Mercado B' })],
      saidas: [
        saida({ cliente_id: 'c1', valor: 900 }),
        saida({ cliente_id: 'c2', valor: 100 }),
      ],
    })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Concentração de carteira')

    expect(screen.getByText('Top 5 = 100% do faturamento')).toBeInTheDocument()
    expect(screen.getByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('Mercado B')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('sem pedido entregue, a secao explica o que falta em vez de mostrar barras vazias', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [] })
    render(<DashboardTela onSessaoExpirada={() => {}} />)
    const titulo = await screen.findByText('Concentração de carteira')
    const secao = titulo.closest('.dashboard-secao') as HTMLElement
    expect(within(secao).getByText(/sem pedidos entregues registrados/i)).toBeInTheDocument()
  })
})
