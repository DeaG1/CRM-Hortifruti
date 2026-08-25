import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App'
import { api } from './api/client'
import { rotuloPeriodo } from './derive/periodo'

// Mock so de `api.get` — mantem a classe ErroApi real (App e as telas fazem
// `err instanceof ErroApi`). Molde: FinanceiroTela.test.tsx.
vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const SAIDA = {
  id: 's-1', numero: 'S-0001', cliente_id: 'c-1', rota: 'Norte',
  data_pedido: '2026-06-01', entrega: '2026-06-05', status: 'Entregue',
  pag: 'Pago', venc: null, data_pag: '2026-06-06', forma_pag: 'PIX',
  perda_kg: 0, motivo: '', obs: '', valor: 1000, peso: 100,
}

const ENTRADA = {
  id: 'e-1', numero: 'C-1040', fornecedor_id: 'f-1', data: '2026-06-08',
  perda_kg: 0, perda_itens_qtd: 0, motivo: 'transporte', pago: 'Pago',
  data_pag: '2026-06-10', forma_pag: 'PIX', obs: '',
  valor_total: 4000, peso_total: 2000,
}

/** Toda rota que qualquer tela desta navegacao possa pedir. O foco destes
 * testes e o ESTADO do periodo atravessando a troca de tela, nao o conteudo
 * de cada tela — por isso as respostas sao minimas. */
function mockTudo(papel: 'admin' | 'colaborador' = 'admin') {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/eu') return Promise.resolve({ usuarioId: 'u-1', papel })
    if (rota === '/api/saidas') return Promise.resolve([SAIDA])
    if (rota === '/api/entradas') return Promise.resolve([ENTRADA])
    if (rota.startsWith('/api/relatorios/produtos')) return Promise.resolve([])
    return Promise.resolve([])
  })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('App — o periodo global sobrevive a troca de tela', () => {
  it('escolher um mes e navegar para outra tela mantem o recorte', async () => {
    mockTudo('colaborador')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    // Um mes qualquer da janela oferecida — nao um literal, que envelheceria
    // junto com o relogio.
    const mes = seletor.options[1].value
    fireEvent.change(seletor, { target: { value: mes } })
    expect(seletor.value).toBe(mes)

    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText('Saídas (Vendas)', { selector: '.shell-header-titulo' })
    // O seletor continua no mesmo mes: o estado mora em App, que nao
    // desmonta ao trocar de tela.
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
    // E a tela nova ja abre falando desse recorte.
    expect(screen.getByText(/os filtros abaixo/i)).toHaveTextContent(rotuloPeriodo(mes))

    fireEvent.click(screen.getByRole('button', { name: 'Entradas (Compras)' }))
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
    expect(screen.getByText(/clique numa entrada para editar/i))
      .toHaveTextContent(rotuloPeriodo(mes))
  })

  it('o padrao ao entrar e "Todo o periodo" — nunca um recorte que o usuario nao escolheu', async () => {
    mockTudo('colaborador')
    render(<App />)
    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    expect(seletor.value).toBe('all')
  })

  it('voltar para o mes anterior e navegar de novo continua consistente', async () => {
    mockTudo('colaborador')
    render(<App />)
    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement

    fireEvent.change(seletor, { target: { value: seletor.options[2].value } })
    const mes = seletor.value
    fireEvent.click(screen.getByRole('button', { name: 'Estoque' }))
    await screen.findByText('Estoque', { selector: '.shell-header-titulo' })
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText('Saídas (Vendas)', { selector: '.shell-header-titulo' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
  })
})

describe('App — saldo em caixa por papel', () => {
  it('admin ve o badge de saldo', async () => {
    mockTudo('admin')
    render(<App />)
    expect(await screen.findByText('SALDO EM CAIXA · ACUMULADO')).toBeInTheDocument()
    // 1000 recebido − 4000 pago ao produtor − 0 lancamentos = −3000.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('-R$ 3.000'))
  })

  it('colaborador nao ve o badge em tela nenhuma', async () => {
    mockTudo('colaborador')
    render(<App />)
    await screen.findByLabelText('Período')
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Estoque' }))
    await screen.findByText('Estoque', { selector: '.shell-header-titulo' })
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()
  })
})
