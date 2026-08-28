import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalProduto } from './ModalProduto'
import { api, ErroApi } from '../api/client'
import type { Produto } from '../derive/produtos'

// Mock so de `api.post/put/del` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>
const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

/** O que `GET /api/funcionarios/opcoes` devolve — id e nome, nada mais. */
const OPCOES = [
  { id: 'f-1', nome: 'Ana Souza' },
  { id: 'f-2', nome: 'João da Silva' },
]

const produtoExistente: Produto = {
  id: 'p-1',
  nome: 'Batata',
  un: 'KG',
  peso_medio: 0,
}

// `papel="admin"` em todos os casos abaixo: eles descrevem o formulario
// SEM os campos de declaracao de autoria — que e exatamente o formulario do
// admin (o login dele e individual, o sistema ja sabe quem e). O que o
// colaborador ve, e o que ele nao consegue salvar sem preencher, esta no
// bloco proprio no fim deste arquivo.

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
  mockGet.mockReset()
  // Todo teste ganha a lista carregada; quem precisar de falha sobrescreve.
  mockGet.mockResolvedValue(OPCOES)
})

describe('ModalProduto — criação (valores padrão)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('')
    expect(screen.getByLabelText(/unidade padr[aã]o/i)).toHaveValue('KG')
    // peso_medio comeca vazio (nao 0) — e exatamente o campo do print que
    // motivou essa correcao (dono do produto digitou "1" e o campo ficou
    // "01"). O placeholder ensina o formato/grandeza esperada.
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveValue(null)
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveAttribute('placeholder', 'Ex.: 20')
  })

  it('foca o campo nome ao abrir', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalProduto — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('nome so com espacos: mesma validacao', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo nome mantem required (semantica de acessibilidade, aria-required)', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toBeRequired()
  })
})

describe('ModalProduto — validação de peso médio não-negativo', () => {
  it('peso medio negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.change(screen.getByLabelText(/peso m[eé]dio/i), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Peso médio não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('valores validos (inclusive zero) nao disparam erro nenhum', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'ok-1', nome: 'Cenoura', peso_medio: 0 })
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Cenoura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/n[aã]o pode ser negativo/i)).not.toBeInTheDocument()
  })
})

describe('ModalProduto — envio', () => {
  it('envia peso_medio como numero, nao string, e a unidade escolhida', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'novo-1', nome: 'Alface' })
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Alface' } })
    fireEvent.change(screen.getByLabelText(/unidade padr[aã]o/i), { target: { value: 'CX' } })
    fireEvent.change(screen.getByLabelText(/peso m[eé]dio/i), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { un: unknown; peso_medio: unknown }
    expect(corpo.un).toBe('CX')
    expect(corpo.peso_medio).toBe(2.5)
    expect(typeof corpo.peso_medio).toBe('number')
  })

  it('chama onSalvo com o produto retornado pela API ao criar com sucesso', async () => {
    const criado = { ...produtoExistente, id: 'novo-2', nome: 'Alface' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={onSalvo} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Alface' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })

  it('campo peso_medio vazio vira 0 ao enviar', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'novo-vazio', nome: 'Rúcula', peso_medio: 0 })
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Rúcula' } })
    // nao toca no campo peso_medio — ele comeca vazio
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { peso_medio: unknown }
    expect(corpo.peso_medio).toBe(0)
    expect(typeof corpo.peso_medio).toBe('number')
  })
})

describe('ModalProduto — 409 (nome duplicado)', () => {
  it('mostra o erro no campo nome, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe um produto com esse nome' }))
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Já existe um produto com esse nome.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('ModalProduto — outros erros', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalProduto papel="admin" podeExcluir
        produto={null}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalProduto — edição', () => {
  it('preenche os campos com os dados do produto existente', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('Batata')
    expect(screen.getByLabelText(/unidade padr[aã]o/i)).toHaveValue('KG')
    // produtoExistente.peso_medio e 0 gravado de verdade (nao ausente) — tem
    // que aparecer como 0, nao vazio: vazio e so o estado inicial de
    // criação, editar um produto com peso 0 e salvar sem tocar no campo tem
    // que continuar 0 por intencao, nao por acaso.
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveValue(0)
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar produto' })).toBeInTheDocument()
  })

  it('usa PUT com o id do produto ao salvar', async () => {
    mockPut.mockResolvedValue(produtoExistente)
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/produtos/${produtoExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalProduto — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/nome do produto/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})

describe('ModalProduto — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onExcluido', async () => {
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    render(
      <ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith(`/api/produtos/${produtoExistente.id}`))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledWith(produtoExistente.id))
  })

  it('falha na exclusao mostra alerta e nao chama onExcluido', async () => {
    mockDel.mockRejectedValue(new Error('falha'))
    const onExcluido = vi.fn()
    render(
      <ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
    expect(onExcluido).not.toHaveBeenCalled()
  })

  it('401 na exclusao chama onSessaoExpirada', async () => {
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalProduto papel="admin" podeExcluir
        produto={produtoExistente}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

/**
 * `podeExcluir` vem de `podeExcluirCadastro` (web/src/telas.ts) atraves de
 * ProdutosLista. O modal nao conhece papel — so a resposta.
 *
 * Esconder o botao e cortesia, nao seguranca: `DELETE /api/produtos/:id`
 * exige admin e responde 403 a colaborador venha o pedido de onde vier
 * (api/test/permissoes_por_papel.http.test.ts). O que o botao escondido evita
 * e oferecer uma acao que vai falhar.
 */
describe('ModalProduto — botao Excluir por permissao', () => {
  const existente = { id: 'p-1', nome: 'Batata', un: 'KG' as const, peso_medio: 0 }

  it('sem permissao, editando: nao ha botao Excluir', () => {
    render(
      <ModalProduto papel="admin"
        podeExcluir={false}
        produto={existente}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    // Editar continua funcionando — e o ponto da mudanca.
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('com permissao, editando: o botao Excluir aparece', () => {
    render(
      <ModalProduto papel="admin"
        podeExcluir
        produto={existente}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })

  it('criando, nem com permissao ha Excluir (nao ha o que apagar ainda)', () => {
    render(
      <ModalProduto papel="admin"
        podeExcluir
        produto={null}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

// Declaração de autoria — o raciocínio inteiro está em ModalCliente.test.tsx.
// Aqui ficam os mesmos cinco fatos, contra o formulário de produto: sem eles,
// uma regressão que apagasse a declaração SÓ desta tela passaria verde.
//
// SÓ AO EDITAR: criar produto dispensou a exigência (pedido do dono,
// 28/08/2026) — ver o bloco "criação dispensa declaração" logo abaixo, que é
// o espelho destes mesmos testes contra `produto={null}`.

describe('ModalProduto — declaração de autoria (colaborador, editando)', () => {
  it('mostra os dois campos, e o de quem é abre vazio', async () => {
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(await screen.findByLabelText(/quem está fazendo esta alteração/i)).toHaveValue('')
    expect(screen.getByLabelText(/motivo da alteração/i)).toHaveValue('')
  })

  it('salvar sem escolher quem é: bloqueado', async () => {
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: 'faltava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha quem está fazendo esta alteração.')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('salvar sem motivo: bloqueado', async () => {
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo da alteração.')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('com os dois, o corpo leva declarado_por e motivo', async () => {
    mockPut.mockResolvedValue(produtoExistente)
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: 'pesamos a caixa de novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ declarado_por: 'f-1', motivo: 'pesamos a caixa de novo' })
  })
})

/**
 * A MUDANÇA DESTE COMMIT: criar produto não pede mais autor nem motivo.
 * Pedido do dono — cadastra dezenas de produtos de uma vez, e duas perguntas
 * por cadastro é atrito real. A razão de fundo: não há "alteração" a
 * atribuir quando o registro está nascendo. `PUT` (bloco acima) e
 * cliente/fornecedor (ModalCliente.test.tsx, ModalFornecedor.test.tsx) não
 * mudam em nada — só a criação de produto relaxou.
 */
describe('ModalProduto — criação dispensa declaração (colaborador)', () => {
  it('nao mostra os campos de declaracao ao criar', async () => {
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByLabelText(/quem está fazendo esta alteração/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/motivo da alteração/i)).not.toBeInTheDocument()
  })

  it('salva sem escolher autor nem motivo, e sem chamar a lista de funcionarios', async () => {
    mockPost.mockResolvedValue({ id: 'p-9' })
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Chuchu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    // DeclaracaoDeAutoria nao monta, entao a rota de funcionarios nem e chamada.
    expect(mockGet).not.toHaveBeenCalledWith('/api/funcionarios/opcoes')
  })

  it('o corpo enviado nao leva declarado_por nem motivo', async () => {
    mockPost.mockResolvedValue({ id: 'p-10' })
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Chuchu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(corpo).not.toHaveProperty('declarado_por')
    expect(corpo).not.toHaveProperty('motivo')
  })
})

describe('ModalProduto — admin e histórico', () => {
  it('admin não vê os dois campos', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByLabelText(/quem está fazendo esta alteração/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/motivo da alteração/i)).not.toBeInTheDocument()
  })

  it('histórico aparece para admin ao editar', () => {
    render(<ModalProduto papel="admin" podeExcluir produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('button', { name: /histórico de alterações/i })).toBeInTheDocument()
  })

  it('e não aparece para o colaborador', () => {
    render(<ModalProduto papel="colaborador" podeExcluir={false} produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: /histórico de alterações/i })).not.toBeInTheDocument()
  })
})
