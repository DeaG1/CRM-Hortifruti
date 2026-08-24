import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalVeiculo } from './ModalVeiculo'
import { api, ErroApi } from '../api/client'
import type { Veiculo } from '../derive/veiculos'

// Mock so de `api.post/put/del` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const veiculoExistente: Veiculo = {
  id: 'v-1',
  placa: 'ABC-1234',
  modelo: 'Fiorino',
  marca: 'Fiat',
  ano: 2020,
  ativo: true,
  obs: 'Chave reserva com o admin',
  uso_aberto: null,
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ModalVeiculo — criação (valores padrao)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/placa/i)).toHaveValue('')
    expect(screen.getByLabelText(/marca/i)).toHaveValue('')
    expect(screen.getByLabelText(/modelo/i)).toHaveValue('')
    expect(screen.getByLabelText(/ano/i)).toHaveValue(null)
    expect(screen.getByLabelText(/veículo ativo/i)).toBeChecked()
  })

  it('foca o campo placa ao abrir', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/placa/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo veículo' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalVeiculo — validação de placa', () => {
  it('placa vazia: mostra erro e nao chama a API', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a placa.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('placa so espacos: mesmo erro', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a placa.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })
})

describe('ModalVeiculo — validação de ano', () => {
  it('ano fracionario: mostra erro inline, nao chama a API', () => {
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'XYZ-0001' } })
    fireEvent.change(screen.getByLabelText(/ano/i), { target: { value: '2020.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Ano deve ser um número inteiro.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('ano vazio e valido (envia null, nao dispara erro)', async () => {
    mockPost.mockResolvedValue({ ...veiculoExistente, id: 'novo', ano: null })
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'SEM-0001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { ano: unknown }
    expect(corpo.ano).toBeNull()
  })
})

describe('ModalVeiculo — envio', () => {
  it('envia ano como numero e ativo como booleano', async () => {
    mockPost.mockResolvedValue({ ...veiculoExistente, id: 'novo-1' })
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'nov-0001' } })
    fireEvent.change(screen.getByLabelText(/ano/i), { target: { value: '2019' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { placa: unknown; ano: unknown; ativo: unknown }
    expect(corpo.placa).toBe('nov-0001')
    expect(corpo.ano).toBe(2019)
    expect(typeof corpo.ano).toBe('number')
    expect(corpo.ativo).toBe(true)
    expect(typeof corpo.ativo).toBe('boolean')
  })

  it('desmarcar "ativo" envia ativo:false', async () => {
    mockPost.mockResolvedValue({ ...veiculoExistente, id: 'novo-2', ativo: false })
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'INA-0001' } })
    fireEvent.click(screen.getByLabelText(/veículo ativo/i))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { ativo: unknown }
    expect(corpo.ativo).toBe(false)
  })

  it('chama onSalvo com o veiculo retornado pela API ao criar com sucesso', async () => {
    const criado = { ...veiculoExistente, id: 'novo-3', placa: 'CRI-0001' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    render(<ModalVeiculo veiculo={null} onSalvo={onSalvo} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'CRI-0001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })
})

describe('ModalVeiculo — erros ao salvar', () => {
  it('409 (placa duplicada) mostra erro especifico no campo placa', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe um veiculo com essa placa' }))
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'DUP-0001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Já existe um veículo com essa placa.')).toBeInTheDocument()
  })

  it('erro generico mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'ERR-0001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalVeiculo
        veiculo={null}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.change(screen.getByLabelText(/placa/i), { target: { value: 'SES-0001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalVeiculo — edição', () => {
  it('preenche os campos com os dados do veiculo existente', () => {
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    expect(screen.getByLabelText(/placa/i)).toHaveValue('ABC-1234')
    expect(screen.getByLabelText(/marca/i)).toHaveValue('Fiat')
    expect(screen.getByLabelText(/modelo/i)).toHaveValue('Fiorino')
    expect(screen.getByLabelText(/ano/i)).toHaveValue(2020)
    expect(screen.getByLabelText(/veículo ativo/i)).toBeChecked()
  })

  it('titulo do dialogo indica edicao', () => {
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    expect(screen.getByRole('dialog', { name: 'Editar veículo' })).toBeInTheDocument()
  })

  it('usa PUT com o id do veiculo ao salvar', async () => {
    mockPut.mockResolvedValue(veiculoExistente)
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/veiculos/${veiculoExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalVeiculo — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />,
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
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith(`/api/veiculos/${veiculoExistente.id}`))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledWith(veiculoExistente.id))
  })

  it('400 (uso registrado, FK restrict) mostra mensagem especifica e nao chama onExcluido', async () => {
    mockDel.mockRejectedValue(new ErroApi(400, { erro: 'veiculo nao encontrado' }))
    const onExcluido = vi.fn()
    render(
      <ModalVeiculo veiculo={veiculoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(/desative-o em vez de excluir/i)).toBeInTheDocument()
    expect(onExcluido).not.toHaveBeenCalled()
  })

  it('401 na exclusao chama onSessaoExpirada', async () => {
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalVeiculo
        veiculo={veiculoExistente}
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

describe('ModalVeiculo — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/placa/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalVeiculo veiculo={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
