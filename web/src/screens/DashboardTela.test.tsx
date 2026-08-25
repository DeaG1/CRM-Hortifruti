import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DashboardTela } from './DashboardTela'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import type { Saida, Entrada, Perda } from '../derive/dashboard'
import type { Lancamento } from '../derive/lancamentos'
import type { ProdutoAgregado } from '../derive/relatorios'

// Mesmo mock do molde (ClientesLista.test.tsx): so `api.get` e substituido,
// ErroApi continua a classe real (o componente faz `err instanceof ErroApi`).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14, ...over,
})

const saida = (over: Partial<Saida> = {}): Saida => ({
  id: 's1', cliente_id: '1', status: 'Entregue', pag: 'Pago', entrega: '2026-06-10', data_pag: '2026-06-10',
  valor: 1000, peso: 100, ...over,
})

const entrada = (over: Partial<Entrada> = {}): Entrada => ({
  id: 'e1', data: '2026-06-01', pago: 'Pago', data_pag: '2026-06-04',
  perda_kg: 0, valor_total: 0, peso_total: 0, ...over,
})

/** Como GET /api/perdas devolve: `qtd` na unidade da propria perda e `qtd_kg`
 * a mesma perda em quilos (null quando o produto nao tem peso medio). Passa
 * por uma variavel porque `Perda` nao declara `qtd` de proposito — ver o
 * comentario do tipo em derive/dashboard.ts. */
function perdaDaApi(campos: { un: string; qtd: number; qtd_kg: number | null }): Perda {
  const daApi = {
    data: '2026-06-19', produto_id: 'p1', motivo: 'vencimento',
    un: campos.un, qtd: campos.qtd, qtd_kg: campos.qtd_kg,
    itens_sem_conversao: campos.qtd_kg === null ? 1 : 0,
  }
  return daApi
}

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-10', categoria: 'Frete', descricao: '', valor: 0, funcionario_id: null, ...over,
} as Lancamento)

const produtoAgregado = (over: Partial<ProdutoAgregado> = {}): ProdutoAgregado => ({
  produto_id: 'p1', nome: 'Produto', un: 'KG',
  compra_qtd: 0, compra_valor: 0, perda_coleta_qtd: 0,
  venda_qtd: 0, venda_valor: 0, perda_deposito_qtd: 0,
  ...over,
})

interface Dados {
  clientes?: Cliente[]
  saidas?: Saida[]
  entradas?: Entrada[]
  lancamentos?: Lancamento[]
  perdas?: Perda[]
  produtosAgregados?: ProdutoAgregado[]
  /** Cadastro de produtos e de fornecedores — o guia de primeiros passos só
   * conta quantos existem, então o conteúdo das linhas não importa aqui. */
  produtos?: unknown[]
  fornecedores?: unknown[]
}

/** api.get e chamado 5x em paralelo (Promise.all) mais 1x pelo agregado por
 * periodo — o mock precisa responder de acordo com a rota pedida, nao com a
 * ordem. A rota do agregado e casada por PREFIXO porque leva `?de=&ate=`
 * quando ha periodo escolhido. */
function mockApiPara(dados: Dados) {
  mockGet.mockImplementation((rota: unknown) => {
    const url = String(rota)
    if (url.startsWith('/api/relatorios/produtos')) return Promise.resolve(dados.produtosAgregados ?? [])
    switch (url) {
      case '/api/clientes': return Promise.resolve(dados.clientes ?? [])
      case '/api/saidas': return Promise.resolve(dados.saidas ?? [])
      case '/api/entradas': return Promise.resolve(dados.entradas ?? [])
      case '/api/lancamentos': return Promise.resolve(dados.lancamentos ?? [])
      case '/api/perdas': return Promise.resolve(dados.perdas ?? [])
      // Cadastros do guia de primeiros passos — carga separada das cinco
      // listas acima (ver DashboardTela.tsx).
      case '/api/produtos': return Promise.resolve(dados.produtos ?? [])
      case '/api/fornecedores': return Promise.resolve(dados.fornecedores ?? [])
      default: return Promise.reject(new Error('rota inesperada: ' + url))
    }
  })
}

function cartao(rotulo: string): HTMLElement {
  const el = screen.getByText(rotulo).closest('.dashboard-kpi-card')
  if (!el) throw new Error(`card "${rotulo}" nao encontrado`)
  return el as HTMLElement
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('DashboardTela — os quatro estados', () => {
  it('carregando: mostra indicador enquanto as chamadas estao pendentes', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os dados do painel.')
  })

  it('vazio: mostra "nenhum cliente cadastrado" quando nao ha nenhum cliente', async () => {
    mockApiPara({ clientes: [] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum cliente cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: renderiza as secoes do painel', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Painel de indicadores')).toBeInTheDocument()
    expect(screen.getByText('Concentração de carteira')).toBeInTheDocument()
    expect(screen.getByText('Cenário realizado vs. projeções')).toBeInTheDocument()
  })
})

describe('DashboardTela — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    // Duas cargas independentes (as cinco listas + o agregado por periodo,
    // que refaz a busca a cada troca de mes) — as duas veem o 401 e as duas
    // reagem. O que importa e que a tela nunca mostra erro generico no lugar
    // do login, nao quantas vezes o aviso subiu.
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('DashboardTela — indicador sem dado mostra travessao, nunca zero', () => {
  it('sem nenhum pedido entregue: receita bruta e os KPIs financeiros ficam em "—"', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')

    // cartao do topo
    expect(within(screen.getByText('Receita bruta').closest('.dashboard-card-topo') as HTMLElement).getByText('—')).toBeInTheDocument()

    // KPIs que dependem de pedidos entregues
    for (const rotulo of ['Ticket médio / minimercado', 'Ticket médio por entrega', 'Inadimplência por cliente']) {
      const card = cartao(rotulo)
      expect(within(card).getByText('—')).toBeInTheDocument()
      expect(within(card).getByText('sem dado')).toBeInTheDocument()
    }

    // nenhum "R$ 0" nem "0%" nesses cartoes — teria que ser travessao, nunca zero
    expect(screen.queryByText('R$ 0')).not.toBeInTheDocument()
  })

  it('markup, giro de estoque e ciclo de caixa continuam em "—" quando o dado agregado nao chega (sem peso de saida, sem produtos agregados)', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 5000, peso: 0 })], // sem peso vendido -> giro/ciclo nao tem ritmo pra estimar
      entradas: [entrada({ valor_total: 2000, peso_total: 200, perda_kg: 5 })],
      // produtosAgregados nao informado (fica []) -> markup sem produto nenhum
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')

    expect(within(cartao('Markup médio (venda/compra)')).getByText('—')).toBeInTheDocument()
    expect(within(cartao('Giro de estoque (dias)')).getByText('—')).toBeInTheDocument()
    expect(within(cartao('Ciclo de caixa (dias)')).getByText('—')).toBeInTheDocument()
  })
})

describe('DashboardTela — os tres indicadores destravados por GET /api/relatorios/produtos', () => {
  it('markup medio, giro de estoque e ciclo de caixa calculam valores reais quando ha dado suficiente', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({
        valor: 5000, peso: 300, entrega: '2026-05-30', data_pag: '2026-06-11', status: 'Entregue',
      })],
      entradas: [entrada({
        valor_total: 2000, peso_total: 1000, perda_kg: 0,
        data: '2026-05-01', data_pag: '2026-05-04', pago: 'Pago',
      })],
      produtosAgregados: [
        // cm=100/10=10, vm=200/10=20 -> markup 100%
        produtoAgregado({ compra_qtd: 10, compra_valor: 100, venda_qtd: 10, venda_valor: 200 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')

    expect(within(cartao('Markup médio (venda/compra)')).getByText('100%')).toBeInTheDocument()
    // giro ('all': 30 dias reais entre 05-01 e 05-30): (1000-300)/(300/30) = 70
    expect(within(cartao('Giro de estoque (dias)')).getByText('70')).toBeInTheDocument()
    // ciclo (CCC padrao): estoque=70 + recebimento=12 (05-30->06-11) - pagamentoProdutor=3 (05-01->05-04) = 79
    expect(within(cartao('Ciclo de caixa (dias)')).getByText('79')).toBeInTheDocument()
    expect(within(
      screen.getByText('Ciclo de caixa').closest('.dashboard-card-topo') as HTMLElement,
    ).getByText('79 dias')).toBeInTheDocument()
  })
})

describe('DashboardTela — KPI bate a meta / fora da meta', () => {
  it('indice de perdas dentro da meta (<=10%) aparece como "na meta"', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50 })], // 5% de perda
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('5,0%')).toBeInTheDocument()
    expect(within(card).getByText('na meta')).toBeInTheDocument()
  })

  it('indice de perdas fora da meta (>13%) aparece como "fora da meta"', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 200 })], // 20% de perda
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('20,0%')).toBeInTheDocument()
    expect(within(card).getByText('fora da meta')).toBeInTheDocument()
  })

  it('perda de deposito em CX entra no indice pelos quilos, nao pelas caixas', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50 })],
      // 4 caixas de alface de 8 kg = 32 kg. Somar `qtd` cru daria 5,4%.
      perdas: [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: 32 })],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('8,2%')).toBeInTheDocument()
    // Numero completo sai LIMPO: sem asterisco no cartao e sem nota no painel.
    expect(within(card).queryByText('8,2%*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('perda sem peso medio: o indice sai marcado com * e o painel ganha a nota de rodape', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50 })],
      perdas: [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: null })],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    const valor = within(card).getByText('5,0%*')
    expect(valor).toHaveAttribute('title', expect.stringContaining('1 lançamento'))
    expect(valor).toHaveAttribute('title', expect.stringContaining('quantidade incompleta'))
    // O semaforo NAO muda: 5% continua batendo a meta de <=10%. A marca fala
    // da completude da conta, nao do julgamento dela.
    expect(within(card).getByText('na meta')).toBeInTheDocument()

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem em Produtos')
  })

  it('so o indicador afetado ganha a marca — os outros cartoes saem limpos', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50 })],
      perdas: [perdaDaApi({ un: 'CX', qtd: 4, qtd_kg: null })],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(within(cartao('Ticket médio por entrega')).getByText('R$ 1.000')).toBeInTheDocument()
    expect(within(cartao('Ticket médio por entrega')).queryByText('R$ 1.000*')).not.toBeInTheDocument()
    expect(within(cartao('Nº de minimercados ativos')).getByText('1')).toBeInTheDocument()
  })

  it('item de entrada sem peso medio marca o indice pelo DENOMINADOR (kg recebido curto)', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 500, peso_total: 1000, perda_kg: 50, itens_sem_conversao: 2 })],
      perdas: [],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Índice de perdas (%)')
    expect(within(card).getByText('5,0%*')).toHaveAttribute('title', expect.stringContaining('2 lançamentos'))
  })

  it('ticket medio por entrega bate a meta (>=R$430)', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [saida({ valor: 500 })] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Ticket médio por entrega')
    expect(within(card).getByText('R$ 500')).toBeInTheDocument()
    expect(within(card).getByText('na meta')).toBeInTheDocument()
  })

  it('ticket medio por entrega fica fora da meta (<R$150)', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [saida({ valor: 100 })] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = cartao('Ticket médio por entrega')
    expect(within(card).getByText('R$ 100')).toBeInTheDocument()
    expect(within(card).getByText('fora da meta')).toBeInTheDocument()
  })
})

describe('DashboardTela — custo total inclui entradas e lancamentos', () => {
  it('lucro liquido desconta compras (entradas) e despesas (lancamentos) da receita', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ valor: 1000 })],
      entradas: [entrada({ valor_total: 300 })],
      lancamentos: [lancamento({ valor: 200 })],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const card = screen.getByText('Lucro líquido op.').closest('.dashboard-card-topo') as HTMLElement
    // 1000 (receita) - 300 (entradas) - 200 (lancamentos) = 500
    expect(within(card).getByText('R$ 500')).toBeInTheDocument()
  })
})

describe('DashboardTela — concentracao de carteira', () => {
  it('mostra a participacao de cada cliente e destaca quem passa de 15%', async () => {
    mockApiPara({
      clientes: [cliente({ id: 'c1', nome: 'Mercado A' }), cliente({ id: 'c2', nome: 'Mercado B' })],
      saidas: [
        saida({ cliente_id: 'c1', valor: 900 }),
        saida({ cliente_id: 'c2', valor: 100 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Concentração de carteira')

    expect(screen.getByText('Top 5 = 100% do faturamento')).toBeInTheDocument()
    expect(screen.getByText('Mercado A')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('Mercado B')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('sem pedido entregue, a secao explica o que falta em vez de mostrar barras vazias', async () => {
    mockApiPara({ clientes: [cliente()], saidas: [] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    const titulo = await screen.findByText('Concentração de carteira')
    const secao = titulo.closest('.dashboard-secao') as HTMLElement
    expect(within(secao).getByText(/sem pedidos entregues registrados/i)).toBeInTheDocument()
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('DashboardTela — periodo global', () => {
  it('a receita bruta so soma as entregas do periodo escolhido', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [
        saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
        saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const receita = screen.getByText('Receita bruta').closest('.dashboard-card-topo') as HTMLElement
    expect(receita).toHaveTextContent('R$ 1.000')
    expect(receita).toHaveTextContent('1 pedido(s) entregue(s)')
  })

  it('sem periodo (padrao "all") soma todas as epocas', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [
        saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
        saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(screen.getByText('Receita bruta').closest('.dashboard-card-topo')).toHaveTextContent('R$ 10.000')
  })

  it('o custo (compras + lancamentos) tambem respeita o recorte', async () => {
    mockApiPara({
      clientes: [cliente()],
      saidas: [saida({ entrega: '2026-06-10', valor: 1000 })],
      entradas: [
        entrada({ id: 'e1', data: '2026-06-01', valor_total: 300 }),
        entrada({ id: 'e2', data: '2026-05-01', valor_total: 5000 }),
      ],
      lancamentos: [
        lancamento({ id: 'l1', data: '2026-06-05', valor: 100 }),
        lancamento({ id: 'l2', data: '2026-05-05', valor: 4000 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    // 1000 − (300 + 100) = 600. Com a base inteira daria 1000 − 9300.
    expect(screen.getByText('Lucro líquido op.').closest('.dashboard-card-topo')).toHaveTextContent('R$ 600')
  })

  it('o indice de perdas usa entradas e perdas do periodo', async () => {
    mockApiPara({
      clientes: [cliente()],
      entradas: [
        entrada({ id: 'e1', data: '2026-06-01', peso_total: 1000, perda_kg: 50 }),
        entrada({ id: 'e2', data: '2026-05-01', peso_total: 1000, perda_kg: 500 }),
      ],
    })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(cartao('Índice de perdas (%)')).toHaveTextContent('5,0%')
  })

  it('minimercados ativos NAO some com o filtro: e cadastro, nao fluxo', async () => {
    mockApiPara({
      clientes: [cliente({ id: '1' }), cliente({ id: '2', nome: 'Mercado B' })],
      saidas: [saida({ entrega: '2026-06-10', valor: 1000 })],
    })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-01" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    const ativos = screen.getByText('Minimercados ativos').closest('.dashboard-card-topo') as HTMLElement
    expect(within(ativos).getByText('2')).toBeInTheDocument()
  })

  it('busca o agregado de produtos ja filtrado no servidor', async () => {
    mockApiPara({ clientes: [cliente()], produtosAgregados: [produtoAgregado()] })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(mockGet).toHaveBeenCalledWith('/api/relatorios/produtos?de=2026-06&ate=2026-06')
  })

  it('em "all" o agregado vai sem query nenhuma', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(mockGet).toHaveBeenCalledWith('/api/relatorios/produtos')
  })

  it('o painel imprime qual recorte esta valendo', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    expect(screen.getByText(/KPIs do estudo/)).toHaveTextContent('Junho/2026')
  })
})

// ==================== guia de primeiros passos (achado D-2) ====================

/** O painel do guia, ou null. */
function painelDoGuia(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Guia de primeiros passos' })
}

/** Espera a tela terminar de carregar — o guia entra depois da carga dos
 * cadastros, entao esperar so pelo painel de indicadores nao basta. */
async function esperarTelaPronta() {
  await vi.waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument())
}

/** O rótulo de um passo — casado só no elemento do rótulo, senão a regex
 * casaria também a linha, o painel e a seção inteira (todos contêm o texto). */
function rotuloDoPasso(painel: HTMLElement, rotulo: string): HTMLElement {
  return within(painel).getByText(new RegExp(rotulo), { selector: '.dashboard-guia-passo-label' })
}

/** Uma base "madura": os cinco passos cumpridos. */
const TUDO_CUMPRIDO: Dados = {
  produtos: [{}, {}], fornecedores: [{}], clientes: [cliente()],
  entradas: [entrada()], saidas: [saida()],
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('DashboardTela — guia: sistema zerado', () => {
  it('aparece com os cinco passos e o progresso em 0 de 5', async () => {
    mockApiPara({})
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()

    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })
    expect(within(painel).getByText('0 de 5')).toBeInTheDocument()
    for (const passo of [
      'Cadastrar produtos', 'Cadastrar fornecedores', 'Cadastrar clientes',
      'Lançar a primeira entrada', 'Lançar a primeira saída',
    ]) {
      expect(rotuloDoPasso(painel, passo)).toBeInTheDocument()
    }
  })

  it('convive com o estado vazio de clientes em vez de ser engolido por ele', async () => {
    mockApiPara({ clientes: [] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()

    expect(await screen.findByText(/nenhum cliente cadastrado/i)).toBeInTheDocument()
    expect(painelDoGuia()).not.toBeNull()
  })

  it('so o passo atual tem botao, e ele e o passo 1', async () => {
    mockApiPara({})
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    expect(within(painel).getByRole('button', { name: 'Cadastrar produto' })).toBeInTheDocument()
    expect(within(painel).queryByRole('button', { name: 'Cadastrar fornecedor' })).not.toBeInTheDocument()
    expect(within(painel).queryByRole('button', { name: 'Nova saída' })).not.toBeInTheDocument()
  })

  it('o botao leva a tela do passo atual', async () => {
    const onNavegar = vi.fn()
    mockApiPara({})
    render(<DashboardTela onNavegar={onNavegar} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()

    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar produto' }))
    expect(onNavegar).toHaveBeenCalledWith('produtos')
  })
})

describe('DashboardTela — guia: preenchimento parcial', () => {
  it('com produtos e fornecedores cadastrados, o botao passa a ser o de cliente', async () => {
    const onNavegar = vi.fn()
    mockApiPara({ produtos: [{}, {}, {}], fornecedores: [{}] })
    render(<DashboardTela onNavegar={onNavegar} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    expect(within(painel).getByText('2 de 5')).toBeInTheDocument()
    expect(within(painel).getByText('3 cadastrado(s)')).toBeInTheDocument()
    fireEvent.click(within(painel).getByRole('button', { name: 'Cadastrar cliente' }))
    expect(onNavegar).toHaveBeenCalledWith('clientes')
  })

  it('faltando so a saida, o botao leva a tela de Saidas (chamada "pedidos")', async () => {
    const onNavegar = vi.fn()
    mockApiPara({
      produtos: [{}], fornecedores: [{}], clientes: [cliente()], entradas: [entrada()], saidas: [],
    })
    render(<DashboardTela onNavegar={onNavegar} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    expect(within(painel).getByText('4 de 5')).toBeInTheDocument()
    fireEvent.click(within(painel).getByRole('button', { name: 'Nova saída' }))
    expect(onNavegar).toHaveBeenCalledWith('pedidos')
  })

  it('quem esta so no comeco ve o passo pendente anunciado a leitor de tela', async () => {
    mockApiPara({ produtos: [{}] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    expect(rotuloDoPasso(painel, 'Cadastrar produtos')).toHaveTextContent('concluído')
    expect(rotuloDoPasso(painel, 'Cadastrar fornecedores')).toHaveTextContent('pendente')
  })
})

describe('DashboardTela — guia: some sozinho', () => {
  it('com os cinco cumpridos o painel nao existe', async () => {
    mockApiPara(TUDO_CUMPRIDO)
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    await esperarTelaPronta()
    expect(painelDoGuia()).toBeNull()
  })

  it('regressao a zero DEPOIS de cumprido nao traz o guia de volta no meio da operacao', async () => {
    // A operacao ja atravessou a cadeia inteira (ha saida lancada) e perdeu
    // todos os produtos: isso e problema de operacao, nao de onboarding.
    mockApiPara({ ...TUDO_CUMPRIDO, produtos: [], fornecedores: [] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    await esperarTelaPronta()
    expect(painelDoGuia()).toBeNull()
  })

  it('regressao TOTAL a zero (nem saida sobrou) reve o guia', async () => {
    mockApiPara({})
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    expect(painelDoGuia()).not.toBeNull()
    expect(within(painelDoGuia()!).getByText('0 de 5')).toBeInTheDocument()
  })
})

describe('DashboardTela — guia: falha ao verificar os cadastros', () => {
  /** Responde tudo menos os dois cadastros do guia, que falham. */
  function mockComCadastrosQuebrados(dados: Dados, erro: unknown) {
    mockApiPara(dados)
    // `getMockImplementation()` volta como uma união que inclui construtor;
    // o que mockApiPara instalou é sempre uma função de rota -> Promise.
    const anterior = mockGet.getMockImplementation() as (rota: unknown) => Promise<unknown>
    mockGet.mockImplementation((rota: unknown) => {
      const url = String(rota)
      if (url === '/api/produtos' || url === '/api/fornecedores') return Promise.reject(erro)
      return anterior(rota)
    })
  }

  it('o guia NAO aparece — nunca diz "cadastre um produto" para quem tem cem', async () => {
    mockComCadastrosQuebrados({ clientes: [cliente()] }, new Error('falha de rede'))
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await screen.findByText('Painel de indicadores')
    await esperarTelaPronta()
    expect(painelDoGuia()).toBeNull()
  })

  it('a falha do guia nao derruba o resto do painel', async () => {
    mockComCadastrosQuebrados({ clientes: [cliente()] }, new Error('falha de rede'))
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Painel de indicadores')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('401 na carga dos cadastros volta para o login, como o resto da tela', async () => {
    const onSessaoExpirada = vi.fn()
    mockComCadastrosQuebrados({ clientes: [cliente()] }, new ErroApi(401, { erro: 'sessao invalida' }))
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })
})

describe('DashboardTela — guia: dispensa manual', () => {
  it('o botao Dispensar fecha o painel sem mexer no resto da tela', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(painelDoGuia()).toBeNull()
    expect(screen.getByText('Painel de indicadores')).toBeInTheDocument()
  })

  it('a dispensa sobrevive ao recarregamento da tela', async () => {
    mockApiPara({ clientes: [cliente()] })
    const primeira = render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    await screen.findByRole('region', { name: 'Guia de primeiros passos' })
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    primeira.unmount()

    // Montar de novo e o que o F5 faz: estado zerado, armazenamento intacto.
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    await screen.findByText('Painel de indicadores')
    expect(painelDoGuia()).toBeNull()
  })

  it('com o armazenamento indisponivel o painel ainda fecha no clique — a tela nao quebra', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError')
    })
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    await screen.findByRole('region', { name: 'Guia de primeiros passos' })

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))).not.toThrow()
    expect(painelDoGuia()).toBeNull()
    expect(screen.getByText('Painel de indicadores')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('leitura do armazenamento lancando na montagem nao impede a tela de renderizar', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sem acesso', 'SecurityError')
    })
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()

    expect(await screen.findByText('Painel de indicadores')).toBeInTheDocument()
    // Falha de leitura = "nao dispensado": o padrao de um guia e aparecer.
    expect(painelDoGuia()).not.toBeNull()
    vi.restoreAllMocks()
  })
})

describe('DashboardTela — guia: o filtro de periodo nao o alcanca', () => {
  it('trocar o mes nao esconde nem reabre o guia, e nao refaz a busca dos cadastros', async () => {
    mockApiPara({ produtos: [{}], fornecedores: [{}], clientes: [cliente()], entradas: [entrada()] })
    // Callbacks estáveis entre os dois renders: o que se mede aqui é o efeito
    // do MÊS, não o da identidade das funções.
    const navegar = () => {}
    const expirou = () => {}
    const tela = render(<DashboardTela onNavegar={navegar} periodo="2026-06" onSessaoExpirada={expirou} />)
    await esperarTelaPronta()
    await screen.findByRole('region', { name: 'Guia de primeiros passos' })
    const buscasDeCadastro = mockGet.mock.calls.filter(c => c[0] === '/api/produtos').length

    // Um mes sem movimento nenhum: se o guia respeitasse o recorte, ele
    // reabriria dizendo "cadastre um produto" para quem tem produtos.
    tela.rerender(<DashboardTela onNavegar={navegar} periodo="2020-01" onSessaoExpirada={expirou} />)
    await esperarTelaPronta()

    const painel = await screen.findByRole('region', { name: 'Guia de primeiros passos' })
    expect(within(painel).getByText('4 de 5')).toBeInTheDocument()
    expect(mockGet.mock.calls.filter(c => c[0] === '/api/produtos').length).toBe(buscasDeCadastro)
  })

  it('a busca dos cadastros vai sem recorte de periodo', async () => {
    mockApiPara({ clientes: [cliente()] })
    render(<DashboardTela onNavegar={() => {}} periodo="2026-06" onSessaoExpirada={() => {}} />)
    await esperarTelaPronta()
    expect(mockGet).toHaveBeenCalledWith('/api/produtos')
    expect(mockGet).toHaveBeenCalledWith('/api/fornecedores')
  })
})
