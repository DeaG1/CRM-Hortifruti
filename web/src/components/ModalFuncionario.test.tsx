import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalFuncionario } from './ModalFuncionario'
import { api, ErroApi } from '../api/client'
import type { Funcionario } from '../derive/funcionarios'

// Mock so de `api.post/put/del` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const funcionarioExistente: Funcionario = {
  id: 'f-1',
  nome: 'João Pereira',
  cargo: 'Motorista',
  tel: '(41) 99900-1122',
  salario: 2200,
  dia_pag: 5,
  ativo: true,
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ModalFuncionario — criação (valores padrão)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do funcionário/i)).toHaveValue('')
    expect(screen.getByLabelText(/cargo/i)).toHaveValue('')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('')
    // salario comeca vazio (nao 0) — mesma razao do limite em
    // ModalCliente.test.tsx: abrir com 0 escrito faz quem digita esquecer
    // de apagar o zero e gravar "01"/"02200" por engano.
    expect(screen.getByLabelText(/salário mensal/i)).toHaveValue(null)
    expect(screen.getByLabelText(/salário mensal/i)).toHaveAttribute('placeholder', 'Ex.: 2200')
    // dia_pag mantem o default 5 — e um <select>, nao sofre do problema do
    // zero pre-escrito, e o default e uma sugestao util.
    expect(screen.getByLabelText(/dia do pagamento/i)).toHaveValue('5')
    expect(screen.getByLabelText(/funcionário ativo/i)).toBeChecked()
  })

  it('foca o campo nome ao abrir', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do funcionário/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo funcionário' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalFuncionario — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo nome mantem required (semantica de acessibilidade, aria-required)', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do funcionário/i)).toBeRequired()
  })
})

describe('ModalFuncionario — validação de salário não-negativo', () => {
  it('salario negativo: mostra erro inline, nao chama a API', () => {
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Novo Funcionário' } })
    fireEvent.change(screen.getByLabelText(/salário mensal/i), { target: { value: '-100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Salário não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('salario zero e valido (nao dispara erro)', async () => {
    mockPost.mockResolvedValue({ ...funcionarioExistente, id: 'novo', salario: 0 })
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Estagiário' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/não pode ser negativo/i)).not.toBeInTheDocument()
  })

  it('campo salario vazio vira 0 ao enviar', async () => {
    mockPost.mockResolvedValue({ ...funcionarioExistente, id: 'novo-vazio', salario: 0 })
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Sem Salário Digitado' } })
    // nao toca no campo salario — ele comeca vazio
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { salario: unknown }
    expect(corpo.salario).toBe(0)
    expect(typeof corpo.salario).toBe('number')
  })
})

describe('ModalFuncionario — envio', () => {
  it('envia salario e dia_pag como numero, e ativo como booleano', async () => {
    mockPost.mockResolvedValue({ ...funcionarioExistente, id: 'novo-1', nome: 'Novo Funcionário' })
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Novo Funcionário' } })
    fireEvent.change(screen.getByLabelText(/salário mensal/i), { target: { value: '1800' } })
    fireEvent.change(screen.getByLabelText(/dia do pagamento/i), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { salario: unknown; dia_pag: unknown; ativo: unknown }
    expect(corpo.salario).toBe(1800)
    expect(typeof corpo.salario).toBe('number')
    expect(corpo.dia_pag).toBe(10)
    expect(typeof corpo.dia_pag).toBe('number')
    expect(corpo.ativo).toBe(true)
    expect(typeof corpo.ativo).toBe('boolean')
  })

  it('desmarcar "ativo" envia ativo:false', async () => {
    mockPost.mockResolvedValue({ ...funcionarioExistente, id: 'novo-2', ativo: false })
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Inativo' } })
    fireEvent.click(screen.getByLabelText(/funcionário ativo/i))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { ativo: unknown }
    expect(corpo.ativo).toBe(false)
  })

  it('chama onSalvo com o funcionario retornado pela API ao criar com sucesso', async () => {
    const criado = { ...funcionarioExistente, id: 'novo-3', nome: 'Criado' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    render(<ModalFuncionario funcionario={null} onSalvo={onSalvo} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Criado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })
})

describe('ModalFuncionario — erros ao salvar', () => {
  it('erro generico mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalFuncionario
        funcionario={null}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalFuncionario — edição', () => {
  it('preenche os campos com os dados do funcionario existente', () => {
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    expect(screen.getByLabelText(/nome do funcionário/i)).toHaveValue('João Pereira')
    expect(screen.getByLabelText(/cargo/i)).toHaveValue('Motorista')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('(41) 99900-1122')
    expect(screen.getByLabelText(/salário mensal/i)).toHaveValue(2200)
    expect(screen.getByLabelText(/dia do pagamento/i)).toHaveValue('5')
    expect(screen.getByLabelText(/funcionário ativo/i)).toBeChecked()
  })

  it('titulo do dialogo indica edicao', () => {
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    expect(screen.getByRole('dialog', { name: 'Editar funcionário' })).toBeInTheDocument()
  })

  it('funcionario existente com salario 0 mostra 0, nao vazio — zero gravado e intencional, diferente do vazio inicial', () => {
    render(
      <ModalFuncionario
        funcionario={{ ...funcionarioExistente, salario: 0 }}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByLabelText(/salário mensal/i)).toHaveValue(0)
  })

  it('usa PUT com o id do funcionario ao salvar', async () => {
    mockPut.mockResolvedValue(funcionarioExistente)
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/funcionarios/${funcionarioExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalFuncionario — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onExcluido', async () => {
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith(`/api/funcionarios/${funcionarioExistente.id}`))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledWith(funcionarioExistente.id))
  })

  it('falha na exclusao mostra alerta e nao chama onExcluido', async () => {
    mockDel.mockRejectedValue(new Error('falha'))
    const onExcluido = vi.fn()
    render(
      <ModalFuncionario funcionario={funcionarioExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
    expect(onExcluido).not.toHaveBeenCalled()
  })

  it('401 na exclusao chama onSessaoExpirada', async () => {
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalFuncionario
        funcionario={funcionarioExistente}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

describe('ModalFuncionario — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/nome do funcionário/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalFuncionario funcionario={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
