import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeclaracaoDeAutoria } from './DeclaracaoDeAutoria'
import { api, ErroApi } from '../api/client'

// Mock só de `api.get` — mantém a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const OPCOES = [
  { id: 'f-1', nome: 'Ana Souza' },
  { id: 'f-2', nome: 'João da Silva' },
]

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockResolvedValue(OPCOES)
})

/** Render com os campos controlados de fora, como o modal faz. */
function montar(props: Partial<Parameters<typeof DeclaracaoDeAutoria>[0]> = {}) {
  const onAutorId = vi.fn()
  const onMotivo = vi.fn()
  const util = render(
    <DeclaracaoDeAutoria
      autorId=""
      onAutorId={onAutorId}
      motivo=""
      onMotivo={onMotivo}
      erroAutor=""
      erroMotivo=""
      {...props}
    />,
  )
  return { ...util, onAutorId, onMotivo }
}

describe('DeclaracaoDeAutoria — o campo de quem é', () => {
  it('busca a lista em /api/funcionarios/opcoes (a rota enxuta, não /api/funcionarios)', async () => {
    montar()
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/funcionarios/opcoes'))
    // `/api/funcionarios` é admin-only e devolve salário: pedir aquela aqui
    // daria 403 para o colaborador — e, se um dia não desse, vazaria folha.
    expect(mockGet).not.toHaveBeenCalledWith('/api/funcionarios')
  })

  it('ABRE VAZIO: nada pré-selecionado', async () => {
    // O ponto inteiro do campo. Se abrisse com um nome já escolhido, todo
    // mundo aceitaria o que está lá e o registro viraria ficção — o mesmo
    // nome em toda alteração da loja, inclusive nas que ele não fez.
    montar()
    const select = await screen.findByLabelText(/quem está fazendo esta alteração/i)
    expect(select).toHaveValue('')
  })

  it('mesmo depois de a lista chegar, continua sem seleção', async () => {
    montar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    expect(screen.getByLabelText(/quem está fazendo esta alteração/i)).toHaveValue('')
  })

  it('a primeira opção é um placeholder, não uma pessoa', async () => {
    montar()
    const opcoes = await screen.findAllByRole('option')
    expect(opcoes[0]).toHaveValue('')
    expect(opcoes[0]).toHaveTextContent(/selecione/i)
  })

  it('lista os funcionários vindos da API, na ordem que vieram', async () => {
    montar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    const nomes = screen.getAllByRole('option').map(o => o.textContent)
    expect(nomes).toEqual(['Selecione…', 'Ana Souza', 'João da Silva'])
  })

  it('escolher avisa quem hospeda, com o ID (não com o nome)', async () => {
    // Id, e não texto: é o que mantém o rastro de uma pessoa junto em vez de
    // fragmentado em "joão", "Joao" e "jão".
    const { onAutorId } = montar()
    const select = await screen.findByLabelText(/quem está fazendo esta alteração/i)
    fireEvent.change(select, { target: { value: 'f-2' } })
    expect(onAutorId).toHaveBeenCalledWith('f-2')
  })

  it('o placeholder NÃO some depois de escolher — dá para desfazer sem fechar o formulário', async () => {
    montar({ autorId: 'f-2' })
    await screen.findByRole('option', { name: 'João da Silva' })
    expect(screen.getAllByRole('option')[0]).toHaveValue('')
  })
})

describe('DeclaracaoDeAutoria — o motivo', () => {
  it('começa vazio e avisa quem hospeda ao digitar', async () => {
    const { onMotivo } = montar()
    const campo = screen.getByLabelText(/motivo da alteração/i)
    expect(campo).toHaveValue('')
    fireEvent.change(campo, { target: { value: 'cliente ligou' } })
    expect(onMotivo).toHaveBeenCalledWith('cliente ligou')
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
  })

  it('tem placeholder que ensina o que escrever', () => {
    montar()
    expect(screen.getByLabelText(/motivo da alteração/i))
      .toHaveAttribute('placeholder', expect.stringMatching(/telefone novo/i))
  })
})

describe('DeclaracaoDeAutoria — as mensagens de erro vêm de fora', () => {
  it('erro de autor aparece em role="alert"', () => {
    montar({ erroAutor: 'Escolha quem está fazendo esta alteração.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha quem está fazendo esta alteração.')
  })

  it('erro de motivo aparece em role="alert"', () => {
    montar({ erroMotivo: 'Informe o motivo da alteração.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo da alteração.')
  })

  it('os dois erros ao mesmo tempo aparecem os dois', () => {
    montar({ erroAutor: 'Escolha quem.', erroMotivo: 'Informe o motivo.' })
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})

describe('DeclaracaoDeAutoria — a tela é honesta sobre o que ela registra', () => {
  it('diz que a equipe usa um login só e que o registro é o que a pessoa informar', () => {
    montar()
    expect(screen.getByText(/login só/i)).toBeInTheDocument()
    expect(screen.getByText(/não tem como saber quem está mexendo/i)).toBeInTheDocument()
  })

  it('o rótulo pergunta quem está fazendo — não afirma que sabe', () => {
    montar()
    expect(screen.getByLabelText(/quem está fazendo esta alteração\?/i)).toBeInTheDocument()
  })
})

describe('DeclaracaoDeAutoria — falha isolada', () => {
  it('lista que não carrega vira aviso em role="status", e os campos continuam de pé', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/não foi possível carregar a lista de funcionários/i)
    // Não derruba o formulário: os dois campos continuam montados e o que já
    // foi digitado não some.
    expect(screen.getByLabelText(/quem está fazendo esta alteração/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo da alteração/i)).toBeInTheDocument()
  })

  it('a falha NÃO vira role="alert" — é estado da tela, não erro do que o usuário fez', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    await screen.findByRole('status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('401 vai para o fluxo de sessão expirada, não para a mensagem de falha', async () => {
    const onSessaoExpirada = vi.fn()
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'nao autenticado' }))
    montar({ onSessaoExpirada })
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sem funcionário ativo cadastrado, explica o caminho (que é do admin)', async () => {
    mockGet.mockResolvedValue([])
    montar()
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/nenhum funcionário ativo cadastrado/i)
    expect(aviso).toHaveTextContent(/Funcionários/)
  })

  it('com a lista cheia não há aviso nenhum', async () => {
    montar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
