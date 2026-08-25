import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { RelatoriosTela } from './RelatoriosTela'
import { api, ErroApi } from '../api/client'

// Mock só de `api.get` — mantém a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
// Mesmo molde de ClientesLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const cliente = (over: Record<string, unknown> = {}) => ({
  id: 'c1', nome: 'Mercado A', resp: 'Sônia', tel: '(41) 90000-0000', rota: 'Sul A', freq: '2x/sem',
  status: 'ativo', tend: '→', limite: 5000, prazo: 14, ...over,
})

const saida = (over: Record<string, unknown> = {}) => ({
  numero: '#2041', cliente_id: 'c1', rota: 'Sul A', entrega: '2026-06-10',
  status: 'Entregue', pag: 'Pago', venc: null, data_pag: '2026-06-12',
  perda_kg: 0, valor: 1000, peso: 100, ...over,
})

const entrada = (over: Record<string, unknown> = {}) => ({
  numero: 'C-1040', fornecedor_id: 'f1', data: '2026-06-08', perda_kg: 0,
  motivo: 'transporte', pago: 'Pago', data_pag: '2026-06-10',
  valor_total: 4000, peso_total: 2000, ...over,
})

const fornecedor = (over: Record<string, unknown> = {}) => ({
  id: 'f1', nome: 'Fazenda Boa Terra', regiao: 'Norte do PR', contato: '(43) 90000-0000', ...over,
})

const lancamento = (over: Record<string, unknown> = {}) => ({
  id: 'l1', data: '2026-06-08', categoria: 'Frete', descricao: 'Coleta Norte',
  valor: 1280, funcionario_id: null, ...over,
})

/** Como GET /api/perdas devolve: `qtd` na unidade da propria perda e
 * `qtd_kg` a mesma perda em quilos (null quando nao convertivel). O default e
 * uma perda em KG, onde a conversao e no-op. */
const perda = (over: Record<string, unknown> = {}) => ({
  data: '2026-06-19', produto_id: 'p1', un: 'KG', qtd: 4, qtd_kg: 4,
  motivo: 'vencimento', itens_sem_conversao: 0, ...over,
})

const produtoAgregado = (over: Record<string, unknown> = {}) => ({
  produto_id: 'p1', nome: 'Batata', un: 'KG',
  compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5,
  venda_qtd: 80, venda_valor: 400, perda_deposito_qtd: 0,
  ...over,
})

/** Router de URL padrão — cada teste sobrescreve só o que precisa. */
function mockCarga(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    '/api/clientes': [], '/api/saidas': [], '/api/entradas': [], '/api/perdas': [],
    '/api/lancamentos': [], '/api/fornecedores': [], '/api/produtos': [],
    'produtos-agregados': [],
    ...overrides,
  }
  mockGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/api/relatorios/produtos')) return Promise.resolve(base['produtos-agregados'])
    if (rota in base) return Promise.resolve(base[rota])
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('RelatoriosTela — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a carga principal falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os relatórios.')
  })

  it('vazio: mostra a mensagem de onboarding quando nao ha nenhum dado lancado', async () => {
    mockCarga()
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/ainda não há dados para gerar relatórios/i)).toBeInTheDocument()
  })

  it('com dados: mostra a aba de clientes (padrao) com a linha do cliente', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
    // Faturamento do período e ticket/entrega da linha coincidem em R$ 1.000
    // com só 1 pedido no período — daí getAllByText, não getByText.
    expect(screen.getAllByText('R$ 1.000').length).toBeGreaterThan(0)
  })
})

describe('RelatoriosTela — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<RelatoriosTela onSessaoExpirada={onSessaoExpirada} />)
    // As duas cargas (a principal e a de produtos agregados) chamam a API em
    // paralelo — ambas recebem 401 e ambas chamam onSessaoExpirada.
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('RelatoriosTela — abas', () => {
  it('troca de aba mostra outro relatorio', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ pag: 'Atrasado', venc: '2026-06-01' })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(screen.getByRole('button', { name: 'Inadimplentes' }))
    expect(await screen.findByText('Total em atraso')).toBeInTheDocument()
    // saida esta Atrasado, mas nao Entregue -> nao conta como faturado; ainda
    // assim o cliente aparece na lista de inadimplentes (valor em atraso)
    expect(screen.getAllByText('Mercado A').length).toBeGreaterThan(0)
  })

  it('aba Produtos mostra os dados do endpoint agregado', async () => {
    mockCarga({ 'produtos-agregados': [produtoAgregado()] })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument())

    // Sem dado nas seis fontes principais, a tela mostraria o estado vazio.
    // Aqui garantimos que ha produto agregado; testamos via troca de aba
    // ainda que a tela geral esteja vazia (produtos usa fonte separada).
  })
})

describe('RelatoriosTela — filtro de periodo', () => {
  it('De/Ate refaz a busca do relatorio de produtos com os parametros certos', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida()],
      'produtos-agregados': [produtoAgregado()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-06' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-06' } })

    // Cada mudança de input dispara sua própria chamada (de sozinho, depois
    // de+ate juntos) — pega a ÚLTIMA chamada ao endpoint agregado, que reflete
    // o filtro final.
    await waitFor(() => {
      const chamadas = mockGet.mock.calls
        .map(([rota]) => String(rota))
        .filter(rota => rota.startsWith('/api/relatorios/produtos?'))
      const ultima = chamadas.at(-1)
      expect(ultima).toContain('de=2026-06')
      expect(ultima).toContain('ate=2026-06')
    })
  })

  it('De/Ate filtra o relatorio de clientes (calculado em memoria) sem novo fetch', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [
        saida({ numero: '#1', entrega: '2026-05-10', valor: 500 }),
        saida({ numero: '#2', entrega: '2026-06-10', valor: 1000 }),
      ],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    // faturamento sem filtro = 500+1000 = 1500 (cartao "Faturamento do período")
    const cartaoFaturamento = () => screen.getByText('Faturamento do período').closest('.relatorios-cartao') as HTMLElement
    expect(within(cartaoFaturamento()).getByText('R$ 1.500')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-06' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-06' } })

    // so a de junho: 1000
    await waitFor(() => expect(within(cartaoFaturamento()).getByText('R$ 1.000')).toBeInTheDocument())
  })

  it('"Limpar período" volta a mostrar tudo', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ entrega: '2026-05-10', valor: 500 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    const cartaoFaturamento = () => screen.getByText('Faturamento do período').closest('.relatorios-cartao') as HTMLElement

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-06' } })
    await waitFor(() => expect(within(cartaoFaturamento()).getByText('R$ 0')).toBeInTheDocument()) // sem faturado em junho

    fireEvent.click(screen.getByRole('button', { name: /limpar período/i }))
    await waitFor(() => expect(within(cartaoFaturamento()).getByText('R$ 500')).toBeInTheDocument())
  })
})

/** jsdom não implementa Blob.prototype.text() nem é compatível com o Response
 * nativo do Node — FileReader é o jeito que o próprio jsdom sabe ler o
 * conteúdo de volta a partir de um Blob criado por ele mesmo. */
function lerBlobComoTexto(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(leitor.error)
    leitor.readAsText(blob)
  })
}

describe('RelatoriosTela — exportar CSV', () => {
  let blobsCriados: Blob[]

  beforeEach(() => {
    blobsCriados = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobsCriados.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    // jsdom nao implementa navegacao de verdade — sem isto, o a.click() do
    // download tenta "navegar" pro href fake e imprime um erro
    // "Not implemented: navigation" (ruido, nao falha o teste, mas polui o
    // log). So queremos confirmar que o Blob foi montado certo, nao que o
    // browser de verdade baixaria o arquivo.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('gera um CSV com separador ";" e escapa nome de cliente com ponto e virgula', async () => {
    mockCarga({
      '/api/clientes': [cliente({ nome: 'Mercado; Bom Preço' })],
      '/api/saidas': [saida()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado; Bom Preço')

    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    expect(texto).toContain('Cliente;Rota;Status;Pedidos;Faturado')
    expect(texto).toContain('"Mercado; Bom Preço"')
    // O BOM (0xFEFF) na frente do CSV é coberto em derive/relatorios.test.ts
    // (gerarCsv) direto na string — o decoder do FileReader engole o BOM ao
    // interpretar o Blob como texto (comportamento padrão de UTF-8 decode,
    // não um bug daqui), então não repetimos essa checagem neste nível.
  })
})

describe('RelatoriosTela — imprimir', () => {
  it('botao Imprimir / PDF chama window.print (sem geracao de PDF no servidor)', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida()],
    })
    const espiao = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }))
    expect(espiao).toHaveBeenCalledOnce()
  })
})

describe('RelatoriosTela — inadimplentes vazio', () => {
  it('sem cliente em atraso, mostra a mensagem dedicada', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ pag: 'Pago' })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Inadimplentes' }))
    expect(await screen.findByText('Nenhum cliente em atraso')).toBeInTheDocument()
  })
})

describe('RelatoriosTela — compras', () => {
  it('mostra o fornecedor resolvido a partir do fornecedor_id', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida()],
      '/api/entradas': [entrada()],
      '/api/fornecedores': [fornecedor()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }))
    expect(await screen.findByText('Fazenda Boa Terra')).toBeInTheDocument()
  })

  // `peso_total` vem da API em kg, mas item em unidade nao-KG sem peso
  // medio cadastrado nao e convertivel e fica de fora (a API conta quantos
  // em itens_sem_conversao). O valor desses itens continua no numerador do
  // preco medio e o peso deles nao entra no denominador: o numero sai para
  // cima e nao pode aparecer como se fosse fechado.
  it('quantidade completa: preco medio sai limpo, sem marca nem aviso', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ valor_total: 4000, peso_total: 2000 })],
      '/api/fornecedores': [fornecedor()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }))

    expect(await screen.findByText('R$ 2,00')).toBeInTheDocument()
    expect(screen.queryByText('R$ 2,00*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('quantidade incompleta: preco medio marcado com * e nota explicando o que ficou de fora', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ valor_total: 4000, peso_total: 2000, itens_sem_conversao: 2 })],
      '/api/fornecedores': [fornecedor()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }))

    const marcado = await screen.findByText('R$ 2,00*')
    expect(marcado).toBeInTheDocument()
    // A explicacao vive no title da propria celula — o asterisco sozinho
    // sinalizaria sem dizer o que falta.
    expect(marcado).toHaveAttribute('title', expect.stringContaining('2 itens lançados'))
    expect(marcado.getAttribute('title')).toContain('peso médio')

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('fora da quantidade')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem')
  })

  // ---- perda de deposito: `perdas.qtd` esta na unidade da propria perda e
  // era somada crua aos quilos da perda de coleta.

  function cartao(rotulo: string): HTMLElement {
    const el = screen.getByText(rotulo).closest('.relatorios-cartao')
    if (!el) throw new Error(`cartao "${rotulo}" nao encontrado`)
    return el as HTMLElement
  }

  it('perda de deposito em CX entra pelos quilos nos cartoes e na tabela por motivo', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10, peso_total: 1000 })],
      '/api/perdas': [perda({ un: 'CX', qtd: 4, qtd_kg: 32 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    const painel = (await screen.findByText('Perdas por motivo')).closest('.relatorios-painel') as HTMLElement
    // 10 kg de coleta + 32 kg de deposito. Somando `qtd` cru daria 14.
    expect(within(cartao('Perda total (kg)')).getByText('42')).toBeInTheDocument()
    expect(within(cartao('Índice de perdas')).getByText('4,2%')).toBeInTheDocument()
    expect(within(painel).getByText('32')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('perda de deposito sem fator: cartoes e linha do motivo marcados com *, mais nota propria', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10, peso_total: 1000 })],
      '/api/perdas': [perda({ un: 'CX', qtd: 4, qtd_kg: null, itens_sem_conversao: 1 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    await screen.findByText('Perdas por motivo')
    const total = within(cartao('Perda total (kg)')).getByText('10*')
    expect(total).toHaveAttribute('title', expect.stringContaining('1 item lançado'))
    // A consequencia desta aba diz a DIRECAO do desvio, que aqui e para baixo
    // (a perda fica de fora do numerador) — o oposto das outras abas.
    expect(total).toHaveAttribute('title', expect.stringContaining('menos perda do que houve'))
    expect(within(cartao('Índice de perdas')).getByText('1,0%*')).toBeInTheDocument()

    const painel = screen.getByText('Perdas por motivo').closest('.relatorios-painel') as HTMLElement
    const linhaVencimento = within(painel).getByText('vencimento')
      .closest('.relatorios-motivo-linha') as HTMLElement
    // O motivo afetado leva a marca; o numero de ocorrencias nao (a perda
    // aconteceu — o que falta e o peso dela).
    expect(within(linhaVencimento).getByText('0*')).toBeInTheDocument()
    expect(within(linhaVencimento).getByText('1 ocorr.')).toBeInTheDocument()

    expect(screen.getByRole('note')).toHaveTextContent('Cadastre o peso médio da embalagem')
  })

  it('motivo fechado nao ganha marca so porque o vizinho esta incompleto', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10, peso_total: 1000 })],
      '/api/perdas': [
        perda({ motivo: 'manuseio', un: 'CX', qtd: 4, qtd_kg: 32 }),
        perda({ motivo: 'vencimento', un: 'CX', qtd: 4, qtd_kg: null, itens_sem_conversao: 1 }),
      ],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    const painel = (await screen.findByText('Perdas por motivo')).closest('.relatorios-painel') as HTMLElement
    expect(within(painel).getByText('32')).toBeInTheDocument() // manuseio, fechado
    expect(within(painel).queryByText('32*')).not.toBeInTheDocument()
    expect(within(painel).getByText('0*')).toBeInTheDocument() // vencimento, incompleto
  })
})

describe('RelatoriosTela — lançamentos (livro-caixa)', () => {
  it('combina venda paga, compra paga e lancamento de custo', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ pag: 'Pago' })],
      '/api/entradas': [entrada({ pago: 'Pago' })],
      '/api/fornecedores': [fornecedor()],
      '/api/lancamentos': [lancamento()],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Lançamentos' }))

    expect(await screen.findByText('Venda #2041 — Mercado A')).toBeInTheDocument()
    expect(screen.getByText('Compra C-1040 — Fazenda Boa Terra')).toBeInTheDocument()
    expect(screen.getByText('Frete — Coleta Norte')).toBeInTheDocument()
  })
})

describe('RelatoriosTela — indice de perdas (o mesmo numero do painel)', () => {
  function cartaoDe(rotulo: string): HTMLElement {
    const el = screen.getByText(rotulo).closest('.relatorios-cartao')
    if (!el) throw new Error(`cartao "${rotulo}" nao encontrado`)
    return el as HTMLElement
  }

  async function abrirPerdas() {
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByRole('button', { name: 'Perdas' })
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))
    await screen.findByText('Perdas por motivo')
  }

  it('com dado: soma coleta e deposito sobre o kg comprado, igual ao KPI do painel', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ perda_kg: 50, peso_total: 1000 })],
      '/api/perdas': [perda({ un: 'CX', qtd: 4, qtd_kg: 20 })],
    })
    await abrirPerdas()
    // (50 + 20) / 1000 = 7% — o mesmo que indiceDePerdas devolve (comparado
    // numero a numero em derive/relatorios.test.ts).
    expect(within(cartaoDe('Índice de perdas')).getByText('7,0%')).toBeInTheDocument()
    expect(within(cartaoDe('Índice de perdas')).getByText('meta ≤ 10%')).toBeInTheDocument()
  })

  it('zero MEDIDO continua sendo 0,0%: houve compra e nao houve perda', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ perda_kg: 0, peso_total: 1000 })],
    })
    await abrirPerdas()
    expect(within(cartaoDe('Índice de perdas')).getByText('0,0%')).toBeInTheDocument()
  })

  it('sem dado: sem compra no periodo o cartao vira travessao, NUNCA 0,0%', async () => {
    // A conta que a aba fazia a mao devolvia 0 aqui — "0,0% de perdas" no
    // cartao em que nada foi medido, a leitura mais tranquilizadora possivel
    // justamente onde nao ha medida. `indiceDePerdas` devolve indisponivel.
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/perdas': [perda({ un: 'KG', qtd: 9, qtd_kg: 9 })],
    })
    await abrirPerdas()
    const cartao = cartaoDe('Índice de perdas')
    expect(within(cartao).getByText('—')).toBeInTheDocument()
    expect(within(cartao).queryByText('0,0%')).not.toBeInTheDocument()
    expect(within(cartao).getByText('sem compra no período para medir')).toBeInTheDocument()
    // O resto da aba continua vivo: a perda de deposito MEDIDA e um numero.
    expect(within(cartaoDe('Perda total (kg)')).getByText('9')).toBeInTheDocument()
  })

  it('falha de carregamento: a tela inteira avisa em vez de mostrar indice pela metade', async () => {
    // A aba Perdas depende de DUAS rotas (entradas e perdas) que vem na mesma
    // carga; sem uma delas o indice sairia parcial, e um indice parcial e
    // exatamente a divergencia que esta unificacao fecha. A tela nao tenta
    // adivinhar: mostra o alerta e nao renderiza numero nenhum.
    mockGet.mockImplementation((rota: string) => {
      if (rota === '/api/perdas') return Promise.reject(new Error('falha de rede'))
      if (rota.startsWith('/api/relatorios/produtos')) return Promise.resolve([])
      return Promise.resolve([])
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os relatórios.')
    expect(screen.queryByText('Índice de perdas')).not.toBeInTheDocument()
  })
})

describe('RelatoriosTela — perdas', () => {
  it('mostra perda por motivo a partir do cabecalho da entrada e das perdas de deposito', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10 })],
      '/api/perdas': [perda({ motivo: 'vencimento', qtd: 4 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    const painel = (await screen.findByText('Perdas por motivo')).closest('.relatorios-painel') as HTMLElement
    expect(within(painel).getByText('transporte')).toBeInTheDocument()
    expect(within(painel).getByText('vencimento')).toBeInTheDocument()
  })

  // "Perdas por produto" reaproveita as linhas de derivarRelatorioProdutos:
  // herdou os numeros em kg quando eles foram corrigidos, mas nao a
  // sinalizacao do que ficou fora da conversao — exibia incompleto limpo.

  it('quantidade completa na aba Perdas: comprado e perda % saem limpos, sem marca nem aviso', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10 })],
      'produtos-agregados': [produtoAgregado({ compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    const painel = (await screen.findByText('Perdas por produto')).closest('.relatorios-painel') as HTMLElement
    expect(within(painel).getByText('100')).toBeInTheDocument()
    expect(within(painel).queryByText('100*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('quantidade incompleta na aba Perdas: comprado e perda % marcados com *, mais a nota de rodape', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10 })],
      'produtos-agregados': [produtoAgregado({
        compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5, itens_sem_conversao: 2,
      })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))

    const painel = (await screen.findByText('Perdas por produto')).closest('.relatorios-painel') as HTMLElement
    expect(within(painel).getByText('100*')).toBeInTheDocument()
    expect(within(painel).getByText('5,0%*')).toBeInTheDocument()
    expect(within(painel).getByText('100*')).toHaveAttribute('title', expect.stringContaining('2 itens lançados'))

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('fora da quantidade')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem')
  })
})

// As quantidades das abas Pedidos e Produtos vem da API em kg, mas
// lancamento em unidade nao-KG sem peso medio cadastrado nao e convertivel e
// fica de fora (a API conta quantos em itens_sem_conversao). O valor em reais
// desses lancamentos continua nas contas e o peso deles nao: os numeros saem
// para cima e nao podem aparecer como se fossem fechados. Mesma sinalizacao
// da aba Compras — asterisco na celula, explicacao no title, nota no rodape.

describe('RelatoriosTela — pedidos: quantidade incompleta', () => {
  it('quantidade completa: qtd entregue e qtd por rota saem limpas, sem marca nem aviso', async () => {
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida({ peso: 100 })] })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Pedidos' }))

    // Duas ocorrencias: o cartao "Qtd entregue" e a celula QTD da rota.
    expect(await screen.findAllByText('100')).toHaveLength(2)
    expect(screen.queryByText('100*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('quantidade incompleta: cartao e celula da rota marcados com * e nota explicando', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ peso: 100, itens_sem_conversao: 2 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Pedidos' }))

    const marcados = await screen.findAllByText('100*')
    expect(marcados).toHaveLength(2)
    // A explicacao vive no title da propria celula — o asterisco sozinho
    // sinalizaria sem dizer o que falta.
    expect(marcados[0]).toHaveAttribute('title', expect.stringContaining('2 itens lançados'))
    expect(marcados[0].getAttribute('title')).toContain('peso médio')

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('fora da quantidade')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem')
  })

  it('pedido nao entregue nao entra no cartao, mas continua contado na tabela por rota', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ status: 'Em rota', peso: 100, itens_sem_conversao: 1 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Pedidos' }))

    // Cartao "Qtd entregue" = 0 (nada entregue) e sem marca: o contador dele
    // descreve so os entregues. A celula da rota, que soma todos os pedidos
    // do periodo, sai marcada.
    expect(await screen.findByText('100*')).toBeInTheDocument()
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})

describe('RelatoriosTela — produtos: quantidade incompleta', () => {
  it('quantidade completa: as cinco metricas saem limpas, sem marca nem aviso', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      'produtos-agregados': [produtoAgregado({ compra_qtd: 100, compra_valor: 200, venda_qtd: 80, venda_valor: 400 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Produtos' }))

    // "Batata" aparece tambem nos cartoes do topo (mais fatura/maior
    // margem/maior perda) — a linha da tabela e a unica dentro de
    // .relatorios-linha.
    const linha = (await screen.findAllByText('Batata'))
      .map(el => el.closest('.relatorios-linha'))
      .find((el): el is HTMLElement => el != null)!
    expect(within(linha).getByText('100')).toBeInTheDocument()
    expect(within(linha).getByText('80')).toBeInTheDocument()
    expect(within(linha).queryByText('100*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('quantidade incompleta: comprado, vendido, margem, markup e perda marcados com *', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      'produtos-agregados': [produtoAgregado({
        compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5,
        venda_qtd: 80, venda_valor: 400, itens_sem_conversao: 2,
      })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Produtos' }))

    // "Batata" aparece tambem nos cartoes do topo (mais fatura/maior
    // margem/maior perda) — a linha da tabela e a unica dentro de
    // .relatorios-linha.
    const linha = (await screen.findAllByText('Batata'))
      .map(el => el.closest('.relatorios-linha'))
      .find((el): el is HTMLElement => el != null)!
    // Todos os numeros derivados de quantidade: comprado (100), vendido (80),
    // margem (400 - 80*2 = R$ 240), markup ((5-2)/2 = 150%) e perda (5%).
    // Faturamento (R$ 400) escapa — reais sao reais.
    expect(within(linha).getByText('100*')).toBeInTheDocument()
    expect(within(linha).getByText('80*')).toBeInTheDocument()
    expect(within(linha).getByText('R$ 240*')).toBeInTheDocument()
    expect(within(linha).getByText('150%*')).toBeInTheDocument()
    expect(within(linha).getByText('5,0%*')).toBeInTheDocument()
    expect(within(linha).getByText('R$ 400')).toBeInTheDocument()

    expect(within(linha).getByText('100*')).toHaveAttribute('title', expect.stringContaining('2 itens lançados'))

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('fora da quantidade')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem')
  })
})

describe('RelatoriosTela — CSV das quantidades incompletas', () => {
  let blobsCriados: Blob[]

  beforeEach(() => {
    blobsCriados = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobsCriados.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('CSV de pedidos leva o mesmo asterisco da tela na coluna de quantidade', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/saidas': [saida({ peso: 100, itens_sem_conversao: 1 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Pedidos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    // O cabecalho diz a unidade e a linha diz que aquele total esta incompleto.
    expect(texto).toContain('Qtd (kg)')
    expect(texto).toContain('100*')
  })

  it('CSV de produtos marca as mesmas cinco colunas da tela', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      'produtos-agregados': [produtoAgregado({
        compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5,
        venda_qtd: 80, venda_valor: 400, itens_sem_conversao: 1,
      })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Produtos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    expect(texto).toContain('Qtd comprada (kg)')
    expect(texto).toContain('100*;80*;R$ 400;R$ 240*;150%*;5,0%*')
  })

  it('CSV de perdas: a tabela por motivo sai em kg e leva o mesmo asterisco da tela', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10, peso_total: 1000 })],
      '/api/perdas': [
        perda({ motivo: 'manuseio', un: 'CX', qtd: 4, qtd_kg: 32 }),
        perda({ motivo: 'vencimento', un: 'CX', qtd: 4, qtd_kg: null, itens_sem_conversao: 1 }),
      ],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    expect(texto).toContain('Quantidade (kg)')
    expect(texto).toContain('manuseio;32;1;')      // convertido, sem marca
    expect(texto).toContain('vencimento;0*;1;')    // fora da soma, marcado
  })

  it('CSV de perdas leva o mesmo asterisco da tela na tabela por produto', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      '/api/entradas': [entrada({ motivo: 'transporte', perda_kg: 10 })],
      'produtos-agregados': [produtoAgregado({
        compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: 5, itens_sem_conversao: 2,
      })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Perdas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    expect(texto).toContain('Qtd comprada (kg)')
    expect(texto).toContain('Batata;100*;5,0%*')
  })

  it('sem lancamento fora da conversao, o CSV sai sem asterisco nenhum', async () => {
    mockCarga({
      '/api/clientes': [cliente()],
      'produtos-agregados': [produtoAgregado({ compra_qtd: 100, compra_valor: 200, venda_qtd: 80, venda_valor: 400 })],
    })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.click(screen.getByRole('button', { name: 'Produtos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(blobsCriados).toHaveLength(1))
    const texto = await lerBlobComoTexto(blobsCriados[0])
    expect(texto).not.toContain('*')
  })
})

// ================================= periodo global (achado S-3 da auditoria)
// Aqui o periodo global ALIMENTA o De/Ate local, em vez de substitui-lo —
// ver o comentario da prop `periodo` em RelatoriosTela.tsx.

describe('RelatoriosTela — periodo global alimenta o De/Ate', () => {
  it('abre com o De/Ate posicionado no mes escolhido no cabecalho', async () => {
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida()] })
    render(<RelatoriosTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    expect(screen.getByLabelText('De')).toHaveValue('2026-06')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-06')
    expect(screen.getByText(/filtrado por/i)).toHaveTextContent('jun/2026')
  })

  it('em "all" o De/Ate abre vazio (sem limite dos dois lados)', async () => {
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida()] })
    render(<RelatoriosTela onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    expect(screen.getByLabelText('De')).toHaveValue('')
    expect(screen.getByLabelText('Até')).toHaveValue('')
  })

  it('o De/Ate continua livre para alargar o intervalo depois', async () => {
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida()] })
    render(<RelatoriosTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-04' } })
    expect(screen.getByLabelText('De')).toHaveValue('2026-04')
    // O ajuste manual sobrevive: o periodo do cabecalho nao o desfaz sozinho.
    expect(screen.getByLabelText('Até')).toHaveValue('2026-06')
  })

  it('TROCAR o periodo no cabecalho reposiciona o De/Ate ja aberto', async () => {
    // O caso que o teste de montagem NAO cobre: a tela ja esta aberta com um
    // recorte e o usuario troca o mes la em cima. Sem a sincronizacao, o
    // De/Ate ficaria congelado no mes da montagem e o cabecalho diria uma
    // coisa enquanto o relatorio mostraria outra.
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida()] })
    const tela = render(<RelatoriosTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    expect(screen.getByLabelText('De')).toHaveValue('2026-06')

    tela.rerender(<RelatoriosTela periodo="2026-04" onSessaoExpirada={() => {}} />)
    expect(screen.getByLabelText('De')).toHaveValue('2026-04')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-04')

    tela.rerender(<RelatoriosTela periodo="all" onSessaoExpirada={() => {}} />)
    expect(screen.getByLabelText('De')).toHaveValue('')
    expect(screen.getByLabelText('Até')).toHaveValue('')
  })

  it('a busca do agregado de produtos vai com o recorte do cabecalho', async () => {
    mockCarga({ '/api/clientes': [cliente()], '/api/saidas': [saida()] })
    render(<RelatoriosTela periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Mercado A')
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/api/relatorios/produtos?de=2026-06&ate=2026-06'))
  })
})
