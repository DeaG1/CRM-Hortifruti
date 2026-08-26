import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FinanceiroTela } from './FinanceiroTela'
import { api, ErroApi } from '../api/client'
import type { SaidaFin, EntradaFin } from '../derive/financeiro'
import type { Lancamento } from '../derive/lancamentos'

// Mock so de `api.get` — mantem a classe ErroApi real (o componente e o
// LancamentosLista embutido fazem `err instanceof ErroApi`, precisa ser o
// mesmo construtor dos dois lados). Molde: LancamentosLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const saida = (over: Partial<SaidaFin> = {}): SaidaFin => ({
  id: 's1', entrega: '2026-06-10', status: 'Entregue', data_pag: '2026-06-15',
  valor: 1000, peso: 100, ...over,
})

const entrada = (over: Partial<EntradaFin> = {}): EntradaFin => ({
  id: 'e1', data: '2026-06-01', pago: 'Pago', data_pag: '2026-06-04',
  perda_kg: 0, valor_total: 300, peso_total: 100, ...over,
})

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-05', categoria: 'Frete', descricao: 'Coleta Norte',
  valor: 100, funcionario_id: null, veiculo_id: null, ...over,
})

/** Resolve as seis rotas que a tela (e o LancamentosLista embutido) usam —
 * /api/veiculos entrou com a coluna VEICULO do razao. */
function mockCarga(opts: {
  saidas?: SaidaFin[]
  entradas?: EntradaFin[]
  lancamentos?: Lancamento[]
  funcionarios?: unknown[]
  veiculos?: unknown[]
  categorias?: string[]
} = {}) {
  const {
    saidas = [], entradas = [], lancamentos = [],
    funcionarios = [], veiculos = [], categorias = ['Frete', 'Gasolina', 'Outros'],
  } = opts
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/saidas') return Promise.resolve(saidas)
    if (rota === '/api/entradas') return Promise.resolve(entradas)
    if (rota === '/api/lancamentos') return Promise.resolve(lancamentos)
    if (rota === '/api/funcionarios') return Promise.resolve(funcionarios)
    if (rota === '/api/veiculos') return Promise.resolve(veiculos)
    if (rota === '/api/lancamentos/categorias') return Promise.resolve(categorias)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('FinanceiroTela — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os dados financeiros.')
  })

  it('vazio: mostra aviso quando nao ha saidas, entradas nem lancamentos', async () => {
    mockCarga()
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/ainda não há dado suficiente/i)).toBeInTheDocument()
  })

  it('com dados: mostra o resultado, o ciclo de caixa e os lancamentos', async () => {
    mockCarga({
      saidas: [saida()],
      entradas: [entrada()],
      lancamentos: [lancamento()],
    })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/Resultado —/)).toBeInTheDocument()
    expect(screen.getByText('Ciclo de caixa')).toBeInTheDocument()
    // Lançamentos embutido (LancamentosLista) mostra a descricao do lancamento
    expect(await screen.findByText('Coleta Norte')).toBeInTheDocument()
  })
})

describe('FinanceiroTela — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<FinanceiroTela onSessaoExpirada={onSessaoExpirada} />)
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FinanceiroTela — resultado', () => {
  it('receita bruta soma so vendas entregues, custos aparecem por categoria', async () => {
    mockCarga({
      saidas: [saida({ valor: 2000, status: 'Entregue' }), saida({ id: 's2', valor: 999, status: 'Em rota' })],
      entradas: [entrada({ valor_total: 600 })],
      lancamentos: [lancamento({ categoria: 'Frete', valor: 400 })],
    })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText(/Resultado —/)

    // receita bruta = 2000 (so a Entregue), nao 2999
    expect(screen.getByText('R$ 2.000')).toBeInTheDocument()
    // custo: compra de mercadoria (600) + Frete (400) — texto exato da linha
    // do cartao "Resultado", pra nao colidir com o badge "Frete" que o
    // LancamentosLista embutido tambem renderiza.
    expect(screen.getByText('(–) Compra de mercadoria')).toBeInTheDocument()
    expect(screen.getByText('(R$ 600)')).toBeInTheDocument()
    expect(screen.getByText('(–) Frete')).toBeInTheDocument()
    expect(screen.getByText('(R$ 400)')).toBeInTheDocument()
    // lucro = 2000 - 1000 = 1000, aparece duas vezes (cartao + destaque escuro)
    expect(screen.getAllByText('R$ 1.000').length).toBeGreaterThan(0)
  })

  it('lucro negativo aparece em vermelho', async () => {
    mockCarga({
      saidas: [saida({ valor: 500, status: 'Entregue' })],
      entradas: [entrada({ valor_total: 600 })],
      lancamentos: [],
    })
    const { container } = render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText(/Resultado —/)

    // custo de mercadoria = 600; lucro = 500 - 600 = -100
    expect(screen.getByText('(R$ 600)')).toBeInTheDocument()
    const lucroNegativo = screen.getAllByText((_, el) => el?.textContent === 'R$ -100')
    expect(lucroNegativo.length).toBe(2) // cartao de resultado + destaque escuro

    // no cartao "Resultado", lucro negativo usa exatamente o vermelho do semaforo
    const noCartao = container.querySelector('.financeiro-destaque-lucro-valor')
    expect(noCartao).toHaveStyle({ color: '#c2502f' })

    // no cartao escuro (fundo verde-escuro), o vermelho e mais claro pra
    // contraste, mas continua distinto do verde usado quando o lucro e positivo
    const noDestaqueEscuro = container.querySelector('.financeiro-lucro-escuro-valor')
    expect(noDestaqueEscuro).not.toHaveStyle({ color: '#a5d66f' })
  })
})

describe('FinanceiroTela — ciclo de caixa', () => {
  it('mostra os tres componentes com dado suficiente', async () => {
    mockCarga({
      saidas: [saida({ entrega: '2026-06-01', data_pag: '2026-06-13', status: 'Entregue', peso: 300 })],
      entradas: [entrada({ data: '2026-06-01', data_pag: '2026-06-04', pago: 'Pago', peso_total: 1000, perda_kg: 0 })],
      lancamentos: [],
    })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Ciclo de caixa')

    expect(screen.getByText('Pagamento ao produtor')).toBeInTheDocument()
    expect(screen.getByText('Giro de estoque')).toBeInTheDocument()
    expect(screen.getByText('Recebimento')).toBeInTheDocument()
  })

  it('mostra travessao honesto (nao zero) quando falta dado para um componente', async () => {
    // sem nenhuma saida/entrada, so um lancamento: passa do estado vazio da
    // tela mas nao ha dado nenhum pra calcular pagamento/estoque/recebimento.
    mockCarga({ lancamentos: [lancamento()] })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Ciclo de caixa')

    // os tres componentes ficam em travessao, e o total tambem
    const travessoes = screen.getAllByText('—')
    expect(travessoes.length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(/Nenhuma entrada paga/)).toBeInTheDocument()
    expect(screen.getByText(/Nenhuma saída registrada/)).toBeInTheDocument()
    expect(screen.getByText(/Nenhuma venda entregue e paga/)).toBeInTheDocument()
  })

  // DEFEITO 1 (corrigido): a formula passou a subtrair pagamentoProdutor
  // (CCC padrao), entao o semaforo/meta (antes removido, com uma nota
  // explicando a ausencia) volta a se aplicar.
  it('restaura o semaforo com a meta de 13 dias, sem a nota de "sem meta definida"', async () => {
    mockCarga({
      saidas: [saida({ entrega: '2026-06-01', data_pag: '2026-06-13', status: 'Entregue', peso: 300 })],
      entradas: [entrada({ data: '2026-06-01', data_pag: '2026-06-04', pago: 'Pago', peso_total: 1000, perda_kg: 0 })],
      lancamentos: [],
    })
    const { container } = render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Ciclo de caixa')

    // total = estoque(2) + recebimento(12) - pagamentoProdutor(3) = 11 dias,
    // dentro da meta (<=13) -> verde, tag "na meta"
    expect(screen.getByText('11 dias')).toBeInTheDocument()
    expect(screen.getByText(/na meta · meta ≤ 13 dias/)).toBeInTheDocument()
    const total = container.querySelector('.financeiro-ciclo-total')
    expect(total).toHaveStyle({ color: '#3f8f5b' })

    // a nota antiga ("sem meta definida", da fase em que a formula somava)
    // nao existe mais
    expect(screen.queryByText(/sem meta definida/i)).not.toBeInTheDocument()
  })
})

// ================================= periodo global (achado S-3 da auditoria)
// A tela PERDEU o seletor proprio: o recorte vem do cabecalho, por prop.
// Ver o comentario da prop `periodo` em FinanceiroTela.tsx.

describe('FinanceiroTela — periodo global', () => {
  it('nao tem mais seletor proprio de periodo', async () => {
    mockCarga({ saidas: [saida()] })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    await screen.findByText(/Resultado —/)
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
  })

  it('o resultado obedece ao periodo recebido', async () => {
    mockCarga({
      saidas: [
        saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
        saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
      ],
    })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Resultado — Junho/2026')).toBeInTheDocument()
    // Receita bruta do cartao de resultado: 1.000 (junho), nunca 10.000.
    expect(screen.getAllByText('R$ 1.000').length).toBeGreaterThan(0)
    expect(screen.queryByText('R$ 10.000')).not.toBeInTheDocument()
  })

  it('sem periodo (padrao "all") soma todas as epocas', async () => {
    mockCarga({
      saidas: [
        saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
        saida({ id: 's2', entrega: '2026-05-10', valor: 9000 }),
      ],
    })
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Resultado — Todo o período')).toBeInTheDocument()
    expect(screen.getAllByText('R$ 10.000').length).toBeGreaterThan(0)
  })

  it('alimenta o De/Ate da lista de lancamentos embutida', async () => {
    mockCarga({ saidas: [saida()], lancamentos: [lancamento()] })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Resultado — Junho/2026')
    expect((await screen.findByLabelText('De')) as HTMLInputElement).toHaveValue('2026-06')
    expect((screen.getByLabelText('Até')) as HTMLInputElement).toHaveValue('2026-06')
  })
})

// ============ sub-linha da receita e cabecalho dos lancamentos (FI-1, FI-2)

describe('FinanceiroTela — sub-linha da receita bruta (FI-1)', () => {
  /** A sub-linha logo abaixo de "Receita bruta". */
  function sub(): HTMLElement {
    return document.querySelector('.financeiro-receita-sub') as HTMLElement
  }

  it('diz de quantas entregas a receita veio', async () => {
    mockCarga({ saidas: [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-06-20', valor: 500 }),
    ] })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Receita bruta')
    expect(sub()).toHaveTextContent('2 pedidos entregues no período')
    // Visivel de verdade, nao so presente no DOM: a rastreabilidade que
    // ninguem le nao rastreia nada.
    expect(sub()).toBeVisible()
  })

  it('singular com um pedido so', async () => {
    mockCarga({ saidas: [saida({ entrega: '2026-06-10', valor: 1000 })] })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Receita bruta')
    expect(sub()).toHaveTextContent('1 pedido entregue no período')
  })

  it('conta so o que entrou na receita: nao-entregue fica de fora dos dois numeros', async () => {
    mockCarga({ saidas: [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-06-11', valor: 700, status: 'Em rota' }),
      saida({ id: 's3', entrega: '2026-06-12', valor: 900, status: 'Cancelado' }),
    ] })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Receita bruta')
    expect(sub()).toHaveTextContent('1 pedido entregue no período')
    // O valor da PROPRIA linha de receita (sem custo nenhum, o lucro liquido
    // exibe o mesmo numero mais abaixo — daí o escopo).
    const linhaReceita = screen.getByText('Receita bruta').closest('.financeiro-linha') as HTMLElement
    expect(within(linhaReceita).getByText('R$ 1.000')).toBeInTheDocument()
  })

  it('segue o periodo, como a receita acima dela', async () => {
    mockCarga({ saidas: [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-07-10', valor: 500 }),
    ] })
    render(<FinanceiroTela periodo="2026-07" onSessaoExpirada={() => {}} />)
    await screen.findByText('Receita bruta')
    expect(sub()).toHaveTextContent('1 pedido entregue no período')
  })

  it('periodo sem entrega: "0 pedidos" MEDIDO ao lado de R$ 0 — nao travessao', async () => {
    // A tela so aparece porque ha lancamento no periodo; a receita e zero de
    // verdade, e "0 pedidos" e a explicacao correta dela.
    mockCarga({
      saidas: [saida({ entrega: '2026-06-10', valor: 1000 })],
      lancamentos: [lancamento({ data: '2026-08-05' })],
    })
    render(<FinanceiroTela periodo="2026-08" onSessaoExpirada={() => {}} />)
    await screen.findByText('Receita bruta')
    expect(sub()).toHaveTextContent('0 pedidos entregues no período')
    expect(sub()).not.toHaveTextContent('—')
  })

  it('erro de carga nao deixa a sub-linha para tras: a tela inteira vira alerta', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FinanceiroTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar os dados financeiros/i)
    expect(document.querySelector('.financeiro-receita-sub')).toBeNull()
  })
})

describe('FinanceiroTela — cabecalho da secao de lancamentos (FI-2)', () => {
  it('o titulo diz "do periodo" e a dica diz que da pra clicar', async () => {
    mockCarga({ lancamentos: [lancamento()] })
    render(<FinanceiroTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Lançamentos do período')).toBeInTheDocument()
    expect(screen.getByText('clique num lançamento para editar')).toBeInTheDocument()
  })
})
