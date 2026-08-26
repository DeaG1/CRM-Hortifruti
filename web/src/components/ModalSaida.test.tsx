import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ModalSaida, type Saida } from './ModalSaida'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import type { PrecoLembrado } from '../derive/memoriaPreco'

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
// Cliente com limite de credito cadastrado, pra suite "aviso de limite de
// credito" abaixo — clienteA (limite: 0 = sem limite) fica reservado pra
// provar que ausencia de limite nunca dispara aviso.
const clienteComLimite: Cliente = {
  id: 'cli-2', nome: 'Mercado B', resp: 'Joao', rota: 'Sul', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 100, prazo: 14,
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
 * uma saida especifica so quando explicitamente configurado.
 *
 * `saidasAnteriores`: resposta de GET /api/saidas (listagem, usada so pro
 * calculo do aviso de limite de credito). Default `[]` (nenhuma venda
 * anterior — nao muda o comportamento das suites que nao mexem com limite
 * de credito). Passar `'erro'` simula a falha desse fetch especifico
 * (isolada — GET /api/clientes e /api/produtos continuam OK), pra testar
 * que o modal continua funcional sem o aviso.
 *
 * `memoria`: resposta de GET /api/saidas/ultimos-precos/:clienteId (a memoria
 * de preco por cliente). Ou um mapa clienteId -> linhas, ou `'erro'` pra
 * simular a falha isolada desse fetch. Default: nenhum cliente tem historico
 * — que e o comportamento neutro pras suites que nao tratam de preco. */
function mockGetPadrao(
  saida: Saida | null = null,
  saidasAnteriores: Saida[] | 'erro' = [],
  memoria: Record<string, PrecoLembrado[]> | 'erro' = {},
) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/clientes') return Promise.resolve([clienteA, clienteComLimite])
    if (rota === '/api/produtos') return Promise.resolve([produtoA, produtoB])
    if (rota.startsWith('/api/saidas/ultimos-precos/')) {
      if (memoria === 'erro') return Promise.reject(new Error('falha ao buscar a memoria de preco'))
      return Promise.resolve(memoria[rota.replace('/api/saidas/ultimos-precos/', '')] ?? [])
    }
    if (rota === '/api/saidas') {
      return saidasAnteriores === 'erro'
        ? Promise.reject(new Error('falha ao buscar vendas anteriores'))
        : Promise.resolve(saidasAnteriores)
    }
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

  it('linha de item nova comeca com quantidade e preco vazios (nao 0), com placeholder', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))

    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    // vazio (nao 0) — abrir com 0 ja escrito faz quem digita esquecer de
    // apagar o zero e gravar "01"/"05" em vez do valor pretendido (bug real
    // reportado pelo dono do produto).
    expect(screen.getByLabelText('Quantidade')).toHaveValue(null)
    expect(screen.getByLabelText('Quantidade')).toHaveAttribute('placeholder', 'Ex.: 1450')
    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(null)
    expect(screen.getByLabelText('Preço por unidade')).toHaveAttribute('placeholder', 'Ex.: 3,20')
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

  it('quantidade/preco do item vazios viram 0 ao enviar', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-vazio' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0101' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    // nao toca em Quantidade nem Preço — comecam vazios
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { itens: Array<{ qtd: unknown; preco: unknown }> }
    expect(corpo.itens[0].qtd).toBe(0)
    expect(corpo.itens[0].preco).toBe(0)
    expect(typeof corpo.itens[0].qtd).toBe('number')
    expect(typeof corpo.itens[0].preco).toBe('number')
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

  it('item existente com qtd/preco 0 mostra 0, nao vazio — zero gravado e intencional, diferente do vazio inicial', async () => {
    const saidaComItemZerado: Saida = {
      ...saidaExistente,
      itens: [{ id: 'item-2', produto_id: 'prod-1', un: 'KG', qtd: 0, preco: 0, perda_kg: 0 }],
    }
    mockGetPadrao(saidaComItemZerado)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)

    expect(await screen.findByLabelText('Quantidade')).toHaveValue(0)
    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(0)
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

// DECISAO DO DONO DO PRODUTO: isto e um AVISO, nunca um bloqueio — a venda
// sempre pode ser salva estourando o limite. Nenhum teste aqui deve
// verificar `disabled` no botao Salvar nem qualquer confirmacao extra por
// causa do limite; o teste "venda salva normalmente..." abaixo existe
// justamente pra proteger essa decisao contra alguem "endurecer" isto depois.
describe('ModalSaida — aviso de limite de crédito', () => {
  // clienteComLimite (limite: 100) já deve 80 (saidaAbertaClienteComLimite,
  // pag Pendente) — fixture-base reaproveitada em vários testes abaixo.
  const saidaAbertaClienteComLimite: Saida = {
    id: 'saida-aberta-b', numero: 'S-0050', cliente_id: 'cli-2', rota: 'Sul',
    data_pedido: '2026-08-01', entrega: '2026-08-01', status: 'Entregue',
    pag: 'Pendente', venc: '2099-01-01', data_pag: null, forma_pag: '',
    perda_kg: 0, motivo: '', obs: '', valor: 80,
  }
  const saidaAbertaClienteA: Saida = {
    id: 'saida-aberta-a', numero: 'S-0040', cliente_id: 'cli-1', rota: 'Norte',
    data_pedido: '2026-08-01', entrega: '2026-08-01', status: 'Entregue',
    pag: 'Pendente', venc: '2099-01-01', data_pag: null, forma_pag: '',
    perda_kg: 0, motivo: '', obs: '', valor: 99999,
  }

  async function selecionarCliente(id: string, nome: string) {
    await waitFor(() => expect(screen.getByRole('option', { name: nome })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: id } })
  }

  async function lancarItem(qtd: string, preco: string) {
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: qtd } })
    fireEvent.change(screen.getByLabelText('Preço por unidade'), { target: { value: preco } })
  }

  it('cliente sem limite cadastrado nunca avisa, mesmo com divida grande e venda grande', async () => {
    mockGetPadrao(null, [saidaAbertaClienteA])
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await lancarItem('1000', '1000')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cliente dentro do limite (em aberto + esta venda nao ultrapassa) nao avisa', async () => {
    mockGetPadrao(null, [saidaAbertaClienteComLimite]) // 80 em aberto, limite 100
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-2', 'Mercado B')
    await lancarItem('1', '10') // total 10 -> 80 + 10 = 90 < 100
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cliente que estoura COM esta venda avisa com o valor correto do excedente', async () => {
    mockGetPadrao(null, [saidaAbertaClienteComLimite]) // 80 em aberto, limite 100
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-2', 'Mercado B')
    await lancarItem('10', '3') // total 30 -> 80 + 30 = 110, excedente 10

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('R$ 100,00') // limite
    expect(aviso).toHaveTextContent('R$ 80,00') // ja deve (em aberto)
    expect(aviso).toHaveTextContent('R$ 30,00') // esta venda
    expect(aviso).toHaveTextContent('R$ 10,00') // excedente
  })

  it('cliente já estourado ANTES desta venda avisa, mesmo sem nenhum item lançado ainda', async () => {
    const saidaEstourada: Saida = { ...saidaAbertaClienteComLimite, id: 'saida-estourada', valor: 150 }
    mockGetPadrao(null, [saidaEstourada])
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-2', 'Mercado B')

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('R$ 150,00') // ja deve, mesmo com "esta venda" = R$ 0,00
  })

  it('falha ao carregar vendas anteriores não quebra o modal nem bloqueia o salvamento', async () => {
    mockGetPadrao(null, 'erro')
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-sem-vendas-anteriores' })
    const onSalvo = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await selecionarCliente('cli-2', 'Mercado B')
    await lancarItem('100', '100') // venda enorme — mas sem dado de vendas anteriores, sem aviso possivel
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0300' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  // Protege a decisao do dono do produto: o aviso e so informativo. Se
  // alguem tentar "endurecer" isto depois (desabilitar o Salvar, adicionar
  // confirmacao, bloquear no backend), este teste quebra primeiro.
  it('venda salva normalmente mesmo com o aviso de limite de crédito visível na tela', async () => {
    mockGetPadrao(null, [saidaAbertaClienteComLimite])
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-com-aviso' })
    const onSalvo = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await selecionarCliente('cli-2', 'Mercado B')
    await lancarItem('10', '3') // 80 + 30 = 110 > 100 -> aviso visivel

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0301' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    // continua visivel depois: nao houve dialogo de confirmacao nem bloqueio
    // no meio do caminho — so o POST normal, com o aviso ainda na tela.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('edição: a própria saída sendo editada não conta duas vezes no valor em aberto', async () => {
    const saidaEditando: Saida = {
      id: 'saida-1', numero: 'S-0001', cliente_id: 'cli-2', rota: 'Sul',
      data_pedido: '2026-08-01', entrega: '2026-08-05', status: 'Pendente',
      pag: 'Pendente', venc: '2026-08-19', data_pag: null, forma_pag: '',
      perda_kg: 0, motivo: '', obs: '',
      itens: [{ id: 'item-1', produto_id: 'prod-1', un: 'KG', qtd: 10, preco: 6, perda_kg: 0 }], // total 60
    }
    // GET /api/saidas (listagem) traz a versao GRAVADA da propria saida em
    // edicao (valor antigo, 60) + uma saida de outro pedido do mesmo
    // cliente (valor 20). Sem excluir a propria saida da soma, o em aberto
    // ficaria 60 + 20 + 60 (total atual do formulario) = 140 > limite 100,
    // avisando errado; excluindo (ignorarId=saidaId), fica 20 + 60 = 80 < 100.
    const versaoGravadaDaEditada: Saida = { ...saidaEditando, valor: 60 }
    const outraSaida: Saida = { ...saidaAbertaClienteComLimite, id: 'outra', valor: 20 }
    mockGetPadrao(saidaEditando, [versaoGravadaDaEditada, outraSaida])
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText(/número do pedido/i)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

/**
 * AVISO DE ITEM SEM PRECO — hoje o campo vazio vira 0 no envio e a venda
 * grava assim em silencio (isso ja obrigou a memoria de preco a filtrar
 * `preco > 0` na propria consulta, e distorce o preco medio de venda do
 * relatorio de produtos). DECISAO DO DONO DO PRODUTO: SO avisa, nunca
 * bloqueia — mesma linha do aviso de limite de credito, acima. Nenhum teste
 * aqui deve checar `disabled` no botao Salvar nem qualquer validacao que
 * impeca o envio por causa do preco; o teste "a venda salva normalmente..."
 * abaixo existe justamente pra proteger essa decisao contra alguem
 * "endurecer" isto depois.
 */
describe('ModalSaida — aviso de item sem preço', () => {
  async function preencherCabecalhoMinimo() {
    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0700' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
  }

  /** Adiciona uma linha de item nova e a preenche — `preco` fica de fora de
   * proposito quando omitido (o cenario que este describe testa). */
  async function adicionarItem(produtoId: string, qtd: string, preco?: string) {
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    const produtos = await screen.findAllByLabelText('Produto')
    const idx = produtos.length - 1
    fireEvent.change(produtos[idx], { target: { value: produtoId } })
    fireEvent.change(screen.getAllByLabelText('Quantidade')[idx], { target: { value: qtd } })
    if (preco !== undefined) {
      fireEvent.change(screen.getAllByLabelText('Preço por unidade')[idx], { target: { value: preco } })
    }
  }

  it('item com preço preenchido: nenhum aviso, nem depois de tentar salvar', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-com-preco' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('não avisa antes da primeira tentativa de salvar, mesmo com item recém-adicionado sem preço', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10') // produto acabou de ser escolhido, preco ainda vazio
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('um item sem preço avisa nomeando o produto', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-sem-preco' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10') // Tomate, sem preco
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const aviso = await screen.findByRole('status')
    // frase exata (nao so um regex frouxo): protege tambem a concordancia
    // no singular ("esta", nao "estao") contra um erro de pluralizacao.
    expect(aviso).toHaveTextContent('Tomate está sem preço — a venda salva assim mesmo, como R$ 0,00.')
  })

  it('vários itens sem preço nomeiam todos os produtos', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-varios-sem-preco' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10') // Tomate, sem preco
    await adicionarItem('prod-2', '5')  // Batata, sem preco
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const aviso = await screen.findByRole('status')
    // frase exata: protege a lista ("Tomate e Batata", nao "Tomate, Batata")
    // e a concordancia no plural ("estao").
    expect(aviso).toHaveTextContent('Tomate e Batata estão sem preço — a venda salva assim mesmo, como R$ 0,00.')
  })

  // Protege a decisao do dono do produto: o aviso e so informativo. Se
  // alguem tentar "endurecer" isto depois (desabilitar o Salvar, adicionar
  // confirmacao, bloquear no backend), este teste quebra primeiro.
  it('a venda salva normalmente com o aviso de item sem preço visível na tela', async () => {
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-salva-com-aviso' })
    const onSalvo = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10') // sem preco

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeDisabled()
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { itens: Array<{ preco: number }> }
    expect(corpo.itens[0].preco).toBe(0)
    // continua visivel depois: nao houve dialogo de confirmacao nem
    // bloqueio no meio do caminho — so o POST normal, com o aviso ainda na tela.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('o aviso some quando o preço é preenchido, sem precisar clicar em Salvar de novo', async () => {
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
    await preencherCabecalhoMinimo()
    await adicionarItem('prod-1', '10') // sem preco
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Preço por unidade'), { target: { value: '5' } })

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})

/**
 * MEMORIA DE PRECO POR CLIENTE.
 *
 * Escolhido o cliente, o modal busca o ultimo preco cobrado dele em cada
 * (produto, unidade) — uma chamada so, `GET /api/saidas/ultimos-precos/:id` —
 * e usa isso pra preencher o campo de R$/UN dos itens, com a data a vista.
 * As regras vivem em derive/memoriaPreco.ts (testadas la, isoladas); aqui se
 * verifica que a TELA as aplica nos momentos certos e que nada disso trava o
 * lancamento.
 */
describe('ModalSaida — memória de preço por cliente', () => {
  const memoriaClienteA = {
    'cli-1': [
      { produto_id: 'prod-1', un: 'KG', preco: 4.2, data: '2026-08-12', numero: 'S-0007' },
    ],
  }

  async function selecionarCliente(id: string, nome: string) {
    await waitFor(() => expect(screen.getByRole('option', { name: nome })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: id } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(`/api/saidas/ultimos-precos/${id}`))
  }

  async function adicionarLinha(produto = 'prod-1') {
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: produto } })
  }

  it('busca a memória do cliente escolhido — uma chamada por cliente, não uma por item', async () => {
    mockGetPadrao(null, [], memoriaClienteA)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')

    await adicionarLinha('prod-1')
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getAllByLabelText('Produto')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('Produto')[1], { target: { value: 'prod-2' } })

    // Dois itens, e ainda assim UMA unica ida ao servidor pela memoria: o
    // modal roda em Workers, com teto de subrequisicoes por invocacao.
    const chamadas = mockGet.mock.calls.filter(
      (args: unknown[]) => String(args[0]).startsWith('/api/saidas/ultimos-precos/'))
    expect(chamadas).toHaveLength(1)
  })

  it('item de produto conhecido abre com o preço preenchido e a data à vista', async () => {
    mockGetPadrao(null, [], memoriaClienteA)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await adicionarLinha('prod-1')

    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(4.2)
    // A data nao e enfeite: um preco de tres meses atras preenchido em
    // silencio faz vender pelo valor errado.
    expect(screen.getByText('último: R$ 4,20/KG em 12/08')).toBeInTheDocument()
  })

  it('produto sem histórico com aquele cliente: campo VAZIO, sem nota', async () => {
    // Nada de preco de outro cliente nem media — o vazio faz a pessoa
    // pensar, o numero errado faz ela clicar em salvar.
    mockGetPadrao(null, [], memoriaClienteA)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await adicionarLinha('prod-2')

    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(null)
    expect(screen.queryByText(/^último:/)).not.toBeInTheDocument()
  })

  it('cliente sem nenhuma compra: campo vazio', async () => {
    mockGetPadrao(null, [], { 'cli-1': [] })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await adicionarLinha('prod-1')

    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(null)
  })

  it('o preço preenchido continua editável — é sugestão, nunca trava', async () => {
    mockGetPadrao(null, [], memoriaClienteA)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await adicionarLinha('prod-1')

    const campo = screen.getByLabelText('Preço por unidade')
    expect(campo).not.toBeDisabled()
    expect(campo).not.toHaveAttribute('readonly')
    fireEvent.change(campo, { target: { value: '5.5' } })
    expect(campo).toHaveValue(5.5)
  })

  it('linha em outra unidade não recebe o preço lembrado, mas a nota diz que ele existe', async () => {
    // A memoria e de p1 em KG a R$ 4,20. Escrever 4,20 numa linha em CX
    // afirmaria que a caixa custa R$ 4,20.
    mockGetPadrao(null, [], memoriaClienteA)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await selecionarCliente('cli-1', 'Mercado A')
    await adicionarLinha('prod-1')
    fireEvent.change(screen.getByLabelText('Unidade'), { target: { value: 'CX' } })

    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(null)
    expect(screen.getByText('último: R$ 4,20/KG em 12/08')).toBeInTheDocument()
  })
})

/**
 * O caso que estraga trabalho digitado: trocar o cliente no MEIO do
 * preenchimento. A regra implementada (derive/memoriaPreco.ts) e uma so —
 * a memoria escreve apenas onde ninguem digitou:
 *
 *  - campo vazio  -> preenche com a memoria do cliente novo;
 *  - campo que a PROPRIA memoria preencheu -> troca pelo preco do cliente
 *    novo, ou APAGA se o cliente novo nunca comprou aquele produto (deixar
 *    seria mostrar, sob o nome dele, um preco que nunca foi cobrado dele);
 *  - campo digitado a mao -> intocado, sempre.
 *
 * "So preencher o que estiver vazio" nao bastava: o preco automatico do
 * cliente ANTERIOR nao esta vazio, e sobreviveria a troca — silenciosamente
 * errado, no campo de dinheiro.
 */
describe('ModalSaida — troca de cliente no meio do preenchimento', () => {
  const memoriaDosDois = {
    'cli-1': [
      { produto_id: 'prod-1', un: 'KG', preco: 4.2, data: '2026-08-12', numero: 'S-0007' },
      { produto_id: 'prod-2', un: 'KG', preco: 2, data: '2026-08-12', numero: 'S-0007' },
    ],
    'cli-2': [
      { produto_id: 'prod-1', un: 'KG', preco: 6, data: '2026-08-20', numero: 'S-0009' },
    ],
  }

  async function trocarCliente(id: string, nome: string) {
    await waitFor(() => expect(screen.getByRole('option', { name: nome })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: id } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/saidas/ultimos-precos/' + id))
  }

  async function duasLinhas() {
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getAllByLabelText('Produto')).toHaveLength(1))
    fireEvent.change(screen.getAllByLabelText('Produto')[0], { target: { value: 'prod-1' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getAllByLabelText('Produto')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('Produto')[1], { target: { value: 'prod-2' } })
  }

  it('NÃO reescreve o preço que a pessoa digitou à mão', async () => {
    mockGetPadrao(null, [], memoriaDosDois)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await trocarCliente('cli-1', 'Mercado A')
    await duasLinhas()

    // A segunda linha (prod-2) recebeu 2,00 da memoria do cli-1; a pessoa
    // digita 9,90 por cima — dali em diante o valor e dela.
    fireEvent.change(screen.getAllByLabelText('Preço por unidade')[1], { target: { value: '9.90' } })

    await trocarCliente('cli-2', 'Mercado B')

    expect(screen.getAllByLabelText('Preço por unidade')[1]).toHaveValue(9.9)
  })

  it('atualiza o preço que a própria memória tinha preenchido', async () => {
    mockGetPadrao(null, [], memoriaDosDois)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await trocarCliente('cli-1', 'Mercado A')
    await duasLinhas()
    expect(screen.getAllByLabelText('Preço por unidade')[0]).toHaveValue(4.2)

    await trocarCliente('cli-2', 'Mercado B')

    await waitFor(() =>
      expect(screen.getAllByLabelText('Preço por unidade')[0]).toHaveValue(6))
    expect(screen.getByText('último: R$ 6,00/KG em 20/08')).toBeInTheDocument()
  })

  it('APAGA o preço automático quando o cliente novo nunca comprou aquele produto', async () => {
    mockGetPadrao(null, [], memoriaDosDois)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await trocarCliente('cli-1', 'Mercado A')
    await duasLinhas()
    expect(screen.getAllByLabelText('Preço por unidade')[1]).toHaveValue(2)

    // cli-2 nunca comprou prod-2: manter "2,00" ali seria mostrar, sob o
    // nome do Mercado B, um preco cobrado do Mercado A.
    await trocarCliente('cli-2', 'Mercado B')

    await waitFor(() =>
      expect(screen.getAllByLabelText('Preço por unidade')[1]).toHaveValue(null))
  })

  it('voltar o cliente para "Selecione…" apaga o preço automático na hora', async () => {
    // Sem cliente selecionado nao existe "ultimo preco daquele cliente": o
    // valor que a memoria escreveu deixa de ter dono, e ficar na tela seria
    // um preco sem procedencia num campo de dinheiro. A limpeza acontece no
    // proprio instante da troca, nao so quando a busca seguinte responde.
    mockGetPadrao(null, [], memoriaDosDois)
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await trocarCliente('cli-1', 'Mercado A')
    await duasLinhas()
    expect(screen.getAllByLabelText('Preço por unidade')[0]).toHaveValue(4.2)

    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: '' } })

    await waitFor(() =>
      expect(screen.getAllByLabelText('Preço por unidade')[0]).toHaveValue(null))
    expect(screen.getAllByLabelText('Preço por unidade')[1]).toHaveValue(null)
  })

  it('o que foi digitado chega intacto no corpo enviado depois da troca', async () => {
    mockGetPadrao(null, [], memoriaDosDois)
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-mem' })
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await trocarCliente('cli-1', 'Mercado A')
    await duasLinhas()
    fireEvent.change(screen.getAllByLabelText('Preço por unidade')[1], { target: { value: '9.90' } })
    await trocarCliente('cli-2', 'Mercado B')

    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0400' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { itens: { preco: number }[] }
    expect(corpo.itens[1].preco).toBe(9.9)
    // `precoAutomatico` e estado de UI, nao campo da API.
    expect(corpo.itens[0]).not.toHaveProperty('precoAutomatico')
  })

  it('edição: preços já gravados na saída não são mexidos pela memória', async () => {
    // O item gravado vale 5,00 e a memoria do cliente diz 4,20 — o valor do
    // banco e dado, nao sugestao, e continua como esta.
    mockGetPadrao(saidaExistente, [], memoriaDosDois)
    render(<ModalSaida saidaId="saida-1" onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByLabelText('Preço por unidade')
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/saidas/ultimos-precos/cli-1'))

    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(5)
  })
})

/**
 * ISOLACAO DE FALHA — se a memoria de preco nao carregar, o modal continua
 * TOTALMENTE funcional. Nunca impedir o lancamento porque um dado auxiliar
 * falhou (mesmo padrao de ClientesLista.tsx e do fetch de vendas anteriores).
 */
describe('ModalSaida — falha ao carregar a memória de preço', () => {
  it('mostra aviso discreto role="status" e mantém o formulário inteiro utilizável', async () => {
    mockGetPadrao(null, [], 'erro')
    render(<ModalSaida saidaId={null} onSalvo={() => {}} onFechar={() => {}} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mercado A' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cli-1' } })

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/últimos preços/i)

    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    // Campo vazio (nunca um preco inventado) e editavel.
    expect(screen.getByLabelText('Preço por unidade')).toHaveValue(null)
    expect(screen.getByLabelText('Preço por unidade')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toBeDisabled()
  })

  it('a venda salva normalmente com os preços digitados à mão', async () => {
    mockGetPadrao(null, [], 'erro')
    mockPost.mockResolvedValue({ ...saidaExistente, id: 'novo-falha' })
    const onSalvo = vi.fn()
    render(<ModalSaida saidaId={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mercado A' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cli-1' } })
    await screen.findByRole('status')

    fireEvent.change(screen.getByLabelText(/número do pedido/i), { target: { value: 'S-0500' } })
    fireEvent.change(screen.getByLabelText(/data do pedido/i), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    await waitFor(() => expect(screen.getByLabelText('Produto')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Produto'), { target: { value: 'prod-1' } })
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Preço por unidade'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { itens: { preco: number }[] }
    expect(corpo.itens[0].preco).toBe(7)
  })
})
