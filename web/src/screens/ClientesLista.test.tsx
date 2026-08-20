import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ClientesLista } from './ClientesLista'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.get` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14, ...over,
})

function botaoFiltro(rotulo: string) {
  return screen.getByRole('button', { name: new RegExp('^' + rotulo) })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('ClientesLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<ClientesLista onAbrir={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<ClientesLista onAbrir={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os clientes.')
  })

  it('vazio: mostra "nenhum cliente cadastrado" quando a API devolve lista vazia', async () => {
    mockGet.mockResolvedValue([])
    render(<ClientesLista onAbrir={() => {}} />)
    expect(await screen.findByText(/nenhum cliente cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os clientes recebidos', async () => {
    mockGet.mockResolvedValue([
      cliente({ id: '1', nome: 'Mercado A' }),
      cliente({ id: '2', nome: 'Mercado B' }),
    ])
    render(<ClientesLista onAbrir={() => {}} />)
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Mercado B')).toBeInTheDocument()
  })
})

describe('ClientesLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClientesLista onAbrir={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ClientesLista — filtro por status', () => {
  const trio = () => [
    cliente({ id: '1', nome: 'Mercado A', status: 'ativo' }),
    cliente({ id: '2', nome: 'Mercado B', status: 'ativo' }),
    cliente({ id: '3', nome: 'Mercado C', status: 'inadimplente' }),
  ]

  it('conta cada status corretamente, inclusive os que nao aparecem na lista', async () => {
    mockGet.mockResolvedValue(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    expect(within(botaoFiltro('Todos')).getByText('3')).toBeInTheDocument()
    expect(within(botaoFiltro('Ativo')).getByText('2')).toBeInTheDocument()
    expect(within(botaoFiltro('Inadimplente')).getByText('1')).toBeInTheDocument()
    expect(within(botaoFiltro('Em negociação')).getByText('0')).toBeInTheDocument()
    expect(within(botaoFiltro('Inativo')).getByText('0')).toBeInTheDocument()
  })

  it('clicar num filtro mostra so os clientes daquele status', async () => {
    mockGet.mockResolvedValue(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(botaoFiltro('Inadimplente'))
    expect(screen.queryByText('Mercado A')).not.toBeInTheDocument()
    expect(screen.queryByText('Mercado B')).not.toBeInTheDocument()
    expect(screen.getByText('Mercado C')).toBeInTheDocument()
  })

  it('voltar para "Todos" mostra todos os clientes de novo', async () => {
    mockGet.mockResolvedValue(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(botaoFiltro('Ativo'))
    expect(screen.queryByText('Mercado C')).not.toBeInTheDocument()
    fireEvent.click(botaoFiltro('Todos'))
    expect(screen.getByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Mercado C')).toBeInTheDocument()
  })
})

describe('ClientesLista — sem pedidos (Fase 1 ainda nao existe)', () => {
  it('ticket, participacao e inadimplencia aparecem zerados sem quebrar o layout', async () => {
    mockGet.mockResolvedValue([cliente()])
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    // ticket do mes e ticket/entrega ficam em travessao (sem faturamento ainda)
    expect(screen.getAllByText('—')).toHaveLength(2)
    // participacao e inadimplencia aparecem como zero, nao em branco
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('0,0%')).toBeInTheDocument()
  })

  it('clicar numa linha chama onAbrir com o id do cliente', async () => {
    const onAbrir = vi.fn()
    mockGet.mockResolvedValue([cliente({ id: 'abc-123' })])
    render(<ClientesLista onAbrir={onAbrir} />)
    const linha = await screen.findByText('Mercado A')
    fireEvent.click(linha)
    expect(onAbrir).toHaveBeenCalledWith('abc-123')
  })
})
