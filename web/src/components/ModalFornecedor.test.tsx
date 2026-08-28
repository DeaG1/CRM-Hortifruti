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

describe('ModalFornecedor — criação (valores padrão)', () => {
  it('mostra os campos vazios ao criar', () => {
    render(
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin" podeExcluir
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
      <ModalFornecedor papel="admin"
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
      <ModalFornecedor papel="admin"
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
      <ModalFornecedor papel="admin"
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

// Declaração de autoria — raciocínio em ModalCliente.test.tsx. O caso próprio
// daqui é o SEGUNDO PUT (o que vincula os produtos depois do POST): para o
// servidor ele é um PUT como qualquer outro e também exige declaração.

describe('ModalFornecedor — declaração de autoria (colaborador)', () => {
  it('mostra os dois campos, e o de quem é abre vazio', async () => {
    render(
      <ModalFornecedor papel="colaborador" podeExcluir={false}
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(await screen.findByLabelText(/quem está fazendo esta alteração/i)).toHaveValue('')
    expect(screen.getByLabelText(/motivo da alteração/i)).toHaveValue('')
  })

  it('salvar sem escolher quem é: bloqueado', async () => {
    render(
      <ModalFornecedor papel="colaborador" podeExcluir={false}
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Sitio X' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: 'produtor novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha quem está fazendo esta alteração.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('salvar sem motivo: bloqueado', async () => {
    render(
      <ModalFornecedor papel="colaborador" podeExcluir={false}
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Sitio X' } })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo da alteração.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('a declaração vai TAMBÉM no PUT que vincula os produtos depois do POST', async () => {
    // Sem isso o fornecedor seria criado e o vínculo dos produtos morreria num
    // 400 do servidor — o colaborador voltaria da feira com o produtor
    // cadastrado e sem nada do que ele entrega.
    mockPost.mockResolvedValue({ id: 'forn-9', nome: 'Sitio X' })
    mockPut.mockResolvedValue({ id: 'forn-9', nome: 'Sitio X', produtos: [] })
    render(
      <ModalFornecedor papel="colaborador" podeExcluir={false}
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do produtor/i), { target: { value: 'Sitio X' } })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: 'produtor novo da feira' } })
    fireEvent.click(screen.getByRole('button', { name: /batata/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPost.mock.calls[0][1]).toMatchObject({ declarado_por: 'f-1', motivo: 'produtor novo da feira' })
    expect(mockPut.mock.calls[0][1]).toMatchObject({ declarado_por: 'f-1', motivo: 'produtor novo da feira' })
  })
})

describe('ModalFornecedor — admin e histórico', () => {
  it('admin não vê os dois campos', () => {
    render(
      <ModalFornecedor papel="admin" podeExcluir
        fornecedor={null}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/quem está fazendo esta alteração/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/motivo da alteração/i)).not.toBeInTheDocument()
  })

  it('histórico aparece para admin ao editar, e não para o colaborador', () => {
    const { unmount } = render(
      <ModalFornecedor papel="admin" podeExcluir
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /histórico de alterações/i })).toBeInTheDocument()
    unmount()

    render(
      <ModalFornecedor papel="colaborador" podeExcluir={false}
        fornecedor={fornecedorExistente}
        produtosDisponiveis={produtos}
        onSalvo={() => {}}
        onExcluido={() => {}}
        onFechar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /histórico de alterações/i })).not.toBeInTheDocument()
  })
})
