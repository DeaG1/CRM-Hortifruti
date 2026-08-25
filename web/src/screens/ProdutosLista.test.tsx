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
    // Casado por PREFIXO: a rota leva `?de=&ate=` quando ha periodo escolhido.
    if (url.startsWith('/api/relatorios/produtos')) return comoPromise(metricasResp)
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
    // margem POR QUILO (achado P-2) = 8,00 - 5,00 = R$ 3,00, que e 37,5% do
    // preco de venda -> "R$ 3,00 · 38%". NAO e mais a margem total do periodo
    // (R$ 30) — essa continua na coluna MARGEM de Relatorios ▸ Produtos.
    expect(within(linha).getByText('R$ 3,00 · 38%')).toBeInTheDocument()
    expect(within(linha).queryByText('R$ 30')).not.toBeInTheDocument()
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

    // compra media 5,00 · venda media 8,00 · markup 60% · margem R$ 3,00 · 38% · perda 10,0%
    const marcados = ['R$ 5,00*', 'R$ 8,00*', '60%*', 'R$ 3,00 · 38%*', '10,0%*']
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

// ================================= periodo global (achado S-3 da auditoria)

describe('ProdutosLista — periodo global', () => {
  it('busca o agregado ja filtrado no servidor', async () => {
    mockRotas([produto()], [agregado()])
    render(<ProdutosLista periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(mockGet).toHaveBeenCalledWith('/api/relatorios/produtos?de=2026-06&ate=2026-06')
  })

  it('em "all" vai sem query nenhuma', async () => {
    mockRotas([produto()], [agregado()])
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(mockGet).toHaveBeenCalledWith('/api/relatorios/produtos')
  })

  it('o CADASTRO nao some num periodo sem movimento: as metricas e que ficam em travessao', async () => {
    // O servidor devolve o agregado VAZIO para um mes sem compra nem venda —
    // e o produto continua listado, com travessao nas colunas derivadas.
    mockRotas([produto({ id: '1', nome: 'Batata' }), produto({ id: '2', nome: 'Cebola' })], [])
    render(<ProdutosLista periodo="2026-01" onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Batata')).toBeInTheDocument()
    expect(screen.getByText('Cebola')).toBeInTheDocument()
  })

  it('a dica diz qual recorte vale para as metricas, e que o cadastro nao segue', async () => {
    mockRotas([produto()], [agregado()])
    render(<ProdutosLista periodo="2026-06" onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    const dica = screen.getByText(/calculados das compras e vendas/i)
    expect(dica).toHaveTextContent('Junho/2026')
    expect(dica).toHaveTextContent(/cadastro aparece inteiro/i)
  })
})

// ============ perda media realizada no rodape (achado P-1 da auditoria)

/**
 * A celula do rodape era um travessao escrito a mao, com um comentario
 * dizendo que "nenhum relatorio expoe uma perda media ponderada" — quando as
 * duas somas saem do agregado que a propria tela ja tinha carregado. Um
 * travessao falso e pior que um numero ausente: ele PARECE a convencao de
 * honestidade do projeto e e, na verdade, uma ligacao que nunca foi feita.
 */
describe('ProdutosLista — perda media realizada (rodape)', () => {
  /** A linha de resumo do rodape, a unica com a classe --resumo. */
  function rodape(): HTMLElement {
    return document.querySelector('.produtos-linha--resumo') as HTMLElement
  }

  it('e a media PONDERADA pelo volume, nao a media das perdas de cada linha', async () => {
    // Alface: 100 kg comprados, 20 perdidos (20%). Batata: 900 kg, 0 perdidos
    // (0%). Media simples das linhas daria 10%; a ponderada e 20/1000 = 2,0%.
    mockRotas(
      [produto({ id: '1', nome: 'Alface' }), produto({ id: '2', nome: 'Batata' })],
      [
        agregado({ produto_id: '1', nome: 'Alface', compra_qtd: 100, compra_valor: 300, perda_coleta_qtd: 20 }),
        agregado({ produto_id: '2', nome: 'Batata', compra_qtd: 900, compra_valor: 900 }),
      ],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Alface')
    expect(within(rodape()).getByText('2,0%')).toBeInTheDocument()
    expect(within(rodape()).queryByText('10,0%')).not.toBeInTheDocument()
  })

  it('soma perda de coleta E de deposito, como diz a nota da tela', async () => {
    // 10 de coleta + 15 de deposito sobre 500 kg = 5,0%. Contar so a coleta
    // daria 2,0% — a perda depois da compra sumiria do indice.
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({
        produto_id: '1', compra_qtd: 500, compra_valor: 1000,
        perda_coleta_qtd: 10, perda_deposito_qtd: 15,
      })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(within(rodape()).getByText('5,0%')).toBeInTheDocument()
  })

  it('comprou e nao perdeu nada: 0,0% MEDIDO, nunca travessao', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 200, compra_valor: 400 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(within(rodape()).getByText('0,0%')).toBeInTheDocument()
    expect(within(rodape()).queryByText('—')).not.toBeInTheDocument()
  })

  it('sem compra no periodo: travessao, nunca "0,0%" — ausencia de operacao nao e perda zero', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 0, compra_valor: 0, venda_qtd: 5, venda_valor: 40 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(within(rodape()).getByText('—')).toBeInTheDocument()
    expect(within(rodape()).queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('falha em /api/relatorios/produtos deixa a perda media em travessao, com a lista visivel', async () => {
    mockRotas([produto({ id: '1', nome: 'Batata' })], new Error('falha de rede'))
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    expect(await screen.findByText('Batata')).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível carregar as métricas/i)
    expect(within(rodape()).getByText('—')).toBeInTheDocument()
  })

  it('semaforo: <=10% verde, ate 13% ambar, acima vermelho — a mesma escala do painel', async () => {
    /** Renderiza a tela com `perdaKg` sobre 100 kg comprados e devolve a cor
     * da celula do rodape. */
    async function corCom(perdaKg: number): Promise<string> {
      mockRotas(
        [produto({ id: '1', nome: 'Batata' })],
        [agregado({ produto_id: '1', compra_qtd: 100, compra_valor: 200, perda_coleta_qtd: perdaKg })],
      )
      const { unmount } = render(<ProdutosLista onSessaoExpirada={() => {}} />)
      await screen.findByText('Batata')
      const cor = (rodape().querySelector('.produtos-resumo-valor') as HTMLElement).style.color
      unmount()
      return cor
    }

    // rgb() porque o jsdom normaliza a cor inline; os hex sao os de
    // CORES_SEMAFORO (#3f8f5b / #c79320 / #c2502f).
    expect(await corCom(8)).toBe('rgb(63, 143, 91)')
    expect(await corCom(12)).toBe('rgb(199, 147, 32)')
    expect(await corCom(20)).toBe('rgb(194, 80, 47)')
  })

  it('quantidade incompleta marca a perda media com * e o title fala do TOTAL, nao "deste produto"', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({
        produto_id: '1', compra_qtd: 100, compra_valor: 200,
        perda_coleta_qtd: 10, itens_sem_conversao: 3,
      })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    const celula = within(rodape()).getByText('10,0%*')
    expect(celula.getAttribute('title')).toContain('3 lançamentos')
    expect(celula.getAttribute('title')).toContain('A perda média está calculada')
    // O texto de celula de linha ("deste produto") seria falso sobre a soma
    // de todos os produtos.
    expect(celula.getAttribute('title')).not.toContain('deste produto')
  })
})

// ================= margem por quilo na coluna MARGEM (achado P-2)

describe('ProdutosLista — coluna MARGEM e por quilo, com a %', () => {
  function linhaDe(nome: string): HTMLElement {
    return screen.getByText(nome).closest('.produtos-linha') as HTMLElement
  }

  it('margem por quilo e o quanto ela representa do preco de venda', async () => {
    // compra media 2,00 · venda media 3,20 -> margem R$ 1,20, que e 37,5% do
    // preco de venda (38% arredondado). O markup da mesma linha e 60% — sao
    // numeros diferentes de proposito.
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 100, compra_valor: 200, venda_qtd: 50, venda_valor: 160 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(within(linhaDe('Batata')).getByText('R$ 1,20 · 38%')).toBeInTheDocument()
    expect(within(linhaDe('Batata')).getByText('60%')).toBeInTheDocument()
  })

  it('margem negativa aparece com o sinal — vender abaixo do custo nao pode sair como travessao', async () => {
    // compra media 3,00 · venda media 2,00 -> -R$ 1,00, -50% da venda.
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 10, compra_valor: 30, venda_qtd: 10, venda_valor: 20 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    expect(within(linhaDe('Batata')).getByText('R$ -1,00 · -50%')).toBeInTheDocument()
  })

  it('so compra, sem venda: travessao junto com o markup — nunca "R$ 0,00 · 0%"', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', compra_qtd: 10, compra_valor: 30 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    const linha = linhaDe('Batata')
    // venda media, markup e margem: os tres em travessao
    expect(within(linha).getAllByText('—')).toHaveLength(3)
    expect(within(linha).queryByText(/R\$ 0,00/)).not.toBeInTheDocument()
  })

  it('so venda, sem compra: travessao — sem custo nao ha margem a apurar', async () => {
    mockRotas(
      [produto({ id: '1', nome: 'Batata' })],
      [agregado({ produto_id: '1', venda_qtd: 10, venda_valor: 80 })],
    )
    render(<ProdutosLista onSessaoExpirada={() => {}} />)
    await screen.findByText('Batata')
    // compra media, markup, margem e perda (compra_qtd 0): quatro travessoes
    const linha = linhaDe('Batata')
    expect(within(linha).getAllByText('—')).toHaveLength(4)
  })
})
