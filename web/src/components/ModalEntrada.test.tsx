import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ModalEntrada } from './ModalEntrada'
import { api, ErroApi } from '../api/client'
import type { EntradaComItens } from './ModalEntrada'

// Mock so de `api.get/post/put` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>

const PRODUTOS = [
  { id: 'p-alface', nome: 'Alface', un: 'UN', peso_medio: 0 },
  { id: 'p-batata', nome: 'Batata', un: 'KG', peso_medio: 0 },
  { id: 'p-tomate', nome: 'Tomate', un: 'KG', peso_medio: 0 },
]

const FORNECEDORES = [
  { id: 'f-boa-terra', nome: 'Fazenda Boa Terra', regiao: 'Sul', contato: '' },
  { id: 'f-sitio-verde', nome: 'Sítio Verde', regiao: 'Norte', contato: '' },
]

/** Mock de api.get roteado por URL — o modal chama /api/produtos,
 * /api/fornecedores e, quando ha fornecedor selecionado, /api/fornecedores/:id. */
function mockRotasPadrao() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/produtos') return Promise.resolve(PRODUTOS)
    if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
    if (url === '/api/fornecedores/f-boa-terra') {
      return Promise.resolve({ ...FORNECEDORES[0], produtos: [PRODUTOS[2]] }) // Tomate
    }
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

const entradaExistente: EntradaComItens = {
  id: 'e-1',
  numero: 'C-1040',
  fornecedor_id: 'f-boa-terra',
  data: '2026-08-10',
  perda_kg: 1.5,
  motivo: 'transporte',
  pago: 'Pendente',
  data_pag: '',
  forma_pag: 'PIX',
  obs: 'coleta atrasada',
  itens: [
    { id: 'i-1', produto_id: 'p-tomate', un: 'KG', qtd: 10, preco: 4, perda_kg: 0.5 },
  ],
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockRotasPadrao()
})

async function aguardarOpcoesCarregadas() {
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/fornecedores'))
}

describe('ModalEntrada — criação (valores padrão)', () => {
  it('titulo do dialogo indica criacao', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Nova entrada' })).toBeInTheDocument()
    await aguardarOpcoesCarregadas()
  })

  it('foca o campo numero ao abrir', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/n[uú]mero da entrada/i)).toHaveFocus()
    await aguardarOpcoesCarregadas()
  })

  it('comeca sem nenhum item — mostra a mensagem de lista vazia', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    expect(screen.getByText(/nenhum produto ainda/i)).toBeInTheDocument()
  })

  it('perda na coleta/transporte comeca vazia (nao 0), com placeholder', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    // vazio (nao '0') — abrir com 0 ja escrito faz quem digita esquecer de
    // apagar o zero e gravar "01"/"08" em vez do valor pretendido (bug real
    // reportado pelo dono do produto).
    expect(screen.getByLabelText(/perda na coleta\/transporte/i)).toHaveValue(null)
    expect(screen.getByLabelText(/perda na coleta\/transporte/i)).toHaveAttribute('placeholder', 'Ex.: 8')
  })

  it('linha de item nova comeca com qtd/preco/perda vazios, com placeholder', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    expect(screen.getByLabelText(/quantidade do item 1/i)).toHaveValue(null)
    expect(screen.getByLabelText(/quantidade do item 1/i)).toHaveAttribute('placeholder', 'Ex.: 1450')
    expect(screen.getByLabelText(/preço do item 1/i)).toHaveValue(null)
    expect(screen.getByLabelText(/preço do item 1/i)).toHaveAttribute('placeholder', 'Ex.: 3,20')
    expect(screen.getByLabelText(/perda do item 1/i)).toHaveValue(null)
    expect(screen.getByLabelText(/perda do item 1/i)).toHaveAttribute('placeholder', 'Ex.: 8')
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })
})

describe('ModalEntrada — itens: adicionar, remover, total', () => {
  it('adicionar produto cria uma linha de item', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    expect(await screen.findByLabelText(/produto do item 1/i)).toBeInTheDocument()
    expect(screen.queryByText(/nenhum produto ainda/i)).not.toBeInTheDocument()
  })

  it('adicionar duas vezes cria duas linhas; remover uma deixa so uma', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    const addBtn = screen.getByRole('button', { name: /adicionar produto/i })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)
    expect(screen.getAllByLabelText(/produto do item \d/i)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /remover item 1/i }))
    expect(screen.getAllByLabelText(/produto do item \d/i)).toHaveLength(1)
  })

  it('total (qtd × preço) recalcula conforme o usuario digita', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))

    fireEvent.change(screen.getByLabelText(/quantidade do item 1/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/preço do item 1/i), { target: { value: '10' } })

    expect(screen.getByText(/total:/i).parentElement).toHaveTextContent('R$ 30,00')

    fireEvent.change(screen.getByLabelText(/quantidade do item 1/i), { target: { value: '5' } })
    expect(screen.getByText(/total:/i).parentElement).toHaveTextContent('R$ 50,00')
  })

  it('duas linhas somam no total geral', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    const addBtn = screen.getByRole('button', { name: /adicionar produto/i })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)

    fireEvent.change(screen.getByLabelText(/quantidade do item 1/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/preço do item 1/i), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(/quantidade do item 2/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/preço do item 2/i), { target: { value: '4' } })

    // 2*5 + 1*4 = 14
    expect(screen.getByText(/total:/i).parentElement).toHaveTextContent('R$ 14,00')
  })
})

describe('ModalEntrada — bloqueio de entrada sem item', () => {
  it('sem nenhum item: mostra erro e nao chama a API', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.change(screen.getByLabelText(/n[uú]mero da entrada/i), { target: { value: 'C-9001' } })
    fireEvent.change(screen.getByLabelText(/data da coleta/i), { target: { value: '2026-08-15' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText(/adicione pelo menos um produto/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('numero vazio: mostra erro e nao chama a API', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe o número da entrada.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('item sem produto selecionado: mostra erro e nao chama a API', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.change(screen.getByLabelText(/n[uú]mero da entrada/i), { target: { value: 'C-9002' } })
    fireEvent.change(screen.getByLabelText(/data da coleta/i), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    fireEvent.change(screen.getByLabelText(/quantidade do item 1/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/preço do item 1/i), { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText(/selecione o produto/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })
})

async function preencherEntradaValida() {
  fireEvent.change(screen.getByLabelText(/n[uú]mero da entrada/i), { target: { value: 'C-2200' } })
  fireEvent.change(screen.getByLabelText(/data da coleta/i), { target: { value: '2026-08-15' } })
  fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
  fireEvent.change(screen.getByLabelText(/produto do item 1/i), { target: { value: 'p-tomate' } })
  fireEvent.change(screen.getByLabelText(/quantidade do item 1/i), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText(/preço do item 1/i), { target: { value: '4' } })
}

describe('ModalEntrada — envio', () => {
  it('campo perda_kg (cabecalho) vazio vira 0 ao enviar, sem disparar erro', async () => {
    mockPost.mockResolvedValue({ ...entradaExistente, id: 'novo-vazio' })
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()
    // nao toca no campo de perda do cabecalho — ele comeca vazio
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { perda_kg: unknown }
    expect(corpo.perda_kg).toBe(0)
    expect(typeof corpo.perda_kg).toBe('number')
    expect(screen.queryByText(/perda n[aã]o pode ser negativa/i)).not.toBeInTheDocument()
  })

  it('envia qtd/preco/perda_kg dos itens como numero, nao string', async () => {
    mockPost.mockResolvedValue({ ...entradaExistente, id: 'novo-1' })
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())

    const corpo = mockPost.mock.calls[0][1] as { itens: { qtd: unknown; preco: unknown }[] }
    expect(corpo.itens).toHaveLength(1)
    expect(corpo.itens[0].qtd).toBe(10)
    expect(corpo.itens[0].preco).toBe(4)
    expect(typeof corpo.itens[0].qtd).toBe('number')
    expect(typeof corpo.itens[0].preco).toBe('number')
  })

  it('chama onSalvo com a entrada retornada pela API ao criar com sucesso', async () => {
    const criada = { ...entradaExistente, id: 'novo-2', numero: 'C-2200' }
    mockPost.mockResolvedValue(criada)
    const onSalvo = vi.fn()
    render(<ModalEntrada entrada={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criada))
  })
})

describe('ModalEntrada — 409 (número duplicado)', () => {
  it('mostra o erro no campo numero, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe uma entrada com esse numero' }))
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByText('Já existe uma entrada com esse número.')
    expect(alerta).toBeInTheDocument()
    // o erro aparece perto do campo numero, nao como bloco generico no rodape
    expect(screen.getByLabelText(/n[uú]mero da entrada/i).closest('.modal-entrada-campo'))
      .toContainElement(alerta)
  })
})

describe('ModalEntrada — outros erros', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByText('Não foi possível salvar. Tente novamente.')
    expect(alerta).toBeInTheDocument()
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />,
    )
    await aguardarOpcoesCarregadas()
    await preencherEntradaValida()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })

  it('401 ao carregar produtos tambem chama onSessaoExpirada', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/produtos') return Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
      if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
      return Promise.reject(new Error('rota nao mockada: ' + url))
    })
    const onSessaoExpirada = vi.fn()
    render(
      <ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />,
    )
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })

  it('403 ao carregar produtos (colaborador) degrada com mensagem, nao quebra o formulario', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/produtos') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      if (url === '/api/fornecedores') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      return Promise.reject(new Error('rota nao mockada: ' + url))
    })
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel carregar a lista de produtos/i)).toBeInTheDocument()
    expect(screen.getByText(/n[aã]o foi poss[ií]vel carregar a lista de fornecedores/i)).toBeInTheDocument()
    // o resto do formulario continua utilizavel
    expect(screen.getByLabelText(/n[uú]mero da entrada/i)).toBeEnabled()
  })
})

describe('ModalEntrada — fornecedor prioriza os produtos que ele entrega', () => {
  it('ao selecionar o fornecedor, os produtos vinculados aparecem primeiro no seletor de item', async () => {
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()

    fireEvent.change(screen.getByLabelText(/fornecedor \(produtor\)/i), { target: { value: 'f-boa-terra' } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/fornecedores/f-boa-terra'))

    fireEvent.click(screen.getByRole('button', { name: /adicionar produto/i }))
    const select = screen.getByLabelText(/produto do item 1/i)
    const opcoes = within(select).getAllByRole('option').map(o => o.textContent)
    // sem priorizacao a ordem alfabetica seria Alface, Batata, Tomate — o
    // fornecedor selecionado so entrega Tomate, que deve vir primeiro.
    expect(opcoes).toEqual(['Selecione…', 'Tomate', 'Alface', 'Batata'])
  })
})

describe('ModalEntrada — edição', () => {
  it('preenche cabecalho e itens com os dados da entrada existente', async () => {
    render(<ModalEntrada entrada={entradaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()

    expect(screen.getByLabelText(/n[uú]mero da entrada/i)).toHaveValue('C-1040')
    expect(screen.getByLabelText(/data da coleta/i)).toHaveValue('2026-08-10')
    expect(screen.getByLabelText(/pagamento ao fornecedor/i)).toHaveValue('Pendente')
    expect(screen.getByLabelText(/perda na coleta\/transporte/i)).toHaveValue(1.5)

    expect(screen.getByLabelText(/produto do item 1/i)).toHaveValue('p-tomate')
    expect(screen.getByLabelText(/quantidade do item 1/i)).toHaveValue(10)
    expect(screen.getByLabelText(/preço do item 1/i)).toHaveValue(4)
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalEntrada entrada={entradaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar entrada' })).toBeInTheDocument()
  })

  it('entrada existente com perda_kg 0 no cabecalho mostra 0, nao vazio — zero gravado e intencional, diferente do vazio inicial', async () => {
    render(<ModalEntrada entrada={{ ...entradaExistente, perda_kg: 0 }} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    expect(screen.getByLabelText(/perda na coleta\/transporte/i)).toHaveValue(0)
  })

  it('usa PUT com o id da entrada ao salvar', async () => {
    mockPut.mockResolvedValue(entradaExistente)
    render(<ModalEntrada entrada={entradaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarOpcoesCarregadas()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/entradas/${entradaExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalEntrada — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/n[uú]mero da entrada/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalEntrada entrada={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
