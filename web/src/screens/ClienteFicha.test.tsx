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

/** Uma linha de GET /api/saidas — os campos que ClienteFicha declara em
 * `SaidaBruta`. Default: venda entregue e paga do cliente da ficha. */
const venda = (over: Record<string, unknown> = {}) => ({
  id: 'sv1', numero: 'PD-001', cliente_id: 'c-1', entrega: '2026-06-10',
  valor: 900, peso: 120, itens_sem_conversao: 0,
  status: 'Entregue', pag: 'Pago', venc: null, ...over,
})

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
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro != 401/404 mostra alerta generico', async () => {
    mockRotas(new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o cliente.')
  })

  it('404 mostra "cliente nao encontrado"', async () => {
    mockRotas(new ErroApi(404, { erro: 'nao encontrado' }))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro', async () => {
    // /api/clientes/:id e /api/saidas sao buscados em paralelo (efeitos
    // independentes) — os dois podem devolver 401, entao a asserção e
    // toHaveBeenCalled (nao ...Once), mesmo padrao de ClientesLista.test.tsx.
    mockRotas(new ErroApi(401, { erro: 'sessao invalida' }), new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ClienteFicha — vendas reais (GET /api/saidas)', () => {
  it('sem vendas no periodo, as metricas comerciais ficam em travessao (nao zeradas)', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    // As SEIS metricas do bloco "Metricas comerciais" (qtd, faturado,
    // ticket/entrega, participacao, ultima compra e inadimplencia) ficam em
    // travessao — nunca "R$ 0"/"0%"/"0,0%"/"0 kg", que fingiriam um dado
    // apurado que nao existe.
    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    expect(within(metricas).getAllByText('—')).toHaveLength(6)
    expect(within(metricas).queryByText('R$ 0')).not.toBeInTheDocument()
    expect(within(metricas).queryByText('0 kg')).not.toBeInTheDocument()

    const taxa = screen.getByText('Taxa de inadimplência').closest('.ficha-linha') as HTMLElement
    expect(within(taxa).getByText('—')).toBeInTheDocument()

    expect(screen.getByText('Nenhum pedido registrado.')).toBeInTheDocument()
  })

  it('uma venda entregue e paga produz ticket, participacao e aparece nos pedidos recentes', async () => {
    mockRotas(cliente, [venda({ entrega: '2026-06-10', valor: 900, peso: 120 })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    // faturado e ticket/entrega (uma so entrega = o proprio valor)
    expect(within(metricas).getAllByText('R$ 900')).toHaveLength(2)
    // unico cliente considerado -> 100% de participacao
    expect(within(metricas).getByText('100%')).toBeInTheDocument()
    // pago, sem atraso
    expect(within(metricas).getByText('0,0%')).toBeInTheDocument()

    // pedidos recentes deixa de mostrar a mensagem vazia e lista a venda,
    // com numero, data, quantidade, valor e selo de status
    expect(screen.queryByText('Nenhum pedido registrado.')).not.toBeInTheDocument()
    const pedido = document.querySelector('.ficha-pedido') as HTMLElement
    expect(within(pedido).getByText('PD-001')).toBeInTheDocument()
    expect(within(pedido).getByText('10/06')).toBeInTheDocument()
    expect(within(pedido).getByText('120 kg')).toBeInTheDocument()
    expect(within(pedido).getByText('R$ 900')).toBeInTheDocument()
    expect(within(pedido).getByText('Entregue')).toBeInTheDocument()
    expect(within(pedido).getByText('Pago')).toBeInTheDocument()
  })

  it('falha em /api/saidas mantem a ficha visivel, com metricas comerciais indisponiveis', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)

    // a ficha aparece normalmente...
    expect(await screen.findByText('Mercado Bom Preço')).toBeInTheDocument()
    // ...com um aviso discreto (nao um erro que apaga a ficha)...
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    // ...e as seis metricas comerciais em travessao
    const metricas = document.querySelector('.ficha-metricas') as HTMLElement
    expect(within(metricas).getAllByText('—')).toHaveLength(6)
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

  it('venda vencida e nao paga mostra Atrasado — mesmo com o cadastro dizendo "Em dia"', async () => {
    // `cliente.cobranca` e 'Em dia' na fixture (e sempre sera: nenhum campo
    // do ModalCliente altera essa coluna). Se a tela voltar a ler o campo
    // cru, este teste quebra.
    mockRotas(cliente, [venda({ pag: 'Pendente', venc: VENCIDO })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Atrasado')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Em dia')).not.toBeInTheDocument()
  })

  it('venda gravada como Atrasado (dado legado) tambem mostra Atrasado', async () => {
    mockRotas(cliente, [venda({ pag: 'Atrasado' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Atrasado')).toBeInTheDocument()
  })

  it('tudo pago mostra Em dia — mesmo com o cadastro dizendo "Atrasado"', async () => {
    mockRotas({ ...cliente, cobranca: 'Atrasado' }, [venda({ pag: 'Pago' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Em dia')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Atrasado')).not.toBeInTheDocument()
  })

  it('venda pendente ainda NAO vencida mostra Em dia — pendente nao e atraso', async () => {
    mockRotas(cliente, [venda({ pag: 'Pendente', venc: A_VENCER })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('Em dia')).toBeInTheDocument()
  })

  it('cliente sem venda nenhuma mostra travessao, nunca "Em dia"', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('—')).toBeInTheDocument()
    expect(within(linhaCobranca()).queryByText('Em dia')).not.toBeInTheDocument()
  })

  it('vendas so de outro cliente nao viram "Em dia" nesta ficha', async () => {
    mockRotas(cliente, [venda({ id: 'sv9', cliente_id: 'c-99', pag: 'Pago' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCobranca()).getByText('—')).toBeInTheDocument()
  })

  it('falha em /api/saidas deixa o status em travessao, com o aviso — nao "Em dia" por omissao', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
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
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: /voltar/i }))
    expect(onVoltar).toHaveBeenCalledOnce()
  })

  it('clicar em Editar cliente chama onEditar com os dados carregados', async () => {
    mockRotas(cliente)
    const onEditar = vi.fn()
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={onEditar} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Editar cliente' }))
    expect(onEditar).toHaveBeenCalledWith(cliente)
  })
})

describe('ClienteFicha — exclusao pede confirmacao', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', async () => {
    mockRotas(cliente)
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', async () => {
    mockRotas(cliente)
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
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
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
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
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={onVoltar} onEditar={() => {}} />)
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
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} onSessaoExpirada={onSessaoExpirada} />)
    await screen.findByText('Mercado Bom Preço')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

// ===================== metricas da ficha (achados CF-2 a CF-5)

/** A metrica do bloco "Metricas comerciais" cujo rotulo e `label`. */
function metrica(label: string): HTMLElement {
  return screen.getByText(label).closest('.ficha-metrica') as HTMLElement
}

/** O valor exibido numa metrica (a linha do meio do bloco). */
function valorDaMetrica(label: string): string {
  return (metrica(label).querySelector('.ficha-metrica-valor') as HTMLElement).textContent ?? ''
}

/** A linha do bloco "Credito & inadimplencia" cuja chave e `chave`. */
function linhaCredito(chave: string): HTMLElement {
  return screen.getByText(chave).closest('.ficha-linha') as HTMLElement
}

describe('ClienteFicha — "Ultima compra" (CF-2)', () => {
  it('mostra a data do pedido ENTREGUE mais recente, com o ano', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-05-02' }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-06-20' }),
      venda({ id: 'c', numero: 'PD-003', entrega: '2026-03-11' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Última compra')).toBe('20/06/2026')
  })

  it('ignora pedido ainda NAO entregue — em rota nao e compra feita', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-05-02', status: 'Entregue' }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-08-30', status: 'Em rota', pag: 'Pendente' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Última compra')).toBe('02/05/2026')
  })

  it('NAO segue o filtro de periodo: cliente parado mostra quando comprou pela ultima vez', async () => {
    // O periodo selecionado (agosto) nao tem venda nenhuma; o faturado cai em
    // travessao, mas "ultima compra" continua respondendo junho.
    mockRotas(cliente, [venda({ entrega: '2026-06-10' })])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-08" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Faturado / mês')).toBe('—')
    expect(valorDaMetrica('Última compra')).toBe('10/06/2026')
  })

  it('cliente sem pedido entregue: travessao e o sub diz por que', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Última compra')).toBe('—')
    expect(metrica('Última compra')).toHaveTextContent('nenhum pedido entregue ainda')
  })

  it('falha em /api/saidas deixa a ultima compra em travessao, nunca uma data inventada', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    expect(valorDaMetrica('Última compra')).toBe('—')
  })
})

describe('ClienteFicha — "Qtd no periodo" (CF-3)', () => {
  it('soma o peso das entregas do cliente, em kg, e conta quantas foram', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-02', peso: 120 }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-06-20', peso: 80 }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Qtd no período')).toBe('200 kg')
    expect(metrica('Qtd no período')).toHaveTextContent('2 entregas')
  })

  it('nao soma entrega de OUTRO cliente', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', peso: 120 }),
      venda({ id: 'b', numero: 'PD-002', cliente_id: 'c-99', peso: 500 }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Qtd no período')).toBe('120 kg')
    expect(metrica('Qtd no período')).toHaveTextContent('1 entrega')
  })

  it('RESPEITA o filtro de periodo — o rotulo promete "no periodo"', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-02', peso: 120 }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-07-20', peso: 400 }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-06" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Qtd no período')).toBe('120 kg')
  })

  it('sem entrega no periodo: travessao, nunca "0 kg"', async () => {
    mockRotas(cliente, [venda({ entrega: '2026-06-10', peso: 120 })])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-08" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Qtd no período')).toBe('—')
    expect(metrica('Qtd no período')).toHaveTextContent('sem entrega no período')
  })

  it('item sem peso medio marca a quantidade com * e explica no title', async () => {
    mockRotas(cliente, [venda({ peso: 120, itens_sem_conversao: 2 })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const marca = within(metrica('Qtd no período')).getByText('120 kg*')
    expect(marca.getAttribute('title')).toContain('2 itens')
    expect(marca.getAttribute('title')).toContain('peso médio')
  })

  it('falha em /api/saidas deixa a quantidade em travessao', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    expect(valorDaMetrica('Qtd no período')).toBe('—')
  })
})

describe('ClienteFicha — metas e semaforo nas metricas (CF-4)', () => {
  /** Cor inline do valor de uma metrica (jsdom normaliza pra rgb()). */
  function corDaMetrica(label: string): string {
    return (metrica(label).querySelector('.ficha-metrica-valor') as HTMLElement).style.color
  }

  const VERDE = 'rgb(63, 143, 91)'
  const AMBAR = 'rgb(199, 147, 32)'
  const VERMELHO = 'rgb(194, 80, 47)'
  const NEUTRO = 'rgb(42, 42, 36)'

  it('cada metrica traz o sub-rotulo com a meta', async () => {
    mockRotas(cliente, [venda()])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(metrica('Faturado / mês')).toHaveTextContent('meta R$ 3.500–3.800')
    expect(metrica('Ticket / entrega')).toHaveTextContent('meta ≥ R$ 430')
    expect(metrica('% do faturamento')).toHaveTextContent('risco de concentração acima de 15%')
    expect(metrica('Inadimplência')).toHaveTextContent('meta ≤ 1%')
  })

  it('faturado acima da meta fica verde; abaixo dela, ambar; bem abaixo, vermelho', async () => {
    async function corDoFaturado(valor: number): Promise<string> {
      mockRotas(cliente, [venda({ valor })])
      const { unmount } = render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
      await screen.findByText('Mercado Bom Preço')
      const cor = corDaMetrica('Faturado / mês')
      unmount()
      return cor
    }
    expect(await corDoFaturado(4000)).toBe(VERDE)
    expect(await corDoFaturado(2500)).toBe(AMBAR)
    expect(await corDoFaturado(900)).toBe(VERMELHO)
  })

  it('ticket por entrega usa a mesma escala do painel (>=430 verde, >=150 ambar)', async () => {
    mockRotas(cliente, [venda({ valor: 200 })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(corDaMetrica('Ticket / entrega')).toBe(AMBAR)
  })

  it('o sub da inadimplencia conta os atrasos', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', pag: 'Pendente', venc: '2020-01-01' }),
      venda({ id: 'b', numero: 'PD-002', pag: 'Pago' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(metrica('Inadimplência')).toHaveTextContent('meta ≤ 1% · 1 atraso')
  })

  it('SEM dado nao ha semaforo: travessao fica neutro, nunca vermelho', async () => {
    // Vermelho num travessao diria "esta pessimo" sobre um numero que
    // ninguem apurou — e o oposto da convencao da tela.
    mockRotas(cliente, [])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(corDaMetrica('Faturado / mês')).toBe(NEUTRO)
    expect(corDaMetrica('Ticket / entrega')).toBe(NEUTRO)
    expect(corDaMetrica('Inadimplência')).toBe(NEUTRO)
  })

  it('falha em /api/saidas tambem nao pinta nada de vermelho', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    expect(corDaMetrica('Faturado / mês')).toBe(NEUTRO)
  })
})

describe('ClienteFicha — "Historico de atrasos" no bloco Credito (CF-5)', () => {
  const VENCIDO = '2020-01-01'

  it('mostra quantos pedidos estao atrasados e quanto somam, em vermelho', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', valor: 300, pag: 'Pendente', venc: VENCIDO }),
      venda({ id: 'b', numero: 'PD-002', valor: 200, pag: 'Pendente', venc: VENCIDO }),
      venda({ id: 'c', numero: 'PD-003', valor: 900, pag: 'Pago' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const linha = linhaCredito('Histórico de atrasos')
    expect(within(linha).getByText('2 pedidos · R$ 500')).toBeInTheDocument()
    expect((within(linha).getByText('2 pedidos · R$ 500')).style.color).toBe('rgb(194, 80, 47)')
  })

  it('cliente com vendas e nenhum atraso: "0 atrasos" MEDIDO, nunca travessao', async () => {
    mockRotas(cliente, [venda({ pag: 'Pago' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const linha = linhaCredito('Histórico de atrasos')
    expect(within(linha).getByText('0 atrasos')).toBeInTheDocument()
    expect(within(linha).queryByText('—')).not.toBeInTheDocument()
  })

  it('cliente sem venda cobravel: travessao, nunca "0 atrasos"', async () => {
    mockRotas(cliente, [])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const linha = linhaCredito('Histórico de atrasos')
    expect(within(linha).getByText('—')).toBeInTheDocument()
    expect(within(linha).queryByText('0 atrasos')).not.toBeInTheDocument()
  })

  it('falha em /api/saidas deixa o historico em travessao — nao "0 atrasos" por omissao', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    const linha = linhaCredito('Histórico de atrasos')
    expect(within(linha).getByText('—')).toBeInTheDocument()
    expect(within(linha).queryByText('0 atrasos')).not.toBeInTheDocument()
  })

  it('NAO segue o filtro de periodo: divida vencida em maio continua divida em agosto', async () => {
    mockRotas(cliente, [venda({ entrega: '2026-05-10', valor: 300, pag: 'Pendente', venc: VENCIDO })])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-08" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(linhaCredito('Histórico de atrasos')).getByText('1 pedido · R$ 300')).toBeInTheDocument()
  })
})

describe('ClienteFicha — "Pedidos recentes" (CF-6)', () => {
  function pedidos(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.ficha-pedido'))
  }

  it('inclui pedido NAO entregue — pendente e em rota sao o que o vendedor precisa ver', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-02', status: 'Entregue' }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-06-20', status: 'Em rota', pag: 'Pendente' }),
      venda({ id: 'c', numero: 'PD-003', entrega: '2026-06-25', status: 'Pendente', pag: 'Pendente' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(pedidos()).toHaveLength(3)
    // Selo de STATUS (nao a situacao de pagamento, que tambem diz "Pendente"
    // em duas destas linhas) — dai a busca ser pela celula do selo.
    const selos = Array.from(document.querySelectorAll('.ficha-pedido-selo')).map(s => s.textContent)
    expect(selos).toEqual(['Pendente', 'Em rota', 'Entregue'])
  })

  it('ordena do mais recente para o mais antigo e mostra no maximo quatro', async () => {
    mockRotas(cliente, ['01', '02', '03', '04', '05'].map((n, i) => venda({
      id: `s${n}`, numero: `PD-0${n}`, entrega: `2026-06-${10 + i}`,
    })))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const numeros = pedidos().map(p => (p.querySelector('.ficha-pedido-numero') as HTMLElement).textContent)
    expect(numeros).toEqual(['PD-005', 'PD-004', 'PD-003', 'PD-002'])
  })

  it('dois pedidos no mesmo dia saem em ordem estavel (desempate pelo numero)', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-10' }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-06-10' }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const numeros = pedidos().map(p => (p.querySelector('.ficha-pedido-numero') as HTMLElement).textContent)
    expect(numeros).toEqual(['PD-002', 'PD-001'])
  })

  it('nao lista pedido de outro cliente', async () => {
    mockRotas(cliente, [venda({ id: 'b', numero: 'PD-999', cliente_id: 'c-99' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(pedidos()).toHaveLength(0)
    expect(screen.getByText('Nenhum pedido registrado.')).toBeInTheDocument()
  })

  it('a situacao de pagamento e a DERIVADA: vencida e nao paga aparece como Atrasado', async () => {
    mockRotas(cliente, [venda({ pag: 'Pendente', venc: '2020-01-01' })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(within(pedidos()[0]).getByText('Atrasado')).toBeInTheDocument()
  })

  it('quantidade nao convertivel do pedido ganha * com a explicacao', async () => {
    mockRotas(cliente, [venda({ peso: 40, itens_sem_conversao: 1 })])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const marca = within(pedidos()[0]).getByText('40 kg*')
    expect(marca.getAttribute('title')).toContain('1 item')
  })

  it('falha em /api/saidas: bloco vazio, sem pedido inventado', async () => {
    mockRotas(cliente, new Error('falha de rede'))
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as vendas/i)
    expect(pedidos()).toHaveLength(0)
    expect(screen.getByText('Nenhum pedido registrado.')).toBeInTheDocument()
  })
})

describe('ClienteFicha — periodo global', () => {
  it('as metricas comerciais respeitam o periodo, como na lista de onde se clicou', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-10', valor: 900 }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-07-10', valor: 4000 }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-06" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Faturado / mês')).toBe('R$ 900')
  })

  it('sem periodo (padrao "all") soma tudo', async () => {
    mockRotas(cliente, [
      venda({ id: 'a', numero: 'PD-001', entrega: '2026-06-10', valor: 900 }),
      venda({ id: 'b', numero: 'PD-002', entrega: '2026-07-10', valor: 100 }),
    ])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    expect(valorDaMetrica('Faturado / mês')).toBe('R$ 1.000')
  })

  it('a legenda diz qual recorte vale e o que fica fora dele', async () => {
    mockRotas(cliente, [venda()])
    render(<ClienteFicha papel="admin" id="c-1" periodo="2026-06" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')
    const legenda = document.querySelector('.ficha-bloco-legenda') as HTMLElement
    expect(legenda).toHaveTextContent('Junho/2026')
    expect(legenda).toHaveTextContent(/histórico inteiro/i)
  })
})

/**
 * A ficha e a mesma historia da lista: CADASTRO sim, METRICA nao. O
 * colaborador abre a ficha para consultar e editar o cadastro do
 * estabelecimento; faturado, ticket, inadimplencia, health score e limite de
 * credito ficam fora — ver `podeVerMetricasDeCadastro` (telas.ts) e o
 * comentario da prop `papel` no componente.
 *
 * `limite` merece nota: e coluna de `clientes` e chega no GET que ele ja le,
 * entao escondе-lo aqui e apresentacao, nao barreira. Esta escrito assim na
 * funcao pura, e o relatorio da tarefa registra o mesmo.
 */
describe('ClienteFicha — colaborador ve o cadastro, nao as metricas', () => {
  it('nao dispara GET /api/saidas', async () => {
    mockRotas(cliente, [venda()])
    render(<ClienteFicha papel="colaborador" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    const rotas = mockGet.mock.calls.map(c => c[0] as string)
    expect(rotas).toContain('/api/clientes/c-1')
    expect(rotas).not.toContain('/api/saidas')
  })

  it('nao mostra o bloco de metricas comerciais nem os pedidos recentes', async () => {
    mockRotas(cliente, [venda({ valor: 4200 })])
    render(<ClienteFicha papel="colaborador" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    expect(screen.queryByText('Métricas comerciais')).not.toBeInTheDocument()
    expect(screen.queryByText('Pedidos recentes')).not.toBeInTheDocument()
    expect(screen.queryByText('Faturado / mês')).not.toBeInTheDocument()
    expect(screen.queryByText('Ticket / entrega')).not.toBeInTheDocument()
    expect(screen.queryByText('% do faturamento')).not.toBeInTheDocument()
    expect(screen.queryByText('Inadimplência')).not.toBeInTheDocument()
  })

  it('nao mostra o health score nem o bloco de credito e inadimplencia', async () => {
    mockRotas(cliente, [venda()])
    render(<ClienteFicha papel="colaborador" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    expect(screen.queryByText('HEALTH SCORE')).not.toBeInTheDocument()
    expect(screen.queryByText('Crédito & inadimplência')).not.toBeInTheDocument()
    expect(screen.queryByText('Limite de crédito')).not.toBeInTheDocument()
    expect(screen.queryByText('Status de cobrança')).not.toBeInTheDocument()
    expect(screen.queryByText('Histórico de atrasos')).not.toBeInTheDocument()
  })

  it('mostra o cadastro, a rota e as observacoes — e o botao de editar', async () => {
    const onEditar = vi.fn()
    mockRotas({ ...cliente, obs: 'Prefere entrega cedo' })
    render(<ClienteFicha papel="colaborador" id="c-1" onVoltar={() => {}} onEditar={onEditar} />)
    await screen.findByText('Mercado Bom Preço')

    expect(screen.getByText('Cadastro & rota')).toBeInTheDocument()
    expect(screen.getByText('Sul A')).toBeInTheDocument()
    expect(screen.getByText('2×/sem · Seg e Qui')).toBeInTheDocument()
    expect(screen.getByText('"Prefere entrega cedo"')).toBeInTheDocument()
    // O status do CADASTRO fica: e campo do formulario, nao score derivado.
    // Aparece duas vezes (no cabecalho e na linha "Status" do bloco de
    // cadastro), como acontece tambem para o admin.
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Editar cliente' }))
    expect(onEditar).toHaveBeenCalled()
  })

  it('nao mostra o botao Excluir', async () => {
    mockRotas(cliente)
    render(<ClienteFicha papel="colaborador" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    // E nao ha caminho escondido para chegar na confirmacao.
    expect(screen.queryByText(/Confirmar exclusão/)).not.toBeInTheDocument()
  })

  it('admin continua vendo metricas, credito, health score e o botao Excluir', async () => {
    mockRotas(cliente, [venda()])
    render(<ClienteFicha papel="admin" id="c-1" onVoltar={() => {}} onEditar={() => {}} />)
    await screen.findByText('Mercado Bom Preço')

    expect(screen.getByText('Métricas comerciais')).toBeInTheDocument()
    expect(screen.getByText('Pedidos recentes')).toBeInTheDocument()
    expect(screen.getByText('HEALTH SCORE')).toBeInTheDocument()
    expect(screen.getByText('Crédito & inadimplência')).toBeInTheDocument()
    expect(screen.getByText('Limite de crédito')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
    expect(mockGet.mock.calls.map(c => c[0] as string)).toContain('/api/saidas')
  })
})
