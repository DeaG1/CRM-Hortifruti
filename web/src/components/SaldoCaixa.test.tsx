import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SaldoCaixa } from './SaldoCaixa'
import { api, ErroApi } from '../api/client'

// Mock so de `api.get` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
// Molde: FinanceiroTela.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

type Falha = 'saidas' | 'entradas' | 'lancamentos'

function mockCarga(opts: {
  saidas?: unknown[]
  entradas?: unknown[]
  lancamentos?: unknown[]
  falhar?: Falha[]
  status?: number
} = {}) {
  const { saidas = [], entradas = [], lancamentos = [], falhar = [], status = 500 } = opts
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/saidas') {
      return falhar.includes('saidas')
        ? Promise.reject(new ErroApi(status, { erro: 'x' }))
        : Promise.resolve(saidas)
    }
    if (rota === '/api/entradas') {
      return falhar.includes('entradas')
        ? Promise.reject(new ErroApi(status, { erro: 'x' }))
        : Promise.resolve(entradas)
    }
    if (rota === '/api/lancamentos') {
      return falhar.includes('lancamentos')
        ? Promise.reject(new ErroApi(status, { erro: 'x' }))
        : Promise.resolve(lancamentos)
    }
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

const valor = () => screen.getByRole('status').textContent

beforeEach(() => {
  mockGet.mockReset()
})

describe('SaldoCaixa — as tres fontes somando', () => {
  it('recebido − pago ao produtor − lancamentos', async () => {
    mockCarga({
      saidas: [{ pag: 'Pago', venc: null, valor: 5000 }, { pag: 'Pendente', venc: null, valor: 2000 }],
      entradas: [{ pago: 'Pago', valor_total: 1500 }, { pago: 'Pendente', valor_total: 800 }],
      lancamentos: [{ valor: 500 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(valor()).toBe('R$ 3.000'))
  })

  it('base vazia nas tres e zero MEDIDO, nao travessao', async () => {
    mockCarga()
    render(<SaldoCaixa />)
    await waitFor(() => expect(valor()).toBe('R$ 0'))
  })

  it('saldo negativo aparece com sinal, nao zerado nem em travessao', async () => {
    mockCarga({
      saidas: [{ pag: 'Pago', venc: null, valor: 500 }],
      entradas: [{ pago: 'Pago', valor_total: 900 }],
      lancamentos: [{ valor: 300 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(valor()).toBe('-R$ 700'))
  })
})

describe('SaldoCaixa — cada fonte falhando isoladamente', () => {
  it('vendas indisponiveis -> travessao (nunca saldo parcial)', async () => {
    mockCarga({
      falhar: ['saidas'],
      entradas: [{ pago: 'Pago', valor_total: 900 }],
      lancamentos: [{ valor: 100 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(screen.getByText(/fonte indisponível: vendas/)).toBeInTheDocument())
    expect(valor()).toBe('—')
  })

  it('compras indisponiveis -> travessao', async () => {
    mockCarga({
      falhar: ['entradas'],
      saidas: [{ pag: 'Pago', venc: null, valor: 5000 }],
      lancamentos: [{ valor: 100 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(screen.getByText(/fonte indisponível: compras/)).toBeInTheDocument())
    expect(valor()).toBe('—')
  })

  it('lancamentos indisponiveis -> travessao', async () => {
    mockCarga({
      falhar: ['lancamentos'],
      saidas: [{ pag: 'Pago', venc: null, valor: 5000 }],
      entradas: [{ pago: 'Pago', valor_total: 900 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(screen.getByText(/fonte indisponível: lançamentos/)).toBeInTheDocument())
    expect(valor()).toBe('—')
  })

  it('403 numa fonte (colaborador que chegasse aqui) -> travessao, nao numero parcial', async () => {
    mockCarga({
      falhar: ['lancamentos'],
      status: 403,
      saidas: [{ pag: 'Pago', venc: null, valor: 5000 }],
      entradas: [{ pago: 'Pago', valor_total: 900 }],
    })
    render(<SaldoCaixa />)
    await waitFor(() => expect(screen.getByText(/fonte indisponível/)).toBeInTheDocument())
    expect(valor()).toBe('—')
  })

  it('401 numa fonte volta ao login em vez de mostrar erro', async () => {
    const onSessaoExpirada = vi.fn()
    mockCarga({ falhar: ['saidas'], status: 401 })
    render(<SaldoCaixa onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByText(/fonte indisponível/)).not.toBeInTheDocument()
  })
})

describe('SaldoCaixa — rotulo e escopo', () => {
  it('o rotulo diz que e ACUMULADO (nao segue o filtro de periodo)', async () => {
    mockCarga()
    render(<SaldoCaixa />)
    expect(screen.getByText('SALDO EM CAIXA · ACUMULADO')).toBeInTheDocument()
    await waitFor(() => expect(valor()).toBe('R$ 0'))
  })

  it('o title abre as tres parcelas do numero', async () => {
    mockCarga({
      saidas: [{ pag: 'Pago', venc: null, valor: 1000 }],
      entradas: [{ pago: 'Pago', valor_total: 400 }],
      lancamentos: [{ valor: 100 }],
    })
    const { container } = render(<SaldoCaixa />)
    await waitFor(() => expect(valor()).toBe('R$ 500'))
    const badge = container.querySelector('.shell-caixa')
    expect(badge?.getAttribute('title')).toContain('não segue o filtro de período')
    expect(badge?.getAttribute('title')).toContain('R$ 1.000')
    expect(badge?.getAttribute('title')).toContain('R$ 400')
    expect(badge?.getAttribute('title')).toContain('R$ 100')
  })

  it('enquanto carrega mostra travessao, nunca um zero provisorio', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<SaldoCaixa />)
    expect(valor()).toBe('—')
  })
})
