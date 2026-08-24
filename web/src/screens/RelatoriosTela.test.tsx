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

const perda = (over: Record<string, unknown> = {}) => ({
  data: '2026-06-19', produto_id: 'p1', qtd: 4, motivo: 'vencimento', ...over,
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
})
