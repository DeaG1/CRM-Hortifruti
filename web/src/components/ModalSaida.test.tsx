import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ModalSaida, type Saida } from './ModalSaida'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de api.get/post/put/del — mantem a classe ErroApi real (o
// componente faz `err instanceof ErroApi`, precisa ser o mesmo construtor
// dos dois lados). Mesmo padrao de ModalCliente.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const clienteA: Cliente = {
  id: 'cli-1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14,
}
const produtoA = { id: 'prod-1', nome: 'Tomate', un: 'KG', peso_medio: 0 }
const produtoB = { id: 'prod-2', nome: 'Batata', un: 'KG', peso_medio: 0 }

const saidaExistente: Saida = {
  id: 'saida-1',
  numero: 'S-0001',
  cliente_id: 'cli-1',
  rota: 'Norte',
  data_pedido: '2026-08-01',
  entrega: '2026-08-05',
  status: 'Pendente',
  pag: 'Pendente',
  venc: '2026-08-19',
  data_pag: null,
  forma_pag: '',
  perda_kg: 0,
  motivo: '',
  obs: '',
  itens: [{ id: 'item-1', produto_id: 'prod-1', un: 'KG', qtd: 10, preco: 5, perda_kg: 0 }],
}

/** Roteia api.get pela URL — clientes/produtos sempre disponiveis; GET de
 * uma saida especifica so quando explicitamente configurado. */
function mockGetPadrao(saida: Saida | null = null) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/clientes') return Promise.resolve([clienteA])
    if (rota === '/api/produtos') return Promise.resolve([produtoA, produtoB])
    if (saida && rota === `/api/saidas/${saida.id}`) return Promise.resolve(saida)
    return Promise.reject(new Error('rota inesperada no teste: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
  mockGetPadrao()
})

describe('ModalSaida — criação (valores padrão)', () => {
  it('vencimento comeca vazio por padrao (a API calcula quando ausente)', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/vencimento/i)).toHaveValue('')
    // nota ao lado explica o calculo automatico, pra nao ser digitado a mao
    expect(screen.getByText(/calculado automaticamente/i)).toBeInTheDocument()
  })

  it('titulo do dialogo indica criacao, e foca o campo numero', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Nova saída' })).toBeInTheDocument()
    expect(screen.getByLabelText(/número do pedido/i)).toHaveFocus()
  })

  it('comeca sem nenhum item lancado', () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByText(/nenhum item ainda/i)).toBeInTheDocument()
  })
})

describe('ModalSaida — itens: adicionar, remover, total', () => {
  async function preencherCabecalhoMinimo() {
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0099' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
  }

  it('adicionar produto cria uma linha de item', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))

    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    expect(screen.getByLabelText('Produto')).toBeInTheDocument()
    expect(screen.queryByText(/nenhum item ainda/i)).not.toBeInTheDocument()
  })

  it('remover item tira a linha da lista', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    expect(screen.getByLabelText('Produto')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remover item' }))
    expect(screen.queryByLabelText('Produto')).not.toBeInTheDocument()
    expect(screen.getByText(/nenhum item ainda/i)).toBeInTheDocument()
  })

  it('total soma qtd x preco de todos os itens, e recalcula ao digitar', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    // cria duas linhas de item
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))

    const qtds = screen.getAllByLabelText('Quantidade')
    const precos = screen.getAllByLabelText('Preço por unidade')
    expect(qtds).toHaveLength(2)

    fireEvent.change(qtds[0], { target: { value: '2' } })
    fireEvent.change(precos[0], { target: { value: '10' } })
    fireEvent.change(qtds[1], { target: { value: '3' } })
    fireEvent.change(precos[1], { target: { value: '4' } })

    // 2*10 + 3*4 = 32,00
    expect(screen.getByText('R$ 32,00')).toBeInTheDocument()

    // muda so um item e confere que recalcula (nao fica "preso" no primeiro total)
    fireEvent.change(qtds[0], { target: { value: '5' } })
    // 5*10 + 3*4 = 62,00
    expect(screen.getByText('R$ 62,00')).toBeInTheDocument()
  })

  it('linha de item comeca com unidade KG por padrao', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    expect(screen.getByLabelText('Unidade')).toHaveValue('KG')
  })

  it('bloqueia salvar sem nenhum item, e nao chama a API', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await preencherCabecalhoMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Adicione pelo menos um item antes de salvar.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('bloqueia salvar quando um item nao tem produto selecionado', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await preencherCabecalhoMinimo()
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Selecione um produto em todos os itens.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalSaida — validação de número/data', () => {
  it('numero vazio: mostra erro e nao chama a API', () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe o número do pedido.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('data do pedido vazia: mostra erro e nao chama a API', () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe a data do pedido.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalSaida — envio (criação)', () => {
  async function preencherPedidoValido() {
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0100' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Preço por unidade'), { target: { value: '5' } })
  }

  it('nao inclui a chave venc no corpo quando o campo fica vazio', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-1' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await preencherPedidoValido()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect('venc' in corpo).toBe(false)
  })

  it('inclui venc no corpo quando o usuario preenche manualmente', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-2' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await preencherPedidoValido()
    fireEvent.change(screen.getByLabelText(/vencimento/i), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(corpo.venc).toBe('2026-09-01')
  })

  it('envia os itens sem a chave de UI "chave"', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-3' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await preencherPedidoValido()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { itens: Array<Record<string, unknown>> }
    expect(corpo.itens).toHaveLength(1)
    expect(corpo.itens[0]).toEqual({ produto_id: 'prod-1', un: 'KG', qtd: 10, preco: 5, perda_kg: 0 })
  })

  it('chama onSalvo com a saida retornada pela API', async () => {
    const criada = { ...saidaExistente, id: 'novo-4' }
    mockPost.mockResolvedValue(criada)
    const onSalvo = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await preencherPedidoValido()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criada))
  })
})

describe('ModalSaida — 409 (número duplicado)', () => {
  it('mostra o erro no campo número, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe uma saida com esse numero' }))
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0001' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByText('Já existe uma saída com esse número.')
    expect(alerta).toBeInTheDocument()
    // o erro esta perto do campo numero, nao como mensagem generica no rodape
    expect(screen.queryByText('Não foi possível salvar. Tente novamente.')).not.toBeInTheDocument()
  })
})

describe('ModalSaida — outros erros / sessão', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-x' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument()
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-y' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

describe('ModalSaida — edição', () => {
  it('carrega o cabecalho e os itens existentes (GET /:id)', async () => {
    mockGetPadrao(saidaExistente)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)

    expect(await screen.findByLabelText(/número do pedido/i)).toHaveValue('S-0001')
    expect(screen.getByLabelText(/vencimento/i)).toHaveValue('2026-08-19')
    expect(screen.getByLabelText('Produto')).toHaveValue('prod-1')
    expect(screen.getByLabelText('Quantidade')).toHaveValue(10)
    expect(screen.getByRole('dialog', { name: 'Editar saída' })).toBeInTheDocument()
  })

  it('usa PUT com o id da saida ao salvar', async () => {
    mockGetPadrao(saidaExistente)
    mockPut.mockResolvedValue(saidaExistente)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/saidas/saida-1', expect.anything()))
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalSaida — excluir com confirmação', () => {
  it('nao mostra o botao excluir ao criar (so existe em edicao)', () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('clicar em Excluir pede confirmação antes de chamar a API', async () => {
    mockGetPadrao(saidaExistente)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Excluir a saída')
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('cancelar a confirmação nao exclui', async () => {
    mockGetPadrao(saidaExistente)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    const painel = screen.getByRole('region', { name: 'Confirmar exclusão' })
    fireEvent.click(within(painel).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(/excluir a saída/i)).not.toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('confirmar exclusão chama DELETE e onExcluido', async () => {
    mockGetPadrao(saidaExistente)
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/saidas/saida-1'))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledOnce())
  })

  it('erro ao excluir mostra mensagem e mantem a confirmacao visivel', async () => {
    mockGetPadrao(saidaExistente)
    mockDel.mockRejectedValue(new Error('falha'))
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
  })
})

describe('ModalSaida — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/número do pedido/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('form tem noValidate, e o campo numero mantem required', () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
    expect(screen.getByLabelText(/número do pedido/i)).toBeRequired()
  })
})
