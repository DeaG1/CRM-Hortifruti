import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ClientesLista } from './ClientesLista'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.get` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14, ...over,
})

/** Uma linha crua de GET /api/saidas — so os campos que ClientesLista usa
 * (ver `SaidaBruta`/`paraPedidos` em ClientesLista.tsx). */
const saida = (over: Record<string, unknown> = {}) => ({
  id: 's1', cliente_id: '1', entrega: '2026-06-10', valor: 1000,
  status: 'Entregue', pag: 'Pago', venc: null, ...over,
})

function comoPromise(v: unknown): Promise<unknown> {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

/** Roteia `api.get` pelas duas chamadas que ClientesLista faz (GET
 * /api/clientes e GET /api/saidas), cada uma com sua propria resposta —
 * `mockResolvedValue` sozinho nao da pra isso porque as duas chamadas
 * compartilham o mesmo mock. `saidasResp` default `[]` cobre os testes que
 * nao se importam com vendas. */
function mockRotas(clientesResp: unknown, saidasResp: unknown = []) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/clientes') return comoPromise(clientesResp)
    if (url === '/api/saidas') return comoPromise(saidasResp)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

function botaoFiltro(rotulo: string) {
  return screen.getByRole('button', { name: new RegExp('^' + rotulo) })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('ClientesLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockRotas(new Promise(() => {})) // nunca resolve nesta suite
    render(<ClientesLista onAbrir={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockRotas(new Error('falha de rede'))
    render(<ClientesLista onAbrir={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os clientes.')
  })

  it('vazio: mostra "nenhum cliente cadastrado" quando a API devolve lista vazia', async () => {
    mockRotas([])
    render(<ClientesLista onAbrir={() => {}} />)
    expect(await screen.findByText(/nenhum cliente cadastrado/i)).toBeInTheDocument()
    // Termo generico ("cliente"), nao o do primeiro tenant (hortifruti).
    expect(screen.getByText(/cadastre os clientes que você atende/i)).toBeInTheDocument()
  })

  it('com dados: lista os clientes recebidos', async () => {
    mockRotas([
      cliente({ id: '1', nome: 'Mercado A' }),
      cliente({ id: '2', nome: 'Mercado B' }),
    ])
    render(<ClientesLista onAbrir={() => {}} />)
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Mercado B')).toBeInTheDocument()
  })
})

describe('ClientesLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    // /api/clientes e /api/saidas sao buscados em paralelo (efeitos
    // independentes) — os dois podem devolver 401, entao a asserção e
    // toHaveBeenCalled (nao ...Once), mesmo padrao de RelatoriosTela.test.tsx
    // e SaidasLista.test.tsx pra telas com mais de uma chamada paralela.
    mockRotas(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClientesLista onAbrir={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ClientesLista — filtro por status', () => {
  const trio = () => [
    cliente({ id: '1', nome: 'Mercado A', status: 'ativo' }),
    cliente({ id: '2', nome: 'Mercado B', status: 'ativo' }),
    cliente({ id: '3', nome: 'Mercado C', status: 'inadimplente' }),
  ]

  it('conta cada status corretamente, inclusive os que nao aparecem na lista', async () => {
    mockRotas(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    expect(within(botaoFiltro('Todos')).getByText('3')).toBeInTheDocument()
    expect(within(botaoFiltro('Ativo')).getByText('2')).toBeInTheDocument()
    expect(within(botaoFiltro('Inadimplente')).getByText('1')).toBeInTheDocument()
    expect(within(botaoFiltro('Em negociação')).getByText('0')).toBeInTheDocument()
    expect(within(botaoFiltro('Inativo')).getByText('0')).toBeInTheDocument()
  })

  it('clicar num filtro mostra so os clientes daquele status', async () => {
    mockRotas(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(botaoFiltro('Inadimplente'))
    expect(screen.queryByText('Mercado A')).not.toBeInTheDocument()
    expect(screen.queryByText('Mercado B')).not.toBeInTheDocument()
    expect(screen.getByText('Mercado C')).toBeInTheDocument()
  })

  it('voltar para "Todos" mostra todos os clientes de novo', async () => {
    mockRotas(trio())
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(botaoFiltro('Ativo'))
    expect(screen.queryByText('Mercado C')).not.toBeInTheDocument()
    fireEvent.click(botaoFiltro('Todos'))
    expect(screen.getByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Mercado C')).toBeInTheDocument()
  })
})

describe('ClientesLista — vendas reais (GET /api/saidas)', () => {
  it('busca as vendas do periodo junto dos clientes', async () => {
    mockRotas([cliente()], [saida({ cliente_id: '1', valor: 900 })])
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    expect(mockGet).toHaveBeenCalledWith('/api/saidas')
    // faturado e ticket/entrega refletem a venda real, nao mais travessao
    expect(screen.getAllByText('R$ 900')).toHaveLength(2)
  })

  it('uma venda entregue e paga produz ticket e participacao (nao mais tudo zerado)', async () => {
    mockRotas(
      [cliente({ id: '1', nome: 'Mercado A' })],
      [saida({ cliente_id: '1', valor: 900, status: 'Entregue', pag: 'Pago' })],
    )
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')

    // ticket do mes e ticket/entrega (uma so entrega = o proprio valor)
    expect(screen.getAllByText('R$ 900')).toHaveLength(2)
    // unico cliente com faturamento no periodo -> 100% de participacao
    expect(screen.getByText('100%')).toBeInTheDocument()
    // pago, sem vencimento vencido -> 0% de inadimplencia (dado real, nao travessao)
    expect(screen.getByText('0,0%')).toBeInTheDocument()
  })

  it('falha em /api/saidas mantem a lista de clientes visivel, com metricas indisponiveis', async () => {
    mockRotas([cliente()], new Error('falha de rede'))
    render(<ClientesLista onAbrir={() => {}} />)

    // a carteira aparece normalmente...
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
    // ...com um aviso discreto (nao um erro que apaga a lista)...
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    // ...e as quatro metricas de venda em travessao, nao "0%"/"0,0%"
    expect(screen.getAllByText('—')).toHaveLength(4)
  })

  it('cliente sem venda no periodo continua com travessao, nao com zero', async () => {
    mockRotas(
      [cliente({ id: '1', nome: 'Mercado A' }), cliente({ id: '2', nome: 'Mercado B' })],
      [saida({ cliente_id: '1', valor: 1000 })], // so Mercado A vendeu
    )
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado B')

    const linhaB = screen.getByText('Mercado B').closest('.clientes-linha') as HTMLElement
    expect(within(linhaB).getAllByText('—')).toHaveLength(4)
    expect(within(linhaB).queryByText('0%')).not.toBeInTheDocument()
    expect(within(linhaB).queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('clicar numa linha chama onAbrir com o id do cliente', async () => {
    const onAbrir = vi.fn()
    mockRotas([cliente({ id: 'abc-123' })])
    render(<ClientesLista onAbrir={onAbrir} />)
    const linha = await screen.findByText('Mercado A')
    fireEvent.click(linha)
    expect(onAbrir).toHaveBeenCalledWith('abc-123')
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('ClientesLista — periodo global', () => {
  it('as metricas so contam as vendas do periodo escolhido', async () => {
    mockRotas([cliente()], [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
    ])
    render(<ClientesLista onAbrir={() => {}} periodo="2026-06" />)
    const linha = await screen.findByText('Mercado A')
    const dados = linha.closest('.clientes-linha') as HTMLElement
    expect(dados).toHaveTextContent('R$ 1.000')
    expect(dados).not.toHaveTextContent('R$ 9.000')
  })

  it('sem periodo (padrao "all") soma a base inteira', async () => {
    mockRotas([cliente()], [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
    ])
    render(<ClientesLista onAbrir={() => {}} />)
    const linha = await screen.findByText('Mercado A')
    expect(linha.closest('.clientes-linha')).toHaveTextContent('R$ 10.000')
  })

  it('o CADASTRO nao some num periodo sem venda nenhuma', async () => {
    mockRotas([cliente({ id: '1', nome: 'Mercado A' }), cliente({ id: '2', nome: 'Mercado B' })], [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
    ])
    render(<ClientesLista onAbrir={() => {}} periodo="2026-01" />)
    // Os dois clientes continuam na lista; so os numeros viram travessao.
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Mercado B')).toBeInTheDocument()
    expect(botaoFiltro('Todos')).toHaveTextContent('2')
  })

  it('a tela diz qual recorte esta valendo para os numeros', async () => {
    mockRotas([cliente()], [])
    render(<ClientesLista onAbrir={() => {}} periodo="2026-06" />)
    await screen.findByText('Mercado A')
    expect(screen.getByText(/números da carteira/i)).toHaveTextContent('Junho/2026')
  })
})

// ============ dica de afordancia (achado CL-1 da auditoria)

describe('ClientesLista — dica de que a linha abre a ficha', () => {
  it('a tela diz que da pra clicar numa linha — a afordancia existia e era invisivel', async () => {
    mockRotas([cliente()], [])
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText('Mercado A')
    expect(screen.getByText('Clique numa linha para abrir a ficha')).toBeInTheDocument()
  })

  it('a dica so aparece quando ha linha para clicar (lista vazia nao a mostra)', async () => {
    mockRotas([], [])
    render(<ClientesLista onAbrir={() => {}} />)
    await screen.findByText(/nenhum cliente cadastrado/i)
    expect(screen.queryByText('Clique numa linha para abrir a ficha')).not.toBeInTheDocument()
  })

  it('cliente sem entrega no periodo: ticket em travessao e NEUTRO, nunca vermelho', async () => {
    // O semaforo do ticket vem de `statusTicketEntrega` (derive/dashboard.ts),
    // que classificaria zero como vermelho — certo para um ticket medido e
    // baixo, errado para "ainda nao houve entrega". Sem esta guarda, todo
    // cliente novo abriria a tela pintado de risco.
    mockRotas([cliente()], [])
    render(<ClientesLista onAbrir={() => {}} />)
    const linha = (await screen.findByText('Mercado A')).closest('.clientes-linha') as HTMLElement
    const celulas = Array.from(linha.querySelectorAll('.clientes-col-num')) as HTMLElement[]
    // Coluna /ENTREGA (a segunda numerica): travessao, cor neutra.
    expect(celulas[1]).toHaveTextContent('—')
    expect(celulas[1].style.color).toBe('rgb(154, 151, 132)')
  })

  it('e a dica nao mente: clicar na linha realmente abre a ficha', async () => {
    mockRotas([cliente({ id: 'c-7' })], [])
    const onAbrir = vi.fn()
    render(<ClientesLista onAbrir={onAbrir} />)
    const linha = (await screen.findByText('Mercado A')).closest('.clientes-linha') as HTMLElement
    fireEvent.click(linha)
    expect(onAbrir).toHaveBeenCalledWith('c-7')
  })
})
