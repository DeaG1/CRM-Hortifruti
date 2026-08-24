import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SaidasLista } from './SaidasLista'
import { api, ErroApi } from '../api/client'
import type { Saida } from '../components/ModalSaida'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.get/patch` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois
// lados). Mesmo padrao de ClientesLista.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), patch: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPatch = api.patch as unknown as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  mockGet.mockReset()
  mockPatch.mockReset()
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
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('S-0001')).toBeInTheDocument()
    // sem o nome resolvido, cai no travessao — a lista continua utilizavel
    expect(screen.getByText('—')).toBeInTheDocument()
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
    // cliente_id resolvido (clienteA) pra so existir UM travessao na linha
    // — o do badge de pagamento — e a asserção abaixo ficar sem ambiguidade.
    mockGetPadrao([saida({ pag: '—', cliente_id: 'cli-1' })], [clienteA])
    render(<SaidasLista onSessaoExpirada={() => {}} />)
    await screen.findByText('S-0001')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
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
