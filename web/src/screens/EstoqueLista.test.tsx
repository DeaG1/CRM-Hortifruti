import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { EstoqueLista } from './EstoqueLista'
import { api, ErroApi } from '../api/client'

// Mock so de `api.get/del` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
// `del` tambem e mockado porque EstoqueLista compoe <PerdasLista>, que usa
// api.del (nao exercido nestes testes, mas nao pode bater na rede real).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const linha = (over: Record<string, unknown> = {}) => ({
  produto_id: 'p-1', nome: 'Tomate', un: 'KG',
  entrou: 100, perda: 15, saiu: 30, saldo: 55,
  peso_medio: 0, equivalente_kg: null,
  ...over,
})

/**
 * EstoqueLista compoe <PerdasLista>, que faz suas proprias chamadas a
 * /api/perdas e /api/produtos. Por padrao aqui elas resolvem vazias, para
 * nao interferir nos testes que so cobrem o comportamento de /api/estoque.
 */
function mockRotas(estoque: unknown[] | Promise<unknown> = [], perdas: unknown[] = [], produtos: unknown[] = []) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/estoque') return estoque instanceof Promise ? estoque : Promise.resolve(estoque)
    if (url === '/api/perdas') return Promise.resolve(perdas)
    if (url === '/api/produtos') return Promise.resolve(produtos)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

/** Escopa a busca na secao de saldo (o topo da tela), separada da secao de
 * perdas do deposito (<PerdasLista>, composta logo abaixo) — as duas tem
 * seus proprios estados de carregamento/erro, com o mesmo texto generico. */
function secaoSaldo(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.estoque-saldo-secao')
  if (!el) throw new Error('secao .estoque-saldo-secao nao encontrada')
  return el as HTMLElement
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('EstoqueLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada a /api/estoque esta pendente', () => {
    mockRotas(new Promise(() => {})) // nunca resolve
    const { container } = render(<EstoqueLista />)
    expect(within(secaoSaldo(container)).getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/estoque' ? Promise.reject(new Error('falha de rede')) : Promise.resolve([]),
    )
    render(<EstoqueLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar o estoque.')
  })

  it('vazio: mostra "nada em estoque ainda" quando a API devolve lista vazia', async () => {
    mockRotas([])
    render(<EstoqueLista />)
    expect(await screen.findByText(/nada em estoque ainda/i)).toBeInTheDocument()
  })

  it('com dados: lista as linhas de estoque recebidas', async () => {
    mockRotas([linha({ produto_id: 'p-1', nome: 'Tomate' }), linha({ produto_id: 'p-2', nome: 'Alface' })])
    render(<EstoqueLista />)
    expect(await screen.findByText('Tomate')).toBeInTheDocument()
    expect(screen.getByText('Alface')).toBeInTheDocument()
  })
})

describe('EstoqueLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/estoque'
        ? Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
        : Promise.resolve([]),
    )
    const onSessaoExpirada = vi.fn()
    render(<EstoqueLista onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('EstoqueLista — saldo = entradas - perdas - saidas', () => {
  it('exibe entrou, perdas, saiu e saldo com os valores recebidos da API (o calculo e feito no backend)', async () => {
    mockRotas([linha({ entrou: 100, perda: 15, saiu: 30, saldo: 55 })])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('55')).toBeInTheDocument()
  })

  it('saldo negativo aparece em vermelho — o alerta que importa nesta tela', async () => {
    mockRotas([linha({ saldo: -15 })])
    render(<EstoqueLista />)
    const saldo = await screen.findByText('-15')
    expect(saldo).toHaveStyle({ color: '#c2502f' })
  })

  it('saldo positivo usa a cor de texto padrao (nao e alerta)', async () => {
    mockRotas([linha({ saldo: 55 })])
    render(<EstoqueLista />)
    const saldo = await screen.findByText('55')
    expect(saldo).toHaveStyle({ color: '#2a2a24' })
  })

  it('saldo zero usa a cor neutra (sem estoque, mas nao e alerta)', async () => {
    mockRotas([linha({ entrou: 10, perda: 0, saiu: 10, saldo: 0 })])
    render(<EstoqueLista />)
    const saldos = await screen.findAllByText('0')
    // duas colunas podem estar zeradas (perda e saldo) — a do saldo e a que tem a classe estoque-saldo-valor
    const saldoCel = saldos.find(el => el.className.includes('estoque-saldo-valor'))
    expect(saldoCel).toHaveStyle({ color: '#6a685c' })
  })
})

describe('EstoqueLista — CX/KG nao se misturam (peso_medio converte pra kg)', () => {
  it('produto em CX e em KG aparece em duas linhas separadas, cada uma com seu proprio saldo', async () => {
    mockRotas([
      linha({ produto_id: 'p-1', nome: 'Melancia', un: 'CX', entrou: 10, perda: 1, saiu: 0, saldo: 9 }),
      linha({ produto_id: 'p-1', nome: 'Melancia', un: 'KG', entrou: 20, perda: 0, saiu: 5, saldo: 15 }),
    ])
    render(<EstoqueLista />)
    expect(await screen.findAllByText('Melancia')).toHaveLength(2)
    expect(screen.getByText('CX')).toBeInTheDocument()
    expect(screen.getByText('KG')).toBeInTheDocument()
  })

  it('quando peso_medio > 0 e un != KG, mostra o equivalente em kg junto do saldo (sem substituir a coluna original)', async () => {
    mockRotas([linha({
      nome: 'Melancia', un: 'CX', entrou: 10, perda: 1, saiu: 0, saldo: 9,
      peso_medio: 15, equivalente_kg: { entrou: 150, perda: 15, saiu: 0, saldo: 135 },
    })])
    render(<EstoqueLista />)
    // coluna original continua em CX...
    expect(await screen.findByText('9')).toBeInTheDocument()
    // ...e o equivalente em kg aparece como informacao a parte, nao substitui
    expect(screen.getByText('≈ 135 kg')).toBeInTheDocument()
  })

  it('sem peso_medio (KG puro) nao mostra nenhum equivalente', async () => {
    mockRotas([linha({ un: 'KG', saldo: 55, peso_medio: 0, equivalente_kg: null })])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })
})

describe('EstoqueLista — compoe a secao de perdas do deposito', () => {
  it('renderiza PerdasLista abaixo do saldo, com seus proprios dados', async () => {
    mockRotas(
      [linha()],
      [{ id: 'pe-1', data: '2026-08-12', produto_id: 'p-1', un: 'KG', qtd: 3.2, motivo: 'vencimento', obs: '' }],
      [{ id: 'p-1', nome: 'Tomate', un: 'KG', peso_medio: 0 }],
    )
    render(<EstoqueLista />)
    // "Tomate" aparece duas vezes: na linha de saldo e na linha de perda —
    // prova de que as duas secoes carregaram, cada uma com seus proprios dados.
    expect(await screen.findAllByText('Tomate')).toHaveLength(2)
    expect(screen.getByText('2026-08-12')).toBeInTheDocument() // linha da perda de deposito
  })

  it('estoque vazio nao impede a secao de perdas de aparecer', async () => {
    mockRotas([], [])
    render(<EstoqueLista />)
    expect(await screen.findByText(/nada em estoque ainda/i)).toBeInTheDocument()
    expect(await screen.findByText(/nenhuma perda registrada/i)).toBeInTheDocument()
  })
})
