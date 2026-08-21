import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FornecedoresLista } from './FornecedoresLista'
import { api, ErroApi } from '../api/client'
import type { Fornecedor } from '../derive/fornecedores'
import type { Produto } from '../derive/produtos'

// Mock do client inteiro: FornecedoresLista usa `api.get` (lista + detalhe de
// cada fornecedor + catalogo de produtos), e o ModalFornecedor que ela
// renderiza internamente (nao ha tela de ficha — mesma razao de
// ProdutosLista) usa `api.post/put/del`. Mantem a classe ErroApi real.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const produtoBatata: Produto = { id: 'pr-1', nome: 'Batata', un: 'KG', peso_medio: 0 }
const produtoAlface: Produto = { id: 'pr-2', nome: 'Alface', un: 'UN', peso_medio: 0 }

const fornecedorBase = (over: Partial<Fornecedor> = {}): Fornecedor => ({
  id: 'f-1', nome: 'Fazenda Boa Terra', regiao: 'Sul A', contato: '(41) 90000-0000', ...over,
})

/**
 * Configura `api.get` pros tres formatos de URL que FornecedoresLista chama:
 * lista (sem produtos vinculados), catalogo de produtos, e detalhe por
 * fornecedor (com produtos vinculados) — GET /api/fornecedores nao traz
 * `produtos`, so GET /api/fornecedores/:id traz (ver comentario no
 * componente e api/src/routes/fornecedores.ts).
 */
function configurarGet(opts: { lista: Fornecedor[]; produtos?: Produto[]; detalhes?: Record<string, Fornecedor> }) {
  const produtos = opts.produtos ?? []
  const detalhes = opts.detalhes ?? {}
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/fornecedores') return Promise.resolve(opts.lista)
    if (url === '/api/produtos') return Promise.resolve(produtos)
    const m = /^\/api\/fornecedores\/(.+)$/.exec(url)
    if (m && detalhes[m[1]]) return Promise.resolve(detalhes[m[1]])
    return Promise.reject(new Error('url nao mapeada em configurarGet: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('FornecedoresLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os fornecedores.')
  })

  it('vazio: mostra "nenhum fornecedor cadastrado" quando a API devolve lista vazia', async () => {
    configurarGet({ lista: [] })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum fornecedor cadastrado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar primeiro fornecedor/i })).toBeInTheDocument()
  })

  it('com dados: lista os fornecedores recebidos', async () => {
    configurarGet({
      lista: [fornecedorBase({ id: 'f-1', nome: 'Fazenda A' }), fornecedorBase({ id: 'f-2', nome: 'Fazenda B' })],
      produtos: [produtoBatata],
      detalhes: {
        'f-1': fornecedorBase({ id: 'f-1', nome: 'Fazenda A', produtos: [produtoBatata] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Fazenda B', produtos: [] }),
      },
    })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Fazenda A')).toBeInTheDocument()
    expect(screen.getByText('Fazenda B')).toBeInTheDocument()
  })
})

describe('FornecedoresLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<FornecedoresLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FornecedoresLista — produtos que entrega e metricas', () => {
  it('mostra os produtos vinculados a cada fornecedor', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      produtos: [produtoBatata, produtoAlface],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata, produtoAlface] }) },
    })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Alface')).toBeInTheDocument()
  })

  it('sem produtos vinculados: mostra aviso em vez de lista vazia', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Nenhum produto vinculado')).toBeInTheDocument()
  })

  it('preco medio, variacao e ultima coleta aparecem como travessao, nao inventados', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    // 3 metricas do cartao + 1 no card de resumo "Variacao de preco de compra" do topo
    expect(screen.getAllByText('—')).toHaveLength(4)
  })
})

describe('FornecedoresLista — abrir modal', () => {
  it('clicar em "Novo fornecedor" abre o modal de criacao', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    fireEvent.click(screen.getByRole('button', { name: /^＋ Novo fornecedor/i }))
    expect(screen.getByRole('dialog', { name: 'Novo fornecedor' })).toBeInTheDocument()
  })

  it('clicar num cartao abre o modal de edicao com os dados do fornecedor', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      produtos: [produtoBatata],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata] }) },
    })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Fazenda Boa Terra'))
    expect(screen.getByRole('dialog', { name: 'Editar fornecedor' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do produtor/i)).toHaveValue('Fazenda Boa Terra')
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('vazio: clicar em "Cadastrar primeiro fornecedor" abre o modal de criacao', async () => {
    configurarGet({ lista: [] })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /cadastrar primeiro fornecedor/i }))
    expect(screen.getByRole('dialog', { name: 'Novo fornecedor' })).toBeInTheDocument()
  })
})

describe('FornecedoresLista — recarrega apos salvar/excluir no modal', () => {
  it('salvar no modal fecha o modal e recarrega a lista', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    mockPost.mockResolvedValue(fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova', produtos: [] }))
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    // apos salvar, a segunda leva da lista (e do detalhe) inclui os dois fornecedores
    configurarGet({
      lista: [fornecedorBase(), fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova' })],
      detalhes: {
        'f-1': fornecedorBase({ produtos: [] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova', produtos: [] }),
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /^＋ Novo fornecedor/i }))
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Fazenda Nova' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText('Fazenda Nova')
  })

  it('excluir no modal fecha o modal e recarrega a lista', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    mockDel.mockResolvedValue({ ok: true })
    render(<FornecedoresLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Fazenda Boa Terra'))

    configurarGet({ lista: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText(/nenhum fornecedor cadastrado/i)
  })
})
