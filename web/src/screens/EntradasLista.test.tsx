import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EntradasLista } from './EntradasLista'
import { api, ErroApi } from '../api/client'

// Mock so de `api.get/del` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const FORNECEDORES = [{ id: 'f-1', nome: 'Fazenda Boa Terra', regiao: 'Sul', contato: '' }]

const entrada = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  numero: 'C-1040',
  fornecedor_id: 'f-1',
  data: '2026-08-10',
  perda_kg: 0.5,
  motivo: 'transporte',
  pago: 'Pago',
  data_pag: '2026-08-11',
  forma_pag: 'PIX',
  obs: '',
  valor_total: 120,
  peso_total: 30,
  ...over,
})

const entradaComItens = {
  ...entrada(),
  itens: [{ id: 'i-1', produto_id: 'p-1', un: 'KG', qtd: 30, preco: 4, perda_kg: 0.5 }],
}

/** Router de URL padrao — cobre tanto a tela quanto o ModalEntrada real que
 * ela monta (produtos/fornecedores). Cada teste pode sobrescrever so o que
 * precisa com mockGet.mockImplementation de novo. */
function mockRotasPadrao(entradas: unknown[] = [entrada()]) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/entradas') return Promise.resolve(entradas)
    if (url === '/api/entradas/e-1') return Promise.resolve(entradaComItens)
    if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
    if (url === '/api/produtos') return Promise.resolve([])
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockDel.mockReset()
})

describe('EntradasLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<EntradasLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/entradas' ? Promise.reject(new Error('falha de rede')) : Promise.resolve([]),
    )
    render(<EntradasLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar as entradas.')
  })

  it('vazio: mostra "nenhuma entrada lançada" quando a API devolve lista vazia', async () => {
    mockRotasPadrao([])
    render(<EntradasLista />)
    expect(await screen.findByText(/nenhuma entrada lan[cç]ada/i)).toBeInTheDocument()
  })

  it('com dados: lista as entradas recebidas', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', numero: 'C-1040' }), entrada({ id: 'e-2', numero: 'C-1041' })])
    render(<EntradasLista />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.getByText('C-1041')).toBeInTheDocument()
  })
})

describe('EntradasLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/entradas'
        ? Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
        : Promise.resolve([]),
    )
    const onSessaoExpirada = vi.fn()
    render(<EntradasLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — fornecedor 403 (colaborador) nao derruba a lista', () => {
  it('a lista de entradas renderiza normalmente mesmo se /api/fornecedores der 403', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') return Promise.resolve([entrada()])
      if (url === '/api/fornecedores') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      return Promise.resolve([])
    })
    render(<EntradasLista />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — abrir modal', () => {
  it('clicar em "Nova entrada" abre o modal de criação', async () => {
    mockRotasPadrao([])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: /lan[cç]ar primeira entrada/i }))
    expect(await screen.findByRole('dialog', { name: 'Nova entrada' })).toBeInTheDocument()
  })

  it('clicar numa linha busca o detalhe e abre o modal de edição preenchido', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByText('C-1040'))

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/entradas/e-1'))
    expect(await screen.findByRole('dialog', { name: 'Editar entrada' })).toBeInTheDocument()
    expect(screen.getByLabelText(/n[uú]mero da entrada/i)).toHaveValue('C-1040')
  })

  it('erro ao buscar o detalhe mostra alerta em vez de abrir o modal', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') return Promise.resolve([entrada()])
      if (url === '/api/entradas/e-1') return Promise.reject(new Error('falha'))
      return Promise.resolve([])
    })
    render(<EntradasLista />)
    fireEvent.click(await screen.findByText('C-1040'))
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel abrir esta entrada/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — confirmação antes de excluir', () => {
  it('clicar em Excluir mostra confirmacao e NAO chama a API antes de confirmar', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(await screen.findByRole('region', { name: 'Confirmar exclusão' })).toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('cancelar a confirmacao fecha o aviso sem excluir', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('confirmar exclusao chama DELETE com o id certo e some da lista', async () => {
    mockRotasPadrao([entrada()])
    mockDel.mockResolvedValue({ ok: true })
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/entradas/e-1'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument())
  })

  it('erro ao excluir mostra mensagem e mantem a confirmacao aberta', async () => {
    mockRotasPadrao([entrada()])
    mockDel.mockRejectedValue(new Error('falha'))
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel excluir/i)).toBeInTheDocument()
  })
})
