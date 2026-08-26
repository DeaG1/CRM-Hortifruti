import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { VeiculosLista } from './VeiculosLista'
import { api, ErroApi } from '../api/client'
import type { Veiculo } from '../derive/veiculos'
import type { Lancamento } from '../derive/lancamentos'

// Mock so de `api.get/post/put/del` — mantem a classe ErroApi real (o
// componente, o ModalVeiculo e o ModalLancamento fazem `err instanceof
// ErroApi`, precisa ser o mesmo construtor dos dois lados). Mesmo padrao de
// FuncionariosLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>

const CATEGORIAS = ['Frete', 'Gasolina', 'Manutenção dos Carros', 'Multa', 'Salário']

const veiculo = (over: Partial<Veiculo> = {}): Veiculo => ({
  id: 'v-1', placa: 'ABC-1234', modelo: 'Fiorino', marca: 'Fiat', ano: 2020,
  ativo: true, obs: '', ...over,
})

const lanc = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l-1', data: '2026-06-10', categoria: 'Gasolina', descricao: '', valor: 0,
  funcionario_id: null, veiculo_id: 'v-1', ...over,
})

/**
 * Resolve as tres rotas que a tela busca: /api/veiculos sozinha (cadastro), e
 * /api/lancamentos + /categorias no Promise.all que falha ISOLADO.
 * `lancamentos: null` faz a segunda busca rejeitar — e como se simula a falha
 * que deixa o cadastro de pe e o gasto em travessao.
 */
function mockCarga(
  veiculos: Veiculo[],
  lancamentos: Lancamento[] | null = [],
  categorias: string[] = CATEGORIAS,
) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/veiculos') return Promise.resolve(veiculos)
    if (rota === '/api/lancamentos') {
      return lancamentos === null
        ? Promise.reject(new Error('falha de rede'))
        : Promise.resolve(lancamentos)
    }
    if (rota === '/api/lancamentos/categorias') return Promise.resolve(categorias)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
})

/**
 * O botao que expande/recolhe a linha de um veiculo. Identificado pelo
 * `aria-expanded` (so o toggle tem), e nao pelo nome acessivel: os botoes de
 * acao da mesma linha ("Lançar gasolina — Fiat Fiorino") tambem carregam o
 * nome do carro, e uma busca por nome pegaria varios.
 */
function linhaDoVeiculo(nome: string): HTMLElement {
  const toggle = screen.getAllByRole('button')
    .find(b => b.hasAttribute('aria-expanded') && (b.textContent ?? '').includes(nome))
  if (!toggle) throw new Error(`linha do veiculo nao encontrada: ${nome}`)
  return toggle
}

/** Valor mostrado NA LINHA daquele veiculo — os cartoes do topo mostram os
 * mesmos numeros e uma busca global acharia os dois. */
function gastoNaLinha(nome: string): string {
  const rotulo = within(linhaDoVeiculo(nome)).getByText('GASTO NO PERÍODO')
  return rotulo.nextElementSibling?.textContent ?? ''
}

describe('VeiculosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<VeiculosLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando /api/veiculos falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<VeiculosLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os veículos.')
  })

  it('vazio: mostra "nenhum veiculo cadastrado" quando a API devolve lista vazia', async () => {
    mockCarga([])
    render(<VeiculosLista />)
    expect(await screen.findByText(/nenhum veículo cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os veiculos recebidos', async () => {
    mockCarga([
      veiculo({ id: 'v-1', placa: 'ABC-1234', marca: 'Fiat', modelo: 'Fiorino' }),
      veiculo({ id: 'v-2', placa: 'XYZ-9876', marca: 'Volkswagen', modelo: 'Kombi' }),
    ])
    render(<VeiculosLista />)
    expect(await screen.findByText('Fiat Fiorino')).toBeInTheDocument()
    expect(screen.getByText('Volkswagen Kombi')).toBeInTheDocument()
  })
})

describe('VeiculosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<VeiculosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('VeiculosLista — gasto por veiculo no periodo', () => {
  it('soma os lancamentos DAQUELE veiculo no periodo escolhido', async () => {
    mockCarga(
      [veiculo({ id: 'v-1' })],
      [
        lanc({ id: 'a', veiculo_id: 'v-1', valor: 300, data: '2026-06-02' }),
        lanc({ id: 'b', veiculo_id: 'v-1', valor: 130.5, data: '2026-06-20' }),
        lanc({ id: 'c', veiculo_id: 'v-1', valor: 999, data: '2026-05-02' }),
      ],
    )
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 430,50')
  })

  it('nao soma o lancamento de OUTRO veiculo', async () => {
    mockCarga(
      [veiculo({ id: 'v-1', marca: 'Fiat', modelo: 'Fiorino' })],
      [
        lanc({ id: 'a', veiculo_id: 'v-1', valor: 300 }),
        lanc({ id: 'b', veiculo_id: 'v-2', valor: 5000 }),
      ],
    )
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 300,00')
  })

  it('trocar o periodo troca o numero (o filtro global chega mesmo na tela)', async () => {
    const lancamentos = [
      lanc({ id: 'a', valor: 300, data: '2026-06-02' }),
      lanc({ id: 'b', valor: 700, data: '2026-07-02' }),
    ]
    mockCarga([veiculo()], lancamentos)
    const { rerender } = render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 300,00')

    mockCarga([veiculo()], lancamentos)
    rerender(<VeiculosLista periodo="2026-07" />)
    await waitFor(() => expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 700,00'))
  })

  it('os cartoes abrem o gasto da frota por categoria', async () => {
    mockCarga(
      [veiculo({ id: 'v-1' }), veiculo({ id: 'v-2', placa: 'XYZ-9876' })],
      [
        lanc({ id: 'a', veiculo_id: 'v-1', categoria: 'Gasolina', valor: 300, data: '2026-06-01' }),
        lanc({ id: 'b', veiculo_id: 'v-2', categoria: 'Multa', valor: 130, data: '2026-06-05' }),
      ],
    )
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Gasto da frota')
    expect(screen.getByText('R$ 430,00')).toBeInTheDocument() // total da frota
    expect(screen.getAllByText('R$ 300,00').length).toBeGreaterThan(0) // gasolina
    expect(screen.getAllByText('R$ 130,00').length).toBeGreaterThan(0) // multa
  })
})

describe('VeiculosLista — veiculo SEM gasto no periodo', () => {
  it('mostra R$ 0,00 (zero MEDIDO), nao travessao', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 0,00')
  })

  it('o CADASTRO nao some num periodo sem nenhum lancamento', async () => {
    mockCarga(
      [veiculo({ id: 'v-1', marca: 'Fiat', modelo: 'Fiorino' }),
       veiculo({ id: 'v-2', placa: 'XYZ-9876', marca: 'Volkswagen', modelo: 'Kombi' })],
      [lanc({ veiculo_id: 'v-1', valor: 300, data: '2026-06-02' })],
    )
    render(<VeiculosLista periodo="2026-12" />)
    // Os dois carros continuam listados, com placa e tudo — um carro nao
    // deixa de existir porque nao abasteceu em dezembro.
    expect(await screen.findByText('Fiat Fiorino')).toBeInTheDocument()
    expect(screen.getByText('Volkswagen Kombi')).toBeInTheDocument()
    expect(screen.getByText(/ABC-1234/)).toBeInTheDocument()
    expect(screen.getByText(/XYZ-9876/)).toBeInTheDocument()
  })

  it('o historico do periodo vazio diz "Nenhum lancamento no periodo", nao "indisponivel"', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    fireEvent.click(linhaDoVeiculo('Fiat Fiorino'))
    expect(screen.getByText(/Nenhum lançamento no período/)).toBeInTheDocument()
  })
})

describe('VeiculosLista — falha de carregamento dos lancamentos (isolada)', () => {
  it('o cadastro continua visivel e o gasto vira travessao com role="status"', async () => {
    mockCarga([veiculo()], null)
    render(<VeiculosLista periodo="2026-06" />)

    // O cadastro sobreviveu.
    expect(await screen.findByText('Fiat Fiorino')).toBeInTheDocument()
    expect(screen.getByText(/ABC-1234/)).toBeInTheDocument()

    // O aviso e status, nao alert: nao derruba a tela.
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('Não foi possível carregar os lançamentos')

    // Travessao, NUNCA R$ 0,00 — zero fingiria uma medicao que nao houve.
    expect(gastoNaLinha('Fiat Fiorino')).toBe('—')
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument()
  })

  it('sem lancamentos carregados, os botoes de lancar somem', async () => {
    mockCarga([veiculo()], null)
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(screen.queryByRole('button', { name: /Lançar gasolina/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lançar multa/ })).not.toBeInTheDocument()
  })

  it('sem CATEGORIAS (lista vazia) tambem nao oferece lancar — categoria nunca e fixada no front', async () => {
    mockCarga([veiculo()], [], [])
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    expect(screen.queryByRole('button', { name: /Lançar gasolina/ })).not.toBeInTheDocument()
  })

  it('401 na busca de lancamentos tambem chama onSessaoExpirada', async () => {
    mockGet.mockImplementation((rota: string) => {
      if (rota === '/api/veiculos') return Promise.resolve([veiculo()])
      return Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
    })
    const onSessaoExpirada = vi.fn()
    render(<VeiculosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })
})

describe('VeiculosLista — o botao abre o modal de lancamento QUE JA EXISTE, pre-preenchido', () => {
  it('Gasolina abre o ModalLancamento com a categoria e o veiculo escolhidos', async () => {
    mockCarga([veiculo({ id: 'v-1', marca: 'Fiat', modelo: 'Fiorino', placa: 'ABC-1234' })], [])
    render(<VeiculosLista periodo="2026-06" />)
    fireEvent.click(await screen.findByRole('button', { name: /Lançar gasolina/ }))

    // E o modal de lancamento de verdade (mesmo aria-label de LancamentosLista),
    // nao uma copia local.
    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Gasolina')
    expect(screen.getByLabelText(/^veículo$/i)).toHaveValue('v-1')
  })

  it('Manutenção e Multa pre-preenchem a categoria correspondente', async () => {
    mockCarga([veiculo({ id: 'v-1' })], [])
    render(<VeiculosLista periodo="2026-06" />)

    fireEvent.click(await screen.findByRole('button', { name: /Lançar manutenção/ }))
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Manutenção dos Carros')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    fireEvent.click(screen.getByRole('button', { name: /Lançar multa/ }))
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Multa')
  })

  it('salvar pelo modal manda veiculo_id e categoria, e o gasto da linha reage sem refetch', async () => {
    mockCarga([veiculo({ id: 'v-1' })], [])
    mockPost.mockResolvedValue(lanc({ id: 'novo', veiculo_id: 'v-1', valor: 250, data: '2026-06-14' }))
    render(<VeiculosLista periodo="2026-06" />)

    fireEvent.click(await screen.findByRole('button', { name: /Lançar gasolina/ }))
    fireEvent.change(screen.getByLabelText(/data do lançamento/i), { target: { value: '2026-06-14' } })
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/lancamentos', expect.objectContaining({
      categoria: 'Gasolina', veiculo_id: 'v-1', valor: 250,
    })))
    await waitFor(() => expect(gastoNaLinha('Fiat Fiorino')).toBe('R$ 250,00'))
  })

  it('clicar numa linha do historico abre o MESMO modal em modo edicao', async () => {
    mockCarga(
      [veiculo({ id: 'v-1' })],
      [lanc({ id: 'l-9', veiculo_id: 'v-1', valor: 480, data: '2026-06-11', categoria: 'Manutenção dos Carros', descricao: 'Troca de óleo' })],
    )
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    fireEvent.click(linhaDoVeiculo('Fiat Fiorino'))
    fireEvent.click(screen.getByText('Troca de óleo'))
    expect(screen.getByRole('dialog', { name: 'Editar lançamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^veículo$/i)).toHaveValue('v-1')
  })
})

describe('VeiculosLista — historico do veiculo', () => {
  it('a linha expandida lista os lancamentos do periodo, mais recente primeiro', async () => {
    mockCarga(
      [veiculo({ id: 'v-1' })],
      [
        lanc({ id: 'a', valor: 300, data: '2026-06-02', descricao: 'Posto da BR' }),
        lanc({ id: 'b', valor: 130, data: '2026-06-20', categoria: 'Multa', descricao: 'Radar' }),
      ],
    )
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByText('Fiat Fiorino')
    fireEvent.click(linhaDoVeiculo('Fiat Fiorino'))

    expect(screen.getByText(/2 lançamento\(s\) no período/)).toBeInTheDocument()
    const descricoes = screen.getAllByText(/Posto da BR|Radar/).map(e => e.textContent)
    expect(descricoes).toEqual(['Radar', 'Posto da BR'])
  })

  it('com os lancamentos indisponiveis, o historico diz "indisponivel" e nao "nenhum"', async () => {
    mockCarga([veiculo()], null)
    render(<VeiculosLista periodo="2026-06" />)
    await screen.findByRole('status')
    fireEvent.click(linhaDoVeiculo('Fiat Fiorino'))
    expect(screen.getByText(/HISTÓRICO — indisponível/)).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum lançamento no período/)).not.toBeInTheDocument()
  })
})

describe('VeiculosLista — o cadastro (admin-only, sem branch de papel)', () => {
  it('"Novo veiculo" esta sempre presente: a tela e admin-only', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista />)
    await screen.findByText('Fiat Fiorino')
    expect(screen.getByRole('button', { name: /novo veículo/i })).toBeInTheDocument()
  })

  it('Editar abre o ModalVeiculo do cadastro', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar — Fiat Fiorino/ }))
    expect(screen.getByRole('dialog', { name: 'Editar veículo' })).toBeInTheDocument()
  })

  it('veiculo inativo mostra selo "Inativo" e continua listado', async () => {
    mockCarga([veiculo({ ativo: false })], [])
    render(<VeiculosLista />)
    await screen.findByText('Fiat Fiorino')
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })
})

describe('VeiculosLista — o check-in/check-out saiu da tela', () => {
  it('nao ha mais Pegar, Devolver, Disponivel nem "Com fulano desde"', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista />)
    await screen.findByText('Fiat Fiorino')
    expect(screen.queryByRole('button', { name: 'Pegar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Devolver' })).not.toBeInTheDocument()
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
    expect(screen.queryByText(/Com .* desde/)).not.toBeInTheDocument()
  })

  it('a tela nao busca mais /api/funcionarios/opcoes (a rota deixou de existir)', async () => {
    mockCarga([veiculo()], [])
    render(<VeiculosLista />)
    await screen.findByText('Fiat Fiorino')
    const rotas = mockGet.mock.calls.map(c => c[0])
    expect(rotas).not.toContain('/api/funcionarios/opcoes')
  })
})
