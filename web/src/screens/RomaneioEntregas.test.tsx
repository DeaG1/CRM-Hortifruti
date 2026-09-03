import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { RomaneioEntregas } from './RomaneioEntregas'
import { api, ErroApi } from '../api/client'
import { CAMPOS_ROMANEIO_PADRAO } from '../derive/romaneio'

// Mock só de `api.get` — a classe ErroApi continua a real, porque o
// componente faz `err instanceof ErroApi`.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

/**
 * A MEDIÇÃO DA FOLHA DE ENTREGA, controlada.
 *
 * `medirCorpoQueCabe` lê alturas do DOM, e o jsdom não faz layout: no ambiente
 * de teste ele mediria zero para tudo. O padrão (12) é justamente o que a
 * função real devolve quando não há layout — "não encolhe nada" —, e cada
 * teste que precisa de uma folha grande enfileira as medições que quer.
 *
 * Quem prova que a medição de verdade funciona é a impressão em PDF pelo
 * Chrome; o que se prova aqui é o que a TELA faz com o resultado dela.
 */
const medicao = vi.hoisted(() => ({ fila: [] as number[], padrao: 12 }))
vi.mock('../components/medicaoDaFolha', () => ({
  medirCorpoQueCabe: () => (medicao.fila.length > 0
    ? medicao.fila.shift() as number
    : medicao.padrao),
}))

/** O mesmo "hoje" que o componente calcula (componentes LOCAIS, não UTC). */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const HOJE = hojeIsoLocal()

function linha(over: Record<string, unknown> = {}) {
  return {
    saida_id: 'p1', numero: '#1001', status: 'Pendente', obs: '', rota: 'Sul A',
    cliente_id: 'c1', cliente_nome: 'Mercado Boa Safra',
    cliente_endereco: 'Rua das Flores, 120', cliente_tel: '(43) 99999-1111',
    cliente_rota: 'Sul A',
    item_id: 'i1', produto: 'Alface Hidropônica', un: 'UN', qtd: 45, preco: 2.5,
    ...over,
  }
}

/** Uma resposta de `GET /api/saidas/romaneio/:data` por dia. Qualquer dia não
 * listado responde vazio — é o que a API faz num dia sem entrega. */
function mockDias(
  porDia: Record<string, unknown[]>,
  semData: { total: number; numeros: string[] } = { total: 0, numeros: [] },
) {
  mockGet.mockImplementation((url: string) => {
    const m = url.match(/^\/api\/saidas\/romaneio\/(\d{4}-\d{2}-\d{2})$/)
    if (!m) return Promise.reject(new Error('rota nao mockada: ' + url))
    return Promise.resolve({ data: m[1], itens: porDia[m[1]] ?? [], sem_data_entrega: semData })
  })
}

function montar() {
  const onVoltar = vi.fn()
  const onSessaoExpirada = vi.fn()
  const utils = render(
    <RomaneioEntregas onVoltar={onVoltar} onSessaoExpirada={onSessaoExpirada} />,
  )
  return { ...utils, onVoltar, onSessaoExpirada }
}

function folha(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.folha')
  if (!el) throw new Error('a folha (.folha) não está na tela')
  return el as HTMLElement
}

beforeEach(() => {
  mockGet.mockReset()
  window.localStorage.clear()
  medicao.fila = []
  medicao.padrao = 12
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ================================================ o dia, e só o dia dele

describe('RomaneioEntregas — a seleção por dia', () => {
  it('abre no dia de hoje e pede à API exatamente esse dia', async () => {
    mockDias({ [HOJE]: [linha()] })
    montar()
    await screen.findByText('Mercado Boa Safra')
    expect(mockGet).toHaveBeenCalledWith(`/api/saidas/romaneio/${HOJE}`)
  })

  it('a folha traz só as entregas do dia escolhido', async () => {
    mockDias({
      '2026-08-27': [linha({ cliente_nome: 'Cliente de ontem' })],
      '2026-08-28': [linha({ cliente_nome: 'Cliente de hoje' })],
    })
    const { container } = montar()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-28' } })

    await screen.findByText('Cliente de hoje')
    expect(within(folha(container)).queryByText('Cliente de ontem')).toBeNull()
  })

  it('trocar de dia refaz a busca com a nova data — um dia por requisição', async () => {
    mockDias({ [HOJE]: [linha()], '2026-08-24': [linha({ cliente_nome: 'Segunda' })] })
    montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-24' } })
    await screen.findByText('Segunda')

    const urls = mockGet.mock.calls.map(c => c[0] as string)
    expect(urls).toContain(`/api/saidas/romaneio/${HOJE}`)
    expect(urls).toContain('/api/saidas/romaneio/2026-08-24')
    // Nenhuma requisição sem dia, nunca — a separação é garantida pela ROTA.
    expect(urls.every(u => /\/romaneio\/\d{4}-\d{2}-\d{2}$/.test(u))).toBe(true)
  })

  it('um DIA ANTERIOR funciona igual a hoje: mesma folha, mesmos campos', async () => {
    const mesmasLinhas = [linha({ cliente_nome: 'Hoje SA', produto: 'Alface Hidropônica', un: 'UN', qtd: 45 })]
    mockDias({ [HOJE]: mesmasLinhas, '2026-08-24': mesmasLinhas })
    const { container } = montar()
    await screen.findByText('Hoje SA')
    const folhaDeHoje = folha(container).textContent ?? ''

    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-24' } })
    await waitFor(() => {
      expect(container.querySelector('.folha-data')?.textContent)
        .toBe('segunda-feira, 24/08/2026')
    })

    const folhaDoPassado = folha(container).textContent ?? ''
    expect(folhaDoPassado).toContain('Hoje SA')
    expect(folhaDoPassado).toContain('45 UN')
    // A ÚNICA diferença entre as duas folhas é a data: não existe "modo
    // histórico" que mude o que sai impresso — reimprimir a folha de terça é
    // o mesmo ato de imprimir a de hoje.
    const semData = (texto: string) =>
      texto.replace(/(?:[a-zç]+-feira|sábado|domingo), \d{2}\/\d{2}\/\d{4}/g, '<DATA>')
    expect(semData(folhaDoPassado)).toBe(semData(folhaDeHoje))
    expect(folhaDoPassado).not.toBe(folhaDeHoje)
  })

  it('os botões ◀ e ▶ andam um dia por clique', async () => {
    mockDias({})
    montar()
    const campo = await screen.findByLabelText<HTMLInputElement>('Entregas de')
    expect(campo.value).toBe(HOJE)

    fireEvent.click(screen.getByLabelText('Dia anterior'))
    await waitFor(() => expect(campo.value).not.toBe(HOJE))
    const anterior = campo.value

    fireEvent.click(screen.getByLabelText('Próximo dia'))
    await waitFor(() => expect(campo.value).toBe(HOJE))
    expect(anterior < HOJE).toBe(true)
  })

  it('o botão "Hoje" só aparece fora de hoje, e devolve para hoje', async () => {
    mockDias({})
    montar()
    await screen.findByLabelText('Entregas de')
    expect(screen.queryByRole('button', { name: 'Hoje' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Dia anterior'))
    const voltar = await screen.findByRole('button', { name: 'Hoje' })
    fireEvent.click(voltar)
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Entregas de').value).toBe(HOJE)
    })
  })

  it('data apagada não vira requisição nem folha — pede um dia, sem erro', async () => {
    mockDias({ [HOJE]: [linha()] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '' } })
    await screen.findByText('Escolha um dia para montar o romaneio.')
    expect(container.querySelector('.folha')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('RomaneioEntregas — a data na folha impressa', () => {
  it('sai por extenso, com dia da semana e ano', async () => {
    mockDias({ '2026-08-28': [linha()] })
    const { container } = montar()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-28' } })

    await screen.findByText('Mercado Boa Safra')
    expect(within(folha(container)).getAllByText('sexta-feira, 28/08/2026').length).toBeGreaterThan(0)
  })

  it('a data é o maior texto da folha — está no elemento de destaque próprio', async () => {
    mockDias({ '2026-08-28': [linha()] })
    const { container } = montar()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-28' } })
    await screen.findByText('Mercado Boa Safra')

    const destaque = container.querySelector('.folha-data')
    expect(destaque?.textContent).toBe('sexta-feira, 28/08/2026')
  })

  it('cada bloco de cliente carrega a data também — folha separada não perde o dia', async () => {
    mockDias({
      '2026-08-28': [
        linha({ cliente_id: 'c1', cliente_nome: 'Um' }),
        linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Dois' }),
      ],
    })
    const { container } = montar()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-28' } })
    await screen.findByText('Dois')

    const selos = container.querySelectorAll('.folha-bloco-selo')
    expect(selos).toHaveLength(2)
    for (const s of selos) expect(s.textContent).toBe('sexta-feira, 28/08/2026')
  })
})

// ================================================ venda sem data de entrega

describe('RomaneioEntregas — a venda que não pertence a dia nenhum', () => {
  it('não aparece na folha E é avisada, com quantas são e onde corrigir', async () => {
    mockDias({ [HOJE]: [linha()] }, { total: 2, numeros: ['#1042', '#1043'] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    const aviso = screen.getByRole('status')
    expect(aviso.textContent).toContain('2 vendas')
    expect(aviso.textContent).toContain('#1042')
    expect(aviso.textContent).toContain('romaneio nenhum')
    expect(aviso.textContent).toContain('Saídas')
    // E a folha continua só com o que de fato vai no caminhão.
    expect(within(folha(container)).queryByText(/#1042/)).toBeNull()
  })

  it('o aviso é da tela, não do papel — o motorista não pode agir sobre ele', async () => {
    mockDias({ [HOJE]: [linha()] }, { total: 1, numeros: ['#1042'] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    const aviso = container.querySelector('.folha-aviso')
    expect(aviso).not.toBeNull()
    expect(aviso?.getAttribute('data-no-print')).toBe('1')
  })

  it('sem nenhuma, não há aviso — não se avisa sobre o que não aconteceu', async () => {
    mockDias({ [HOJE]: [linha()] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')
    expect(container.querySelector('.folha-aviso')).toBeNull()
  })

  it('o aviso aparece mesmo num dia SEM entrega nenhuma — é onde ele mais importa', async () => {
    mockDias({}, { total: 3, numeros: ['#1', '#2', '#3'] })
    montar()
    await screen.findByText(/Nenhuma entrega marcada/)
    expect(screen.getByRole('status').textContent).toContain('3 vendas')
  })
})

// ========================================================== dia vazio

describe('RomaneioEntregas — dia sem entrega', () => {
  it('mostra vazio CLARO, com a data, e não um erro', async () => {
    mockDias({})
    const { container } = montar()
    const vazio = await screen.findByText(new RegExp('Nenhuma entrega marcada para'))

    expect(vazio.textContent).toContain(HOJE.slice(8) + '/' + HOJE.slice(5, 7))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('.folha')).toBeNull()
  })

  it('explica que o corte é a DATA DE ENTREGA, não a do pedido', async () => {
    mockDias({})
    montar()
    const vazio = await screen.findByText(/Nenhuma entrega marcada/)
    expect(vazio.parentElement?.textContent).toContain('data de entrega')
  })

  it('sem entrega nenhuma não há o que imprimir, e o botão não é oferecido', async () => {
    mockDias({})
    montar()
    await screen.findByText(/Nenhuma entrega marcada/)
    expect(screen.queryByRole('button', { name: 'Imprimir romaneio' })).toBeNull()
  })

  it('falha de rede é ERRO (role=alert), coisa diferente de dia vazio', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    const erro = await screen.findByRole('alert')
    expect(erro.textContent).toContain('Não foi possível carregar')
  })

  it('401 leva ao aviso de sessão expirada, não a uma folha em branco', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'nao autenticado' }))
    const { onSessaoExpirada } = montar()
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })
})

// ================================================ agrupamento e quantidade

describe('RomaneioEntregas — a folha', () => {
  it('agrupa por cliente, com os itens de cada pedido', async () => {
    mockDias({
      [HOJE]: [
        linha({ cliente_id: 'c1', cliente_nome: 'Boa Safra', item_id: 'i1', produto: 'Alface', un: 'UN', qtd: 45 }),
        linha({ cliente_id: 'c1', cliente_nome: 'Boa Safra', item_id: 'i2', produto: 'Rúcula', un: 'MC', qtd: 30 }),
        linha({
          cliente_id: 'c2', cliente_nome: 'Hortifruti Zé', saida_id: 'p2', numero: '#1002',
          item_id: 'i3', produto: 'Batata', un: 'KG', qtd: 12,
        }),
      ],
    })
    const { container } = montar()
    await screen.findByText('Hortifruti Zé')

    const blocos = container.querySelectorAll('.folha-bloco')
    expect(blocos).toHaveLength(2)
    expect(within(blocos[0] as HTMLElement).getByText('Alface')).toBeTruthy()
    expect(within(blocos[0] as HTMLElement).getByText('Rúcula')).toBeTruthy()
    expect(within(blocos[1] as HTMLElement).getByText('Batata')).toBeTruthy()
    expect(within(blocos[0] as HTMLElement).queryByText('Batata')).toBeNull()
  })

  it('a quantidade sai NA UNIDADE LANÇADA, não convertida em quilos', async () => {
    mockDias({
      [HOJE]: [
        linha({ item_id: 'i1', produto: 'Alface', un: 'UN', qtd: 45 }),
        linha({ item_id: 'i2', produto: 'Melancia', un: 'CX', qtd: 10 }),
        linha({ item_id: 'i3', produto: 'Batata', un: 'KG', qtd: 30 }),
      ],
    })
    const { container } = montar()
    await screen.findByText('Alface')

    const texto = folha(container).textContent ?? ''
    expect(texto).toContain('45 UN')
    expect(texto).toContain('10 CX')
    expect(texto).toContain('30 KG')
    expect(texto).not.toMatch(/\bkg\b/)
  })

  it('cada item tem um quadradinho para o motorista marcar no pátio', async () => {
    mockDias({
      [HOJE]: [
        linha({ item_id: 'i1', produto: 'Alface' }),
        linha({ item_id: 'i2', produto: 'Rúcula' }),
      ],
    })
    const { container } = montar()
    await screen.findByText('Alface')
    expect(container.querySelectorAll('.folha-check')).toHaveLength(2)
  })

  it('a folha traz a conferência de topo (clientes · pedidos · itens)', async () => {
    mockDias({
      [HOJE]: [
        linha({ cliente_id: 'c1', item_id: 'i1' }),
        linha({ cliente_id: 'c1', item_id: 'i2', produto: 'Rúcula' }),
      ],
    })
    const { container } = montar()
    await screen.findByText('Rúcula')
    expect(container.querySelector('.folha-resumo')?.textContent)
      .toBe('1 cliente · 1 pedido · 2 itens')
  })
})

// ================================================ a escolha dos campos

describe('RomaneioEntregas — escolher o que sai na folha', () => {
  const comDados = () => mockDias({
    [HOJE]: [linha({ obs: 'Entregar pelos fundos', qtd: 10, preco: 4 })],
  })

  it('abre com o padrão marcado: endereço, telefone, rota, número e observação', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    const texto = folha(container).textContent ?? ''
    expect(texto).toContain('Rua das Flores, 120')
    expect(texto).toContain('(43) 99999-1111')
    expect(texto).toContain('Sul A')
    expect(texto).toContain('#1001')
    expect(texto).toContain('Entregar pelos fundos')
  })

  it('PREÇO vem desmarcado — a folha não vaza preço por descuido', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    expect(folha(container).textContent).not.toContain('R$')
    for (const rotulo of ['Preço unitário', 'Total do item', 'Total do pedido']) {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: rotulo }).checked).toBe(false)
    }
  })

  it('desmarcar um campo tira o dado da folha na hora', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')
    expect(folha(container).textContent).toContain('Rua das Flores, 120')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Endereço do cliente' }))
    await waitFor(() => {
      expect(folha(container).textContent).not.toContain('Rua das Flores, 120')
    })
    // e o resto continua
    expect(folha(container).textContent).toContain('(43) 99999-1111')
  })

  it('marcar preço unitário faz o preço aparecer, com coluna própria', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Preço unitário' }))
    await waitFor(() => expect(folha(container).textContent).toContain('R$ 4,00'))
    expect(within(folha(container)).getByText('PREÇO UN.')).toBeTruthy()
  })

  it('marcar total do pedido soma o pedido', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Total do pedido' }))
    await waitFor(() => expect(folha(container).textContent).toContain('R$ 40,00'))
  })

  it('a tela diz o que sai SEMPRE — a escolha é honesta sobre o que não escolhe', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')
    const fixos = container.querySelector('.folha-campos-fixos')?.textContent ?? ''
    expect(fixos).toContain('Nome do cliente')
    expect(fixos).toContain('quantidade')
  })

  it('o painel de escolha não é impresso', async () => {
    comDados()
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')
    expect(container.querySelector('.folha-campos')?.getAttribute('data-no-print')).toBe('1')
  })
})

describe('RomaneioEntregas — a escolha PERSISTE entre impressões', () => {
  it('a escolha volta na próxima montagem (remontar = o F5 de amanhã)', async () => {
    mockDias({ [HOJE]: [linha({ qtd: 10, preco: 4 })] })
    const primeira = montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Preço unitário' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Telefone do cliente' }))
    await waitFor(() => expect(folha(primeira.container).textContent).toContain('R$ 4,00'))
    primeira.unmount()

    const segunda = montar()
    await screen.findByText('Mercado Boa Safra')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Preço unitário' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Telefone do cliente' }).checked).toBe(false)
    expect(folha(segunda.container).textContent).toContain('R$ 4,00')
    expect(folha(segunda.container).textContent).not.toContain('(43) 99999-1111')
  })

  it('sem nada gravado, abre no padrão', async () => {
    mockDias({ [HOJE]: [linha()] })
    montar()
    await screen.findByText('Mercado Boa Safra')
    for (const c of Object.entries(CAMPOS_ROMANEIO_PADRAO)) {
      const rotulo = { endereco: 'Endereço do cliente', telefone: 'Telefone do cliente',
        rota: 'Rota', numero: 'Número do pedido', obs: 'Observação do pedido',
        precoUnitario: 'Preço unitário', totalItem: 'Total do item',
        totalPedido: 'Total do pedido' }[c[0]] as string
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: rotulo }).checked).toBe(c[1])
    }
  })

  it('armazenamento que recusa gravar não quebra a tela: a folha muda e um aviso explica', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError')
    })
    mockDias({ [HOJE]: [linha({ qtd: 10, preco: 4 })] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Preço unitário' }))
    // A folha respeitou o clique...
    await waitFor(() => expect(folha(container).textContent).toContain('R$ 4,00'))
    // ...e o aviso diz que ela volta ao padrão no próximo acesso.
    const avisos = screen.getAllByRole('status').map(e => e.textContent ?? '')
    expect(avisos.some(t => t.includes('não pôde ser gravada'))).toBe(true)
  })
})

// ================================================ impressão e isolação

describe('RomaneioEntregas — a impressão', () => {
  it('usa a impressão nativa do navegador (window.print), sem gerar PDF', async () => {
    mockDias({ [HOJE]: [linha()] })
    montar()
    await screen.findByText('Mercado Boa Safra')

    const espiao = vi.spyOn(window, 'print').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir romaneio' }))
    expect(espiao).toHaveBeenCalledTimes(1)
  })

  it('todo controle da tela está marcado para não sair no papel', async () => {
    mockDias({ [HOJE]: [linha()] })
    const { container } = montar()
    await screen.findByText('Mercado Boa Safra')

    for (const seletor of ['.folha-barra', '.folha-campos']) {
      expect(container.querySelector(seletor)?.getAttribute('data-no-print')).toBe('1')
    }
    // E nenhum botão sobrou fora de uma região marcada.
    for (const botao of container.querySelectorAll('button')) {
      expect(botao.closest('[data-no-print]')).not.toBeNull()
    }
  })

  it('marca o documento enquanto está montado, e desmarca ao sair', async () => {
    mockDias({ [HOJE]: [linha()] })
    const { unmount } = montar()
    await screen.findByText('Mercado Boa Safra')
    // É esta classe que dá orientação retrato só a esta impressão, sem virar
    // os relatórios (que são paisagem) junto.
    expect(document.body.classList.contains('folha-imprimindo')).toBe(true)
    unmount()
    expect(document.body.classList.contains('folha-imprimindo')).toBe(false)
  })
})

describe('RomaneioEntregas — isolação de falha', () => {
  it('resposta corrompida não derruba a tela: avisa em role=status e o controle de dia segue', async () => {
    // `itens` não é array: `montarRomaneio` trata isso, então o que se força
    // aqui é a falha genérica — um item nulo, que estoura ao ser lido.
    mockGet.mockResolvedValue({
      data: HOJE, itens: [null], sem_data_entrega: { total: 0, numeros: [] },
    })
    const { container } = montar()

    const aviso = await screen.findByRole('status')
    expect(aviso.textContent).toContain('Não foi possível montar a folha')
    expect(screen.getByLabelText('Entregas de')).toBeTruthy()
    expect(container.querySelector('.folha-campos')).not.toBeNull()
  })

  it('o botão de voltar devolve a lista de saídas', async () => {
    mockDias({ [HOJE]: [linha()] })
    const { onVoltar } = montar()
    await screen.findByText('Mercado Boa Safra')
    fireEvent.click(screen.getByRole('button', { name: '← Voltar para a lista' }))
    expect(onVoltar).toHaveBeenCalled()
  })
})

// ==================================================================
// A FOLHA DE ENTREGA — a via que o CLIENTE confere e assina
// ==================================================================

/** Um pedido com dois itens e cabeçalho de pagamento pendente. */
function pedidoDeEntrega(over: Record<string, unknown> = {}) {
  return [
    linha({
      saida_id: 'p1', numero: '#1001', item_id: 'i1', produto: 'Alface Crespa',
      un: 'CX', qtd: 10, preco: 4, pag: 'Pendente', venc: '2036-09-07',
      forma_pag: 'Boleto', ...over,
    }),
    linha({
      saida_id: 'p1', numero: '#1001', item_id: 'i2', produto: 'Melancia',
      un: 'UN', qtd: 3, preco: 20, pag: 'Pendente', venc: '2036-09-07',
      forma_pag: 'Boleto', ...over,
    }),
  ]
}

/** Abre a tela e troca para a folha de entrega. */
async function irParaEntrega() {
  fireEvent.click(await screen.findByRole('button', { name: 'Folha de entrega' }))
  return screen.findByText('FOLHA DE ENTREGA')
}

describe('RomaneioEntregas — o botão da folha de entrega', () => {
  it('existe ao lado do romaneio, e o romaneio continua sendo o padrão', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    montar()
    await screen.findByText('ROMANEIO DE ENTREGAS')
    expect(screen.getByRole('button', { name: 'Romaneio do dia' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Folha de entrega' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Imprimir romaneio' })).toBeTruthy()
  })

  it('EXISTE TAMBÉM COM A LISTA VAZIA — a lição de 8cad53e', async () => {
    // Um dia sem entrega não quer dizer "não há folha de entrega": quer dizer
    // que este dia está vazio. Esconder o botão aí é escondê-lo de quem foi
    // procurar — e quem não acha conclui que a funcionalidade não existe.
    mockDias({})
    montar()
    await screen.findByText(/Nenhuma entrega marcada/)
    expect(screen.getByRole('button', { name: 'Folha de entrega' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Romaneio do dia' })).toBeTruthy()
  })

  it('com o dia vazio o botão de IMPRIMIR não é oferecido — não há o que mandar ao papel', async () => {
    mockDias({})
    montar()
    await screen.findByText(/Nenhuma entrega marcada/)
    fireEvent.click(screen.getByRole('button', { name: 'Folha de entrega' }))
    await screen.findByText(/Nenhum pedido para imprimir/)
    expect(screen.queryByRole('button', { name: 'Imprimir folha de entrega' })).toBeNull()
  })

  it('o vazio explica que pedido cancelado ou devolvido não tem folha', async () => {
    mockDias({})
    montar()
    await screen.findByText(/Nenhuma entrega marcada/)
    fireEvent.click(screen.getByRole('button', { name: 'Folha de entrega' }))
    const vazio = await screen.findByText(/Nenhum pedido para imprimir/)
    expect(vazio.parentElement?.textContent).toContain('cancelado')
    expect(vazio.parentElement?.textContent).toContain('devolvido')
  })

  it('trocar de folha troca o rótulo do botão de imprimir', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    montar()
    await irParaEntrega()
    expect(screen.getByRole('button', { name: 'Imprimir folha de entrega' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Imprimir romaneio' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Romaneio do dia' }))
    await screen.findByText('ROMANEIO DE ENTREGAS')
    expect(screen.getByRole('button', { name: 'Imprimir romaneio' })).toBeTruthy()
  })

  it('imprime com window.print, como as outras folhas', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    montar()
    await irParaEntrega()
    const espiao = vi.spyOn(window, 'print').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir folha de entrega' }))
    expect(espiao).toHaveBeenCalledTimes(1)
  })

  it('só UMA folha vai para o papel de cada vez — o romaneio sai da tela', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    expect(container.querySelectorAll('.folha')).toHaveLength(1)
    expect(container.querySelector('.folha-entrega')).not.toBeNull()
    expect(within(folha(container)).queryByText('ROMANEIO DE ENTREGAS')).toBeNull()
  })

  it('o painel de campos é do ROMANEIO e some na folha de entrega', async () => {
    // Valor não é opcional numa via que o cliente assina reconhecendo quanto
    // recebeu: não há o que escolher aqui.
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await screen.findByText('ROMANEIO DE ENTREGAS')
    expect(container.querySelector('.folha-campos')).not.toBeNull()
    await irParaEntrega()
    expect(container.querySelector('.folha-campos')).toBeNull()
  })

  it('todo controle continua marcado para não sair no papel', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    for (const botao of container.querySelectorAll('button')) {
      expect(botao.closest('[data-no-print]')).not.toBeNull()
    }
    expect(container.querySelector('#entrega-pedido')?.closest('[data-no-print]')).not.toBeNull()
  })
})

describe('RomaneioEntregas — o que a folha de entrega diz', () => {
  it('traz cliente, endereço, telefone, número do pedido e data da entrega', async () => {
    mockDias({ '2026-08-28': pedidoDeEntrega() })
    const { container } = montar()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-28' } })
    await irParaEntrega()

    const texto = folha(container).textContent ?? ''
    expect(texto).toContain('Mercado Boa Safra')
    expect(texto).toContain('Rua das Flores, 120')
    expect(texto).toContain('(43) 99999-1111')
    expect(texto).toContain('Pedido #1001')
    expect(container.querySelector('.folha-data')?.textContent).toBe('sexta-feira, 28/08/2026')
  })

  it('cada item tem quadradinho, produto, quantidade NA UNIDADE LANÇADA, preço e total', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()

    const texto = folha(container).textContent ?? ''
    expect(texto).toContain('Alface Crespa')
    expect(texto).toContain('10 CX')
    expect(texto).toContain('3 UN')
    expect(texto).not.toMatch(/\bkg\b/)
    expect(texto).toContain('R$ 4,00')
    expect(texto).toContain('R$ 40,00')
    expect(texto).toContain('R$ 20,00')
    expect(texto).toContain('R$ 60,00')
    expect(container.querySelectorAll('.folha-check')).toHaveLength(2)
  })

  it('o total do pedido sai no rodapé — é o que o cliente assina', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    const total = container.querySelector('.folha-entrega-total')
    expect(total?.textContent).toContain('TOTAL DO PEDIDO')
    expect(total?.textContent).toContain('R$ 100,00')
  })

  it('a situação de pagamento vira INSTRUÇÃO: o motorista decide na porta', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    const pag = container.querySelector('.folha-entrega-pagamento')
    expect(pag?.textContent).toContain('RECEBER NA ENTREGA')
    expect(pag?.textContent).toContain('Pendente')
    expect(pag?.textContent).toContain('vence em 07/09/2036')
    expect(pag?.textContent).toContain('Boleto')
  })

  it('pedido já pago manda NÃO receber', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega({ pag: 'Pago', forma_pag: 'PIX', venc: null }) })
    const { container } = montar()
    await irParaEntrega()
    const pag = container.querySelector('.folha-entrega-pagamento')
    expect(pag?.textContent).toContain('NÃO RECEBER')
    expect(pag?.textContent).toContain('PIX')
  })

  it('tem linha de assinatura, nome legível e data', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    const recibo = container.querySelector('.folha-entrega-recibo')
    expect(recibo?.textContent).toContain('Recebi e conferi')
    expect(recibo?.textContent).toContain('Assinatura')
    expect(recibo?.textContent).toContain('Nome legível')
    expect(recibo?.textContent).toContain('Data')
    expect(recibo?.querySelectorAll('.folha-linha-assinatura')).toHaveLength(3)
  })

  it('A ROTA NÃO SAI: é logística interna, o cliente não tem o que fazer com ela', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    const texto = folha(container).textContent ?? ''
    expect(texto).not.toContain('Sul A')
    expect(texto).not.toContain('Rota')
  })

  it('STATUS, PERDA e MOTIVO também não saem — são gestão', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega({ status: 'Em rota' }) })
    const { container } = montar()
    await irParaEntrega()
    const texto = folha(container).textContent ?? ''
    expect(texto).not.toContain('Em rota')
    expect(texto).not.toContain('Perda')
    expect(texto).not.toContain('Motivo')
  })

  it('item sem preço sai com travessão, nunca "R$ 0,00"', async () => {
    mockDias({ [HOJE]: [linha({ saida_id: 'p1', item_id: 'i1', qtd: 10, preco: 0 })] })
    const { container } = montar()
    await irParaEntrega()
    const texto = folha(container).textContent ?? ''
    expect(texto).toContain('—')
    expect(texto).not.toContain('R$ 0,00')
  })
})

describe('RomaneioEntregas — escolher DE QUAL pedido é a folha', () => {
  const doisPedidos = () => mockDias({
    [HOJE]: [
      ...pedidoDeEntrega(),
      linha({
        saida_id: 'p2', numero: '#1002', item_id: 'i9', produto: 'Rúcula',
        cliente_id: 'c2', cliente_nome: 'Hortifruti Zé',
        cliente_endereco: 'Av. Central, 9', cliente_tel: '(43) 98888-2222',
      }),
    ],
  })

  it('o seletor lista os pedidos do dia, com número, cliente e contagem', async () => {
    doisPedidos()
    montar()
    await irParaEntrega()
    const seletor = screen.getByLabelText<HTMLSelectElement>('Pedido')
    const rotulos = [...seletor.options].map(o => o.textContent)
    expect(rotulos).toEqual([
      '#1001 · Mercado Boa Safra (2 itens)',
      '#1002 · Hortifruti Zé (1 item)',
    ])
  })

  it('abre no primeiro pedido do dia, sem obrigar a escolher', async () => {
    doisPedidos()
    const { container } = montar()
    await irParaEntrega()
    expect(folha(container).textContent).toContain('Mercado Boa Safra')
    expect(folha(container).textContent).not.toContain('Hortifruti Zé')
  })

  it('trocar de pedido troca a folha inteira — UM pedido por folha', async () => {
    doisPedidos()
    const { container } = montar()
    await irParaEntrega()
    fireEvent.change(screen.getByLabelText('Pedido'), { target: { value: 'p2' } })

    await waitFor(() => {
      expect(folha(container).textContent).toContain('Hortifruti Zé')
    })
    expect(folha(container).textContent).toContain('Rúcula')
    expect(folha(container).textContent).not.toContain('Alface Crespa')
    expect(folha(container).textContent).not.toContain('Mercado Boa Safra')
  })

  it('trocar de dia cai no primeiro pedido do dia novo, sem carregar a escolha velha', async () => {
    mockDias({
      [HOJE]: pedidoDeEntrega(),
      '2026-08-24': [linha({
        saida_id: 'pX', numero: '#0900', item_id: 'iX', produto: 'Cenoura',
        cliente_id: 'c9', cliente_nome: 'Padaria Estrela',
      })],
    })
    const { container } = montar()
    await irParaEntrega()
    fireEvent.change(screen.getByLabelText('Entregas de'), { target: { value: '2026-08-24' } })

    await waitFor(() => {
      expect(folha(container).textContent).toContain('Padaria Estrela')
    })
    // continua na folha de entrega: trocar o dia não devolve ao romaneio
    expect(screen.getByRole('button', { name: 'Imprimir folha de entrega' })).toBeTruthy()
  })
})

describe('RomaneioEntregas — uma folha só, e o que isso custa', () => {
  it('no volume do dia a dia a folha NÃO encolhe: sai no tamanho confortável', async () => {
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    expect(container.querySelector('.folha-entrega')?.getAttribute('data-corpo')).toBe('12')
    // sem `zoom`: uma folha no tamanho normal não carrega estilo nenhum
    expect(container.querySelector('.folha-entrega')?.getAttribute('style')).toBeNull()
    expect(screen.queryByText(/a letra encolheu/)).toBeNull()
  })

  it('quando não cabe, a letra encolhe — e a folha diz em quanto', async () => {
    // Uma coluna não coube (9), duas couberam no mesmo 9: fica com duas.
    medicao.fila = [9, 9]
    medicao.padrao = 9
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()

    await waitFor(() => {
      expect(container.querySelector('.folha-entrega')?.getAttribute('data-corpo')).toBe('9')
    })
    expect(container.querySelector<HTMLElement>('.folha-entrega')?.style.zoom).toBe('0.75')
    const aviso = screen.getByText(/a letra encolheu/)
    expect(aviso.textContent).toContain('12px')
    expect(aviso.textContent).toContain('9px')
  })

  it('DUAS COLUNAS antes de encolher a letra — e só quando uma não coube', async () => {
    medicao.fila = [7, 11]
    medicao.padrao = 11
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()

    await waitFor(() => {
      expect(container.querySelector('.folha-tabela--duas')).not.toBeNull()
    })
    expect(container.querySelector('.folha-entrega')?.getAttribute('data-corpo')).toBe('11')
  })

  it('abaixo do piso de legibilidade a tela DIZ o número, e imprime assim mesmo', async () => {
    medicao.fila = [3, 5]
    medicao.padrao = 5
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()

    const aviso = await screen.findByText(/deixa de ser conferível/)
    expect(aviso.textContent).toContain('5px')
    expect(aviso.textContent).toContain('Dividir o pedido')
    // o botão continua lá: a instrução do dono foi "tem que caber de alguma
    // forma", e o código obedece — o que ele ganha é o número, não um bloqueio.
    expect(screen.getByRole('button', { name: 'Imprimir folha de entrega' })).toBeTruthy()
    expect(container.querySelector('.folha-entrega')).not.toBeNull()
  })

  it('o aviso de tamanho é da TELA, não do papel', async () => {
    medicao.fila = [8, 8]
    medicao.padrao = 8
    mockDias({ [HOJE]: pedidoDeEntrega() })
    const { container } = montar()
    await irParaEntrega()
    const aviso = await screen.findByText(/a letra encolheu/)
    expect(aviso.closest('[data-no-print]')).not.toBeNull()
    expect(within(folha(container)).queryByText(/a letra encolheu/)).toBeNull()
  })

  it('a caixa de medição não fica para trás no documento', async () => {
    medicao.fila = [9, 9]
    medicao.padrao = 9
    mockDias({ [HOJE]: pedidoDeEntrega() })
    montar()
    await irParaEntrega()
    await waitFor(() => {
      expect(document.querySelectorAll('.folha-medindo')).toHaveLength(0)
    })
  })
})
