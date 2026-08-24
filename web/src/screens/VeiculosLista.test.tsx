import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VeiculosLista } from './VeiculosLista'
import { api, ErroApi } from '../api/client'
import type { Veiculo, FuncionarioOpcao } from '../derive/veiculos'

// Mock so de `api.get/post` — mantem a classe ErroApi real (o componente e
// o ModalVeiculo fazem `err instanceof ErroApi`, precisa ser o mesmo
// construtor dos dois lados). Mesmo padrao de FuncionariosLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>

const veiculo = (over: Partial<Veiculo> = {}): Veiculo => ({
  id: '1', placa: 'ABC-1234', modelo: 'Fiorino', marca: 'Fiat', ano: 2020,
  ativo: true, obs: '', uso_aberto: null, ...over,
})

const funcionario = (over: Partial<FuncionarioOpcao> = {}): FuncionarioOpcao => ({
  id: 'f-1', nome: 'João', ...over,
})

/** Resolve GET /api/veiculos e /api/funcionarios/opcoes, na ordem em que a tela chama. */
function mockCarga(veiculos: Veiculo[], funcionarios: FuncionarioOpcao[] = []) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/veiculos') return Promise.resolve(veiculos)
    if (rota === '/api/funcionarios/opcoes') return Promise.resolve(funcionarios)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
})

describe('VeiculosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<VeiculosLista papel="admin" />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<VeiculosLista papel="admin" />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os veículos.')
  })

  it('vazio: mostra "nenhum veiculo cadastrado" quando a API devolve lista vazia', async () => {
    mockCarga([])
    render(<VeiculosLista papel="admin" />)
    expect(await screen.findByText(/nenhum veículo cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os veiculos recebidos', async () => {
    mockCarga([
      veiculo({ id: '1', placa: 'ABC-1234', modelo: 'Fiorino' }),
      veiculo({ id: '2', placa: 'XYZ-9876', modelo: 'Kombi' }),
    ])
    render(<VeiculosLista papel="admin" />)
    expect(await screen.findByText('ABC-1234')).toBeInTheDocument()
    expect(screen.getByText('XYZ-9876')).toBeInTheDocument()
  })
})

describe('VeiculosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<VeiculosLista papel="admin" onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('VeiculosLista — status de cada veiculo', () => {
  it('veiculo sem uso aberto mostra "Disponível"', async () => {
    mockCarga([veiculo({ uso_aberto: null })])
    render(<VeiculosLista papel="admin" />)
    expect(await screen.findByText('Disponível')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pegar' })).toBeInTheDocument()
  })

  it('veiculo com uso aberto recente mostra "Com {nome} desde {hora}" e botao Devolver', async () => {
    const desde = new Date(Date.now() - 2 * 3600 * 1000).toISOString() // 2h atras
    mockCarga([veiculo({
      uso_aberto: { id: 'u1', funcionario_id: 'f-1', funcionario_nome: 'João', desde },
    })])
    render(<VeiculosLista papel="admin" />)
    expect(await screen.findByText(/Com João desde \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument()
  })

  it('uso aberto ha mais de 12h ganha a classe de destaque (ambar/vermelho)', async () => {
    const desdeAntigo = new Date(Date.now() - 14 * 3600 * 1000).toISOString() // 14h atras
    mockCarga([veiculo({
      uso_aberto: { id: 'u1', funcionario_id: 'f-1', funcionario_nome: 'João', desde: desdeAntigo },
    })])
    render(<VeiculosLista papel="admin" />)
    const status = await screen.findByText(/Com João desde/)
    expect(status.className).toContain('veiculos-status--antigo')
  })

  it('uso aberto ha menos de 12h NAO ganha a classe de destaque', async () => {
    const desdeRecente = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    mockCarga([veiculo({
      uso_aberto: { id: 'u1', funcionario_id: 'f-1', funcionario_nome: 'João', desde: desdeRecente },
    })])
    render(<VeiculosLista papel="admin" />)
    const status = await screen.findByText(/Com João desde/)
    expect(status.className).not.toContain('veiculos-status--antigo')
    expect(status.className).toContain('veiculos-status--em-uso')
  })

  it('veiculo inativo mostra selo "Inativo"', async () => {
    mockCarga([veiculo({ ativo: false })])
    render(<VeiculosLista papel="admin" />)
    await screen.findByText('ABC-1234')
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })
})

describe('VeiculosLista — permissoes (admin gerencia cadastro, colaborador so pega/devolve)', () => {
  it('admin ve "Novo veículo" e pode clicar num veiculo para editar', async () => {
    mockCarga([veiculo()])
    render(<VeiculosLista papel="admin" />)
    await screen.findByText('ABC-1234')
    expect(screen.getByRole('button', { name: /novo veículo/i })).toBeInTheDocument()
    fireEvent.click(screen.getByText('ABC-1234'))
    expect(screen.getByRole('dialog', { name: 'Editar veículo' })).toBeInTheDocument()
  })

  it('colaborador NAO ve "Novo veículo" e clicar no veiculo nao abre o cadastro', async () => {
    mockCarga([veiculo()])
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    expect(screen.queryByRole('button', { name: /novo veículo/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('ABC-1234'))
    expect(screen.queryByRole('dialog', { name: 'Editar veículo' })).not.toBeInTheDocument()
  })

  it('sem papel informado, trata como colaborador (mais restritivo)', async () => {
    mockCarga([veiculo()])
    render(<VeiculosLista />)
    await screen.findByText('ABC-1234')
    expect(screen.queryByRole('button', { name: /novo veículo/i })).not.toBeInTheDocument()
  })

  it('colaborador ve os botoes Pegar/Devolver normalmente', async () => {
    mockCarga([veiculo({ uso_aberto: null })], [funcionario()])
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    expect(screen.getByRole('button', { name: 'Pegar' })).toBeInTheDocument()
  })
})

describe('VeiculosLista — pegar', () => {
  it('clicar em Pegar abre o seletor de funcionario', async () => {
    mockCarga([veiculo()], [funcionario({ id: 'f-1', nome: 'João' }), funcionario({ id: 'f-2', nome: 'Maria' })])
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    expect(screen.getByRole('dialog', { name: /Pegar ABC-1234/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'João' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Maria' })).toBeInTheDocument()
  })

  it('confirmar sem escolher funcionario mostra erro e nao chama a API', async () => {
    mockCarga([veiculo()], [funcionario()])
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha quem está pegando o carro.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('confirmar com funcionario escolhido chama POST /:id/pegar e atualiza a linha', async () => {
    mockCarga([veiculo({ id: 'v1', placa: 'ABC-1234' })], [funcionario({ id: 'f-1', nome: 'João' })])
    mockPost.mockResolvedValue({ id: 'u1', funcionario_id: 'f-1', saida_em: new Date().toISOString() })
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    fireEvent.change(screen.getByLabelText(/funcionário/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/veiculos/v1/pegar', { funcionario_id: 'f-1' }))
    expect(await screen.findByText(/Com João desde/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('409 ao pegar (concorrencia) mostra erro inline, nao fecha o dialogo', async () => {
    mockCarga([veiculo()], [funcionario({ id: 'f-1', nome: 'João' })])
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'este veiculo ja esta em uso' }))
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    fireEvent.change(screen.getByLabelText(/funcionário/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Este veículo acabou de ser pego por outra pessoa.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancelar o dialogo de pegar fecha sem chamar a API', async () => {
    mockCarga([veiculo()], [funcionario()])
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('401 ao pegar chama onSessaoExpirada', async () => {
    mockCarga([veiculo()], [funcionario({ id: 'f-1' })])
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<VeiculosLista papel="colaborador" onSessaoExpirada={onSessaoExpirada} />)
    await screen.findByText('ABC-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Pegar' }))
    fireEvent.change(screen.getByLabelText(/funcionário/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

describe('VeiculosLista — devolver', () => {
  it('clicar em Devolver chama POST /:id/devolver e a linha volta a "Disponível"', async () => {
    const desde = new Date().toISOString()
    mockCarga([veiculo({
      id: 'v1', uso_aberto: { id: 'u1', funcionario_id: 'f-1', funcionario_nome: 'João', desde },
    })])
    mockPost.mockResolvedValue({ id: 'u1', volta_em: new Date().toISOString() })
    render(<VeiculosLista papel="colaborador" />)
    await screen.findByText(/Com João desde/)
    fireEvent.click(screen.getByRole('button', { name: 'Devolver' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/veiculos/v1/devolver'))
    expect(await screen.findByText('Disponível')).toBeInTheDocument()
  })

  it('401 ao devolver chama onSessaoExpirada', async () => {
    const desde = new Date().toISOString()
    mockCarga([veiculo({
      uso_aberto: { id: 'u1', funcionario_id: 'f-1', funcionario_nome: 'João', desde },
    })])
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<VeiculosLista papel="colaborador" onSessaoExpirada={onSessaoExpirada} />)
    await screen.findByText(/Com João desde/)
    fireEvent.click(screen.getByRole('button', { name: 'Devolver' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})
