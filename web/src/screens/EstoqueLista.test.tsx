import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
  // Saidas desta linha que descontam do saldo sem data de entrega — zero no
  // caso comum. Ver a suite "posicao num dia passado" no fim do arquivo.
  itens_saida_sem_data: 0,
  // As tres datas vem do MESMO GET /api/estoque das quantidades (um max()
  // nas CTEs que ja existiam). Por padrao null aqui — cada teste de
  // movimentacao preenche o que precisa.
  ultima_entrada: null, ultima_saida: null, ultima_perda: null,
  ...over,
})

const mov = (over: Record<string, unknown> = {}) => ({
  produto_id: 'p-1', un: 'KG', tipo: 'entrada', data: '2026-08-01',
  qtd_kg: 100, referencia: 'E-1', total: 1,
  ...over,
})

/**
 * EstoqueLista compoe <PerdasLista>, que faz suas proprias chamadas a
 * /api/perdas e /api/produtos. Por padrao aqui elas resolvem vazias, para
 * nao interferir nos testes que so cobrem o comportamento de /api/estoque.
 */
function mockRotas(
  estoque: unknown[] | Promise<unknown> = [],
  perdas: unknown[] = [],
  produtos: unknown[] = [],
  movimentacoes: unknown[] | Promise<unknown> = [],
) {
  mockGet.mockImplementation((url: string) => {
    // O caminho sem a query: a tela manda `?posicao_em=` nas duas rotas de
    // estoque quando se olha uma data passada, e o mock casa pela ROTA. Quem
    // precisa checar a data lida `mockGet.mock.calls` — ver `urlsDe`.
    const caminho = url.split('?')[0]
    if (caminho === '/api/estoque') return estoque instanceof Promise ? estoque : Promise.resolve(estoque)
    if (caminho === '/api/perdas') return Promise.resolve(perdas)
    if (caminho === '/api/produtos') return Promise.resolve(produtos)
    if (caminho === '/api/estoque/movimentacoes') {
      return movimentacoes instanceof Promise ? movimentacoes : Promise.resolve(movimentacoes)
    }
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

// ============================================ rastreamento de movimentacao

describe('EstoqueLista — coluna ULTIMA MOVIMENTACAO', () => {
  it('a coluna existe no cabecalho', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const cabecalho = container.querySelector('.estoque-linha--cabecalho') as HTMLElement
    expect(within(cabecalho).getByText('ÚLTIMA MOVIMENTAÇÃO')).toBeInTheDocument()
  })

  it('item com entrada e saida mostra a MAIS RECENTE das duas, com o tipo', async () => {
    mockRotas([linha({ ultima_entrada: '2026-06-01', ultima_saida: '2026-06-14' })])
    render(<EstoqueLista />)
    expect(await screen.findByText('Saída · 14/06')).toBeInTheDocument()
    expect(screen.queryByText('Entrada · 01/06')).not.toBeInTheDocument()
  })

  it('item so com entrada mostra a entrada', async () => {
    mockRotas([linha({ ultima_entrada: '2026-05-04' })])
    render(<EstoqueLista />)
    expect(await screen.findByText('Entrada · 04/05')).toBeInTheDocument()
  })

  it('perda aparece rotulada como PERDA — nunca disfarcada de saida', async () => {
    mockRotas([linha({ ultima_perda: '2026-05-19' })])
    const { container } = render(<EstoqueLista />)
    const cel = await screen.findByText('Perda · 19/05')
    expect(cel.className).toContain('estoque-mov--perda')
    // Nenhuma celula desta tabela esta rotulada como saida: a perda entrou no
    // rastreamento, mas com o nome dela.
    expect(container.querySelector('.estoque-mov--saida')).toBeNull()
    expect(container.querySelector('.estoque-mov--entrada')).toBeNull()
  })

  it('item SEM movimentacao nenhuma mostra travessao — nunca a data de hoje nem 01/01/1970', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const cel = container.querySelector('.estoque-sem-mov') as HTMLElement
    expect(cel).toHaveTextContent('—')
    expect(cel).toHaveAttribute('title', expect.stringContaining('Nenhuma movimentação'))
    // Nenhuma data foi inventada para preencher a celula.
    expect(container.querySelector('.estoque-mov')).toBeNull()
    const [, mes, dia] = new Date().toISOString().slice(0, 10).split('-')
    expect(cel.textContent).not.toContain(`${dia}/${mes}`)
    expect(cel.textContent).not.toContain('01/01')
  })

  it('o title carrega a data ISO completa — o formato curto nao mostra o ano', async () => {
    // Estoque nao segue o filtro de periodo: a ultima movimentacao pode ser
    // de anos atras, e '09/03' sozinho nao diria de quando.
    mockRotas([linha({ ultima_saida: '2024-03-09' })])
    render(<EstoqueLista />)
    const cel = await screen.findByText('Saída · 09/03')
    expect(cel).toHaveAttribute('title', 'Última movimentação: Saída em 2024-03-09')
  })

  it('a legenda diz que a saida conta pela entrega e que cancelado nao conta', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const legendas = container.querySelectorAll('.estoque-legenda')
    const textos = Array.from(legendas).map(l => l.textContent ?? '').join(' ')
    expect(textos).toMatch(/data de entrega/i)
    expect(textos).toMatch(/cancelado ou devolvido não conta/i)
  })

  it('a nota de escopo continua valendo e passa a cobrir tambem a movimentacao', async () => {
    mockRotas([linha({ ultima_saida: '2026-06-14' })])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const nota = screen.getByRole('note', { name: 'Escopo do estoque' })
    expect(nota).toHaveTextContent(/não segue o filtro de período/i)
    expect(nota).toHaveTextContent(/última movimentação/i)
  })
})

describe('EstoqueLista — historico por item (custo: uma busca para a tela inteira)', () => {
  it('nao busca o historico ao montar — quem so ve os saldos nao paga por ele', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(mockGet).not.toHaveBeenCalledWith('/api/estoque/movimentacoes')
  })

  it('expandir uma linha busca o historico e lista as movimentacoes daquele item', async () => {
    mockRotas(
      [linha({ ultima_entrada: '2026-08-01', ultima_saida: '2026-08-09' })],
      [], [],
      [
        mov({ tipo: 'saida', data: '2026-08-09', qtd_kg: 40, referencia: 'S-7', total: 2 }),
        mov({ tipo: 'entrada', data: '2026-08-01', qtd_kg: 100, referencia: 'E-1', total: 2 }),
      ],
    )
    render(<EstoqueLista />)
    const botao = await screen.findByRole('button', { expanded: false })
    fireEvent.click(botao)

    expect(await screen.findByText('S-7')).toBeInTheDocument()
    expect(screen.getByText('E-1')).toBeInTheDocument()
    expect(screen.getByText('40 kg')).toBeInTheDocument()
    expect(screen.getByText('100 kg')).toBeInTheDocument()
    expect(botao).toHaveAttribute('aria-expanded', 'true')
  })

  it('renderiza o historico NA ORDEM RECEBIDA — nao reordena duas do mesmo dia', async () => {
    // Duas movimentacoes no mesmo dia sao comuns; o desempate estavel vive na
    // query (junto do corte das mais recentes). A tela nao pode desfaze-lo.
    mockRotas(
      [linha({ ultima_saida: '2026-08-09' })],
      [], [],
      [
        mov({ tipo: 'saida', data: '2026-08-09', referencia: 'S-9', total: 3 }),
        mov({ tipo: 'saida', data: '2026-08-09', referencia: 'S-8', total: 3 }),
        mov({ tipo: 'entrada', data: '2026-08-01', referencia: 'E-1', total: 3 }),
      ],
    )
    const { container } = render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    await screen.findByText('S-9')

    const refs = Array.from(container.querySelectorAll('.estoque-movimentacao-ref'))
      .map(el => el.textContent)
    expect(refs).toEqual(['S-9', 'S-8', 'E-1'])
  })

  it('expandir um SEGUNDO item nao dispara outra busca — o custo e O(1), nao O(n)', async () => {
    mockRotas(
      [
        linha({ produto_id: 'p-1', nome: 'Tomate', ultima_entrada: '2026-08-01' }),
        linha({ produto_id: 'p-2', nome: 'Alface', ultima_entrada: '2026-08-02' }),
      ],
      [], [],
      [
        mov({ produto_id: 'p-1', referencia: 'E-1' }),
        mov({ produto_id: 'p-2', referencia: 'E-2' }),
      ],
    )
    render(<EstoqueLista />)
    const botoes = await screen.findAllByRole('button', { expanded: false })

    fireEvent.click(botoes[0])
    expect(await screen.findByText('E-1')).toBeInTheDocument()
    fireEvent.click(botoes[1])
    expect(await screen.findByText('E-2')).toBeInTheDocument()

    const buscas = mockGet.mock.calls.filter(([url]) => url === '/api/estoque/movimentacoes')
    expect(buscas).toHaveLength(1)
  })

  it('cada linha ve so o proprio historico — (produto, unidade) e a chave', async () => {
    mockRotas(
      [
        linha({ produto_id: 'p-1', nome: 'Melancia', un: 'CX', ultima_entrada: '2026-08-01' }),
        linha({ produto_id: 'p-1', nome: 'Melancia', un: 'KG', ultima_entrada: '2026-08-02' }),
      ],
      [], [],
      [
        mov({ produto_id: 'p-1', un: 'CX', referencia: 'E-CX' }),
        mov({ produto_id: 'p-1', un: 'KG', referencia: 'E-KG' }),
      ],
    )
    render(<EstoqueLista />)
    const botoes = await screen.findAllByRole('button', { expanded: false })
    fireEvent.click(botoes[0])
    expect(await screen.findByText('E-CX')).toBeInTheDocument()
    expect(screen.queryByText('E-KG')).not.toBeInTheDocument()
  })

  it('diz "N de M" quando a API truncou nas mais recentes, em vez de truncar calada', async () => {
    mockRotas(
      [linha({ ultima_entrada: '2026-08-01' })],
      [], [],
      [mov({ referencia: 'E-1', total: 47 }), mov({ referencia: 'E-2', total: 47 })],
    )
    render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    expect(await screen.findByText(/2 de 47 movimentações/)).toBeInTheDocument()
  })

  it('sem truncamento, o titulo diz so quantas existem', async () => {
    mockRotas(
      [linha({ ultima_entrada: '2026-08-01' })],
      [], [],
      [mov({ referencia: 'E-1', total: 1 })],
    )
    render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    expect(await screen.findByText(/1 movimentação\(ões\)/)).toBeInTheDocument()
  })

  it('quantidade nao convertivel no historico vira travessao marcado, nunca zero', async () => {
    mockRotas(
      [linha({ un: 'CX', itens_sem_conversao: 1, ultima_entrada: '2026-08-01' })],
      [], [],
      [mov({ un: 'CX', qtd_kg: null, referencia: 'E-1' })],
    )
    const { container } = render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    await screen.findByText('E-1')

    const marcado = Array.from(container.querySelectorAll('.estoque-movimentacao .estoque-incompleto'))
    expect(marcado).toHaveLength(1)
    expect(marcado[0]).toHaveTextContent('—*')
    expect(marcado[0]).toHaveAttribute('title', expect.stringContaining('peso médio'))
    expect(screen.queryByText('0 kg')).not.toBeInTheDocument()
  })

  it('item sem movimentacao com data: o detalhe explica, nao fica em branco', async () => {
    mockRotas([linha()], [], [], [])
    const { container } = render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    // O titulo diz o estado, e o corpo explica a causa (saida sem entrega) —
    // "vazio" sem motivo pareceria a tela ter perdido o historico.
    expect(await screen.findByText(/HISTÓRICO — nenhuma movimentação com data/i)).toBeInTheDocument()
    const vazio = container.querySelector('.estoque-historico-vazio') as HTMLElement
    expect(vazio).toHaveTextContent(/sem data de entrega preenchida/i)
  })

  it('clicar de novo recolhe a linha', async () => {
    mockRotas([linha({ ultima_entrada: '2026-08-01' })], [], [], [mov({ referencia: 'E-1' })])
    render(<EstoqueLista />)
    const botao = await screen.findByRole('button', { expanded: false })
    fireEvent.click(botao)
    expect(await screen.findByText('E-1')).toBeInTheDocument()
    fireEvent.click(botao)
    expect(screen.queryByText('E-1')).not.toBeInTheDocument()
    expect(botao).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('EstoqueLista — o historico cai SOZINHO', () => {
  it('falha do historico: os saldos e a ultima movimentacao continuam na tela, com aviso role=status', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/estoque') {
        return Promise.resolve([linha({ saldo: 55, ultima_saida: '2026-06-14' })])
      }
      if (url === '/api/estoque/movimentacoes') return Promise.reject(new Error('falha de rede'))
      return Promise.resolve([])
    })
    render(<EstoqueLista />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/histórico de movimentação/i)
    // A tela NAO caiu: saldo e ultima movimentacao vem do outro endpoint.
    expect(screen.getByText('55')).toBeInTheDocument()
    expect(screen.getByText('Saída · 14/06')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // E o detalhe aberto diz o que houve, em vez de fingir lista vazia.
    expect(screen.getByText(/não puderam ser carregadas/i)).toBeInTheDocument()
    expect(screen.getByText(/HISTÓRICO — indisponível/)).toBeInTheDocument()
  })

  it('401 no historico volta ao login em vez de mostrar erro generico', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/estoque') return Promise.resolve([linha({ ultima_entrada: '2026-08-01' })])
      if (url === '/api/estoque/movimentacoes') {
        return Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
      }
      return Promise.resolve([])
    })
    const onSessaoExpirada = vi.fn()
    render(<EstoqueLista onSessaoExpirada={onSessaoExpirada} />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('falha do ESTOQUE nao tenta buscar historico nenhum (nao ha linha para expandir)', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/estoque' ? Promise.reject(new Error('falha de rede')) : Promise.resolve([]),
    )
    render(<EstoqueLista />)
    await screen.findByRole('alert')
    expect(mockGet).not.toHaveBeenCalledWith('/api/estoque/movimentacoes')
  })
})

// ==================================== posicao num dia passado ("Posicao em")

/** AAAA-MM-DD no fuso local, igual ao `hojeIsoLocal()` da tela. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Uma data relativa ao relogio REAL: a tela le `new Date()` na montagem, e o
 * teste nao pode depender de hoje ser um dia especifico do calendario.
 * `setDate` respeita o fuso local (nao soma 86400000 as cegas). */
function diasDeHoje(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

const HOJE = isoLocal(new Date())
const ONTEM = diasDeHoje(-1)
const AMANHA = diasDeHoje(1)
const PASSADO = diasDeHoje(-12)

/** As URLs pedidas a `api.get`, na ordem — e onde se ve se o corte foi junto. */
function urlsDe(rota: string): string[] {
  return mockGet.mock.calls
    .map(c => String(c[0]))
    .filter(u => u.split('?')[0] === rota)
}

function seletorDeData(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('#estoque-posicao-em')
  if (!el) throw new Error('seletor de data nao encontrado')
  return el as HTMLInputElement
}

describe('EstoqueLista — o seletor "Posicao em"', () => {
  it('o controle existe, rotulado, e comeca em HOJE', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(screen.getByLabelText('Posição em')).toBeInTheDocument()
    expect(seletorDeData(container).value).toBe(HOJE)
  })

  it('em hoje, a busca sai SEM parametro — o caso normal nao muda em nada', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(urlsDe('/api/estoque')).toEqual(['/api/estoque'])
  })

  it('escolher uma data passada refaz a busca com o corte', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    await vi.waitFor(() => {
      expect(urlsDe('/api/estoque')).toEqual(['/api/estoque', `/api/estoque?posicao_em=${PASSADO}`])
    })
  })

  it('a vespera ja e uma posicao historica (o corte comeca no dia anterior)', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: ONTEM } })
    await screen.findByRole('status')
    expect(urlsDe('/api/estoque')).toContain(`/api/estoque?posicao_em=${ONTEM}`)
  })

  it('o seletor e limitado a hoje: amanha nao esta na oferta', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(seletorDeData(container)).toHaveAttribute('max', HOJE)
  })

  it('data FUTURA digitada nao vira corte — a tela nunca pede uma posicao no futuro', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: AMANHA } })
    // Nenhuma busca nova com corte, e nenhum aviso de posicao historica.
    await vi.waitFor(() => expect(seletorDeData(container).value).toBe(AMANHA))
    expect(urlsDe('/api/estoque').some(u => u.includes('posicao_em'))).toBe(false)
    expect(screen.queryByText(/não é o estoque de agora/i)).not.toBeInTheDocument()
  })

  it('o controle continua na tela quando a busca FALHA — da para voltar para hoje sem recarregar', async () => {
    mockGet.mockImplementation((url: string) =>
      url.split('?')[0] === '/api/estoque' ? Promise.reject(new Error('falha')) : Promise.resolve([]),
    )
    const { container } = render(<EstoqueLista />)
    await screen.findByRole('alert')
    expect(seletorDeData(container)).toBeInTheDocument()
  })
})

describe('EstoqueLista — a tela diz quando NAO se esta olhando hoje', () => {
  it('em hoje nao ha aviso de posicao historica nem botao de voltar', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(screen.queryByText(/não é o estoque de agora/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /voltar para hoje/i })).not.toBeInTheDocument()
  })

  it('numa data passada, um aviso role=status nomeia a data e diz que nao e o estoque de agora', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: '2026-03-09' } })
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/posição histórica/i)
    expect(aviso).toHaveTextContent('09/03')
    expect(aviso).toHaveTextContent(/não é o estoque de agora/i)
    // O `title` carrega a data por extenso — o rotulo curto nao mostra o ano.
    expect(aviso).toHaveAttribute('title', 'Posição do depósito em 2026-03-09')
  })

  it('a tabela muda de cara na posicao historica — nao so o aviso', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(container.querySelector('.estoque-tabela--historica')).toBeNull()
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    await vi.waitFor(() => {
      expect(container.querySelector('.estoque-tabela--historica')).not.toBeNull()
    })
    expect(container.querySelector('.estoque-saldo-secao--historica')).not.toBeNull()
  })

  it('o botao "Voltar para hoje" aparece e devolve a posicao atual, sem corte na URL', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    const voltar = await screen.findByRole('button', { name: /voltar para hoje/i })
    fireEvent.click(voltar)
    await vi.waitFor(() => expect(seletorDeData(container).value).toBe(HOJE))
    expect(urlsDe('/api/estoque').at(-1)).toBe('/api/estoque')
    expect(screen.queryByText(/não é o estoque de agora/i)).not.toBeInTheDocument()
  })

  it('SAIR E VOLTAR A TELA volta para hoje — a data escolhida nao sobrevive a remontagem', async () => {
    // A decisao: quem perde a data escolhida clica de novo; quem volta a tela
    // achando ver o estoque de agora e esta vendo o de 12 dias atras compra
    // errado. So um dos dois erros custa mercadoria.
    mockRotas([linha()])
    const primeira = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(primeira.container), { target: { value: PASSADO } })
    await screen.findByRole('status')
    primeira.unmount()

    const segunda = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(seletorDeData(segunda.container).value).toBe(HOJE)
    expect(urlsDe('/api/estoque').at(-1)).toBe('/api/estoque')
    expect(screen.queryByText(/não é o estoque de agora/i)).not.toBeInTheDocument()
  })
})

describe('EstoqueLista — o historico segue o mesmo corte', () => {
  it('expandir numa data passada busca o historico COM o corte', async () => {
    mockRotas([linha()], [], [], [mov()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await vi.waitFor(() => {
      expect(urlsDe('/api/estoque/movimentacoes'))
        .toEqual([`/api/estoque/movimentacoes?posicao_em=${PASSADO}`])
    })
  })

  it('trocar a data INVALIDA o historico ja buscado — ele nao pode contradizer o saldo', async () => {
    mockRotas([linha()], [], [], [mov()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await vi.waitFor(() => expect(urlsDe('/api/estoque/movimentacoes')).toHaveLength(1))

    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    await screen.findByRole('status')
    // A linha recolheu (o corte e outro) e a proxima expansao busca de novo.
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await vi.waitFor(() => {
      expect(urlsDe('/api/estoque/movimentacoes')).toEqual([
        '/api/estoque/movimentacoes',
        `/api/estoque/movimentacoes?posicao_em=${PASSADO}`,
      ])
    })
  })
})

describe('EstoqueLista — produto que ainda nao existia na data', () => {
  it('lista vazia numa data passada nao manda "lance uma entrada" — o deposito pode estar cheio hoje', async () => {
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    mockRotas([])
    fireEvent.change(seletorDeData(container), { target: { value: '2026-03-09' } })

    expect(await screen.findByText(/nada em estoque em 09\/03/i)).toBeInTheDocument()
    expect(screen.queryByText(/nada em estoque ainda/i)).not.toBeInTheDocument()
    // E diz o motivo: ausencia, nao saldo zero.
    expect(screen.getByText(/fora da lista/i)).toBeInTheDocument()
  })

  it('em hoje, a lista vazia continua com a mensagem de sempre', async () => {
    mockRotas([])
    render(<EstoqueLista />)
    expect(await screen.findByText(/nada em estoque ainda/i)).toBeInTheDocument()
  })
})

describe('EstoqueLista — saida sem data de entrega na posicao historica', () => {
  const comSaidaSemData = () => linha({ saiu: 30, itens_saida_sem_data: 2 })

  it('em HOJE nao marca nem explica — ali essa saida ja e o saldo de agora', async () => {
    mockRotas([comSaidaSemData()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    expect(container.querySelector('.estoque-sem-data')).toBeNull()
    expect(screen.queryByRole('note', { name: 'Saídas sem data de entrega' })).not.toBeInTheDocument()
  })

  it('numa data passada, marca a coluna SAIU e explica no rodape', async () => {
    mockRotas([comSaidaSemData()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })

    const marca = await vi.waitFor(() => {
      const el = container.querySelector('.estoque-sem-data')
      if (!el) throw new Error('marca nao apareceu')
      return el as HTMLElement
    })
    // A marca e † — deliberadamente diferente do * de "quantidade incompleta",
    // que e outro problema.
    expect(marca).toHaveTextContent('30†')
    expect(marca).toHaveAttribute('title', expect.stringContaining('2 saídas'))

    const nota = screen.getByRole('note', { name: 'Saídas sem data de entrega' })
    expect(nota).toHaveTextContent(/2 saídas sem data de entrega/i)
    expect(nota).toHaveTextContent(/em todas/i)
    expect(nota).toHaveTextContent(/Preencha a entrega/i)
  })

  it('linha sem nenhuma saida sem data nao ganha marca, mesmo na posicao historica', async () => {
    mockRotas([linha({ itens_saida_sem_data: 0 })])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })
    await screen.findByRole('status')
    expect(container.querySelector('.estoque-sem-data')).toBeNull()
    expect(screen.queryByRole('note', { name: 'Saídas sem data de entrega' })).not.toBeInTheDocument()
  })
})

describe('EstoqueLista — a nota de escopo passou a cobrir a data propria', () => {
  it('continua dizendo que a tela nao segue o filtro de periodo global', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const nota = screen.getByRole('note', { name: 'Escopo do estoque' })
    expect(nota).toHaveTextContent(/não segue o filtro de período/i)
  })

  it('e passou a dizer que a tela tem data propria, e que ela e um CORTE ate a data', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const nota = screen.getByRole('note', { name: 'Escopo do estoque' })
    expect(nota).toHaveTextContent(/data própria/i)
    expect(nota).toHaveTextContent(/Posição em/i)
    expect(nota).toHaveTextContent(/corte/i)
    // A distincao que e o ponto inteiro da funcionalidade.
    expect(nota).toHaveTextContent(/intervalo/i)
  })

  it('diz que item sem movimentacao ate a data fica FORA da lista — travessao nunca vira zero', async () => {
    mockRotas([linha()])
    render(<EstoqueLista />)
    await screen.findByText('Tomate')
    const nota = screen.getByRole('note', { name: 'Escopo do estoque' })
    expect(nota).toHaveTextContent(/não aparece na lista/i)
    expect(nota).toHaveTextContent(/não é saldo zero/i)
  })
})

describe('EstoqueLista — trocar a data e um recarregamento, nao um filtro no cliente', () => {
  it('enquanto a nova posicao carrega, a tabela ANTIGA sai da tela', async () => {
    // Sem isto, o aviso "posição em 09/03" apareceria por cima dos números de
    // hoje — a combinação exata que faz alguém decidir com o número errado.
    let resolver: (v: unknown) => void = () => {}
    const pendente = new Promise(res => { resolver = res })
    mockGet.mockImplementation((url: string) => {
      const caminho = url.split('?')[0]
      if (caminho === '/api/estoque') {
        return url.includes('posicao_em') ? pendente : Promise.resolve([linha()])
      }
      return Promise.resolve([])
    })

    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: PASSADO } })

    expect(within(secaoSaldo(container)).getByText('Carregando…')).toBeInTheDocument()
    expect(screen.queryByText('Tomate')).not.toBeInTheDocument()

    resolver([])
    expect(await screen.findByText(/nada em estoque em/i)).toBeInTheDocument()
  })

  it('escolher uma data que da o MESMO corte nao trava a tela em "Carregando…"', async () => {
    // Amanhã e hoje dão a mesma posição (a atual), então não há busca nova
    // para desligar o carregamento — ligá-lo aqui deixaria a tela pendurada.
    mockRotas([linha()])
    const { container } = render(<EstoqueLista />)
    await screen.findByText('Tomate')
    fireEvent.change(seletorDeData(container), { target: { value: AMANHA } })
    expect(within(secaoSaldo(container)).queryByText('Carregando…')).toBeNull()
    expect(screen.getByText('Tomate')).toBeInTheDocument()
  })
})
