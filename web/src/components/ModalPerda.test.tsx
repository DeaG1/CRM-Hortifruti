import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalPerda } from './ModalPerda'
import { api, ErroApi } from '../api/client'
import type { Perda } from './ModalPerda'

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
  { id: 'p-tomate', nome: 'Tomate', un: 'KG', peso_medio: 0 },
]

const perdaExistente: Perda = {
  id: 'pe-1',
  data: '2026-08-12',
  produto_id: 'p-tomate',
  un: 'KG',
  qtd: 3.2,
  motivo: 'vencimento',
  obs: 'caixa vencida',
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockGet.mockResolvedValue(PRODUTOS)
})

async function aguardarProdutos() {
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/produtos'))
}

describe('ModalPerda — criação (valores padrão)', () => {
  it('titulo do dialogo indica criacao', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Nova perda' })).toBeInTheDocument()
    await aguardarProdutos()
  })

  it('foca o campo data ao abrir', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/data da perda/i)).toHaveFocus()
    await aguardarProdutos()
  })

  it('motivo comeca como "nao informado", igual ao default do banco', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('não informado')
  })

  it('quantidade perdida comeca vazia (nao 0), com placeholder', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    expect(screen.getByLabelText(/quantidade perdida/i)).toHaveValue(null)
    expect(screen.getByLabelText(/quantidade perdida/i)).toHaveAttribute('placeholder', 'Ex.: 8')
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })
})

describe('ModalPerda — validação', () => {
  it('data vazia: mostra erro e nao chama a API', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe a data.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('sem produto selecionado: mostra erro e nao chama a API', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Selecione o produto.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('quantidade vazia: mostra erro e nao chama a API', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText(/informe uma quantidade v[aá]lida/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('quantidade negativa: mostra erro e nao chama a API', async () => {
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.change(screen.getByLabelText(/quantidade perdida/i), { target: { value: '-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText(/informe uma quantidade v[aá]lida/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalPerda — envio', () => {
  it('envia qtd como numero, nao string', async () => {
    mockPost.mockResolvedValue({ ...perdaExistente, id: 'novo-1' })
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.change(screen.getByLabelText(/quantidade perdida/i), { target: { value: '4.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { qtd: unknown }
    expect(corpo.qtd).toBe(4.5)
    expect(typeof corpo.qtd).toBe('number')
  })

  it('selecionar produto sugere a unidade cadastrada nele', async () => {
    mockPost.mockResolvedValue({ ...perdaExistente, id: 'novo-2' })
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-alface' } })
    expect(screen.getByLabelText(/^unidade$/i)).toHaveValue('UN')
  })

  it('chama onSalvo com a perda retornada pela API ao criar com sucesso', async () => {
    const criada = { ...perdaExistente, id: 'novo-3' }
    mockPost.mockResolvedValue(criada)
    const onSalvo = vi.fn()
    render(<ModalPerda perda={null} onSalvo={onSalvo} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.change(screen.getByLabelText(/quantidade perdida/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criada))
  })
})

describe('ModalPerda — outros erros', () => {
  it('erro != 401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.change(screen.getByLabelText(/quantidade perdida/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument()
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />,
    )
    await aguardarProdutos()
    fireEvent.change(screen.getByLabelText(/data da perda/i), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText(/^produto$/i), { target: { value: 'p-tomate' } })
    fireEvent.change(screen.getByLabelText(/quantidade perdida/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })

  it('403 ao carregar produtos (colaborador) degrada com mensagem, nao quebra o formulario', async () => {
    mockGet.mockRejectedValue(new ErroApi(403, { erro: 'sem permissao' }))
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel carregar a lista de produtos/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/data da perda/i)).toBeEnabled()
  })
})

describe('ModalPerda — edição', () => {
  it('preenche os campos com os dados da perda existente', async () => {
    render(<ModalPerda perda={perdaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    expect(screen.getByLabelText(/data da perda/i)).toHaveValue('2026-08-12')
    expect(screen.getByLabelText(/^produto$/i)).toHaveValue('p-tomate')
    expect(screen.getByLabelText(/quantidade perdida/i)).toHaveValue(3.2)
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('vencimento')
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalPerda perda={perdaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar perda' })).toBeInTheDocument()
  })

  it('usa PUT com o id da perda ao salvar', async () => {
    mockPut.mockResolvedValue(perdaExistente)
    render(<ModalPerda perda={perdaExistente} onSalvo={() => {}} onFechar={() => {}} />)
    await aguardarProdutos()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/perdas/${perdaExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalPerda — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/data da perda/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalPerda perda={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
