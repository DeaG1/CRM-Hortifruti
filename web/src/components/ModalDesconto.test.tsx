import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { ModalDesconto } from './ModalDesconto'
import { api, ErroApi } from '../api/client'
import type { Desconto } from '../derive/descontos'

// Molde: ModalLancamento.test.tsx. Mock so de `api.post/put/del` — mantem a
// classe ErroApi real (o componente faz `err instanceof ErroApi`, precisa ser
// o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const descontoExistente: Desconto = {
  id: 'd-1',
  funcionario_id: 'f-1',
  data: '2026-06-12',
  motivo: 'faltou sem avisar',
  valor: 80,
}

function renderModal(props: Partial<ComponentProps<typeof ModalDesconto>> = {}) {
  return render(
    <ModalDesconto
      desconto={{ funcionario_id: 'f-1' }}
      funcionarioNome="João Pereira"
      onSalvo={() => {}}
      onExcluido={() => {}}
      onFechar={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('ModalDesconto — registrar uma falta', () => {
  it('abre com o dia de hoje sugerido, valor vazio e o nome do funcionário no cabeçalho', () => {
    renderModal()
    const hoje = new Date()
    const iso = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0')
      + '-' + String(hoje.getDate()).padStart(2, '0')
    expect(screen.getByLabelText(/dia da falta/i)).toHaveValue(iso)
    // Campo numérico começa VAZIO, não com 0 pré-escrito (DESCONTO_NOVO).
    expect(screen.getByLabelText(/valor a descontar/i)).toHaveValue(null)
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('')
    expect(screen.getByRole('dialog', { name: 'Descontar do salário' })).toBeInTheDocument()
    // O modal não tem seletor de funcionário — ele sempre abre a partir da
    // linha de alguém, e o nome aparece como confirmação.
    expect(screen.getAllByText(/João Pereira/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Funcionário')).not.toBeInTheDocument()
  })

  it('salva data, motivo, valor e o vínculo com o funcionário', async () => {
    const onSalvo = vi.fn()
    mockPost.mockResolvedValue({ ...descontoExistente })
    renderModal({ onSalvo })

    fireEvent.change(screen.getByLabelText(/dia da falta/i), { target: { value: '2026-06-12' } })
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'faltou sem avisar' } })
    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/descontos', {
      funcionario_id: 'f-1',
      data: '2026-06-12',
      motivo: 'faltou sem avisar',
      valor: 80,
    }))
    expect(onSalvo).toHaveBeenCalledWith(descontoExistente)
  })

  it('grava o motivo já sem espaços nas bordas', async () => {
    mockPost.mockResolvedValue(descontoExistente)
    renderModal()
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: '  faltou  ' } })
    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/api/descontos', expect.objectContaining({ motivo: 'faltou' }),
    ))
  })

  it('exige o motivo — sem ele o desconto não é enviado', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o motivo.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('exige a data da falta', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/dia da falta/i), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'faltou' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o dia da falta.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('recusa valor negativo antes de chamar a API', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'faltou' } })
    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Valor não pode ser negativo.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('a dica diz que nada é pago aqui — o registro só reduz o que será pago', () => {
    renderModal()
    expect(screen.getByText(/não paga nem lança nada/i)).toBeInTheDocument()
  })
})

describe('ModalDesconto — editar e excluir', () => {
  it('abre preenchido com o desconto existente', () => {
    renderModal({ desconto: descontoExistente })
    expect(screen.getByRole('dialog', { name: 'Editar desconto' })).toBeInTheDocument()
    expect(screen.getByLabelText(/dia da falta/i)).toHaveValue('2026-06-12')
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('faltou sem avisar')
    expect(screen.getByLabelText(/valor a descontar/i)).toHaveValue(80)
  })

  it('salvar a edição faz PUT no id do desconto', async () => {
    const onSalvo = vi.fn()
    mockPut.mockResolvedValue({ ...descontoExistente, valor: 40 })
    renderModal({ desconto: descontoExistente, onSalvo })

    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/descontos/d-1', {
      funcionario_id: 'f-1', data: '2026-06-12', motivo: 'faltou sem avisar', valor: 40,
    }))
    expect(onSalvo).toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('excluir pede confirmação antes e avisa que o valor volta a ser devido', async () => {
    const onExcluido = vi.fn()
    mockDel.mockResolvedValue({ ok: true })
    renderModal({ desconto: descontoExistente, onExcluido })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/volta a ser devido/i)
    expect(mockDel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith('/api/descontos/d-1'))
    expect(onExcluido).toHaveBeenCalledWith('d-1')
  })

  it('registro novo não oferece Excluir (não há o que excluir)', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalDesconto — erros da API', () => {
  it('falha ao salvar vira mensagem, e o modal continua aberto com o que foi digitado', async () => {
    mockPost.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    renderModal()
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'faltou' } })
    fireEvent.change(screen.getByLabelText(/valor a descontar/i), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('faltou')
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro de salvamento', async () => {
    const onSessaoExpirada = vi.fn()
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    renderModal({ onSessaoExpirada })
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'faltou' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByText('Não foi possível salvar. Tente novamente.')).not.toBeInTheDocument()
  })

  it('401 ao excluir chama onSessaoExpirada', async () => {
    const onSessaoExpirada = vi.fn()
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    renderModal({ desconto: descontoExistente, onSessaoExpirada })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })

  it('falha ao excluir vira mensagem, sem fechar o modal', async () => {
    const onExcluido = vi.fn()
    mockDel.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    renderModal({ desconto: descontoExistente, onExcluido })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
    expect(onExcluido).not.toHaveBeenCalled()
  })
})

describe('ModalDesconto — fechar', () => {
  it('clicar no fundo fecha; clicar dentro do card não', () => {
    const onFechar = vi.fn()
    renderModal({ onFechar })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText(/motivo/i))
    expect(onFechar).toHaveBeenCalledTimes(1)
  })

  it('o X e o Cancelar fecham', () => {
    const onFechar = vi.fn()
    renderModal({ onFechar })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledTimes(2)
  })
})
