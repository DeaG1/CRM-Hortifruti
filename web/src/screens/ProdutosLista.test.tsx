import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProdutosLista } from './ProdutosLista'
import { api, ErroApi } from '../api/client'
import type { Produto } from '../derive/produtos'
import type { ProdutoAgregado } from '../derive/relatorios'

// Mock do client inteiro: ProdutosLista usa `api.get` diretamente, e o
// ModalProduto que ela renderiza internamente (nao ha tela de ficha para
// produtos — ver comentario no componente) usa `api.post/put/del`. Mantem a
// classe ErroApi real (os componentes fazem `err instanceof ErroApi`).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const produto = (over: Partial<Produto> = {}): Produto => ({
  id: '1', nome: 'Batata', un: 'KG', peso_medio: 0, ...over,
})

/** Uma linha de GET /api/relatorios/produtos — so os campos que
 * derivarRelatorioProdutos/ProdutosLista usam (ver `ProdutoAgregado` em
 * derive/relatorios.ts). */
const agregado = (over: Partial<ProdutoAgregado> = {}): ProdutoAgregado => ({
  produto_id: '1', nome: 'Batata', un: 'KG',
  compra_qtd: 0, compra_valor: 0, perda_coleta_qtd: 0,
  venda_qtd: 0, venda_valor: 0, perda_deposito_qtd: 0,
  ...over,
})

function comoPromise(v: unknown): Promise<unknown> {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

/** Roteia `api.get` pelas duas chamadas que ProdutosLista faz (GET
 * /api/produtos e GET /api/relatorios/produtos), cada uma com sua propria
 * resposta — mesmo padrao de mockRotas em ClientesLista.test.tsx.
 * `metricasResp` default `[]` cobre os testes que nao se importam com as
 * metricas de compra/venda. */
function mockRotas(produtosResp: unknown, metricasResp: unknown = []) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/produtos') return comoPromise(produtosResp)
    if (url === '/api/relatorios/produtos') return comoPromise(metricasResp)
    return Promise.reject(new Error('rota nao mockada: ' + url))
  })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ProdutosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockRotas(new Promise(() => {})) // nunca resolve nesta suite
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockRotas(new Error('falha de rede'))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os produtos.')
  })

  it('vazio: mostra "nenhum produto cadastrado" quando a API devolve lista vazia', async () => {
    mockRotas([])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText(/nenhum produto cadastrado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cadastrar primeiro produto/i })).toBeInTheDocument()
  })

  it('com dados: lista os produtos recebidos', async () => {
    mockRotas([produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cenoura' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Cenoura')).toBeInTheDocument()
  })
})

describe('ProdutosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    // /api/produtos e /api/relatorios/produtos sao buscados em paralelo
    // (efeitos independentes) — os dois podem devolver 401, entao a
    // asserção e toHaveBeenCalled (nao ...Once), mesmo padrao de
    // ClientesLista.test.tsx pra telas com mais de uma chamada paralela.
    mockRotas(
      new ErroApi(401, { erro: 'sessao invalida' }),
      new ErroApi(401, { erro: 'sessao invalida' }),
    )
    const onSessaoExpirada = vi.fn()
    render(<ProdutosLista onSessaoExpirada={onSessaoExpirada} />)
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ProdutosLista — metricas (GET /api/relatorios/produtos)', () => {
  it('produto com compra e venda no periodo mostra markup e margem calculados', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({
        produto_id: '1', compra_qtd: 10, compra_valor: 50, venda_qtd: 10, venda_valor: 80,
        perda_coleta_qtd: 0, perda_deposito_qtd: 1,
      })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const linha = (await screen.findByText('Batata')).closest('.produtos-linha') as HTMLElement

    // compra media 50/10, venda media 80/10
    expect(within(linha).getByText('R$ 5,00')).toBeInTheDocument()
    expect(within(linha).getByText('R$ 8,00')).toBeInTheDocument()
    // markup = (8-5)/5 * 100 = 60%
    expect(within(linha).getByText('60%')).toBeInTheDocument()
    // margem = venda_valor - venda_qtd*compra_media = 80 - 10*5 = 30
    expect(within(linha).getByText('R$ 30')).toBeInTheDocument()
    // perda = (0+1)/10 * 100 = 10,0%
    expect(within(linha).getByText('10,0%')).toBeInTheDocument()
    expect(within(linha).queryByText('—')).not.toBeInTheDocument()
  })

  it('produto so com compra registrada mostra o custo medio, mas markup e margem ficam em travessao', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 10, compra_valor: 40, venda_qtd: 0, venda_valor: 0 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const linha = (await screen.findByText('Batata')).closest('.produtos-linha') as HTMLElement

    // custo medio (compra) e um dado real: 40/10 = 4,00
    expect(within(linha).getByText('R$ 4,00')).toBeInTheDocument()
    // sem venda no periodo: venda media, markup e margem — nunca "R$ 0,00"/0%,
    // que fingiria um preco de venda ou um markup medidos
    expect(within(linha).getAllByText('—')).toHaveLength(3)
  })

  it('produto sem nenhuma movimentacao (fora do agregado) mostra as cinco colunas em travessao', async () => {
    mockRotas([produto({ id: '1', nome: 'Batata' })], [])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    // 5 colunas por linha (compra, venda, markup, margem, perda) + 1 no resumo de perda media
    expect(screen.getAllByText('—')).toHaveLength(6)
  })

  it('falha em /api/relatorios/produtos mantem a lista de produtos visivel, com metricas indisponiveis', async () => {
    mockRotas([produto({ id: '1', nome: 'Batata' })], new Error('falha de rede'))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)

    // o cadastro aparece normalmente...
    expect(await screen.findByText('Batata')).toBeInTheDocument()
    // ...com um aviso discreto (nao um erro que apaga a lista)...
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as métricas/i)
    // ...e as cinco metricas em travessao (mais o resumo de perda media)
    expect(screen.getAllByText('—')).toHaveLength(6)
  })

  it('mostra a unidade do produto', async () => {
    mockRotas([produto({ un: 'CX' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('CX')).toBeInTheDocument()
  })
})

describe('ProdutosLista — abrir modal', () => {
  it('clicar em "Novo produto" abre o modal de criacao', async () => {
    mockRotas([produto()])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    fireEvent.click(screen.getByRole('button', { name: /novo produto/i }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })

  it('clicar numa linha abre o modal de edicao com os dados do produto', async () => {
    mockRotas([produto({ id: 'xyz', nome: 'Batata' })])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Batata'))
    expect(screen.getByRole('dialog', { name: 'Editar produto' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('Batata')
  })

  it('vazio: clicar em "Cadastrar primeiro produto" abre o modal de criacao', async () => {
    mockRotas([])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /cadastrar primeiro produto/i }))
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })
})

describe('ProdutosLista — recarrega apos salvar/excluir no modal', () => {
  it('salvar no modal fecha o modal e recarrega a lista', async () => {
    // /api/produtos precisa de duas respostas em sequencia (antes/depois do
    // salvar) — /api/relatorios/produtos fica de fora dessa contagem porque
    // o efeito que a busca não depende de `versao` (metricas nao mudam so
    // por editar o cadastro de produtos).
    let chamadasProdutos = 0
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/produtos') {
        chamadasProdutos++
        return comoPromise(chamadasProdutos === 1
          ? [produto({ id: '1', nome: 'Batata' })]
          : [produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cenoura' })])
      }
      if (url === '/api/relatorios/produtos') return comoPromise([])
      return Promise.reject(new Error('rota nao mockada: ' + url))
    })
    mockPost.mockResolvedValue(produto({ id: '2', nome: 'Cenoura' }))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')

    fireEvent.click(screen.getByRole('button', { name: /novo produto/i }))
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Cenoura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText('Cenoura')
    expect(chamadasProdutos).toBe(2)
  })

  it('excluir no modal fecha o modal e recarrega a lista', async () => {
    let chamadasProdutos = 0
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/produtos') {
        chamadasProdutos++
        return comoPromise(chamadasProdutos === 1 ? [produto({ id: '1', nome: 'Batata' })] : [])
      }
      if (url === '/api/relatorios/produtos') return comoPromise([])
      return Promise.reject(new Error('rota nao mockada: ' + url))
    })
    mockDel.mockResolvedValue({ ok: true })
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    fireEvent.click(await screen.findByText('Batata'))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText(/nenhum produto cadastrado/i)
    expect(chamadasProdutos).toBe(2)
  })
})

/**
 * As quantidades de GET /api/relatorios/produtos chegam em kg, com cada
 * lancamento convertido pela unidade dele. Lancamento em unidade nao-KG cujo
 * produto nao tem peso medio cadastrado nao e convertivel: a API o deixa de
 * fora e diz quantos foram em `itens_sem_conversao`, em vez de inventar fator
 * 1. Como o valor em reais desses lancamentos continua inteiro, a compra
 * media (valor/qtd) sai PARA CIMA — e esta e a tela onde o dono decide preco
 * de venda. Um markup incompleto exibido limpo seria a pior das opcoes.
 */
describe('ProdutosLista — metricas incompletas (lancamento sem peso medio)', () => {
  it('produto 100% convertivel: as cinco metricas saem limpas, sem marca nem nota', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({
        produto_id: '1', compra_qtd: 10, compra_valor: 50, venda_qtd: 10, venda_valor: 80,
        perda_deposito_qtd: 1,
      })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const linha = (await screen.findByText('Batata')).closest('.produtos-linha') as HTMLElement

    expect(within(linha).getByText('R$ 5,00')).toBeInTheDocument()
    expect(within(linha).queryByText('R$ 5,00*')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('produto com lancamento nao convertivel: as cinco metricas marcadas com * e title explicando', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({
        produto_id: '1', compra_qtd: 10, compra_valor: 50, venda_qtd: 10, venda_valor: 80,
        perda_deposito_qtd: 1, itens_sem_conversao: 2,
      })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    const linha = (await screen.findByText('Batata')).closest('.produtos-linha') as HTMLElement

    // compra media 5,00 · venda media 8,00 · markup 60% · margem R$ 30 · perda 10,0%
    const marcados = ['R$ 5,00*', 'R$ 8,00*', '60%*', 'R$ 30*', '10,0%*']
    for (const texto of marcados) expect(within(linha).getByText(texto)).toBeInTheDocument()
    // A explicacao vive no title da propria celula — o asterisco sozinho
    // sinalizaria sem dizer o que falta.
    const celula = within(linha).getByText('R$ 5,00*')
    expect(celula.getAttribute('title')).toContain('2 lançamentos')
    expect(celula.getAttribute('title')).toContain('peso médio')
  })

  it('a nota de rodape aparece com o total e diz como resolver', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cenoura' })],
      [
        agregado({ produto_id: '1', compra_qtd: 10, compra_valor: 50, itens_sem_conversao: 2 }),
        agregado({ produto_id: '2', nome: 'Cenoura', compra_qtd: 10, compra_valor: 50, itens_sem_conversao: 1 }),
      ],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')

    const nota = screen.getByRole('note')
    expect(nota).toHaveTextContent('3 lançamentos')
    expect(nota).toHaveTextContent('fora das quantidades')
    expect(nota).toHaveTextContent('Cadastre o peso médio da embalagem')
  })

  it('produto sem metrica nenhuma (fora do agregado) nao ganha marca — nao ha o que sinalizar', async () => {
    mockRotas([produto({ id: '1', nome: 'Batata' })], [])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('a dica do topo diz que os precos sao por quilo, nao "por unidade do produto"', async () => {
    mockRotas([produto()])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    // Depois da conversao na API, compra media e venda media sao R$/kg para
    // qualquer produto — inclusive os comprados em caixa.
    expect(screen.getByText(/por quilo/i)).toBeInTheDocument()
  })
})
