import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalFornecedor } from './ModalFornecedor'
import { api, ErroApi } from '../api/client'
import type { Fornecedor } from '../derive/fornecedores'
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

const produtos: Produto[] = [
  { id: 'pr-1', nome: 'Batata', un: 'KG', peso_medio: 0 },
  { id: 'pr-2', nome: 'Alface', un: 'UN', peso_medio: 0 },
]

const fornecedorExistente: Fornecedor = {
  id: 'f-1',
  nome: 'Fazenda Boa Terra',
  regiao: 'Londrina, Norte do PR',
  contato: '(43) 99999-0000',
  produtos: [produtos[0]],
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ModalFornecedor — criação (valores padrão)', () => {
  it('mostra os campos vazios ao criar', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByLabelText(/nome do produtor/i)).toHaveValue('')
    expect(screen.getByLabelText(/regi[aã]o/i)).toHaveValue('')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('')
  })

  it('nenhum produto vem selecionado ao criar', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByText('— 0 selecionado(s)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('foca o campo nome ao abrir', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByLabelText(/nome do produtor/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Novo fornecedor' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('avisa quando nao ha produtos cadastrados para vincular', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={[]}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByText(/nenhum produto cadastrado ainda/i)).toBeInTheDocument()
  })
})

describe('ModalFornecedor — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate e o campo nome mantem required', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
    expect(screen.getByLabelText(/nome do produtor/i)).toBeRequired()
  })
})

describe('ModalFornecedor — seleção de produtos', () => {
  it('clicar num produto marca como selecionado e atualiza a contagem', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /batata/i }))
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('— 1 selecionado(s)')).toBeInTheDocument()
  })

  it('clicar de novo desmarca', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /batata/i }))
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('— 0 selecionado(s)')).toBeInTheDocument()
  })
})

describe('ModalFornecedor — envio ao criar', () => {
  it('sem produtos selecionados: so chama POST, nao chama PUT', async () => {
    mockPost.mockResolvedValue({ ...fornecedorExistente, id: 'novo-1', nome: 'Sitio Verde', produtos: [] })
    const onSalvo = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={onSalvo}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Sitio Verde' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    expect(mockPost).toHaveBeenCalledWith('/api/fornecedores', { nome: 'Sitio Verde', regiao: '', contato: '' })
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('com produtos selecionados: POST para criar, depois PUT para vincular os produtos', async () => {
    const criado = { ...fornecedorExistente, id: 'novo-2', nome: 'Sitio Verde', produtos: [] }
    mockPost.mockResolvedValue(criado)
    mockPut.mockResolvedValue({ ...criado, produtos: [produtos[0]] })
    const onSalvo = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={onSalvo}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Sitio Verde' } })
    fireEvent.click(screen.getByRole('button', { name: /batata/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/fornecedores/novo-2', { produto_ids: ['pr-1'] }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith({ ...criado, produtos: [produtos[0]] }))
  })
})

describe('ModalFornecedor — 409 (nome duplicado)', () => {
  it('mostra o erro no campo nome, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe um fornecedor com esse nome' }))
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Fazenda Repetida' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Já existe um fornecedor com esse nome.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('ModalFornecedor — outros erros', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Fazenda X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
        onSessaoExpirada={onSessaoExpirada}
      />,
    )
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Fazenda Y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalFornecedor — edição', () => {
  it('preenche os campos e pre-seleciona os produtos vinculados', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByLabelText(/nome do produtor/i)).toHaveValue('Fazenda Boa Terra')
    expect(screen.getByLabelText(/regi[aã]o/i)).toHaveValue('Londrina, Norte do PR')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('(43) 99999-0000')
    expect(screen.getByRole('button', { name: /batata/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /alface/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('titulo do dialogo indica edicao', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Editar fornecedor' })).toBeInTheDocument()
  })

  it('usa PUT com o id do fornecedor e o produto_ids atualizado ao salvar', async () => {
    mockPut.mockResolvedValue(fornecedorExistente)
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /alface/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/fornecedores/${fornecedorExistente.id}`, {
        nome: 'Fazenda Boa Terra',
        regiao: 'Londrina, Norte do PR',
        contato: '(43) 99999-0000',
        produto_ids: ['pr-1', 'pr-2'],
      }),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalFornecedor — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={onFechar}
      />,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={onFechar}
      />,
    )
    fireEvent.click(screen.getByLabelText(/nome do produtor/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={onFechar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})

describe('ModalFornecedor — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/apagado definitivamente/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/apagado definitivamente/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onExcluido', async () => {
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={onExcluido}
        onFechar={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith(`/api/fornecedores/${fornecedorExistente.id}`))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledWith(fornecedorExistente.id))
  })

  it('falha na exclusao mostra alerta e nao chama onExcluido', async () => {
    mockDel.mockRejectedValue(new Error('falha'))
    const onExcluido = vi.fn()
    render(
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={onExcluido}
        onFechar={() => {}}
      />,
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
      <ModalFornecedor podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
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
 * Mesma historia de ModalProduto: `podeExcluir` vem de
 * `podeExcluirCadastro` (web/src/telas.ts) atraves de FornecedoresLista, e
 * quem realmente barra e a API (`DELETE /api/fornecedores/:id` exige admin).
 */
describe('ModalFornecedor — botao Excluir por permissao', () => {
  const existente = { id: 'f-1', nome: 'Fazenda Boa Terra', regiao: 'Sul A', contato: '', produtos: [] }

  it('sem permissao, editando: nao ha botao Excluir', () => {
    render(
      <ModalFornecedor
        podeExcluir={false}
        fornecedor={existente}
        produtosDisponiveis={[]}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('com permissao, editando: o botao Excluir aparece', () => {
    render(
      <ModalFornecedor
        podeExcluir
        fornecedor={existente}
        produtosDisponiveis={[]}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })

  it('criando, nem com permissao ha Excluir (nao ha o que apagar ainda)', () => {
    render(
      <ModalFornecedor
        podeExcluir
        fornecedor={null}
        produtosDisponiveis={[]}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})
