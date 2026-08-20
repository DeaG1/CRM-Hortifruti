import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClienteFicha } from './ClienteFicha'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.get/del` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const cliente: Cliente = {
  id: 'c-1',
  nome: 'Mercado Bom Preço',
  resp: 'Sonia',
  cnpj: '',
  tel: '',
  email: '',
  endereco: '',
  rota: 'Sul A',
  freq: '2×/sem · Seg e Qui',
  status: 'ativo',
  cobranca: 'Em dia',
  forma: 'PIX',
  limite: 300,
  prazo: 14,
  tend: '→',
  obs: '',
}

beforeEach(() => {
  mockGet.mockReset()
  mockDel.mockReset()
})

describe('ClienteFicha — carregamento', () => {
  it('mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro != 401/404 mostra alerta generico', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o cliente.')
  })

  it('404 mostra "cliente nao encontrado"', async () => {
    mockGet.mockRejectedValue(new ErroApi(404, { erro: 'nao encontrado' }))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ClienteFicha — sem pedidos (Fase 1 ainda nao existe)', () => {
  it('mostra nome, metricas zeradas e mensagem de historico vazio (nao um bloco vazio)', async () => {
    mockGet.mockResolvedValue(cliente)
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByText('Mercado Bom Preço')).toBeInTheDocument()

    // faturado e ticket/entrega ficam zerados, nao em branco
    expect(screen.getAllByText('R$ 0')).toHaveLength(2)
    // participacao zerada
    expect(screen.getByText('0%')).toBeInTheDocument()
    // inadimplencia aparece duas vezes (metricas + credito), tambem zerada
    expect(screen.getAllByText('0,0%')).toHaveLength(2)

    expect(screen.getByText('Nenhuma entrega registrada.')).toBeInTheDocument()
  })
})

describe('ClienteFicha — navegacao', () => {
  it('clicar em Voltar chama onVoltar', async () => {
    mockGet.mockResolvedValue(cliente)
    const onVoltar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: /voltar/i }))
    expect(onVoltar).toHaveBeenCalledOnce()
  })

  it('clicar em Editar cliente chama onEditar com os dados carregados', async () => {
    mockGet.mockResolvedValue(cliente)
    const onEditar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={onEditar} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Editar cliente' }))
    expect(onEditar).toHaveBeenCalledWith(cliente)
  })
})

describe('ClienteFicha — exclusao pede confirmacao', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', async () => {
    mockGet.mockResolvedValue(cliente)
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', async () => {
    mockGet.mockResolvedValue(cliente)
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onVoltar', async () => {
    mockGet.mockResolvedValue(cliente)
    mockDel.mockResolvedValue({ ok: true })
    const onVoltar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/clientes/c-1'))
    await waitFor(() => expect(onVoltar).toHaveBeenCalledOnce())
  })

  it('falha na exclusao mostra alerta e nao volta para a lista', async () => {
    mockGet.mockResolvedValue(cliente)
    mockDel.mockRejectedValue(new Error('falha'))
    const onVoltar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
    expect(onVoltar).not.toHaveBeenCalled()
  })

  it('401 na exclusao chama onSessaoExpirada', async () => {
    mockGet.mockResolvedValue(cliente)
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})
