import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FornecedoresLista } from './FornecedoresLista'
import { api, ErroApi } from '../api/client'
import type { Fornecedor } from '../derive/fornecedores'
import type { Produto } from '../derive/produtos'
import type { EntradaResumo } from '../derive/relatorios'

// Mock do client inteiro: FornecedoresLista usa `api.get` (lista + detalhe de
// cada fornecedor + catalogo de produtos), e o ModalFornecedor que ela
// renderiza internamente (nao ha tela de ficha — mesma razao de
// ProdutosLista) usa `api.post/put/del`. Mantem a classe ErroApi real.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const produtoBatata: Produto = { id: 'pr-1', nome: 'Batata', un: 'KG', peso_medio: 0 }
const produtoAlface: Produto = { id: 'pr-2', nome: 'Alface', un: 'UN', peso_medio: 0 }

const fornecedorBase = (over: Partial<Fornecedor> = {}): Fornecedor => ({
  id: 'f-1', nome: 'Fazenda Boa Terra', regiao: 'Sul A', contato: '(41) 90000-0000', ...over,
})

/** Coleta (entrada) como GET /api/entradas devolve — `peso_total` ja em kg. */
const entradaBase = (over: Partial<EntradaResumo> = {}): EntradaResumo => ({
  numero: 'C-1', fornecedor_id: 'f-1', data: '2026-06-08', perda_kg: 0, perda_itens_qtd: 0,
  motivo: 'transporte', pago: 'Pago', data_pag: '2026-06-10',
  valor_total: 2000, peso_total: 1000, ...over,
})

/**
 * Configura `api.get` pros quatro formatos de URL que FornecedoresLista
 * chama: lista (sem produtos vinculados), catalogo de produtos, detalhe por
 * fornecedor (com produtos vinculados) e as coletas — GET /api/fornecedores
 * nao traz `produtos`, so GET /api/fornecedores/:id traz (ver comentario no
 * componente e api/src/routes/fornecedores.ts).
 *
 * `entradas: 'falha'` simula GET /api/entradas caindo sozinho, sem derrubar
 * o resto da tela (isolacao de falha, igual a ClientesLista/ProdutosLista).
 */
function configurarGet(opts: {
  lista: Fornecedor[]
  produtos?: Produto[]
  detalhes?: Record<string, Fornecedor>
  entradas?: EntradaResumo[] | 'falha'
}) {
  const produtos = opts.produtos ?? []
  const detalhes = opts.detalhes ?? {}
  const entradas = opts.entradas ?? []
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/fornecedores') return Promise.resolve(opts.lista)
    if (url === '/api/produtos') return Promise.resolve(produtos)
    if (url === '/api/entradas') {
      return entradas === 'falha'
        ? Promise.reject(new Error('falha de rede'))
        : Promise.resolve(entradas)
    }
    const m = /^\/api\/fornecedores\/(.+)$/.exec(url)
    if (m && detalhes[m[1]]) return Promise.resolve(detalhes[m[1]])
    return Promise.reject(new Error('url nao mapeada em configurarGet: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('FornecedoresLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os fornecedores.')
  })

  it('vazio: mostra "nenhum fornecedor cadastrado" quando a API devolve lista vazia', async () => {
    configurarGet({ lista: [] })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum fornecedor cadastrado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar primeiro fornecedor/i })).toBeInTheDocument()
  })

  it('com dados: lista os fornecedores recebidos', async () => {
    configurarGet({
      lista: [fornecedorBase({ id: 'f-1', nome: 'Fazenda A' }), fornecedorBase({ id: 'f-2', nome: 'Fazenda B' })],
      produtos: [produtoBatata],
      detalhes: {
        'f-1': fornecedorBase({ id: 'f-1', nome: 'Fazenda A', produtos: [produtoBatata] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Fazenda B', produtos: [] }),
      },
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Fazenda A')).toBeInTheDocument()
    expect(screen.getByText('Fazenda B')).toBeInTheDocument()
  })
})

describe('FornecedoresLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    // /api/fornecedores e /api/entradas sao buscados em efeitos independentes
    // — os dois podem devolver 401, entao a assercao e toHaveBeenCalled (nao
    // ...Once), mesmo padrao de ClientesLista.test.tsx.
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<FornecedoresLista papel="admin" onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FornecedoresLista — produtos que entrega e metricas', () => {
  it('mostra os produtos vinculados a cada fornecedor', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      produtos: [produtoBatata, produtoAlface],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata, produtoAlface] }) },
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Alface')).toBeInTheDocument()
  })

  it('sem produtos vinculados: mostra aviso em vez de lista vazia', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Nenhum produto vinculado')).toBeInTheDocument()
  })

})

describe('FornecedoresLista — as quatro metricas por fornecedor', () => {
  const soUmFornecedor = (entradas: EntradaResumo[] | 'falha') => configurarGet({
    lista: [fornecedorBase()],
    detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    entradas,
  })

  it('fornecedor COM coletas mostra preco medio, variacao, ultima coleta e aproveitamento', async () => {
    soUmFornecedor([
      // 1000kg a R$ 2,00 com 100kg de perda
      entradaBase({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000, perda_kg: 100 }),
      // 1000kg a R$ 2,20, sem perda -> media 2,10 / aproveitamento 95% / variacao +10%
      entradaBase({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
    ])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    expect(screen.getByText('R$ 2,10')).toBeInTheDocument()
    expect(screen.getByText('10/06')).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
    // uma vez so: a celula do fornecedor. O cartao de resumo, que repetia a
    // media DAS variacoes, saiu a pedido do dono do produto.
    expect(screen.getAllByText('+10,0%')).toHaveLength(1)
  })

  it('aproveitamento aparece — e a metrica que o cartao nem renderizava', async () => {
    soUmFornecedor([entradaBase({ valor_total: 2000, peso_total: 1000, perda_kg: 200 })])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Aproveit.')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('fornecedor SEM coleta: travessao nas quatro, nunca R$ 0,00 nem 0%', async () => {
    soUmFornecedor([])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    // so as 4 metricas do cartao do fornecedor
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('quem comprou e nao perdeu nada tem 100% de aproveitamento medido', async () => {
    soUmFornecedor([entradaBase({ perda_kg: 0, perda_itens_qtd: 0 })])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('uma unica coleta: variacao fica em travessao e o title explica que faltam duas', async () => {
    soUmFornecedor([entradaBase()])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    // as outras tres saem normalmente
    expect(screen.getByText('R$ 2,00')).toBeInTheDocument()
    expect(screen.getByText('08/06')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    // e a variacao nao vira "0,0%" (que afirmaria que o preco nao mudou)
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
    const travessoes = screen.getAllByText('—')
    expect(travessoes.some(el => /1 coleta registrada/.test(el.getAttribute('title') ?? '')))
      .toBe(true)
  })

  it('duas coletas com o mesmo preco: 0,0% e uma variacao medida, nao travessao', async () => {
    soUmFornecedor([
      entradaBase({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000 }),
      entradaBase({ numero: 'C-2', data: '2026-06-10', valor_total: 2000, peso_total: 1000 }),
    ])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    // so a celula, como no caso de +10,0% acima
    expect(screen.getAllByText('0,0%')).toHaveLength(1)
  })

  it('coletas de outro fornecedor nao vazam para quem nunca coletou', async () => {
    configurarGet({
      lista: [fornecedorBase(), fornecedorBase({ id: 'f-2', nome: 'Sitio Vale Verde' })],
      detalhes: {
        'f-1': fornecedorBase({ produtos: [] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Sitio Vale Verde', produtos: [] }),
      },
      entradas: [entradaBase({ fornecedor_id: 'f-1' })],
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Sitio Vale Verde')
    // f-1 tem preco/coleta/aproveitamento (so a variacao dele fica em
    // travessao: uma coleta so); f-2 fica com as 4 em travessao
    expect(screen.getByText('R$ 2,00')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(1 + 4)
  })
})

// ========= cartao de resumo: removido a pedido do dono do produto =========

/**
 * Guarda de reintroducao. O cartao "Variacao de preco de compra" exibia a
 * media das variacoes com o sub "ultima compra vs. anterior · ±7% CEASA",
 * como se 7% fosse cotacao consultada na CEASA. Nao era: e uma constante fixa
 * herdada do prototipo, que nada neste sistema consulta. O dono do produto
 * mandou remover o cartao inteiro.
 *
 * A VARIACAO EM SI CONTINUA VIVA — na celula "Variacao" de cada fornecedor,
 * que compara a ultima coleta com a anterior a partir de dado real. O que nao
 * pode voltar e o cartao agregado e, principalmente, o rotulo CEASA em
 * qualquer lugar da tela.
 */
describe('FornecedoresLista — cartao de resumo NAO e renderizado', () => {
  const comDuasColetas = () => configurarGet({
    lista: [fornecedorBase()],
    detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    entradas: [
      entradaBase({ numero: 'C-1', data: '2026-06-01', valor_total: 2000, peso_total: 1000 }),
      entradaBase({ numero: 'C-2', data: '2026-06-10', valor_total: 2200, peso_total: 1000 }),
    ],
  })

  it('nao ha cartao "Variacao de preco de compra" nem o sub do prototipo', async () => {
    comDuasColetas()
    const { container } = render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.queryByText('Variação de preço de compra')).not.toBeInTheDocument()
    expect(container.querySelector('.fornecedores-resumo')).toBeNull()
    expect(container.querySelector('.fornecedores-resumo-card')).toBeNull()
    expect(screen.queryByText(/última compra vs\. anterior/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fornecedor\(es\)/i)).not.toBeInTheDocument()
  })

  it('a referencia CEASA nao sobrevive em lugar nenhum da tela', async () => {
    comDuasColetas()
    const { container } = render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(container.textContent).not.toMatch(/CEASA/i)
    expect(container.textContent).not.toMatch(/±7%/)
  })

  it('a variacao POR FORNECEDOR continua — so o agregado saiu', async () => {
    comDuasColetas()
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('Variação')).toBeInTheDocument()
    // Uma unica ocorrencia: a celula. Com o cartao vivo seriam duas.
    expect(screen.getAllByText('+10,0%')).toHaveLength(1)
  })
})

describe('FornecedoresLista — isolacao de falha das coletas', () => {
  it('GET /api/entradas falhando mantem a lista visivel, com aviso e metricas em travessao', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
      entradas: 'falha',
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)

    // o cadastro continua na tela — e o que a tela existe pra mostrar
    expect(await screen.findByText('Fazenda Boa Terra')).toBeInTheDocument()
    expect(screen.getByText('Sul A · (41) 90000-0000')).toBeInTheDocument()

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/não foi possível carregar as coletas/i)
    // aviso, nao erro: a tela nao quebrou
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(4)
  })
})

describe('FornecedoresLista — itens sem conversao (unidade != KG sem peso medio)', () => {
  it('marca as metricas com * e explica no rodape o que ficou de fora', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
      entradas: [entradaBase({ valor_total: 2000, peso_total: 1000, itens_sem_conversao: 2 })],
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    expect(screen.getByText('R$ 2,00*')).toBeInTheDocument()
    expect(screen.getByText('100%*')).toBeInTheDocument()
    expect(screen.getByText('R$ 2,00*')).toHaveAttribute('title', expect.stringContaining('2 itens'))
    expect(screen.getByRole('note')).toHaveTextContent(/2 itens de coleta em unidade diferente de KG/i)
  })

  it('base toda convertivel sai limpa, sem asterisco nem rodape', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
      entradas: [entradaBase()],
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('R$ 2,00')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('FornecedoresLista — abrir modal', () => {
  it('clicar em "Novo fornecedor" abre o modal de criacao', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    fireEvent.click(screen.getByRole('button', { name: /^＋ Novo fornecedor/i }))
    expect(screen.getByRole('dialog', { name: 'Novo fornecedor' })).toBeInTheDocument()
  })

  it('clicar num cartao abre o modal de edicao com os dados do fornecedor', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      produtos: [produtoBatata],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata] }) },
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Fazenda Boa Terra'))
    expect(screen.getByRole('dialog', { name: 'Editar fornecedor' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do produtor/i)).toHaveValue('Fazenda Boa Terra')
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('vazio: clicar em "Cadastrar primeiro fornecedor" abre o modal de criacao', async () => {
    configurarGet({ lista: [] })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /cadastrar primeiro fornecedor/i }))
    expect(screen.getByRole('dialog', { name: 'Novo fornecedor' })).toBeInTheDocument()
  })
})

describe('FornecedoresLista — recarrega apos salvar/excluir no modal', () => {
  it('salvar no modal fecha o modal e recarrega a lista', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    mockPost.mockResolvedValue(fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova', produtos: [] }))
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    // apos salvar, a segunda leva da lista (e do detalhe) inclui os dois fornecedores
    configurarGet({
      lista: [fornecedorBase(), fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova' })],
      detalhes: {
        'f-1': fornecedorBase({ produtos: [] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Fazenda Nova', produtos: [] }),
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /^＋ Novo fornecedor/i }))
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Fazenda Nova' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText('Fazenda Nova')
  })

  it('excluir no modal fecha o modal e recarrega a lista', async () => {
    configurarGet({ lista: [fornecedorBase()], detalhes: { 'f-1': fornecedorBase({ produtos: [] }) } })
    mockDel.mockResolvedValue({ ok: true })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Fazenda Boa Terra'))

    configurarGet({ lista: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText(/nenhum fornecedor cadastrado/i)
  })
})

// ================================= periodo global (achado S-3 da auditoria)

describe('FornecedoresLista — periodo global', () => {
  const umFornecedor = (entradas: EntradaResumo[]) => configurarGet({
    lista: [fornecedorBase()],
    detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    entradas,
  })

  it('as metricas so contam as coletas do periodo escolhido', async () => {
    umFornecedor([
      entradaBase({ numero: 'C-1', data: '2026-06-10', valor_total: 2000, peso_total: 1000 }),
      entradaBase({ numero: 'C-2', data: '2026-05-10', valor_total: 9000, peso_total: 1000 }),
    ])
    render(<FornecedoresLista papel="admin" periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('R$ 2,00')).toBeInTheDocument()
    expect(screen.queryByText('R$ 9,00')).not.toBeInTheDocument()
    expect(screen.getByText('10/06')).toBeInTheDocument()
  })

  it('sem periodo (padrao "all") soma a base inteira', async () => {
    umFornecedor([
      entradaBase({ numero: 'C-1', data: '2026-06-10', valor_total: 2000, peso_total: 1000 }),
      entradaBase({ numero: 'C-2', data: '2026-05-10', valor_total: 4000, peso_total: 1000 }),
    ])
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    expect(screen.getByText('R$ 3,00')).toBeInTheDocument()
  })

  it('o CADASTRO nao some num periodo sem coleta: fica com travessao nas quatro', async () => {
    configurarGet({
      lista: [fornecedorBase(), fornecedorBase({ id: 'f-2', nome: 'Sitio das Flores' })],
      detalhes: {
        'f-1': fornecedorBase({ produtos: [] }),
        'f-2': fornecedorBase({ id: 'f-2', nome: 'Sitio das Flores', produtos: [] }),
      },
      entradas: [entradaBase({ data: '2026-06-10' })],
    })
    render(<FornecedoresLista papel="admin" periodo="2026-01" onSessaoExpirada={() => {}} />)
    // Um fornecedor não deixa de existir porque não houve coleta em janeiro.
    expect(await screen.findByText('Fazenda Boa Terra')).toBeInTheDocument()
    expect(screen.getByText('Sitio das Flores')).toBeInTheDocument()
    // Os dois ficam na lista com as quatro metricas em travessao — 4 + 4. A
    // afirmacao sobre o periodo vazio vivia no sub do cartao de resumo, que
    // saiu; o que ela protegia (cadastro nao some, metrica nao inventa zero)
    // continua protegido pela contagem de travessoes.
    expect(screen.getAllByText('—')).toHaveLength(8)
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument()
  })

  it('a dica diz qual recorte vale, e que o cadastro nao segue', async () => {
    umFornecedor([entradaBase({ data: '2026-06-10' })])
    render(<FornecedoresLista papel="admin" periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')
    const dica = screen.getByText(/Clique num fornecedor para editar/i)
    expect(dica).toHaveTextContent('Junho/2026')
    expect(dica).toHaveTextContent(/cadastro aparece inteiro/i)
  })
})

/**
 * O colaborador passou a ver, criar e editar o CADASTRO de fornecedores, e a
 * NAO ver as quatro metricas (preco medio, variacao, ultima coleta,
 * aproveitamento) — ver `podeVerMetricasDeCadastro` em telas.ts.
 *
 * Mesma ressalva honesta de ClientesLista: essas quatro saem de
 * `GET /api/entradas`, que responde para o colaborador (Entradas e tela
 * dele). Esconde-las e apresentacao, nao permissao. O que muda e que a tela
 * nao entrega o agregado pronto — e nem o busca.
 */
describe('FornecedoresLista — colaborador ve o cadastro, nao as metricas', () => {
  const ROTULOS_DE_METRICA = ['Preço médio', 'Variação', 'Última coleta', 'Aproveit.']

  it('nao dispara GET /api/entradas — a tela nao pede o que nao vai mostrar', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata] }) },
      entradas: [entradaBase()],
    })
    render(<FornecedoresLista papel="colaborador" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    const rotas = mockGet.mock.calls.map(c => c[0] as string)
    expect(rotas).toContain('/api/fornecedores')
    expect(rotas).not.toContain('/api/entradas')
  })

  it('nao mostra nenhum dos quatro rotulos de metrica', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata] }) },
      entradas: [entradaBase()],
    })
    render(<FornecedoresLista papel="colaborador" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    for (const rotulo of ROTULOS_DE_METRICA) {
      expect(screen.queryByText(rotulo)).not.toBeInTheDocument()
    }
  })

  it('mostra o cadastro: nome, regiao, contato e produtos vinculados', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [produtoBatata, produtoAlface] }) },
    })
    render(<FornecedoresLista papel="colaborador" onSessaoExpirada={() => {}} />)

    expect(await screen.findByText('Fazenda Boa Terra')).toBeInTheDocument()
    expect(screen.getByText(/Sul A/)).toBeInTheDocument()
    expect(screen.getByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Alface')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Novo fornecedor/ })).toBeInTheDocument()
  })

  it('abre o modal de edicao SEM o botao Excluir', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
    })
    render(<FornecedoresLista papel="colaborador" onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Fazenda Boa Terra'))

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('admin continua vendo as quatro metricas, buscando as coletas e podendo excluir', async () => {
    configurarGet({
      lista: [fornecedorBase()],
      detalhes: { 'f-1': fornecedorBase({ produtos: [] }) },
      entradas: [entradaBase()],
    })
    render(<FornecedoresLista papel="admin" onSessaoExpirada={() => {}} />)
    await screen.findByText('Fazenda Boa Terra')

    for (const rotulo of ROTULOS_DE_METRICA) {
      expect(screen.getByText(rotulo)).toBeInTheDocument()
    }
    expect(mockGet.mock.calls.map(c => c[0] as string)).toContain('/api/entradas')

    fireEvent.click(screen.getByText('Fazenda Boa Terra'))
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })
})
