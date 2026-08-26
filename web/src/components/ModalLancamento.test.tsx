import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { ModalLancamento } from './ModalLancamento'
import { api, ErroApi } from '../api/client'
import type { Lancamento } from '../derive/lancamentos'

// Mock so de `api.post/put/del` — mantem a classe ErroApi real (o componente
// faz `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), del: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

// Mesma lista da API (api/src/routes/lancamentos.ts), 'Multa' inclusa.
const CATEGORIAS = [
  'Frete', 'Gasolina', 'Manutenção dos Carros', 'Multa', 'Salário', 'Adiantamento de salário',
  'Vale-alimentação', 'Vale-transporte', 'FGTS', 'INSS', 'Simples Nacional',
  'Parcelamento Impostos', 'Pagamento de conta de sócio', 'Outros',
]

const FUNCIONARIOS = [
  { id: 'f-1', nome: 'João Pereira' },
  { id: 'f-2', nome: 'Maria Souza' },
]

const VEICULOS = [
  { id: 'v-1', placa: 'ABC-1234', marca: 'Fiat', modelo: 'Fiorino' },
  { id: 'v-2', placa: 'XYZ-9876', marca: 'Volkswagen', modelo: 'Kombi' },
]

const lancamentoExistente: Lancamento = {
  id: 'l-1',
  data: '2026-06-18',
  categoria: 'Manutenção dos Carros',
  descricao: 'Troca de óleo e filtro do caminhão',
  valor: 480,
  funcionario_id: null,
  veiculo_id: null,
}

function renderModal(props: Partial<ComponentProps<typeof ModalLancamento>> = {}) {
  return render(
    <ModalLancamento
      lancamento={null}
      categorias={CATEGORIAS}
      funcionarios={FUNCIONARIOS}
      veiculos={VEICULOS}
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

describe('ModalLancamento — criação (valores padrão)', () => {
  it('preenche a data com a data de hoje', () => {
    renderModal()
    const hoje = new Date()
    const iso = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0')
    expect(screen.getByLabelText(/data do lançamento/i)).toHaveValue(iso)
  })

  it('usa a primeira categoria da lista vinda da API, nao um valor fixo no front', () => {
    renderModal({ categorias: ['Outros', 'Frete'] })
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Outros')
  })

  it('select de categoria lista exatamente as categorias recebidas via prop', () => {
    renderModal({ categorias: ['Frete', 'Gasolina'] })
    const select = screen.getByLabelText(/^categoria$/i) as HTMLSelectElement
    const opcoes = Array.from(select.options).map(o => o.value)
    expect(opcoes).toEqual(['Frete', 'Gasolina'])
  })

  it('valor comeca vazio (nao 0), com placeholder, e descricao vazia', () => {
    renderModal()
    // valor comeca vazio (nao 0) — abrir com 0 ja escrito faz quem digita
    // esquecer de apagar o zero e gravar "0250" em vez de "250" (bug real
    // reportado pelo dono do produto).
    expect(screen.getByLabelText(/valor/i)).toHaveValue(null)
    expect(screen.getByLabelText(/valor/i)).toHaveAttribute('placeholder', 'Ex.: 350,00')
    expect(screen.getByLabelText(/descrição/i)).toHaveValue('')
  })

  it('foca o campo data ao abrir', () => {
    renderModal()
    expect(screen.getByLabelText(/data do lançamento/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument()
  })

  it('nao mostra o botao Excluir ao criar', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ModalLancamento — campo funcionário só nas categorias certas', () => {
  it('categoria default (Frete) nao mostra o campo funcionario', () => {
    renderModal({ categorias: ['Frete', 'Salário'] })
    expect(screen.queryByLabelText(/^funcionário$/i)).not.toBeInTheDocument()
  })

  it('mudar para Salário mostra o campo funcionario', () => {
    renderModal({ categorias: ['Frete', 'Salário'] })
    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Salário' } })
    expect(screen.getByLabelText(/^funcionário$/i)).toBeInTheDocument()
  })

  it('mudar para Adiantamento de salário mostra o campo funcionario', () => {
    renderModal({ categorias: ['Frete', 'Adiantamento de salário'] })
    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Adiantamento de salário' } })
    expect(screen.getByLabelText(/^funcionário$/i)).toBeInTheDocument()
  })

  it('outras categorias (Gasolina, FGTS, Outros) nao mostram o campo', () => {
    renderModal({ categorias: ['Gasolina', 'FGTS', 'Outros'] })
    for (const cat of ['Gasolina', 'FGTS', 'Outros']) {
      fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: cat } })
      expect(screen.queryByLabelText(/^funcionário$/i)).not.toBeInTheDocument()
    }
  })

  it('select de funcionario lista os funcionarios recebidos via prop', () => {
    renderModal({ categorias: ['Salário'] })
    const select = screen.getByLabelText(/^funcionário$/i) as HTMLSelectElement
    const opcoes = Array.from(select.options).map(o => o.textContent)
    expect(opcoes).toEqual(['—', 'João Pereira', 'Maria Souza'])
  })

  it('voltar pra categoria sem funcionario nao envia o funcionario selecionado antes', async () => {
    mockPost.mockResolvedValue({ ...lancamentoExistente, id: 'novo' })
    renderModal({ categorias: ['Salário', 'Gasolina'] })
    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Salário' } })
    fireEvent.change(screen.getByLabelText(/^funcionário$/i), { target: { value: 'f-1' } })
    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Gasolina' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { funcionario_id: unknown }
    expect(corpo.funcionario_id).toBeNull()
  })
})

describe('ModalLancamento — campo veículo só nas categorias de despesa de carro', () => {
  it('categoria default (Frete) NAO mostra o campo veiculo — frete e servico de terceiro', () => {
    renderModal({ categorias: ['Frete', 'Gasolina'] })
    expect(screen.queryByLabelText(/^veículo$/i)).not.toBeInTheDocument()
  })

  it('Gasolina, Manutenção dos Carros e Multa mostram o campo veiculo', () => {
    renderModal({ categorias: ['Frete', 'Gasolina', 'Manutenção dos Carros', 'Multa'] })
    for (const cat of ['Gasolina', 'Manutenção dos Carros', 'Multa']) {
      fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: cat } })
      expect(screen.getByLabelText(/^veículo$/i), cat).toBeInTheDocument()
    }
  })

  it('categorias de folha e as demais NAO mostram o campo veiculo', () => {
    renderModal({ categorias: ['Gasolina', 'Salário', 'Adiantamento de salário', 'FGTS', 'Outros'] })
    for (const cat of ['Salário', 'Adiantamento de salário', 'FGTS', 'Outros']) {
      fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: cat } })
      expect(screen.queryByLabelText(/^veículo$/i), cat).not.toBeInTheDocument()
    }
  })

  it('nunca mostra os dois campos ao mesmo tempo (as duas listas sao disjuntas)', () => {
    renderModal({ categorias: ['Gasolina', 'Salário'] })
    expect(screen.getByLabelText(/^veículo$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^funcionário$/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Salário' } })
    expect(screen.getByLabelText(/^funcionário$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^veículo$/i)).not.toBeInTheDocument()
  })

  it('select de veiculo lista os veiculos recebidos via prop, com placa', () => {
    renderModal({ categorias: ['Gasolina'] })
    const select = screen.getByLabelText(/^veículo$/i) as HTMLSelectElement
    const opcoes = Array.from(select.options).map(o => o.textContent)
    expect(opcoes).toEqual(['—', 'Fiat Fiorino · ABC-1234', 'Volkswagen Kombi · XYZ-9876'])
  })

  it('voltar pra categoria sem veiculo nao envia o veiculo selecionado antes', async () => {
    mockPost.mockResolvedValue({ ...lancamentoExistente, id: 'novo' })
    renderModal({ categorias: ['Gasolina', 'Frete'] })
    fireEvent.change(screen.getByLabelText(/^veículo$/i), { target: { value: 'v-1' } })
    fireEvent.change(screen.getByLabelText(/^categoria$/i), { target: { value: 'Frete' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { veiculo_id: unknown }
    expect(corpo.veiculo_id).toBeNull()
  })

  it('editar um lancamento com veiculo abre com o veiculo selecionado e o mantem ao salvar', async () => {
    mockPut.mockResolvedValue({ ...lancamentoExistente, veiculo_id: 'v-2' })
    renderModal({ lancamento: { ...lancamentoExistente, categoria: 'Gasolina', veiculo_id: 'v-2' } })
    expect(screen.getByLabelText(/^veículo$/i)).toHaveValue('v-2')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    const corpo = mockPut.mock.calls[0][1] as { veiculo_id: unknown }
    expect(corpo.veiculo_id).toBe('v-2')
  })
})

describe('ModalLancamento — validação', () => {
  it('data vazia: mostra erro e nao chama a API', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/data do lançamento/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a data.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('valor negativo: mostra erro inline, nao chama a API', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: '-50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Valor não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('campo valor vazio vira 0 ao enviar, sem disparar erro de negativo', async () => {
    mockPost.mockResolvedValue({ ...lancamentoExistente, id: 'novo', valor: 0 })
    renderModal()
    // nao toca no campo valor — ele comeca vazio
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/não pode ser negativo/i)).not.toBeInTheDocument()
    const corpo = mockPost.mock.calls[0][1] as { valor: unknown }
    expect(corpo.valor).toBe(0)
    expect(typeof corpo.valor).toBe('number')
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    renderModal()
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo data mantem required (semantica de acessibilidade, aria-required)', () => {
    renderModal()
    expect(screen.getByLabelText(/data do lançamento/i)).toBeRequired()
  })
})

describe('ModalLancamento — envio', () => {
  it('envia valor como numero, e funcionario_id null quando a categoria nao aceita', async () => {
    mockPost.mockResolvedValue({ ...lancamentoExistente, id: 'novo-1' })
    renderModal({ categorias: ['Frete'] })
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: '620' } })
    fireEvent.change(screen.getByLabelText(/descrição/i), { target: { value: 'Entregas da semana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { valor: unknown; funcionario_id: unknown; descricao: unknown }
    expect(corpo.valor).toBe(620)
    expect(typeof corpo.valor).toBe('number')
    expect(corpo.funcionario_id).toBeNull()
    expect(corpo.descricao).toBe('Entregas da semana')
  })

  it('envia o funcionario_id escolhido quando a categoria aceita', async () => {
    mockPost.mockResolvedValue({ ...lancamentoExistente, id: 'novo-2' })
    renderModal({ categorias: ['Salário'] })
    fireEvent.change(screen.getByLabelText(/^funcionário$/i), { target: { value: 'f-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { funcionario_id: unknown }
    expect(corpo.funcionario_id).toBe('f-2')
  })

  it('chama onSalvo com o lancamento retornado pela API ao criar com sucesso', async () => {
    const criado = { ...lancamentoExistente, id: 'novo-3' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    renderModal({ onSalvo })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })
})

describe('ModalLancamento — erros ao salvar', () => {
  it('erro generico mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 ao salvar chama onSessaoExpirada em vez de mostrar erro', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    renderModal({ onSessaoExpirada })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalLancamento — edição', () => {
  it('preenche os campos com os dados do lancamento existente', () => {
    renderModal({ lancamento: lancamentoExistente })
    expect(screen.getByLabelText(/data do lançamento/i)).toHaveValue('2026-06-18')
    expect(screen.getByLabelText(/^categoria$/i)).toHaveValue('Manutenção dos Carros')
    expect(screen.getByLabelText(/descrição/i)).toHaveValue('Troca de óleo e filtro do caminhão')
    expect(screen.getByLabelText(/valor/i)).toHaveValue(480)
  })

  it('lancamento existente de Salário preenche e mostra o funcionario vinculado', () => {
    renderModal({ lancamento: { ...lancamentoExistente, categoria: 'Salário', funcionario_id: 'f-2' } })
    expect(screen.getByLabelText(/^funcionário$/i)).toHaveValue('f-2')
  })

  it('titulo do dialogo indica edicao', () => {
    renderModal({ lancamento: lancamentoExistente })
    expect(screen.getByRole('dialog', { name: 'Editar lançamento' })).toBeInTheDocument()
  })

  it('lancamento existente com valor 0 mostra 0, nao vazio — zero gravado e intencional, diferente do vazio inicial', () => {
    renderModal({ lancamento: { ...lancamentoExistente, valor: 0 } })
    expect(screen.getByLabelText(/valor/i)).toHaveValue(0)
  })

  it('usa PUT com o id do lancamento ao salvar', async () => {
    mockPut.mockResolvedValue(lancamentoExistente)
    renderModal({ lancamento: lancamentoExistente })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/lancamentos/${lancamentoExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalLancamento — exclusão pede confirmação', () => {
  it('clicar em Excluir nao chama a API imediatamente — mostra confirmacao', () => {
    renderModal({ lancamento: lancamentoExistente })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.getByText(/não é possível desfazer/i)).toBeInTheDocument()
  })

  it('cancelar a confirmacao nao chama a API e some com o aviso', () => {
    renderModal({ lancamento: lancamentoExistente })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockDel).not.toHaveBeenCalled()
    expect(screen.queryByText(/não é possível desfazer/i)).not.toBeInTheDocument()
  })

  it('confirmar a exclusao chama DELETE com o id certo e depois onExcluido', async () => {
    mockDel.mockResolvedValue({ ok: true })
    const onExcluido = vi.fn()
    renderModal({ lancamento: lancamentoExistente, onExcluido })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(mockDel).toHaveBeenCalledWith(`/api/lancamentos/${lancamentoExistente.id}`))
    await waitFor(() => expect(onExcluido).toHaveBeenCalledWith(lancamentoExistente.id))
  })

  it('falha na exclusao mostra alerta e nao chama onExcluido', async () => {
    mockDel.mockRejectedValue(new Error('falha'))
    const onExcluido = vi.fn()
    renderModal({ lancamento: lancamentoExistente, onExcluido })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    expect(await screen.findByText('Não foi possível excluir. Tente novamente.')).toBeInTheDocument()
    expect(onExcluido).not.toHaveBeenCalled()
  })

  it('401 na exclusao chama onSessaoExpirada', async () => {
    mockDel.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    renderModal({ lancamento: lancamentoExistente, onSessaoExpirada })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
  })
})

describe('ModalLancamento — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    renderModal({ onFechar })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    renderModal({ onFechar })
    fireEvent.click(screen.getByLabelText(/data do lançamento/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    renderModal({ onFechar })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})
