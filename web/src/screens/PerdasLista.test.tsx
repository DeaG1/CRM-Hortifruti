import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PerdasLista } from './PerdasLista'
import { api, ErroApi } from '../api/client'

// Mock so de `api.get/del` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const PRODUTOS = [{ id: 'p-1', nome: 'Tomate', un: 'KG', peso_medio: 0 }]

const perda = (over: Record<string, unknown> = {}) => ({
  id: 'pe-1',
  data: '2026-08-12',
  produto_id: 'p-1',
  un: 'KG',
  qtd: 3.2,
  motivo: 'vencimento',
  obs: 'caixa vencida',
  ...over,
})

function mockRotasPadrao(perdas: unknown[] = [perda()]) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/perdas') return Promise.resolve(perdas)
    if (url === '/api/produtos') return Promise.resolve(PRODUTOS)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockDel.mockReset()
})

describe('PerdasLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<PerdasLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/perdas' ? Promise.reject(new Error('falha de rede')) : Promise.resolve([]),
    )
    render(<PerdasLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar as perdas.')
  })

  it('vazio: mostra "nenhuma perda registrada" quando a API devolve lista vazia', async () => {
    mockRotasPadrao([])
    render(<PerdasLista />)
    expect(await screen.findByText(/nenhuma perda registrada/i)).toBeInTheDocument()
  })

  it('com dados: lista as perdas recebidas', async () => {
    mockRotasPadrao([perda({ id: 'pe-1' }), perda({ id: 'pe-2', motivo: 'armazenagem' })])
    render(<PerdasLista />)
    expect(await screen.findAllByText('Tomate')).toHaveLength(2)
  })
})

describe('PerdasLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/perdas'
        ? Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
        : Promise.resolve([]),
    )
    const onSessaoExpirada = vi.fn()
    render(<PerdasLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PerdasLista — produto 403 (colaborador) nao derruba a lista', () => {
  it('a lista de perdas renderiza normalmente mesmo se /api/produtos der 403 — cai pro id', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/perdas') return Promise.resolve([perda()])
      if (url === '/api/produtos') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      return Promise.resolve([])
    })
    render(<PerdasLista />)
    expect(await screen.findByText('2026-08-12')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PerdasLista — abrir modal', () => {
  it('clicar em "Nova perda" abre o modal de criação', async () => {
    mockRotasPadrao([])
    render(<PerdasLista />)
    fireEvent.click(await screen.findByRole('button', { name: /registrar primeira perda/i }))
    expect(await screen.findByRole('dialog', { name: 'Nova perda' })).toBeInTheDocument()
  })

  it('clicar numa linha abre o modal de edição ja preenchido', async () => {
    mockRotasPadrao([perda()])
    render(<PerdasLista />)
    fireEvent.click(await screen.findByText('Tomate'))
    expect(await screen.findByRole('dialog', { name: 'Editar perda' })).toBeInTheDocument()
    expect(screen.getByLabelText(/data da perda/i)).toHaveValue('2026-08-12')
  })
})

describe('PerdasLista — confirmação antes de excluir', () => {
  it('clicar em Excluir mostra confirmacao e NAO chama a API antes de confirmar', async () => {
    mockRotasPadrao([perda()])
    render(<PerdasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(await screen.findByRole('region', { name: 'Confirmar exclusão' })).toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('cancelar a confirmacao fecha o aviso sem excluir', async () => {
    mockRotasPadrao([perda()])
    render(<PerdasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('confirmar exclusao chama DELETE com o id certo e some da lista', async () => {
    mockRotasPadrao([perda()])
    mockDel.mockResolvedValue({ ok: true })
    render(<PerdasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/perdas/pe-1'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument())
  })

  it('erro ao excluir mostra mensagem e mantem a confirmacao aberta', async () => {
    mockRotasPadrao([perda()])
    mockDel.mockRejectedValue(new Error('falha'))
    render(<PerdasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel excluir/i)).toBeInTheDocument()
  })
})

/**
 * Achado ES-1: a secao de perdas do deposito (embutida na tela de Estoque)
 * tinha so uma legenda dizendo ONDE a perda acontece. Sumiram o titulo, o
 * fato de o lancamento ter DOIS efeitos (desconta do estoque E entra no
 * indice de perdas) e a distincao entre perda de coleta e perda de deposito
 * — a confusao mais provavel do usuario nesta tela, ja que a mesma palavra
 * nomeia as duas coisas. Prototipo 641-644 (topo) e 662 (estado vazio).
 */
describe('PerdasLista — titulo e explicacao da secao (achado ES-1)', () => {
  it('com dado: titulo "Perdas no deposito" e os dois efeitos do lancamento', async () => {
    mockRotasPadrao()
    render(<PerdasLista />)
    await screen.findByText('Tomate')
    expect(screen.getByRole('heading', { name: 'Perdas no depósito' })).toBeInTheDocument()
    const legenda = screen.getByText(/mercadoria que estragou depois da compra/i)
    expect(legenda).toHaveTextContent('desconta do estoque e entra no índice de perdas')
  })

  it('a legenda distingue perda de deposito de perda de coleta', async () => {
    mockRotasPadrao()
    render(<PerdasLista />)
    await screen.findByText('Tomate')
    expect(screen.getByText(/mercadoria que estragou depois da compra/i))
      .toHaveTextContent('A perda da coleta não entra aqui: ela vai na própria entrada')
  })

  it('a legenda nao perdeu a instrucao de clique que ja existia', async () => {
    mockRotasPadrao()
    render(<PerdasLista />)
    await screen.findByText('Tomate')
    expect(screen.getByText(/clique numa perda para editar/i)).toBeInTheDocument()
  })

  it('sem dado: o estado vazio repete a distincao — e quem chega aqui que precisa dela', async () => {
    mockRotasPadrao([])
    render(<PerdasLista />)
    expect(await screen.findByText(/nenhuma perda registrada/i)).toBeInTheDocument()
    // O titulo continua: a secao existe mesmo sem lancamento nenhum.
    expect(screen.getByRole('heading', { name: 'Perdas no depósito' })).toBeInTheDocument()
    expect(screen.getByText(/registre aqui o que estraga/i))
      .toHaveTextContent('A perda da coleta vai na própria entrada, não aqui')
  })

  it('falha de carregamento: so o alerta, sem titulo nem legenda pela metade', async () => {
    mockGet.mockImplementation((url: string) => (
      url === '/api/perdas'
        ? Promise.reject(new Error('falha de rede'))
        : Promise.resolve(PRODUTOS)
    ))
    render(<PerdasLista />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as perdas.')
    expect(screen.queryByRole('heading', { name: 'Perdas no depósito' })).not.toBeInTheDocument()
  })
})
