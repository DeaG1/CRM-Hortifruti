import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FuncionariosLista } from './FuncionariosLista'
import { api, ErroApi } from '../api/client'
import type { Funcionario } from '../derive/funcionarios'

// Mock so de `api.get/post/put/del` — mantem a classe ErroApi real (o
// componente e o ModalFuncionario fazem `err instanceof ErroApi`, precisa
// ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const funcionario = (over: Partial<Funcionario> = {}): Funcionario => ({
  id: '1', nome: 'João Pereira', cargo: 'Motorista', tel: '(41) 99900-1122',
  salario: 2200, dia_pag: 5, ativo: true, ...over,
})

/** Resolve GET /api/funcionarios e /api/lancamentos, na ordem em que a tela chama. */
function mockCarga(funcionarios: Funcionario[], lancamentos: unknown[] = []) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/funcionarios') return Promise.resolve(funcionarios)
    if (rota === '/api/lancamentos') return Promise.resolve(lancamentos)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('FuncionariosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<FuncionariosLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FuncionariosLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os funcionários.')
  })

  it('vazio: mostra "nenhum funcionário cadastrado" quando a API devolve lista vazia', async () => {
    mockCarga([])
    render(<FuncionariosLista />)
    expect(await screen.findByText(/nenhum funcionário cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os funcionarios recebidos', async () => {
    mockCarga([
      funcionario({ id: '1', nome: 'João Pereira' }),
      funcionario({ id: '2', nome: 'Maria Souza' }),
    ])
    render(<FuncionariosLista />)
    expect(await screen.findByText('João Pereira')).toBeInTheDocument()
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
  })
})

describe('FuncionariosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<FuncionariosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FuncionariosLista — dados exibidos', () => {
  it('mostra cargo, salario formatado, dia de pagamento e status do proximo pagamento', async () => {
    mockCarga([funcionario({ salario: 2200, dia_pag: 5 })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('Motorista')).toBeInTheDocument()
    expect(screen.getByText('R$ 2.200,00')).toBeInTheDocument()
    expect(screen.getByText('todo dia 5')).toBeInTheDocument()
  })

  it('funcionario inativo mostra selo "Inativo"', async () => {
    mockCarga([funcionario({ ativo: false })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })

  it('funcionario ativo nao mostra selo "Inativo"', async () => {
    mockCarga([funcionario({ ativo: true })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.queryByText('Inativo')).not.toBeInTheDocument()
  })
})

describe('FuncionariosLista — criar', () => {
  it('clicar em "Novo funcionário" abre o modal de criacao', async () => {
    mockCarga([])
    render(<FuncionariosLista />)
    await screen.findByText(/nenhum funcionário cadastrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo funcionário/i }))
    expect(screen.getByRole('dialog', { name: 'Novo funcionário' })).toBeInTheDocument()
  })

  it('salvar no modal acrescenta o funcionario na lista sem refetch', async () => {
    mockCarga([])
    mockPost.mockResolvedValue(funcionario({ id: 'novo', nome: 'Recém-contratado' }))
    render(<FuncionariosLista />)
    await screen.findByText(/nenhum funcionário cadastrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo funcionário/i }))
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Recém-contratado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('Recém-contratado')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledTimes(2) // so a carga inicial, nenhum refetch
  })
})

describe('FuncionariosLista — editar', () => {
  it('clicar numa linha abre o modal preenchido com os dados do funcionario', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira', cargo: 'Motorista' })])
    render(<FuncionariosLista />)
    const linha = await screen.findByText('João Pereira')
    fireEvent.click(linha)
    expect(screen.getByRole('dialog', { name: 'Editar funcionário' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do funcionário/i)).toHaveValue('João Pereira')
    expect(screen.getByLabelText(/cargo/i)).toHaveValue('Motorista')
  })

  it('salvar a edicao atualiza a linha na lista', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira', salario: 2200 })])
    mockPut.mockResolvedValue(funcionario({ id: '1', nome: 'João Pereira', salario: 2500 }))
    render(<FuncionariosLista />)
    const linha = await screen.findByText('João Pereira')
    fireEvent.click(linha)
    fireEvent.change(screen.getByLabelText(/salário mensal/i), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('R$ 2.500,00')).toBeInTheDocument())
  })
})

describe('FuncionariosLista — excluir', () => {
  it('excluir com sucesso remove o funcionario da lista', async () => {
    mockCarga([
      funcionario({ id: '1', nome: 'João Pereira' }),
      funcionario({ id: '2', nome: 'Maria Souza' }),
    ])
    mockDel.mockResolvedValue({ ok: true })
    render(<FuncionariosLista />)
    fireEvent.click(await screen.findByText('João Pereira'))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(screen.queryByText('João Pereira')).not.toBeInTheDocument())
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
  })
})

describe('FuncionariosLista — proximo pagamento', () => {
  it('usa o ultimo lancamento de Salario do funcionario pra calcular a proxima data', async () => {
    // dia_pag 5, ultimo salario pago em 30/05 -> proxima data 05/06
    mockCarga(
      [funcionario({ id: '1', dia_pag: 5 })],
      [{ id: 'l1', data: '2026-05-30', categoria: 'Salário', funcionario_id: '1' }],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('05/06')).toBeInTheDocument()
  })

  it('ignora lancamentos de outros funcionarios ao calcular o ultimo salario pago', async () => {
    mockCarga(
      [funcionario({ id: '1', dia_pag: 5 })],
      [{ id: 'l1', data: '2026-06-20', categoria: 'Salário', funcionario_id: '2' }],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    // sem lancamento de Salario do funcionario 1: nao pode ser 20/07 (mes
    // seguinte ao lancamento do funcionario 2) — usa o ramo "nunca pago".
    expect(screen.queryByText('20/07')).not.toBeInTheDocument()
  })
})
