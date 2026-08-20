import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalCliente } from './ModalCliente'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.post/put` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>

const clienteExistente: Cliente = {
  id: 'abc-1',
  nome: 'Mercado Bom Preço',
  resp: 'Sonia',
  cnpj: '11.111.111/0001-11',
  tel: '(41) 99999-0000',
  email: 'contato@bp.com',
  endereco: 'Rua X, 100',
  rota: 'Leste B',
  freq: 'Diária',
  status: 'inadimplente',
  cobranca: 'Atrasado',
  forma: 'Boleto',
  limite: 500,
  prazo: 30,
  tend: '↓',
  obs: 'Cliente antigo',
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
})

describe('ModalCliente — criação (valores padrão)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/regi[aã]o.*rota/i)).toHaveValue('Sul A')
    expect(screen.getByLabelText(/frequ[eê]ncia/i)).toHaveValue('2×/sem · Seg e Qui')
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('ativo')
    expect(screen.getByLabelText(/forma de pagamento/i)).toHaveValue('PIX')
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveValue(0)
    expect(screen.getByLabelText(/prazo de pagamento/i)).toHaveValue(14)
    expect(screen.getByLabelText(/tend[eê]ncia/i)).toHaveValue('→')
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveValue('')
  })

  it('foca o campo nome ao abrir', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
  })
})

describe('ModalCliente — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('nome so com espacos: mesma validacao', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    // getByRole('dialog') e a propria div do overlay (ver componente); o
    // <form> e seu unico filho direto — buscamos por tag porque `form` nao
    // tem role/nome acessivel proprio quando ja esta dentro de um dialog.
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo nome mantem required (semantica de acessibilidade, aria-required)', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toBeRequired()
  })
})

describe('ModalCliente — validação de limite/prazo não-negativos', () => {
  it('limite negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '-500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Limite não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('prazo negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Y' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Prazo não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('limite e prazo negativos ao mesmo tempo: mostra os dois erros', () => {
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Z' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Limite não pode ser negativo.')).toBeInTheDocument()
    expect(screen.getByText('Prazo não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('valores validos (inclusive zero) nao disparam erro nenhum', async () => {
    mockPost.mockResolvedValue({ ...clienteExistente, id: 'ok-1', nome: 'Mercado Ok', limite: 0, prazo: 0 })
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/n[aã]o pode ser negativo/i)).not.toBeInTheDocument()
  })
})

describe('ModalCliente — envio', () => {
  it('envia limite e prazo como numero, nao string', async () => {
    mockPost.mockResolvedValue({ ...clienteExistente, id: 'novo-1', nome: 'Mercado Teste' })
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Teste' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { limite: unknown; prazo: unknown }
    expect(corpo.limite).toBe(1500)
    expect(corpo.prazo).toBe(7)
    expect(typeof corpo.limite).toBe('number')
    expect(typeof corpo.prazo).toBe('number')
  })

  it('chama onSalvo com o cliente retornado pela API ao criar com sucesso', async () => {
    const criado = { ...clienteExistente, id: 'novo-2', nome: 'Mercado Z' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    render(<ModalCliente cliente={null} onSalvo={onSalvo} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })
})

describe('ModalCliente — 409 (nome duplicado)', () => {
  it('mostra o erro no campo nome, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe um cliente com esse nome' }))
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Repetido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Já existe um cliente com esse nome.')
    // so um alerta na tela — nao aparece tambem a mensagem generica
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('ModalCliente — outros erros', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalCliente cliente={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />,
    )
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalCliente — edição', () => {
  it('preenche os campos com os dados do cliente existente', () => {
    render(<ModalCliente cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveValue('Mercado Bom Preço')
    expect(screen.getByLabelText(/respons[aá]vel/i)).toHaveValue('Sonia')
    expect(screen.getByLabelText(/cnpj/i)).toHaveValue('11.111.111/0001-11')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('(41) 99999-0000')
    expect(screen.getByLabelText(/e-mail/i)).toHaveValue('contato@bp.com')
    expect(screen.getByLabelText(/endere[cç]o/i)).toHaveValue('Rua X, 100')
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveValue(500)
    expect(screen.getByLabelText(/prazo de pagamento/i)).toHaveValue(30)
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('inadimplente')
    expect(screen.getByLabelText(/observa[cç][oõ]es/i)).toHaveValue('Cliente antigo')
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalCliente cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
  })

  it('usa PUT com o id do cliente ao salvar', async () => {
    mockPut.mockResolvedValue(clienteExistente)
    render(<ModalCliente cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/clientes/${clienteExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalCliente — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/nome do estabelecimento/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
