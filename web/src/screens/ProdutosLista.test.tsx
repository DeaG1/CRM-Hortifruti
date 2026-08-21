import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProdutosLista } from './ProdutosLista'
import { api, ErroApi } from '../api/client'
import type { Produto } from '../derive/produtos'

// Mock do client inteiro: ProdutosLista usa `api.get` diretamente, e o
// ModalProduto que ela renderiza internamente (nao ha tela de ficha para
// produtos — ver comentario no componente) usa `api.post/put/del`. Mantem a
// classe ErroApi real (os componentes fazem `err instanceof ErroApi`).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const produto = (over: Partial<Produto> = {}): Produto => ({
  id: '1', nome: 'Batata', un: 'KG', peso_medio: 0, ...over,
})

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ProdutosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os produtos.')
  })

  it('vazio: mostra "nenhum produto cadastrado" quando a API devolve lista vazia', async () => {
    mockGet.mockResolvedValue([])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum produto cadastrado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar primeiro produto/i })).toBeInTheDocument()
  })

  it('com dados: lista os produtos recebidos', async () => {
    mockGet.mockResolvedValue([produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cenoura' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Cenoura')).toBeInTheDocument()
  })
})

describe('ProdutosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ProdutosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ProdutosLista — metricas sem entradas/saidas', () => {
  it('compra, venda, markup, margem e perda aparecem como travessao, nao inventadas', async () => {
    mockGet.mockResolvedValue([produto()])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    // 5 colunas por linha (compra, venda, markup, margem, perda) + 1 no resumo de perda media
    expect(screen.getAllByText('—')).toHaveLength(6)
  })

  it('mostra a unidade do produto', async () => {
    mockGet.mockResolvedValue([produto({ un: 'CX' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('CX')).toBeInTheDocument()
  })
})

describe('ProdutosLista — abrir modal', () => {
  it('clicar em "Novo produto" abre o modal de criacao', async () => {
    mockGet.mockResolvedValue([produto()])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    fireEvent.click(screen.getByRole('button', { name: /novo produto/i }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })

  it('clicar numa linha abre o modal de edicao com os dados do produto', async () => {
    mockGet.mockResolvedValue([produto({ id: 'xyz', nome: 'Batata' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Batata'))
    expect(screen.getByRole('dialog', { name: 'Editar produto' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('Batata')
  })

  it('vazio: clicar em "Cadastrar primeiro produto" abre o modal de criacao', async () => {
    mockGet.mockResolvedValue([])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /cadastrar primeiro produto/i }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })
})

describe('ProdutosLista — recarrega apos salvar/excluir no modal', () => {
  it('salvar no modal fecha o modal e recarrega a lista', async () => {
    mockGet.mockResolvedValueOnce([produto({ id: '1', nome: 'Batata' })])
    mockGet.mockResolvedValueOnce([produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cenoura' })])
    mockPost.mockResolvedValue(produto({ id: '2', nome: 'Cenoura' }))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')

    fireEvent.click(screen.getByRole('button', { name: /novo produto/i }))
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Cenoura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText('Cenoura')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('excluir no modal fecha o modal e recarrega a lista', async () => {
    mockGet.mockResolvedValueOnce([produto({ id: '1', nome: 'Batata' })])
    mockGet.mockResolvedValueOnce([])
    mockDel.mockResolvedValue({ ok: true })
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Batata'))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText(/nenhum produto cadastrado/i)
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
