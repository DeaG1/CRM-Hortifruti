import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SaidasLista } from './SaidasLista'
import { api, ErroApi } from '../api/client'
import type { Saida } from '../components/ModalSaida'
import type { Cliente } from '../derive/clientes'
import { derivarResumoSaidas } from '../derive/resumoOperacional'

// Mock so de `api.get/patch` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois
// lados). Mesmo padrao de ClientesLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), patch: vi.fn() } }
})

// Espiao sobre a derivacao dos cartoes: a implementacao REAL continua
// valendo em todos os testes (vi.fn(actual)); so o teste de isolacao de
// falha a troca por uma que lanca. Sem isso nao ha como provar que os
// cartoes falham sozinhos — a lista e os cartoes saem da MESMA chamada de
// API, entao nao existe um 401/500 que atinja um e nao o outro.
vi.mock('../derive/resumoOperacional', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../derive/resumoOperacional')>()
  return { ...actual, derivarResumoSaidas: vi.fn(actual.derivarResumoSaidas) }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPatch = api.patch as unknown as ReturnType<typeof vi.fn>
const espiaoResumo = vi.mocked(derivarResumoSaidas)
const resumoReal = espiaoResumo.getMockImplementation() as typeof derivarResumoSaidas

const saida = (over: Partial<Saida> = {}): Saida => ({
  id: '1',
  numero: 'S-0001',
  cliente_id: 'cli-1',
  rota: 'Norte',
  data_pedido: '2026-08-01',
  entrega: '2026-08-05',
  status: 'Pendente',
  pag: 'Pendente',
  venc: null,
  data_pag: null,
  forma_pag: '',
  perda_kg: 0,
  motivo: '',
  obs: '',
  valor: 100,
  peso: 20,
  ...over,
})

const clienteA: Cliente = {
  id: 'cli-1', nome: 'Mercado A', resp: 'Sonia', rota: 'Norte', freq: 'Semanal',
  status: 'ativo', tend: '→', limite: 0, prazo: 14,
}

/** Roteia api.get pela URL. `lista` alimenta GET /api/saidas; `clientes`
 * alimenta GET /api/clientes (resolve o nome na tabela e os seletores do
 * modal); `detalhe`, se passado, alimenta GET /api/saidas/:id (abrir modal
 * de edicao) e GET /api/produtos (o modal sempre busca produtos). */
function mockGetPadrao(lista: Saida[], clientes: Cliente[] = [], detalhe?: Saida) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/saidas') return Promise.resolve(lista)
    if (rota === '/api/clientes') return Promise.resolve(clientes)
    if (rota === '/api/produtos') return Promise.resolve([])
    if (detalhe && rota === `/api/saidas/${detalhe.id}`) return Promise.resolve(detalhe)
    return Promise.reject(new Error('rota inesperada no teste: ' + rota))
  })
}

function botaoFiltro(grupo: string, rotulo: string) {
  return within(screen.getByRole('group', { name: grupo })).getByRole('button', { name: new RegExp('^' + rotulo) })
}

/** O bloco de cartoes de resumo — pra distinguir o "R$ 100" de um cartao do
 * "R$ 100" da coluna VALOR da tabela. */
function cartoes() {
  return within(screen.getByRole('group', { name: 'Resumo das saídas' }))
}

/** Um cartao pelo rotulo: devolve o card inteiro (valor + sub-linha). */
function cartao(rotulo: string): HTMLElement {
  return cartoes().getByText(rotulo).parentElement as HTMLElement
}

/** 'AAAA-MM-DD' local, igual ao que a tela usa pra derivar atraso. */
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HOJE = new Date()
const ONTEM = isoDe(new Date(HOJE.getTime() - 86_400_000))
const AMANHA = isoDe(new Date(HOJE.getTime() + 86_400_000))

beforeEach(() => {
  mockGet.mockReset()
  mockPatch.mockReset()
  espiaoResumo.mockImplementation(resumoReal)
})

describe('SaidasLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar as saídas.')
  })

  it('vazio: mostra mensagem util quando a API devolve lista vazia', async () => {
    mockGetPadrao([])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhuma saída lançada/i)).toBeInTheDocument()
    // Termo generico ("cliente"), nao o do primeiro tenant (hortifruti).
    expect(screen.getByText(/lance a primeira venda entregue a um cliente/i)).toBeInTheDocument()
    expect(screen.getByText(/alimenta faturamento, ticket médio e estoque/i)).toBeInTheDocument()
  })

  it('com dados: lista as saidas recebidas', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-0001' }), saida({ id: '2', numero: 'S-0002' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('S-0001')).toBeInTheDocument()
    expect(screen.getByText('S-0002')).toBeInTheDocument()
  })
})

describe('SaidasLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<SaidasLista onSessaoExpirada={onSessaoExpirada} />)
    // A tela dispara duas buscas independentes (saidas + clientes, usada so
    // pra resolver o nome na tabela) — se as duas caem no mesmo 401 de
    // sessao expirada, as duas chamam onSessaoExpirada. sair() (App.tsx) e
    // idempotente, entao chamar mais de uma vez nao e um bug: o importante
    // e que dispara, e nunca mostra o alerta generico de erro.
    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('SaidasLista — resolve o nome do cliente sem quebrar a lista', () => {
  it('mostra o nome do cliente quando /api/clientes carrega', async () => {
    mockGetPadrao([saida({ cliente_id: 'cli-1' })], [clienteA])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Mercado A')).toBeInTheDocument()
  })

  it('/api/clientes falhando (ex.: 403 pro colaborador) nao quebra a lista de saidas', async () => {
    mockGet.mockImplementation((rota: string) => {
      if (rota === '/api/saidas') return Promise.resolve([saida({ cliente_id: 'cli-1' })])
      if (rota === '/api/clientes') return Promise.reject(new ErroApi(403, { erro: 'sem permissao' }))
      return Promise.reject(new Error('rota inesperada: ' + rota))
    })
    const { container } = render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('S-0001')).toBeInTheDocument()
    // Sem o nome resolvido, a celula do cliente cai no travessao — a lista
    // continua utilizavel. Aponta pra celula pelo seletor de classe: a
    // coluna RECEB. desta mesma linha tambem mostra travessao (pedido nao
    // pago nao tem prazo de recebimento).
    expect(container.querySelector('.saidas-cliente-nome')?.textContent).toBe('—')
  })
})

describe('SaidasLista — filtro por status', () => {
  const trio = () => [
    saida({ id: '1', numero: 'S-1', status: 'Pendente' }),
    saida({ id: '2', numero: 'S-2', status: 'Pendente' }),
    saida({ id: '3', numero: 'S-3', status: 'Entregue' }),
  ]

  it('conta cada status corretamente, inclusive os que nao aparecem na lista', async () => {
    mockGetPadrao(trio())
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    expect(within(botaoFiltro('Filtrar por status', 'Todos')).getByText('3')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por status', 'Pendente')).getByText('2')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por status', 'Entregue')).getByText('1')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por status', 'Cancelado')).getByText('0')).toBeInTheDocument()
  })

  it('clicar num filtro de status mostra so as saidas daquele status', async () => {
    mockGetPadrao(trio())
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por status', 'Entregue'))
    expect(screen.queryByText('S-1')).not.toBeInTheDocument()
    expect(screen.queryByText('S-2')).not.toBeInTheDocument()
    expect(screen.getByText('S-3')).toBeInTheDocument()
  })

  it('voltar para "Todos" mostra todas as saidas de novo', async () => {
    mockGetPadrao(trio())
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por status', 'Pendente'))
    expect(screen.queryByText('S-3')).not.toBeInTheDocument()
    fireEvent.click(botaoFiltro('Filtrar por status', 'Todos'))
    expect(screen.getByText('S-1')).toBeInTheDocument()
    expect(screen.getByText('S-3')).toBeInTheDocument()
  })
})

describe('SaidasLista — filtro por pagamento', () => {
  const trio = () => [
    saida({ id: '1', numero: 'S-1', pag: 'Pago' }),
    saida({ id: '2', numero: 'S-2', pag: 'Atrasado' }),
    saida({ id: '3', numero: 'S-3', pag: 'Atrasado' }),
  ]

  it('conta cada situacao de pagamento corretamente', async () => {
    mockGetPadrao(trio())
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    expect(within(botaoFiltro('Filtrar por pagamento', 'Todos')).getByText('3')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por pagamento', 'Pago')).getByText('1')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por pagamento', 'Atrasado')).getByText('2')).toBeInTheDocument()
    expect(within(botaoFiltro('Filtrar por pagamento', 'Pendente')).getByText('0')).toBeInTheDocument()
  })

  it('clicar num filtro de pagamento mostra so as saidas daquela situacao', async () => {
    mockGetPadrao(trio())
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por pagamento', 'Pago'))
    expect(screen.getByText('S-1')).toBeInTheDocument()
    expect(screen.queryByText('S-2')).not.toBeInTheDocument()
    expect(screen.queryByText('S-3')).not.toBeInTheDocument()
  })

  it('filtros de status e pagamento combinam (E, nao OU)', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', status: 'Pendente', pag: 'Atrasado' }),
      saida({ id: '2', numero: 'S-2', status: 'Entregue', pag: 'Atrasado' }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por status', 'Entregue'))
    fireEvent.click(botaoFiltro('Filtrar por pagamento', 'Atrasado'))
    expect(screen.queryByText('S-1')).not.toBeInTheDocument()
    expect(screen.getByText('S-2')).toBeInTheDocument()
  })

  it('nenhuma saida bate com os filtros combinados: mostra mensagem, nao uma tabela vazia muda', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-1', status: 'Pendente', pag: 'Pago' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por status', 'Cancelado'))
    expect(screen.getByText('Nenhuma saída com estes filtros.')).toBeInTheDocument()
  })
})

describe('SaidasLista — pagamento editável na linha (chip vira seletor, Atrasado calculado)', () => {
  // Datas bem no passado/futuro de proposito — o teste nao pode depender de
  // qual e o "hoje" real de quem roda a suite.
  const VENCIDO = '2020-01-01'
  const A_VENCER = '2099-01-01'

  it('pag=Pendente com vencimento no passado exibe Atrasado (calculado, nao gravado)', async () => {
    mockGetPadrao([saida({ pag: 'Pendente', venc: VENCIDO })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    // valor selecionavel continua Pendente (e a mesma opcao "ainda nao
    // pago"), so o ROTULO exibido muda pra Atrasado.
    expect(select.value).toBe('Pendente')
    expect(select.selectedOptions[0].text).toBe('Atrasado')
  })

  it('pag=Pendente com vencimento no futuro exibe Pendente', async () => {
    mockGetPadrao([saida({ pag: 'Pendente', venc: A_VENCER })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('Pendente')
    expect(select.selectedOptions[0].text).toBe('Pendente')
  })

  it('pag gravado como Atrasado (dado legado) continua exibindo Atrasado, mesmo com vencimento no futuro', async () => {
    mockGetPadrao([saida({ pag: 'Atrasado', venc: A_VENCER })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    expect(select.selectedOptions[0].text).toBe('Atrasado')
  })

  it('o seletor nunca oferece "Atrasado" como valor escolhivel — so Pendente/Pago', async () => {
    mockGetPadrao([saida({ pag: 'Pendente', venc: VENCIDO })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    const valores = [...select.options].map(o => o.value)
    expect(valores).toEqual(['Pendente', 'Pago'])
  })

  it('pag="—" (nao aplicavel) continua um badge estatico, sem virar seletor', async () => {
    // cliente_id resolvido (clienteA) pra o travessao do nome do cliente nao
    // entrar na conta. A coluna RECEB. tambem mostra travessao nesta linha
    // (pedido sem pagamento nao tem prazo de recebimento), entao a asserção
    // aponta pro badge de pagamento pelo seletor de classe, e nao pro texto
    // solto na tela.
    mockGetPadrao([saida({ pag: '—', cliente_id: 'cli-1' })], [clienteA])
    const { container } = render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const badges = [...container.querySelectorAll('.saidas-badge')]
    expect(badges.map(b => b.textContent)).toContain('—')
  })

  it('marcar Pago chama PATCH /api/saidas/:id/pag e atualiza a linha com a resposta', async () => {
    mockGetPadrao([saida({ id: 'sa-1', numero: 'S-0001', pag: 'Pendente', data_pag: null })])
    mockPatch.mockResolvedValue({ pag: 'Pago', data_pag: '2026-08-24' })
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/api/saidas/sa-1/pag', { pag: 'Pago' }))
    await vi.waitFor(() => expect(select.value).toBe('Pago'))
  })

  it('voltar para Pendente chama PATCH com "Pendente" (a API e quem limpa data_pag)', async () => {
    mockGetPadrao([saida({ id: 'sa-1', numero: 'S-0001', pag: 'Pago', data_pag: '2026-08-01' })])
    mockPatch.mockResolvedValue({ pag: 'Pendente', data_pag: null })
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('Pago')

    fireEvent.change(select, { target: { value: 'Pendente' } })

    await vi.waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/api/saidas/sa-1/pag', { pag: 'Pendente' }))
    await vi.waitFor(() => expect(select.value).toBe('Pendente'))
  })

  it('clicar no seletor NAO abre o modal de edição da linha (stopPropagation)', async () => {
    mockGetPadrao([saida()])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox')
    fireEvent.click(select)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falha do PATCH reverte o chip pro valor anterior e mostra aviso', async () => {
    mockGetPadrao([saida({ id: 'sa-1', pag: 'Pendente', venc: A_VENCER })])
    mockPatch.mockRejectedValue(new Error('falha de rede'))
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await screen.findByRole('alert')
    expect(select.value).toBe('Pendente')
  })

  it('sessao expirada (401) no PATCH chama onSessaoExpirada', async () => {
    mockGetPadrao([saida({ id: 'sa-1', pag: 'Pendente' })])
    mockPatch.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<SaidasLista onSessaoExpirada={onSessaoExpirada} />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'Pago' } })

    await vi.waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })

  it('filtro "Atrasado" inclui saida Pendente com vencimento vencido (situacao calculada, nao o pag cru)', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', pag: 'Pendente', venc: VENCIDO }),
      saida({ id: '2', numero: 'S-2', pag: 'Pendente', venc: A_VENCER }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    expect(within(botaoFiltro('Filtrar por pagamento', 'Atrasado')).getByText('1')).toBeInTheDocument()
    fireEvent.click(botaoFiltro('Filtrar por pagamento', 'Atrasado'))
    expect(screen.getByText('S-1')).toBeInTheDocument()
    expect(screen.queryByText('S-2')).not.toBeInTheDocument()
  })
})

describe('SaidasLista — abrir o modal', () => {
  it('clicar em "Novo pedido" abre o modal de criação', async () => {
    mockGetPadrao([saida()])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')

    fireEvent.click(screen.getByRole('button', { name: /novo pedido/i }))
    expect(await screen.findByRole('dialog', { name: 'Nova saída' })).toBeInTheDocument()
  })

  it('clicar numa linha abre o modal de edição daquela saida', async () => {
    const existente = saida({ id: 'abc-1', numero: 'S-0001' })
    mockGetPadrao([existente], [], existente)
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    const linha = await screen.findByText('S-0001')

    fireEvent.click(linha)
    expect(await screen.findByRole('dialog', { name: 'Editar saída' })).toBeInTheDocument()
  })

  it('"Lançar primeira saída" no estado vazio abre o modal de criação', async () => {
    mockGetPadrao([])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /lançar primeira saída/i }))
    expect(await screen.findByRole('dialog', { name: 'Nova saída' })).toBeInTheDocument()
  })
})

/**
 * Os quatro cartoes de resumo (achado S-1 da auditoria; protótipo
 * `pedidoStats`, markup 412-419 e dados 2394-2399). O terceiro e o motivo de
 * este bloco existir: "quanto os clientes me devem" nao aparecia em
 * nenhuma tela de rotina, so em Relatorios ▸ Inadimplentes, que e tela de
 * analise.
 */
describe('SaidasLista — cartoes de resumo', () => {
  it('"Pedidos" conta todas as saidas lancadas', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-1' }), saida({ id: '2', numero: 'S-2' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('PEDIDOS')).getByText('2')).toBeInTheDocument()
  })

  it('"Faturado (entregue)" soma so os entregues e diz quantos sao', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pago', valor: 1000, data_pag: '2026-08-06' }),
      saida({ id: '2', numero: 'S-2', status: 'Em rota', valor: 9999 }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    const c = cartao('FATURADO (ENTREGUE)')
    expect(within(c).getByText('R$ 1.000')).toBeInTheDocument()
    expect(within(c).getByText('1 pedido entregue')).toBeInTheDocument()
  })

  it('"A receber / atrasado" soma o que os clientes ainda devem', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', pag: 'Pago', valor: 1000, data_pag: '2026-08-06' }),
      saida({ id: '2', numero: 'S-2', pag: 'Pendente', venc: AMANHA, valor: 300 }),
      saida({ id: '3', numero: 'S-3', pag: 'Pendente', venc: ONTEM, valor: 200 }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('A RECEBER / ATRASADO')).getByText('R$ 500')).toBeInTheDocument()
  })

  it('pedido cancelado ("—" no pagamento) nao entra em "A receber" — nao e divida', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', status: 'Cancelado', pag: '—', valor: 4000 }),
      saida({ id: '2', numero: 'S-2', pag: 'Pendente', venc: AMANHA, valor: 300 }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('A RECEBER / ATRASADO')).getByText('R$ 300')).toBeInTheDocument()
  })

  it('a sub-linha conta atraso pelo vencimento DECORRIDO, nao pelo `pag` gravado', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-1', pag: 'Pendente', venc: ONTEM, valor: 200 })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('A RECEBER / ATRASADO')).getByText('1 pedido em atraso')).toBeInTheDocument()
  })

  it('vencimento no futuro nao conta como atraso', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-1', pag: 'Pendente', venc: AMANHA, valor: 200 })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('A RECEBER / ATRASADO')).getByText('nenhum em atraso')).toBeInTheDocument()
  })

  it('tudo pago: R$ 0 MEDIDO e "nenhum em atraso" — nunca travessao', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', pag: 'Pago', valor: 1000, data_pag: '2026-08-06' }),
      saida({ id: '2', numero: 'S-2', pag: 'Pago', valor: 500, data_pag: '2026-08-06' }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    const c = cartao('A RECEBER / ATRASADO')
    expect(within(c).getByText('R$ 0')).toBeInTheDocument()
    expect(within(c).getByText('nenhum em atraso')).toBeInTheDocument()
    expect(within(c).queryByText('—')).not.toBeInTheDocument()
  })

  it('"Qtd entregue" soma o peso so dos entregues', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pago', peso: 100, data_pag: '2026-08-06' }),
      saida({ id: '2', numero: 'S-2', status: 'Em rota', peso: 900 }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(within(cartao('QTD ENTREGUE')).getByText('100 kg')).toBeInTheDocument()
  })

  it('"Qtd entregue" com item nao convertivel sai marcado com * e explicacao no title', async () => {
    mockGetPadrao([
      saida({
        id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pago',
        peso: 100, data_pag: '2026-08-06', itens_sem_conversao: 1,
      }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    const marcado = within(cartao('QTD ENTREGUE')).getByText('100 kg*')
    expect(marcado.getAttribute('title')).toContain('peso médio')
    expect(marcado.getAttribute('title')).toContain('1 item')
  })

  it('os cartoes somam a base inteira, NAO o que os filtros deixam visivel', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-1', pag: 'Pago', valor: 1000, data_pag: '2026-08-06' }),
      saida({ id: '2', numero: 'S-2', pag: 'Pendente', venc: AMANHA, valor: 300 }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')

    fireEvent.click(botaoFiltro('Filtrar por pagamento', 'Pago'))
    expect(screen.queryByText('S-2')).not.toBeInTheDocument()
    // A tabela mostra so a saida paga, mas o cartao continua respondendo
    // "quanto os clientes me devem" pela carteira inteira.
    expect(within(cartao('A RECEBER / ATRASADO')).getByText('R$ 300')).toBeInTheDocument()
    expect(within(cartao('PEDIDOS')).getByText('2')).toBeInTheDocument()
  })

  it('sem nenhuma saida lancada nao existe cartao com R$ 0 — o estado vazio explica', async () => {
    mockGetPadrao([])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText(/nenhuma saída lançada/i)
    expect(screen.queryByRole('group', { name: 'Resumo das saídas' })).not.toBeInTheDocument()
    expect(screen.queryByText('R$ 0')).not.toBeInTheDocument()
  })
})

describe('SaidasLista — isolacao de falha dos cartoes', () => {
  it('resumo que nao pode ser calculado vira travessao com aviso, e a lista continua visivel', async () => {
    espiaoResumo.mockImplementation(() => { throw new Error('base inconsistente') })
    mockGetPadrao([saida({ id: '1', numero: 'S-1', valor: 1000 })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)

    // A lista — o trabalho de rotina desta tela — nao foi derrubada.
    expect(await screen.findByText('S-1')).toBeInTheDocument()

    expect(screen.getByRole('status')).toHaveTextContent(/não foi possível calcular o resumo/i)

    for (const rotulo of ['PEDIDOS', 'FATURADO (ENTREGUE)', 'A RECEBER / ATRASADO', 'QTD ENTREGUE']) {
      expect(within(cartao(rotulo)).getAllByText('—').length).toBeGreaterThan(0)
    }
    expect(cartoes().queryByText('R$ 0')).not.toBeInTheDocument()
  })
})

/**
 * Coluna RECEB. (achado S-2; protótipo cabecalho 424, celula 436, dado
 * 2406): dias entre a entrega e o pagamento. E o insumo visivel do
 * componente "recebimento" do ciclo de caixa, e sai da MESMA funcao que
 * alimenta essa media (diasRecebimentoSaida, derive/financeiro.ts).
 */
describe('SaidasLista — coluna RECEB.', () => {
  it('a coluna existe no cabecalho da tabela', async () => {
    mockGetPadrao([saida()])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(screen.getByText('RECEB.')).toBeInTheDocument()
  })

  it('mostra os dias entre entrega e pagamento do pedido entregue e pago', async () => {
    mockGetPadrao([
      saida({
        id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pago',
        entrega: '2026-08-05', data_pag: '2026-08-08',
      }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(screen.getByText('3 d')).toBeInTheDocument()
  })

  it('pago no mesmo dia da entrega mostra "0 d", nao travessao', async () => {
    mockGetPadrao([
      saida({
        id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pago',
        entrega: '2026-08-05', data_pag: '2026-08-05',
      }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(screen.getByText('0 d')).toBeInTheDocument()
  })

  it('pedido ainda nao pago nao tem prazo a exibir', async () => {
    mockGetPadrao([
      saida({
        id: '1', numero: 'S-1', status: 'Entregue', pag: 'Pendente',
        entrega: '2026-08-05', data_pag: null, venc: AMANHA,
      }),
    ])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-1')
    expect(screen.queryByText(/^\d+ d$/)).not.toBeInTheDocument()
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('SaidasLista — periodo global', () => {
  it('a tabela mostra so os pedidos entregues no periodo escolhido', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-0001', entrega: '2026-08-05' }),
      saida({ id: '2', numero: 'S-0002', entrega: '2026-07-05' }),
    ], [clienteA])
    render(<SaidasLista periodo="2026-08" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('S-0001')).toBeInTheDocument()
    expect(screen.queryByText('S-0002')).not.toBeInTheDocument()
  })

  it('sem periodo (padrao "all") mostra os dois', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-0001', entrega: '2026-08-05' }),
      saida({ id: '2', numero: 'S-0002', entrega: '2026-07-05' }),
    ], [clienteA])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('S-0001')).toBeInTheDocument()
    expect(screen.getByText('S-0002')).toBeInTheDocument()
  })

  it('os cartoes somam so o periodo', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-0001', entrega: '2026-08-05', status: 'Entregue', pag: 'Pago', valor: 100 }),
      saida({ id: '2', numero: 'S-0002', entrega: '2026-07-05', status: 'Entregue', pag: 'Pago', valor: 9000 }),
    ], [clienteA])
    render(<SaidasLista periodo="2026-08" onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(cartao('PEDIDOS')).toHaveTextContent('1')
    expect(cartao('PEDIDOS')).toHaveTextContent('Agosto/2026')
    expect(cartao('FATURADO (ENTREGUE)')).toHaveTextContent('R$ 100')
  })

  it('os contadores dos chips tambem contam so o periodo', async () => {
    mockGetPadrao([
      saida({ id: '1', numero: 'S-0001', entrega: '2026-08-05', status: 'Entregue' }),
      saida({ id: '2', numero: 'S-0002', entrega: '2026-07-05', status: 'Entregue' }),
    ], [clienteA])
    render(<SaidasLista periodo="2026-08" onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(botaoFiltro('Filtrar por status', 'Todos')).toHaveTextContent('1')
  })

  it('periodo sem venda nenhuma manda trocar o PERIODO, nao os filtros', async () => {
    mockGetPadrao([saida({ id: '1', numero: 'S-0001', entrega: '2026-08-05' })], [clienteA])
    render(<SaidasLista periodo="2026-01" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhuma saída em janeiro\/2026/i)).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma saída com estes filtros.')).not.toBeInTheDocument()
    // Base nao vazia: o estado vazio de "lance a primeira" nao aparece.
    expect(screen.queryByRole('button', { name: /lançar primeira saída/i })).not.toBeInTheDocument()
  })

  it('base realmente vazia continua com o estado vazio de sempre', async () => {
    mockGetPadrao([], [clienteA])
    render(<SaidasLista periodo="2026-08" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhuma saída lançada ainda/i)).toBeInTheDocument()
  })

  it('a nota dos cartoes diz qual recorte esta valendo', async () => {
    mockGetPadrao([saida({ entrega: '2026-08-05' })], [clienteA])
    render(<SaidasLista periodo="2026-08" onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(screen.getByText(/os filtros abaixo/i)).toHaveTextContent('Agosto/2026')
  })
})

/**
 * Achado S-3: `forma_pag` e `data_pag` ja vinham de GET /api/saidas e a tela
 * so mostrava o VENCIMENTO — a promessa, nunca o fato. Quem quisesse saber
 * como e quando o cliente pagou tinha de abrir o modal.
 */
describe('SaidasLista — sub-linha "forma · data" do pagamento (achado S-3)', () => {
  function blocoPagamento(): HTMLElement {
    const linha = screen.getByText('S-0001').closest('.saidas-linha--dados') as HTMLElement
    // Ordem: PEDIDO, CLIENTE, ENTREGA, PESO, VALOR, STATUS, PAGAMENTO, RECEB.
    return linha.children[6] as HTMLElement
  }

  it('com dado: pedido pago mostra "PIX · 07/08" sob o chip', async () => {
    mockGetPadrao([saida({ status: 'Entregue', pag: 'Pago', forma_pag: 'PIX', data_pag: '2026-08-07' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(within(blocoPagamento()).getByText('PIX · 07/08')).toBeInTheDocument()
  })

  it('a promessa e o fato convivem: vencimento e info de pagamento sao sub-linhas diferentes', async () => {
    mockGetPadrao([saida({
      status: 'Entregue', pag: 'Pago', venc: '2026-08-20', forma_pag: 'Boleto', data_pag: '2026-08-07',
    })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(within(blocoPagamento()).getByText('venc. 20/08')).toBeInTheDocument()
    expect(within(blocoPagamento()).getByText('Boleto · 07/08')).toBeInTheDocument()
  })

  it('sem dado: pedido pendente nao desenha sub-linha de pagamento — nem travessao', async () => {
    mockGetPadrao([saida({ pag: 'Pendente', forma_pag: 'PIX', data_pag: null })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(blocoPagamento().querySelector('.saidas-pag-info')).toBeNull()
  })

  it('usa a situacao DERIVADA: pendente vencido e Atrasado, e Atrasado nao tem info de pagamento', async () => {
    // `pag` gravado 'Pendente' + vencimento no passado -> chip mostra
    // Atrasado. A sub-linha nao pode contradizer o chip que acompanha.
    mockGetPadrao([saida({ pag: 'Pendente', venc: '2020-01-01', forma_pag: 'PIX', data_pag: '2026-08-07' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(blocoPagamento().querySelector('.saidas-pag-info')).toBeNull()
  })

  it('pago sem forma registrada mostra so a data, sem separador solto', async () => {
    mockGetPadrao([saida({ status: 'Entregue', pag: 'Pago', forma_pag: '', data_pag: '2026-08-07' })])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(within(blocoPagamento()).getByText('07/08')).toBeInTheDocument()
    expect(blocoPagamento().textContent).not.toContain('· ')
  })

  it('falha de carregamento: nenhuma linha, nenhuma sub-linha, so o alerta', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as saídas.')
    expect(document.querySelector('.saidas-pag-info')).toBeNull()
  })
})

