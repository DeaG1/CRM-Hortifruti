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

/** Router de URL padrao — cobre tanto a tela quanto o ModalEntrada real que
 * ela monta (produtos/fornecedores). Cada teste pode sobrescrever so o que
 * precisa com mockGet.mockImplementation de novo. */
function mockRotasPadrao(entradas: unknown[] = [entrada()]) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/entradas') return Promise.resolve(entradas)
    if (url === '/api/entradas/e-1') return Promise.resolve(entradaComItens)
    if (url === '/api/fornecedores') return Promise.resolve(FORNECEDORES)
    if (url === '/api/produtos') return Promise.resolve([])
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
 * Cartao "Perda media" (achado E-2; protótipo linha 2507). A perda aparecia
 * so em quilos absolutos e sempre em vermelho — 140 kg pode ser rotina ou
 * catastrofe, e a tela nao dizia qual. O indice contra o peso recebido e o
 * que da sentido ao numero; o alvo do protótipo e 10%.
 */
describe('EntradasLista — cartao "Perda media"', () => {
  const VERDE = 'rgb(63, 143, 91)'
  const AMBAR = 'rgb(199, 147, 32)'
  const VERMELHO = 'rgb(194, 80, 47)'
  const valorDo = (rotulo: string) => cartao(rotulo).querySelector('.entradas-stat-valor') as HTMLElement

  it('mostra a perda como % do peso recebido, com o alvo e os quilos na sub-linha', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')
    expect(within(c).getByText('7,0%')).toBeInTheDocument()
    expect(within(c).getByText('meta ≤ 10% · 70 kg perdidos')).toBeInTheDocument()
  })

  it('abaixo do alvo fica verde', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 99, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(valorDo('PERDA MÉDIA (COLETA/TRANSPORTE)')).toHaveStyle({ color: VERDE })
  })

  it('exatamente no alvo (10%) ainda e verde — "meta ≤ 10%" inclui o 10', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')
    expect(within(c).getByText('10,0%')).toBeInTheDocument()
    expect(valorDo('PERDA MÉDIA (COLETA/TRANSPORTE)')).toHaveStyle({ color: VERDE })
  })

  it('acima do alvo fica ambar', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 120, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(valorDo('PERDA MÉDIA (COLETA/TRANSPORTE)')).toHaveStyle({ color: AMBAR })
  })

  it('perda alta fica vermelha — a cor agora significa alguma coisa', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 300, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(valorDo('PERDA MÉDIA (COLETA/TRANSPORTE)')).toHaveStyle({ color: VERMELHO })
  })

  it('coleta sem perda: 0,0% MEDIDO, nunca travessao', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 0, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(within(cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')).getByText('0,0%')).toBeInTheDocument()
  })

  it('sem peso recebido nao ha indice: travessao, nunca 0,0%', async () => {
    mockRotasPadrao([entrada({ peso_total: 0, perda_kg: 0, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const c = cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')
    expect(within(c).getByText('—')).toBeInTheDocument()
    expect(within(c).queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('cabecalho e itens descrevem a MESMA perda: usa o maior, nunca a soma', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 100, perda_itens_qtd: 60 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    // Somar daria 160 kg (16%); o certo e 100 kg (10%).
    expect(within(cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')).getByText('10,0%')).toBeInTheDocument()
  })

  it('com item nao convertivel o indice sai marcado com * e a nota de rodape explica', async () => {
    mockRotasPadrao([
      entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0, itens_sem_conversao: 2 }),
    ])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    const marcado = within(cartao('PERDA MÉDIA (COLETA/TRANSPORTE)')).getByText('7,0%*')
    expect(marcado.getAttribute('title')).toContain('peso médio')
    expect(marcado.getAttribute('title')).toContain('2 itens')
    expect(screen.getByRole('note')).toHaveTextContent(/sai para cima/i)
  })

  it('sem item fora da conversao nao ha nota de rodape nem asterisco', async () => {
    mockRotasPadrao([entrada({ peso_total: 1000, perda_kg: 70, perda_itens_qtd: 0 })])
    render(<EntradasLista />)
    await screen.findByText('C-1040')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText('7,0%*')).not.toBeInTheDocument()
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
      'ENTRADAS', 'PESO RECEBIDO', 'PERDA MÉDIA (COLETA/TRANSPORTE)', 'A PAGAR AO PRODUTOR', 'VALOR TOTAL',
    ]
    for (const rotulo of rotulos) {
      expect(within(cartao(rotulo)).getAllByText('—').length).toBeGreaterThan(0)
    }
    expect(cartoes().queryByText('R$ 0,00')).not.toBeInTheDocument()
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
