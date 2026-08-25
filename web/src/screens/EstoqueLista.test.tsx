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
  peso_medio: 0, equivalente_un: null, itens_sem_conversao: 0,
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

describe('EstoqueLista — as quantidades sao kg, a embalagem e a leitura secundaria', () => {
  it('produto em CX e em KG aparece em duas linhas separadas, cada uma com seu proprio saldo', async () => {
    mockRotas([
      linha({ produto_id: 'p-1', nome: 'Melancia', un: 'CX', entrou: 150, perda: 1, saiu: 0, saldo: 149 }),
      linha({ produto_id: 'p-1', nome: 'Melancia', un: 'KG', entrou: 20, perda: 0, saiu: 5, saldo: 15 }),
    ])
    render(<EstoqueLista />)
    expect(await screen.findAllByText('Melancia')).toHaveLength(2)
    expect(screen.getByText('CX')).toBeInTheDocument()
    expect(screen.getByText('KG')).toBeInTheDocument()
  })

  it('as quatro colunas sao rotuladas em KG — o numero principal e o quilo', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const cabecalho = container.querySelector('.estoque-linha--cabecalho') as HTMLElement
    expect(within(cabecalho).getByText('ENTROU (KG)')).toBeInTheDocument()
    expect(within(cabecalho).getByText('PERDAS (KG)')).toBeInTheDocument()
    expect(within(cabecalho).getByText('SAIU (KG)')).toBeInTheDocument()
    expect(within(cabecalho).getByText('EM ESTOQUE (KG)')).toBeInTheDocument()
    // O selo de unidade continua, dizendo em que unidade foi LANCADO.
    expect(within(cabecalho).getByText('LANÇADO EM')).toBeInTheDocument()
  })

  it('quando peso_medio > 0 e un != KG, mostra a contagem de embalagens junto do saldo (em kg)', async () => {
    mockRotas([linha({
      nome: 'Melancia', un: 'CX', entrou: 150, perda: 1, saiu: 0, saldo: 149,
      peso_medio: 15, equivalente_un: { entrou: 10, perda: 1 / 15, saiu: 0, saldo: 149 / 15 },
    })])
    render(<EstoqueLista />)
    // a coluna principal esta em kg...
    expect(await screen.findByText('149')).toBeInTheDocument()
    // ...e a leitura em caixas aparece como informacao a parte (149/15 ≈ 9,9)
    expect(screen.getByText('≈ 9,9 CX')).toBeInTheDocument()
  })

  it('linha em KG nao mostra equivalente nenhum (a unidade principal ja e a dela)', async () => {
    mockRotas([linha({ un: 'KG', saldo: 55, peso_medio: 0, equivalente_un: null })])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })
})

describe('EstoqueLista — linha incompleta (sem peso medio cadastrado)', () => {
  const incompleta = () => linha({
    nome: 'Melancia', un: 'CX', peso_medio: 0, equivalente_un: null,
    entrou: 0, perda: 2, saiu: 0, saldo: -2, itens_sem_conversao: 3,
  })

  it('marca as QUATRO quantidades com * — todas saem das mesmas embalagens', async () => {
    mockRotas([incompleta()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Melancia')
    const marcados = container.querySelectorAll('.estoque-incompleto')
    expect(marcados).toHaveLength(4)
    expect(marcados[0]).toHaveAttribute('title', expect.stringContaining('3 lançamentos'))
  })

  it('mostra a nota de rodape explicando o que ficou de fora', async () => {
    mockRotas([incompleta()])
    render(<EstoqueLista />)
    const nota = await screen.findByRole('note', { name: 'Quantidade incompleta' })
    expect(nota).toHaveTextContent(/sem peso médio cadastrado/i)
    expect(nota).toHaveTextContent(/Cadastre o peso médio da embalagem em Produtos/i)
  })

  it('saldo negativo de linha incompleta NAO vai a vermelho (seria alarme falso)', async () => {
    mockRotas([incompleta()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Melancia')
    const saldo = container.querySelector('.estoque-saldo-valor')
    expect(saldo).toHaveStyle({ color: '#6a685c' })
  })

  it('linha completa nao mostra marca nem nota', async () => {
    mockRotas([linha({ itens_sem_conversao: 0 })])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(container.querySelectorAll('.estoque-incompleto')).toHaveLength(0)
    expect(screen.queryByRole('note', { name: 'Quantidade incompleta' })).not.toBeInTheDocument()
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

// ================================= periodo global (achado S-3 da auditoria)

describe('EstoqueLista — nao segue o periodo global, e diz isso', () => {
  it('avisa que o saldo e uma posicao acumulada', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const nota = screen.getByRole('note', { name: 'Escopo do estoque' })
    expect(nota).toHaveTextContent(/não segue o filtro de período/i)
    expect(nota).toHaveTextContent(/posição acumulada/i)
  })

  it('nao aceita prop de periodo: a assinatura do componente nao tem uma', () => {
    // Se alguem acrescentar o recorte aqui sem revisar a decisao, este teste
    // continua passando — mas a nota acima passa a mentir, e o teste dela
    // cai. O par de testes e o guarda-corpo.
    expect(EstoqueLista.length).toBe(1) // so o objeto de props
  })

  it('a nota nao aparece quando nao ha nada em estoque (nao ha o que explicar)', async () => {
    mockRotas([])
    render(<EstoqueLista />)
    await screen.findByText(/nada em estoque ainda/i)
    expect(screen.queryByRole('note', { name: 'Escopo do estoque' })).not.toBeInTheDocument()
  })
})
