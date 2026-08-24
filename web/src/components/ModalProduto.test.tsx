import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalProduto } from './ModalProduto'
import { api, ErroApi } from '../api/client'
import type { Produto } from '../derive/produtos'

// Mock so de `api.post/put/del` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const produtoExistente: Produto = {
  id: 'p-1',
  nome: 'Batata',
  un: 'KG',
  peso_medio: 0,
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ModalProduto — criação (valores padrão)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('')
    expect(screen.getByLabelText(/unidade padr[aã]o/i)).toHaveValue('KG')
    // peso_medio comeca vazio (nao 0) — e exatamente o campo do print que
    // motivou essa correcao (dono do produto digitou "1" e o campo ficou
    // "01"). O placeholder ensina o formato/grandeza esperada.
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveValue(null)
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveAttribute('placeholder', 'Ex.: 20')
  })

  it('foca o campo nome ao abrir', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalProduto — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('nome so com espacos: mesma validacao', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo nome mantem required (semantica de acessibilidade, aria-required)', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toBeRequired()
  })
})

describe('ModalProduto — validação de peso médio não-negativo', () => {
  it('peso medio negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.change(screen.getByLabelText(/peso m[eé]dio/i), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Peso médio não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('valores validos (inclusive zero) nao disparam erro nenhum', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'ok-1', nome: 'Cenoura', peso_medio: 0 })
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Cenoura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/n[aã]o pode ser negativo/i)).not.toBeInTheDocument()
  })
})

describe('ModalProduto — envio', () => {
  it('envia peso_medio como numero, nao string, e a unidade escolhida', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'novo-1', nome: 'Alface' })
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
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
    render(<ModalProduto produto={null} onSalvo={onSalvo} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Alface' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })

  it('campo peso_medio vazio vira 0 ao enviar', async () => {
    mockPost.mockResolvedValue({ ...produtoExistente, id: 'novo-vazio', nome: 'Rúcula', peso_medio: 0 })
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
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
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
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
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do produto/i), { target: { value: 'Batata' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalProduto
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
    render(<ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do produto/i)).toHaveValue('Batata')
    expect(screen.getByLabelText(/unidade padr[aã]o/i)).toHaveValue('KG')
    // produtoExistente.peso_medio e 0 gravado de verdade (nao ausente) — tem
    // que aparecer como 0, nao vazio: vazio e so o estado inicial de
    // criação, editar um produto com peso 0 e salvar sem tocar no campo tem
    // que continuar 0 por intencao, nao por acaso.
    expect(screen.getByLabelText(/peso m[eé]dio/i)).toHaveValue(0)
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar produto' })).toBeInTheDocument()
  })

  it('usa PUT com o id do produto ao salvar', async () => {
    mockPut.mockResolvedValue(produtoExistente)
    render(<ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
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
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/nome do produto/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalProduto produto={null} onSalvo={() => {}} onExcluido={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})

describe('ModalProduto — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    render(<ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    render(<ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onExcluido', async () => {
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    render(
      <ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
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
      <ModalProduto produto={produtoExistente} onSalvo={() => {}} onExcluido={onExcluido} onFechar={() => {}} />,
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
      <ModalProduto
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
