import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

function comoPromise(v: unknown): Promise<unknown> {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

/** Roteia `api.get` pelas duas chamadas que ClienteFicha faz (GET
 * /api/clientes/c-1 e GET /api/saidas), cada uma com sua propria resposta —
 * mesmo motivo do helper equivalente em ClientesLista.test.tsx. `saidasResp`
 * default `[]` cobre os testes que nao se importam com vendas. */
function mockRotas(clienteResp: unknown, saidasResp: unknown = []) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/clientes/c-1') return comoPromise(clienteResp)
    if (url === '/api/saidas') return comoPromise(saidasResp)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockDel.mockReset()
})

describe('ClienteFicha — carregamento', () => {
  it('mostra indicador enquanto a chamada esta pendente', () => {
    mockRotas(new Promise(() => {}))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro != 401/404 mostra alerta generico', async () => {
    mockRotas(new Error('falha de rede'))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o cliente.')
  })

  it('404 mostra "cliente nao encontrado"', async () => {
    mockRotas(new ErroApi(404, { erro: 'nao encontrado' }))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro', async () => {
    // /api/clientes/:id e /api/saidas sao buscados em paralelo (efeitos
    // independentes) — os dois podem devolver 401, entao a asserção e
    // toHaveBeenCalled (nao ...Once), mesmo padrao de ClientesLista.test.tsx.
    mockRotas(new ErroApi(401, { erro: 'sessao invalida' }), new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ClienteFicha — vendas reais (GET /api/saidas)', () => {
  it('sem vendas no periodo, as metricas comerciais ficam em travessao (nao zeradas)', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    // faturado, ticket/entrega, participacao e inadimplencia (bloco
    // "Metricas comerciais") ficam em travessao — nunca "R$ 0"/"0%"/"0,0%",
    // que fingiriam um dado apurado que nao existe.
    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    expect(within(metricas).getAllByText('—')).toHaveLength(4)
    expect(within(metricas).queryByText('R$ 0')).not.toBeInTheDocument()

    const taxa = screen.getByText('Taxa de inadimplência').closest('.ficha-linha') as HTMLElement
    expect(within(taxa).getByText('—')).toBeInTheDocument()

    expect(screen.getByText('Nenhuma entrega registrada.')).toBeInTheDocument()
  })

  it('uma venda entregue e paga produz ticket, participacao e aparece no historico', async () => {
    mockRotas(cliente, [
      { id: 'sv1', cliente_id: 'c-1', entrega: '2026-06-10', valor: 900, status: 'Entregue', pag: 'Pago', venc: null },
    ])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    // faturado e ticket/entrega (uma so entrega = o proprio valor)
    expect(within(metricas).getAllByText('R$ 900')).toHaveLength(2)
    // unico cliente considerado -> 100% de participacao
    expect(within(metricas).getByText('100%')).toBeInTheDocument()
    // pago, sem atraso
    expect(within(metricas).getByText('0,0%')).toBeInTheDocument()

    // historico de entregas deixa de mostrar a mensagem vazia e lista a venda
    expect(screen.queryByText('Nenhuma entrega registrada.')).not.toBeInTheDocument()
    expect(screen.getByText('10/06 · Pago')).toBeInTheDocument()
  })

  it('falha em /api/saidas mantem a ficha visivel, com metricas comerciais indisponiveis', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)

    // a ficha aparece normalmente...
    expect(await screen.findByText('Mercado Bom Preço')).toBeInTheDocument()
    // ...com um aviso discreto (nao um erro que apaga a ficha)...
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    // ...e as metricas comerciais em travessao
    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    expect(within(metricas).getAllByText('—')).toHaveLength(4)
  })
})

describe('ClienteFicha — status de cobranca e derivado das vendas (CF-1)', () => {
  // Mesma convencao de SaidasLista.test.tsx: datas absurdamente longe pros
  // dois lados, pra o teste nao depender do dia em que roda (o componente le
  // o relogio de verdade em `hojeIsoLocal`).
  const VENCIDO = '2020-01-01'
  const A_VENCER = '2099-01-01'

  /** A linha "Status de cobranca" do bloco Credito & inadimplencia. */
  function linhaCobranca(): HTMLElement {
    return screen.getByText('Status de cobrança').closest('.ficha-linha') as HTMLElement
  }

  const venda = (over: Record<string, unknown> = {}) => ({
    id: 'sv1', cliente_id: 'c-1', entrega: '2026-06-10', valor: 900,
    status: 'Entregue', pag: 'Pago', venc: null, ...over,
  })

  it('venda vencida e nao paga mostra Atrasado — mesmo com o cadastro dizendo "Em dia"', async () => {
    // `cliente.cobranca` e 'Em dia' na fixture (e sempre sera: nenhum campo
    // do ModalCliente altera essa coluna). Se a tela voltar a ler o campo
    // cru, este teste quebra.
    mockRotas(cliente, [venda({ pag: 'Pendente', venc: VENCIDO })])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Atrasado')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Em dia')).not.toBeInTheDocument()
  })

  it('venda gravada como Atrasado (dado legado) tambem mostra Atrasado', async () => {
    mockRotas(cliente, [venda({ pag: 'Atrasado' })])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Atrasado')).toBeInTheDocument()
  })

  it('tudo pago mostra Em dia — mesmo com o cadastro dizendo "Atrasado"', async () => {
    mockRotas({ ...cliente, cobranca: 'Atrasado' }, [venda({ pag: 'Pago' })])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Em dia')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Atrasado')).not.toBeInTheDocument()
  })

  it('venda pendente ainda NAO vencida mostra Em dia — pendente nao e atraso', async () => {
    mockRotas(cliente, [venda({ pag: 'Pendente', venc: A_VENCER })])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Em dia')).toBeInTheDocument()
  })

  it('cliente sem venda nenhuma mostra travessao, nunca "Em dia"', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('—')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Em dia')).not.toBeInTheDocument()
  })

  it('vendas so de outro cliente nao viram "Em dia" nesta ficha', async () => {
    mockRotas(cliente, [venda({ id: 'sv9', cliente_id: 'c-99', pag: 'Pago' })])
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('—')).toBeInTheDocument()
  })

  it('falha em /api/saidas deixa o status em travessao, com o aviso — nao "Em dia" por omissao', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    expect(within(linhaCobranca()).getByText('—')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Em dia')).not.toBeInTheDocument()
  })
})

describe('ClienteFicha — navegacao', () => {
  it('clicar em Voltar chama onVoltar', async () => {
    mockRotas(cliente)
    const onVoltar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: /voltar/i }))
    expect(onVoltar).toHaveBeenCalledOnce()
  })

  it('clicar em Editar cliente chama onEditar com os dados carregados', async () => {
    mockRotas(cliente)
    const onEditar = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={onEditar} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Editar cliente' }))
    expect(onEditar).toHaveBeenCalledWith(cliente)
  })
})

describe('ClienteFicha — exclusao pede confirmacao', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', async () => {
    mockRotas(cliente)
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', async () => {
    mockRotas(cliente)
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onVoltar', async () => {
    mockRotas(cliente)
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
    mockRotas(cliente)
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
    mockRotas(cliente)
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClienteFicha id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})
