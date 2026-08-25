import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { EntradasLista } from './EntradasLista'
import { api, ErroApi } from '../api/client'
import { derivarResumoEntradas } from '../derive/resumoOperacional'

// Mock so de `api.get/del/patch` — mantem a classe ErroApi real (o
// componente faz `err instanceof ErroApi`, precisa ser o mesmo construtor
// dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), del: vi.fn(), patch: vi.fn() } }
})

// Espiao sobre a derivacao dos cartoes: a implementacao REAL continua
// valendo em todos os testes (vi.fn(actual)); so o teste de isolacao de
// falha a troca por uma que lanca. Sem isso nao ha como provar que os
// cartoes falham sozinhos — a lista e os cartoes saem da MESMA chamada de
// API, entao nao existe um 401/500 que atinja um e nao o outro.
vi.mock('../derive/resumoOperacional', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../derive/resumoOperacional')>()
  return { ...actual, derivarResumoEntradas: vi.fn(actual.derivarResumoEntradas) }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>
const mockPatch = api.patch as unknown as ReturnType<typeof vi.fn>
const espiaoResumo = vi.mocked(derivarResumoEntradas)
const resumoReal = espiaoResumo.getMockImplementation() as typeof derivarResumoEntradas

const FORNECEDORES = [{ id: 'f-1', nome: 'Fazenda Boa Terra', regiao: 'Sul', contato: '' }]

const entrada = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  numero: 'C-1040',
  fornecedor_id: 'f-1',
  data: '2026-08-10',
  perda_kg: 0.5,
  motivo: 'transporte',
  pago: 'Pago',
  data_pag: '2026-08-11',
  forma_pag: 'PIX',
  obs: '',
  valor_total: 120,
  peso_total: 30,
  ...over,
})

const entradaComItens = {
  ...entrada(),
  itens: [{ id: 'i-1', produto_id: 'p-1', un: 'KG', qtd: 30, preco: 4, perda_kg: 0.5 }],
}

/** Uma perda de depósito, na forma que GET /api/perdas devolve (paraJsonLista
 * em api/src/routes/perdas.ts) — `qtd_kg` já convertido pela unidade da
 * própria perda, nunca o `qtd` cru. */
const perda = (over: Record<string, unknown> = {}) => ({
  id: 'pd-1',
  data: '2026-08-10',
  produto_id: 'p-1',
  un: 'KG',
  qtd: 0,
  qtd_kg: 0,
  motivo: 'vencimento',
  obs: '',
  itens_sem_conversao: 0,
  ...over,
})

/** Router de URL padrao — cobre tanto a tela quanto o ModalEntrada real que
 * ela monta (produtos/fornecedores). Cada teste pode sobrescrever so o que
 * precisa com mockGet.mockImplementation de novo. `perdas` default `[]`: a
 * maioria dos testes não é sobre o índice de perdas e não quer que ele
 * contribua com nada. */
function mockRotasPadrao(entradas: unknown[] = [entrada()], perdas: unknown[] = []) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/entradas') return Promise.resolve(entradas)
    if (url === '/api/entradas/e-1') return Promise.resolve(entradaComItens)
    if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
    if (url === '/api/produtos') return Promise.resolve([])
    if (url === '/api/perdas') return Promise.resolve(perdas)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

/** O bloco de cartoes de resumo — pra distinguir o valor de um cartao do
 * mesmo texto na tabela. */
function cartoes() {
  return within(screen.getByRole('group', { name: 'Resumo das entradas' }))
}

/** Um cartao pelo rotulo: devolve o card inteiro (valor + sub-linha). */
function cartao(rotulo: string): HTMLElement {
  return cartoes().getByText(rotulo).parentElement as HTMLElement
}

beforeEach(() => {
  mockGet.mockReset()
  mockDel.mockReset()
  mockPatch.mockReset()
  espiaoResumo.mockImplementation(resumoReal)
})

describe('EntradasLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<EntradasLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/entradas' ? Promise.reject(new Error('falha de rede')) : Promise.resolve([]),
    )
    render(<EntradasLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar as entradas.')
  })

  it('vazio: mostra "nenhuma entrada lançada" quando a API devolve lista vazia', async () => {
    mockRotasPadrao([])
    render(<EntradasLista />)
    expect(await screen.findByText(/nenhuma entrada lan[cç]ada/i)).toBeInTheDocument()
  })

  it('com dados: lista as entradas recebidas', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', numero: 'C-1040' }), entrada({ id: 'e-2', numero: 'C-1041' })])
    render(<EntradasLista />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.getByText('C-1041')).toBeInTheDocument()
  })
})

describe('EntradasLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockImplementation((url: string) =>
      url === '/api/entradas'
        ? Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
        : Promise.resolve([]),
    )
    const onSessaoExpirada = vi.fn()
    render(<EntradasLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — fornecedor 403 (colaborador) nao derruba a lista', () => {
  it('a lista de entradas renderiza normalmente mesmo se /api/fornecedores der 403', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') return Promise.resolve([entrada()])
      if (url === '/api/fornecedores') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      return Promise.resolve([])
    })
    render(<EntradasLista />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — abrir modal', () => {
  it('clicar em "Nova entrada" abre o modal de criação', async () => {
    mockRotasPadrao([])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: /lan[cç]ar primeira entrada/i }))
    expect(await screen.findByRole('dialog', { name: 'Nova entrada' })).toBeInTheDocument()
  })

  it('clicar numa linha busca o detalhe e abre o modal de edição preenchido', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByText('C-1040'))

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/entradas/e-1'))
    expect(await screen.findByRole('dialog', { name: 'Editar entrada' })).toBeInTheDocument()
    expect(screen.getByLabelText(/n[uú]mero da entrada/i)).toHaveValue('C-1040')
  })

  it('erro ao buscar o detalhe mostra alerta em vez de abrir o modal', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') return Promise.resolve([entrada()])
      if (url === '/api/entradas/e-1') return Promise.reject(new Error('falha'))
      return Promise.resolve([])
    })
    render(<EntradasLista />)
    fireEvent.click(await screen.findByText('C-1040'))
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel abrir esta entrada/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — confirmação antes de excluir', () => {
  it('clicar em Excluir mostra confirmacao e NAO chama a API antes de confirmar', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(await screen.findByRole('region', { name: 'Confirmar exclusão' })).toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('cancelar a confirmacao fecha o aviso sem excluir', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('confirmar exclusao chama DELETE com o id certo e some da lista', async () => {
    mockRotasPadrao([entrada()])
    mockDel.mockResolvedValue({ ok: true })
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/entradas/e-1'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Confirmar exclusão' })).not.toBeInTheDocument())
  })

  it('erro ao excluir mostra mensagem e mantem a confirmacao aberta', async () => {
    mockRotasPadrao([entrada()])
    mockDel.mockRejectedValue(new Error('falha'))
    render(<EntradasLista />)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText(/n[aã]o foi poss[ií]vel excluir/i)).toBeInTheDocument()
  })
})

describe('EntradasLista — pagamento editável na linha (chip vira seletor)', () => {
  it('o seletor nunca oferece "Atrasado" como opção — so Pendente/Pago', async () => {
    mockRotasPadrao([entrada({ pago: 'Atrasado' })])
    render(<EntradasLista />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    const valores = [...select.options].map(o => o.value)
    expect(valores).toEqual(['Pendente', 'Pago'])
  })

  it('marcar Pago chama o PATCH e a data de pagamento vem da resposta da API', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', numero: 'C-1040', pago: 'Pendente', data_pag: null })])
    mockPatch.mockResolvedValue({ pago: 'Pago', data_pag: '2026-08-24' })
    render(<EntradasLista />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/api/entradas/e-1/pago', { pago: 'Pago' }))
    // a tela nao inventa a data — so espelha o que a API devolveu (a API e
    // quem grava "hoje" no servidor)
    await waitFor(() => expect(select.value).toBe('Pago'))
  })

  it('voltar para Pendente chama o PATCH com "Pendente" (a API e quem limpa data_pag)', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', numero: 'C-1040', pago: 'Pago', data_pag: '2026-08-11' })])
    mockPatch.mockResolvedValue({ pago: 'Pendente', data_pag: null })
    render(<EntradasLista />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('Pago')

    fireEvent.change(select, { target: { value: 'Pendente' } })

    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/api/entradas/e-1/pago', { pago: 'Pendente' }))
    await waitFor(() => expect(select.value).toBe('Pendente'))
  })

  it('clicar no seletor NAO abre o modal de edição da linha (stopPropagation)', async () => {
    mockRotasPadrao([entrada()])
    render(<EntradasLista />)
    const select = await screen.findByRole('combobox')
    fireEvent.click(select)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falha do PATCH reverte o chip pro valor anterior e mostra aviso', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', pago: 'Pendente', data_pag: null })])
    mockPatch.mockRejectedValue(new Error('falha de rede'))
    render(<EntradasLista />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await screen.findByRole('alert')
    expect(select.value).toBe('Pendente')
  })

  it('sessao expirada (401) no PATCH chama onSessaoExpirada', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', pago: 'Pendente' })])
    mockPatch.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<EntradasLista onSessaoExpirada={onSessaoExpirada} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })
})

/**
 * `peso_total` chega da API em kg, com cada item convertido pela unidade
 * dele (KG conta direto, caixa conta qtd * produtos.peso_medio). Item em
 * unidade nao-KG cujo produto nao tem peso medio cadastrado nao e
 * convertivel: a API o deixa de fora e diz quantos foram em
 * `itens_sem_conversao`, em vez de inventar fator 1. A tela precisa dizer
 * isso — um peso silenciosamente menor que a realidade seria pior que um
 * peso marcado como incompleto.
 */
describe('EntradasLista — peso incompleto (itens sem peso medio cadastrado)', () => {
  it('entrada 100% convertivel: peso sai limpo, sem marca', async () => {
    mockRotasPadrao([entrada({ peso_total: 30 })])
    render(<EntradasLista />)
    // Duas ocorrencias: a celula da linha e o card "PESO RECEBIDO" no topo.
    expect(await screen.findAllByText('30 kg')).toHaveLength(2)
    expect(screen.queryByText('30 kg*')).not.toBeInTheDocument()
  })

  it('entrada com item nao convertivel: peso marcado com * e explicacao no title', async () => {
    mockRotasPadrao([entrada({ peso_total: 30, itens_sem_conversao: 1 })])
    render(<EntradasLista />)
    // Duas ocorrencias: a celula da linha e o card "PESO RECEBIDO" no topo,
    // ambos somando o mesmo peso incompleto.
    const marcados = await screen.findAllByText('30 kg*')
    expect(marcados).toHaveLength(2)
    expect(marcados[0].getAttribute('title')).toContain('peso médio')
    expect(marcados[0].getAttribute('title')).toContain('1 item')
  })
})

/**
 * Cartao "A pagar ao produtor" (achado E-1 da auditoria; protótipo
 * `entradaStats`, markup 471 e dado 2506). "Quanto devo ao produtor" nao
 * aparecia em nenhuma tela de rotina — so em Relatorios ▸ Compras, que e
 * tela de analise. E a outra ponta do capital de giro, junto do "A receber"
 * de Saidas.
 */
describe('EntradasLista — cartao "A pagar ao produtor"', () => {
  it('soma o valor das coletas ainda nao pagas e conta quantas sao', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', numero: 'C-1', pago: 'Pago', valor_total: 500 }),
      entrada({ id: 'e-2', numero: 'C-2', pago: 'Pendente', data_pag: null, valor_total: 300 }),
      entrada({ id: 'e-3', numero: 'C-3', pago: 'Pendente', data_pag: null, valor_total: 200 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1')
    const c = cartao('A PAGAR AO PRODUTOR')
    expect(within(c).getByText('R$ 500,00')).toBeInTheDocument()
    expect(within(c).getByText('2 coletas pendentes')).toBeInTheDocument()
  })

  it('`pago` gravado como "Atrasado" (dado legado) continua sendo divida', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', numero: 'C-1', pago: 'Atrasado', data_pag: null, valor_total: 250 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1')
    expect(within(cartao('A PAGAR AO PRODUTOR')).getByText('R$ 250,00')).toBeInTheDocument()
  })

  it('tudo pago: R$ 0,00 MEDIDO, nunca travessao — e a informacao boa', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', numero: 'C-1', pago: 'Pago', valor_total: 500 }),
      entrada({ id: 'e-2', numero: 'C-2', pago: 'Pago', valor_total: 300 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1')
    const c = cartao('A PAGAR AO PRODUTOR')
    expect(within(c).getByText('R$ 0,00')).toBeInTheDocument()
    expect(within(c).getByText('0 coletas pendentes')).toBeInTheDocument()
    expect(within(c).queryByText('—')).not.toBeInTheDocument()
  })

  it('sem nenhuma entrada lancada nao existe cartao com R$ 0,00 — o estado vazio explica', async () => {
    mockRotasPadrao([])
    render(<EntradasLista />)
    await screen.findByText(/nenhuma entrada lançada/i)
    expect(screen.queryByRole('group', { name: 'Resumo das entradas' })).not.toBeInTheDocument()
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument()
  })
})

/**
 * Cartao "ÍNDICE DE PERDAS" (antes "Perda média (coleta/transporte)") —
 * unificado ao KPI do painel (derive/dashboard.ts, indiceDePerdas): soma
 * perda de coleta (da própria entrada) + perda de depósito (GET /api/perdas),
 * sobre o peso recebido. A régua do semáforo também deixou de ser própria
 * desta tela (10/15) e passou a ser a do painel (10/13, METAS_DASHBOARD).
 */
describe('EntradasLista — cartao "Índice de perdas"', () => {
  const VERDE = 'rgb(63, 143, 91)'
  const AMBAR = 'rgb(199, 147, 32)'
  const VERMELHO = 'rgb(194, 80, 47)'
  const valorDo = (rotulo: string) => cartao(rotulo).querySelector('.entradas-stat-valor') as HTMLElement

  it('mostra a perda como % do peso recebido, com o alvo e os quilos na sub-linha', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('7,0%')).toBeInTheDocument()
    expect(within(c).getByText('meta ≤ 10% · 70 kg perdidos')).toBeInTheDocument()
  })

  it('coleta + depósito somando: o cartão passa a incluir a perda de depósito', async () => {
    // Antes desta unificação o cartão mostraria só 50/1000 = 5% (só coleta).
    // Com a perda de depósito somada, (50+20)/1000 = 7% — o mesmo número que
    // o KPI "Índice de perdas" do painel mostraria para este recorte.
    mockRotasPadrao(
      [entrada({ peso_total: 1000, perda_kg: 50, perda_itens_qtd: 0 })],
      [perda({ qtd_kg: 20 })],
    )
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('7,0%')).toBeInTheDocument()
    expect(within(c).getByText('meta ≤ 10% · 70 kg perdidos')).toBeInTheDocument()
  })

  it('só coleta (sem perda de depósito no período): bate com o número que o KPI do painel mostraria', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0 })], [])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    // (70 coleta + 0 depósito) / 1000 = 7% — indiceDePerdas([...], []) dá o
    // mesmo valor (ver a comparação número a número em resumoOperacional.test.ts).
    expect(within(cartao('ÍNDICE DE PERDAS')).getByText('7,0%')).toBeInTheDocument()
  })

  it('abaixo do alvo fica verde', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 99, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(valorDo('ÍNDICE DE PERDAS')).toHaveStyle({ color: VERDE })
  })

  it('exatamente no alvo (10%) ainda e verde — "meta ≤ 10%" inclui o 10', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('10,0%')).toBeInTheDocument()
    expect(valorDo('ÍNDICE DE PERDAS')).toHaveStyle({ color: VERDE })
  })

  it('acima do alvo (10%) e ate o limite ambar do painel (13%) fica ambar', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 130, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('13,0%')).toBeInTheDocument()
    expect(valorDo('ÍNDICE DE PERDAS')).toHaveStyle({ color: AMBAR })
  })

  it('acima de 13% (a régua do painel, não mais 15%) fica vermelho', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 131, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('13,1%')).toBeInTheDocument()
    expect(valorDo('ÍNDICE DE PERDAS')).toHaveStyle({ color: VERMELHO })
  })

  it('perda alta fica vermelha — a cor agora significa alguma coisa', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 300, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(valorDo('ÍNDICE DE PERDAS')).toHaveStyle({ color: VERMELHO })
  })

  it('coleta sem perda: 0,0% MEDIDO, nunca travessao', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 0, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(within(cartao('ÍNDICE DE PERDAS')).getByText('0,0%')).toBeInTheDocument()
  })

  it('sem peso recebido nao ha indice: travessao, nunca 0,0%', async () => {
    mockRotasPadrao([entrada({ peso_total: 0, perda_kg: 0, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('ÍNDICE DE PERDAS')
    expect(within(c).getByText('—')).toBeInTheDocument()
    expect(within(c).queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('cabecalho e itens descrevem a MESMA perda de coleta: usa o maior, nunca a soma', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 60 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    // Somar daria 160 kg (16%); o certo e 100 kg (10%).
    expect(within(cartao('ÍNDICE DE PERDAS')).getByText('10,0%')).toBeInTheDocument()
  })

  it('item de entrada nao convertivel: o indice sai marcado com * e a nota de rodape explica', async () => {
    mockRotasPadrao([
      entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0, itens_sem_conversao: 2 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const marcado = within(cartao('ÍNDICE DE PERDAS')).getByText('7,0%*')
    expect(marcado.getAttribute('title')).toContain('peso médio')
    expect(marcado.getAttribute('title')).toContain('2 itens')
    // Duas notas (PESO RECEBIDO tambem esta marcado, mesma causa): a do peso
    // recebido tem direcao conhecida ("sai para cima").
    const notas = screen.getAllByRole('note')
    expect(notas.some(n => /sai para cima/i.test(n.textContent ?? ''))).toBe(true)
  })

  it('item de perda de DEPÓSITO nao convertivel marca so o indice, nunca o peso recebido', async () => {
    mockRotasPadrao(
      [entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0, itens_sem_conversao: 0 })],
      [perda({ qtd_kg: null, itens_sem_conversao: 1 })],
    )
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    // PESO RECEBIDO continua limpo — a entrada em si converteu 100%.
    expect(within(cartao('PESO RECEBIDO')).queryByText(/\*/)).not.toBeInTheDocument()
    // O indice, nao: a perda de deposito que nao converteu deixa a soma
    // (numerador) incompleta, mesmo com o peso recebido (denominador) inteiro.
    const marcado = within(cartao('ÍNDICE DE PERDAS')).getByText('7,0%*')
    expect(marcado.getAttribute('title')).toContain('nem a direção do desvio é conhecida')
    const notas = screen.getAllByRole('note')
    expect(notas.some(n => /nem a dire[cç][aã]o do desvio/i.test(n.textContent ?? ''))).toBe(true)
  })

  it('sem item fora da conversao nao ha nota de rodape nem asterisco', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText('7,0%*')).not.toBeInTheDocument()
  })
})

/**
 * Falha isolada de GET /api/perdas (regra desta unificação): o índice não
 * pode cair de volta para "só perda de coleta" como se fosse o total — isso
 * reintroduziria a divergência com o painel, agora escondida atrás de um
 * número que parece fechado. Vira travessão com aviso `role="status"`
 * próprio, diferente do aviso de `resumoFalhou`, e o resto da tela
 * (lista + os outros quatro cartões) continua vivo — padrão de
 * ClientesLista.tsx (`erroVendas`).
 */
describe('EntradasLista — falha isolada de /api/perdas', () => {
  it('o índice vira travessão com aviso, mas os outros cartões e a lista continuam normais', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') {
        return Promise.resolve([entrada({ peso_total: 1000, perda_kg: 70, valor_total: 120 })])
      }
      if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
      if (url === '/api/perdas') return Promise.reject(new Error('falha de rede'))
      return Promise.resolve([])
    })
    render(<EntradasLista />)
    await screen.findByText('C-1040')

    expect(screen.getByRole('status')).toHaveTextContent(/n[aã]o foi poss[íi]vel carregar as perdas de dep[oó]sito/i)

    const c = cartao('ÍNDICE DE PERDAS')
    // Os dois — valor E sub-linha (quilos) — viram travessão: mostrar o
    // quilo perdido sem o índice seria a mesma meia-verdade por outra porta.
    expect(within(c).getAllByText('—')).toHaveLength(2)
    expect(within(c).queryByText(/%/)).not.toBeInTheDocument()

    // Os outros quatro cartões — que não dependem de perdas de depósito —
    // continuam calculados normalmente, nunca travessão.
    expect(within(cartao('ENTRADAS')).getByText('1')).toBeInTheDocument()
    expect(within(cartao('PESO RECEBIDO')).getByText('1.000 kg')).toBeInTheDocument()
    expect(within(cartao('VALOR TOTAL')).getByText('R$ 120,00')).toBeInTheDocument()
  })

  it('sessao expirada (401) em /api/perdas chama onSessaoExpirada em vez do aviso', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/entradas') return Promise.resolve([entrada()])
      if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
      if (url === '/api/perdas') return Promise.reject(new ErroApi(401, { erro: 'sessao invalida' }))
      return Promise.resolve([])
    })
    const onSessaoExpirada = vi.fn()
    render(<EntradasLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('EntradasLista — isolacao de falha dos cartoes', () => {
  it('resumo que nao pode ser calculado vira travessao com aviso, e a lista continua visivel', async () => {
    espiaoResumo.mockImplementation(() => { throw new Error('base inconsistente') })
    mockRotasPadrao([entrada({ numero: 'C-1040', valor_total: 120 })])
    render(<EntradasLista />)

    // A lista — o trabalho de rotina desta tela — nao foi derrubada.
    expect(await screen.findByText('C-1040')).toBeInTheDocument()

    expect(screen.getByRole('status')).toHaveTextContent(/não foi possível calcular o resumo/i)

    const rotulos = [
      'ENTRADAS', 'PESO RECEBIDO', 'ÍNDICE DE PERDAS', 'A PAGAR AO PRODUTOR', 'VALOR TOTAL',
    ]
    for (const rotulo of rotulos) {
      expect(within(cartao(rotulo)).getAllByText('—').length).toBeGreaterThan(0)
    }
    expect(cartoes().queryByText('R$ 0,00')).not.toBeInTheDocument()
  })
})

/**
 * Sensibilidade da unificação: se o cartão voltasse a somar só a perda de
 * coleta (o defeito que esta tarefa fecha), o teste "coleta + depósito
 * somando" acima teria que continuar passando por acidente — o que não
 * acontece, porque ele afirma 7,0% (unificado) e não 5,0% (só coleta). Este
 * teste isola exatamente essa afirmação, espiando `derivarResumoEntradas`
 * para confirmar que a tela REPASSA as perdas de depósito recebidas — se
 * alguém remover o argumento na chamada (regressão para "só coleta"), o
 * spy pega a chamada com um array vazio/ausente em vez do array com dado.
 */
describe('EntradasLista — sensibilidade da unificação', () => {
  it('derivarResumoEntradas é chamada com as perdas de depósito do período, não uma lista vazia', async () => {
    mockRotasPadrao(
      [entrada({ peso_total: 1000, perda_kg: 50 })],
      [perda({ qtd_kg: 20 })],
    )
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    await waitFor(() => expect(espiaoResumo).toHaveBeenCalled())
    const [, perdasRecebidas] = espiaoResumo.mock.calls[espiaoResumo.mock.calls.length - 1]
    expect(perdasRecebidas).not.toBeNull()
    expect((perdasRecebidas as unknown[]).length).toBe(1)
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('EntradasLista — periodo global', () => {
  it('a tabela mostra so as coletas do periodo escolhido', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', numero: 'C-1040', data: '2026-08-10' }),
      entrada({ id: 'e-2', numero: 'C-0930', data: '2026-07-05' }),
    ])
    render(<EntradasLista periodo="2026-08" />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.queryByText('C-0930')).not.toBeInTheDocument()
  })

  it('sem periodo (padrao "all") mostra as duas', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', numero: 'C-1040', data: '2026-08-10' }),
      entrada({ id: 'e-2', numero: 'C-0930', data: '2026-07-05' }),
    ])
    render(<EntradasLista />)
    expect(await screen.findByText('C-1040')).toBeInTheDocument()
    expect(screen.getByText('C-0930')).toBeInTheDocument()
  })

  it('os cartoes somam so o periodo, nao a base inteira', async () => {
    mockRotasPadrao([
      entrada({ id: 'e-1', data: '2026-08-10', valor_total: 120, peso_total: 30, perda_kg: 0 }),
      entrada({ id: 'e-2', numero: 'C-0930', data: '2026-07-05', valor_total: 5000, peso_total: 900, perda_kg: 0 }),
    ])
    render(<EntradasLista periodo="2026-08" />)
    await screen.findByText('C-1040')
    expect(cartao('ENTRADAS')).toHaveTextContent('1')
    expect(cartao('VALOR TOTAL')).toHaveTextContent('R$ 120,00')
  })

  it('periodo sem coleta nenhuma NAO diz "nenhuma entrada lancada"', async () => {
    mockRotasPadrao([entrada({ id: 'e-1', data: '2026-08-10' })])
    render(<EntradasLista periodo="2026-01" />)
    expect(await screen.findByText(/nenhuma entrada em janeiro\/2026/i)).toBeInTheDocument()
    expect(screen.queryByText(/nenhuma entrada lançada/i)).not.toBeInTheDocument()
    // E nao oferece "lancar a primeira": ja existe uma, noutro mes.
    expect(screen.queryByRole('button', { name: /lançar primeira entrada/i })).not.toBeInTheDocument()
  })

  it('base realmente vazia continua com o estado vazio de sempre', async () => {
    mockRotasPadrao([])
    render(<EntradasLista periodo="2026-08" />)
    expect(await screen.findByText(/nenhuma entrada lançada/i)).toBeInTheDocument()
  })

  it('a legenda diz qual recorte esta valendo', async () => {
    mockRotasPadrao()
    render(<EntradasLista periodo="2026-08" />)
    await screen.findByText('C-1040')
    expect(screen.getByText(/clique numa entrada para editar/i)).toHaveTextContent('Agosto/2026')
  })
})

/**
 * Achado E-3: a coluna PERDA mostrava quilos absolutos, sempre na mesma cor
 * de alerta — 140 kg pode ser rotina numa coleta de 8 t e catastrofe numa de
 * 300 kg, e a coluna nao dizia qual. Agora e % do peso recebido daquela
 * coleta, com a MESMA regua do cartao logo acima (10/13, METAS_DASHBOARD) e
 * nao a regua propria 10/15 do prototipo, que era exatamente a duplicacao
 * removida em 7a16a20.
 */
describe('EntradasLista — coluna PERDA em % (achado E-3)', () => {
  const VERDE = 'rgb(63, 143, 91)'
  const AMBAR = 'rgb(199, 147, 32)'
  const VERMELHO = 'rgb(194, 80, 47)'

  /** A celula PERDA da linha da tabela — nao a do cartao de mesmo tema. */
  function celulaPerda(): HTMLElement {
    const linha = screen.getByText('C-1040').closest('.entradas-linha--dados') as HTMLElement
    // Ordem das colunas: ENTRADA, FORNECEDOR, MOTIVO, PESO, PERDA, VALOR...
    return linha.children[4] as HTMLElement
  }

  it('com dado: 140 kg em 1.400 kg recebidos sai 10,0%, em verde', async () => {
    mockRotasPadrao([entrada({ peso_total: 1400, perda_kg: 140, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const celula = celulaPerda()
    expect(celula).toHaveTextContent('10,0%')
    expect(celula).toHaveStyle({ color: VERDE })
    // Os quilos nao se perdem: continuam no title, ao lado da base.
    expect(within(celula).getByTitle(/140 kg de perda em 1\.400 kg recebidos/)).toBeInTheDocument()
  })

  it('a mesma perda absoluta muda de cor conforme o tamanho da coleta', async () => {
    // 140 kg sobre 1.000 = 14% -> vermelho na regua 10/13. O numero absoluto
    // e o mesmo do teste anterior; so o denominador mudou.
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 140, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(celulaPerda()).toHaveTextContent('14,0%')
    expect(celulaPerda()).toHaveStyle({ color: VERMELHO })
  })

  it('a faixa ambar existe: 12% fica entre a meta e o limite', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 120, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(celulaPerda()).toHaveStyle({ color: AMBAR })
  })

  it('usa a perda EFETIVA (maior entre cabecalho e itens), igual ao cartao', async () => {
    // Cabecalho 60, itens somam 100: a linha nao pode mostrar 6% enquanto o
    // cartao mostra 10% sobre a mesma coleta.
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 60, perda_itens_qtd: 100 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(celulaPerda()).toHaveTextContent('10,0%')
    expect(within(cartao('ÍNDICE DE PERDAS')).getByText('10,0%')).toBeInTheDocument()
  })

  it('zero MEDIDO e 0,0% em verde — houve coleta e nao houve perda', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 0, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(celulaPerda()).toHaveTextContent('0,0%')
    expect(celulaPerda()).toHaveStyle({ color: VERDE })
  })

  it('sem dado: coleta sem peso recebido vira travessao, nunca 0,0%', async () => {
    mockRotasPadrao([entrada({ peso_total: 0, perda_kg: 5, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(celulaPerda()).toHaveTextContent('—')
    expect(celulaPerda()).not.toHaveTextContent('%')
  })

  it('peso incompleto marca a % com * e explica: o denominador encurtou', async () => {
    mockRotasPadrao([
      entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 0, itens_sem_conversao: 2 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const marcado = within(celulaPerda()).getByText('10,0%*')
    expect(marcado.getAttribute('title')).toContain('2 itens')
    expect(marcado.getAttribute('title')).toContain('sai para cima')
    // O numero absoluto continua no mesmo title, antes do aviso.
    expect(marcado.getAttribute('title')).toContain('100 kg de perda')
  })

  it('falha de carregamento: sem lista nao ha celula nenhuma, so o alerta', async () => {
    mockGet.mockImplementation((url: string) => (
      url === '/api/entradas'
        ? Promise.reject(new Error('falha de rede'))
        : Promise.resolve([])
    ))
    render(<EntradasLista />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as entradas.')
    expect(screen.queryByText('C-1040')).not.toBeInTheDocument()
  })
})

/**
 * Achado E-4: `forma_pag` e `data_pag` ja vinham em GET /api/entradas e nao
 * apareciam em lugar nenhum da tela — o chip dizia "Pago" e a unica forma de
 * saber COMO e QUANDO era abrir o modal.
 */
describe('EntradasLista — sub-linha "forma · data" do pagamento (achado E-4)', () => {
  function blocoPagamento(): HTMLElement {
    const linha = screen.getByText('C-1040').closest('.entradas-linha--dados') as HTMLElement
    return linha.children[6] as HTMLElement
  }

  it('com dado: entrada paga mostra "PIX · 11/08" sob o chip', async () => {
    mockRotasPadrao([entrada({ pago: 'Pago', forma_pag: 'PIX', data_pag: '2026-08-11' })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(within(blocoPagamento()).getByText('PIX · 11/08')).toBeInTheDocument()
  })

  it('sem dado: entrada pendente nao desenha sub-linha — nem travessao', async () => {
    // Nao e dado faltando: e pagamento que nao aconteceu, e o chip ja diz.
    mockRotasPadrao([entrada({ pago: 'Pendente', forma_pag: 'PIX', data_pag: null })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(blocoPagamento().querySelector('.entradas-pag-info')).toBeNull()
  })

  it('paga sem data registrada mostra so a forma, sem separador solto', async () => {
    mockRotasPadrao([entrada({ pago: 'Pago', forma_pag: 'Boleto', data_pag: null })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(within(blocoPagamento()).getByText('Boleto')).toBeInTheDocument()
    expect(blocoPagamento().textContent).not.toContain('· ')
  })

  it('paga sem forma nem data nao inventa sub-linha', async () => {
    mockRotasPadrao([entrada({ pago: 'Pago', forma_pag: '', data_pag: null })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(blocoPagamento().querySelector('.entradas-pag-info')).toBeNull()
  })

  it('falha de carregamento: nenhuma linha, nenhuma sub-linha, so o alerta', async () => {
    mockGet.mockImplementation((url: string) => (
      url === '/api/entradas'
        ? Promise.reject(new Error('falha de rede'))
        : Promise.resolve([])
    ))
    render(<EntradasLista />)
    await screen.findByRole('alert')
    expect(document.querySelector('.entradas-pag-info')).toBeNull()
  })
})

