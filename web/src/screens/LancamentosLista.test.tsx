import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LancamentosLista } from './LancamentosLista'
import { api, ErroApi } from '../api/client'
import type { Lancamento } from '../derive/lancamentos'
import type { Funcionario } from '../derive/funcionarios'

// Mock so de `api.get/post/put/del` — mantem a classe ErroApi real (o
// componente e o ModalLancamento fazem `err instanceof ErroApi`, precisa
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

const CATEGORIAS = ['Frete', 'Gasolina', 'Salário', 'Adiantamento de salário', 'Outros']

const funcionario = (over: Partial<Funcionario> = {}): Funcionario => ({
  id: 'f-1', nome: 'João Pereira', cargo: 'Motorista', tel: '',
  salario: 2200, dia_pag: 5, ativo: true, ...over,
})

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l-1', data: '2026-06-08', categoria: 'Frete', descricao: 'Coleta Norte',
  valor: 1280, funcionario_id: null, ...over,
})

/** Resolve GET /api/lancamentos, /api/funcionarios e /api/lancamentos/categorias, na ordem em que a tela chama. */
function mockCarga(lancamentos: Lancamento[], funcionarios: Funcionario[] = [], categorias: string[] = CATEGORIAS) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/lancamentos') return Promise.resolve(lancamentos)
    if (rota === '/api/funcionarios') return Promise.resolve(funcionarios)
    if (rota === '/api/lancamentos/categorias') return Promise.resolve(categorias)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('LancamentosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<LancamentosLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<LancamentosLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os lançamentos.')
  })

  it('vazio: mostra "nenhum lançamento registrado" quando a API devolve lista vazia', async () => {
    mockCarga([])
    render(<LancamentosLista />)
    expect(await screen.findByText(/nenhum lançamento registrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os lancamentos recebidos', async () => {
    mockCarga([
      lancamento({ id: 'l1', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l2', descricao: 'Entregas urbanas' }),
    ])
    render(<LancamentosLista />)
    expect(await screen.findByText('Coleta Norte')).toBeInTheDocument()
    expect(screen.getByText('Entregas urbanas')).toBeInTheDocument()
  })
})

describe('LancamentosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<LancamentosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LancamentosLista — dados exibidos', () => {
  it('mostra data, categoria, valor e nome do funcionario vinculado', async () => {
    mockCarga(
      [lancamento({ categoria: 'Salário', valor: 1100, funcionario_id: 'f-1' })],
      [funcionario({ id: 'f-1', nome: 'João Pereira' })],
    )
    render(<LancamentosLista />)
    await screen.findByText('Coleta Norte')
    expect(screen.getByText('08/06/2026')).toBeInTheDocument()
    expect(screen.getByText('Salário')).toBeInTheDocument()
    expect(screen.getByText('João Pereira')).toBeInTheDocument()
    expect(screen.getByText('(R$ 1.100,00)')).toBeInTheDocument()
  })

  it('lancamento sem funcionario vinculado mostra travessao', async () => {
    mockCarga([lancamento({ funcionario_id: null })])
    render(<LancamentosLista />)
    await screen.findByText('Coleta Norte')
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('LancamentosLista — filtro por período', () => {
  it('filtra lancamentos fora do intervalo De/Até', async () => {
    mockCarga([
      lancamento({ id: 'l1', data: '2026-05-10', descricao: 'Maio' }),
      lancamento({ id: 'l2', data: '2026-06-10', descricao: 'Junho' }),
      lancamento({ id: 'l3', data: '2026-07-10', descricao: 'Julho' }),
    ])
    render(<LancamentosLista />)
    await screen.findByText('Maio')

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-06' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-06' } })

    expect(screen.queryByText('Maio')).not.toBeInTheDocument()
    expect(screen.getByText('Junho')).toBeInTheDocument()
    expect(screen.queryByText('Julho')).not.toBeInTheDocument()
  })

  it('filtro sem nenhum resultado mostra mensagem, nao a tela vazia geral', async () => {
    mockCarga([lancamento({ data: '2026-06-10' })])
    render(<LancamentosLista />)
    await screen.findByText('Coleta Norte')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-01' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-01' } })
    expect(screen.getByText(/nenhum lançamento no período selecionado/i)).toBeInTheDocument()
    expect(screen.queryByText(/nenhum lançamento registrado ainda/i)).not.toBeInTheDocument()
  })

  it('"Limpar período" volta a mostrar todos os lancamentos', async () => {
    mockCarga([
      lancamento({ id: 'l1', data: '2026-05-10', descricao: 'Maio' }),
      lancamento({ id: 'l2', data: '2026-06-10', descricao: 'Junho' }),
    ])
    render(<LancamentosLista />)
    await screen.findByText('Maio')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-06' } })
    expect(screen.queryByText('Maio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /limpar período/i }))
    expect(screen.getByText('Maio')).toBeInTheDocument()
    expect(screen.getByText('Junho')).toBeInTheDocument()
  })
})

describe('LancamentosLista — criar', () => {
  it('clicar em "Novo lançamento" abre o modal de criacao com as categorias vindas da API', async () => {
    mockCarga([])
    render(<LancamentosLista />)
    await screen.findByText(/nenhum lançamento registrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo lançamento/i }))
    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument()
    const select = screen.getByLabelText(/^categoria$/i) as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.value)).toEqual(CATEGORIAS)
  })

  it('salvar no modal acrescenta o lancamento na lista sem refetch', async () => {
    mockCarga([])
    mockPost.mockResolvedValue(lancamento({ id: 'novo', descricao: 'Recém-criado' }))
    render(<LancamentosLista />)
    await screen.findByText(/nenhum lançamento registrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo lançamento/i }))
    fireEvent.change(screen.getByLabelText(/descrição/i), { target: { value: 'Recém-criado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('Recém-criado')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledTimes(3) // so a carga inicial, nenhum refetch
  })
})

describe('LancamentosLista — editar', () => {
  it('clicar numa linha abre o modal preenchido com os dados do lancamento', async () => {
    mockCarga([lancamento({ descricao: 'Coleta Norte', categoria: 'Gasolina' })])
    render(<LancamentosLista />)
    const linha = await screen.findByText('Coleta Norte')
    fireEvent.click(linha)
    expect(screen.getByRole('dialog', { name: 'Editar lançamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toHaveValue('Coleta Norte')
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Gasolina')
  })

  it('salvar a edicao atualiza a linha na lista', async () => {
    mockCarga([lancamento({ id: 'l1', valor: 1280 })])
    mockPut.mockResolvedValue(lancamento({ id: 'l1', valor: 1500 }))
    render(<LancamentosLista />)
    const linha = await screen.findByText('Coleta Norte')
    fireEvent.click(linha)
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('(R$ 1.500,00)')).toBeInTheDocument())
  })
})

describe('LancamentosLista — excluir', () => {
  it('excluir com sucesso remove o lancamento da lista', async () => {
    mockCarga([
      lancamento({ id: 'l1', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l2', descricao: 'Entregas urbanas' }),
    ])
    mockDel.mockResolvedValue({ ok: true })
    render(<LancamentosLista />)
    fireEvent.click(await screen.findByText('Coleta Norte'))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(screen.queryByText('Coleta Norte')).not.toBeInTheDocument())
    expect(screen.getByText('Entregas urbanas')).toBeInTheDocument()
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('LancamentosLista — periodo global alimenta o De/Ate', () => {
  it('abre com o De/Ate posicionado no mes do cabecalho e filtra a lista', async () => {
    mockCarga([
      lancamento({ id: 'l-1', data: '2026-06-08', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l-2', data: '2026-05-08', descricao: 'Coleta Sul' }),
    ])
    render(<LancamentosLista periodo="2026-06" />)
    expect(await screen.findByText('Coleta Norte')).toBeInTheDocument()
    expect(screen.queryByText('Coleta Sul')).not.toBeInTheDocument()
    expect(screen.getByLabelText('De')).toHaveValue('2026-06')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-06')
  })

  it('em "all" abre sem limite e mostra os dois', async () => {
    mockCarga([
      lancamento({ id: 'l-1', data: '2026-06-08', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l-2', data: '2026-05-08', descricao: 'Coleta Sul' }),
    ])
    render(<LancamentosLista />)
    expect(await screen.findByText('Coleta Norte')).toBeInTheDocument()
    expect(screen.getByText('Coleta Sul')).toBeInTheDocument()
    expect(screen.getByLabelText('De')).toHaveValue('')
  })

  it('TROCAR o periodo no cabecalho reposiciona o De/Ate ja aberto', async () => {
    mockCarga([
      lancamento({ id: 'l-1', data: '2026-06-08', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l-2', data: '2026-05-08', descricao: 'Coleta Sul' }),
    ])
    const tela = render(<LancamentosLista periodo="2026-06" />)
    await screen.findByText('Coleta Norte')

    tela.rerender(<LancamentosLista periodo="2026-05" />)
    expect(screen.getByLabelText('De')).toHaveValue('2026-05')
    expect(screen.getByText('Coleta Sul')).toBeInTheDocument()
    expect(screen.queryByText('Coleta Norte')).not.toBeInTheDocument()
  })

  it('o De/Ate continua livre para alargar depois', async () => {
    mockCarga([
      lancamento({ id: 'l-1', data: '2026-06-08', descricao: 'Coleta Norte' }),
      lancamento({ id: 'l-2', data: '2026-05-08', descricao: 'Coleta Sul' }),
    ])
    render(<LancamentosLista periodo="2026-06" />)
    await screen.findByText('Coleta Norte')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-05' } })
    expect(screen.getByText('Coleta Sul')).toBeInTheDocument()
  })
})
