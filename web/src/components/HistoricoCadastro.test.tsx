import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HistoricoCadastro } from './HistoricoCadastro'
import { api, ErroApi } from '../api/client'
import type { RegistroHistorico } from '../derive/historico'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

const DECLARADO: RegistroHistorico = {
  id: 'h-1',
  entidade: 'cliente',
  registro_id: 'c-1',
  registro_nome: 'Mercado Bom Preço',
  acao: 'editou',
  autor_origem: 'declarado',
  autor_nome: 'João da Silva',
  autor_funcionario_id: 'f-1',
  motivo: 'cliente ligou avisando o telefone novo',
  alteracoes: [{ campo: 'tel', de: '44 90000-0000', para: '44 98888-8888' }],
  criado_em: '2026-08-28T14:32',
}

const PELO_LOGIN: RegistroHistorico = {
  id: 'h-2',
  entidade: 'cliente',
  registro_id: 'c-1',
  registro_nome: 'Mercado Bom Preço',
  acao: 'criou',
  autor_origem: 'login',
  autor_nome: 'Dona Rita',
  autor_funcionario_id: null,
  motivo: '',
  alteracoes: [],
  criado_em: '2026-08-20T09:05',
}

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockResolvedValue([DECLARADO, PELO_LOGIN])
})

function montar(props: Partial<Parameters<typeof HistoricoCadastro>[0]> = {}) {
  return render(<HistoricoCadastro entidade="cliente" registroId="c-1" {...props} />)
}

async function abrir() {
  fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
  // Texto EXATO da linha do autor: `/declarado por/i` casaria também com a
  // nota de rodapé do painel, que cita a mesma expressão.
  await screen.findByText('Declarado por João da Silva')
}

describe('HistoricoCadastro — descoberta e carga', () => {
  it('o botão fica visível desde a abertura do modal', () => {
    montar()
    expect(screen.getByRole('button', { name: /histórico de alterações/i })).toBeInTheDocument()
  })

  it('NÃO busca nada antes de expandir', () => {
    // A esmagadora maioria das aberturas do modal é para EDITAR, não para
    // auditar. Buscar o log em toda abertura custaria uma ida ao banco por
    // edição para alimentar uma seção fechada. O que se adia é a busca, não a
    // descoberta: o botão está lá o tempo todo.
    montar()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('expandir busca o histórico daquele registro, na rota da entidade certa', async () => {
    montar({ entidade: 'produto', registroId: 'p-9' })
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/historico/produto/p-9'))
  })

  it('aria-expanded acompanha o estado', async () => {
    montar()
    const botao = screen.getByRole('button', { name: /histórico de alterações/i })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    await screen.findByText('Declarado por João da Silva')
  })

  it('fechar e reabrir não refaz a busca — o que já veio continua valendo', async () => {
    montar()
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await screen.findByText('Declarado por João da Silva')
    expect(mockGet).toHaveBeenCalledTimes(1)
  })
})

describe('HistoricoCadastro — o que a linha mostra', () => {
  it('data, quem declarou ser, o motivo e o que mudou', async () => {
    montar()
    await abrir()
    expect(screen.getByText('28/08/2026 14:32')).toBeInTheDocument()
    expect(screen.getByText('Declarado por João da Silva')).toBeInTheDocument()
    expect(screen.getByText(/cliente ligou avisando o telefone novo/)).toBeInTheDocument()
    expect(screen.getByText('Telefone / WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('44 90000-0000')).toBeInTheDocument()
    expect(screen.getByText('44 98888-8888')).toBeInTheDocument()
  })

  it('a linha do admin diz "Registrado no login de", não "Declarado por"', async () => {
    montar()
    await abrir()
    expect(screen.getByText('Registrado no login de Dona Rita')).toBeInTheDocument()
  })

  it('em NENHUMA linha aparece "editado por"', async () => {
    // Chamar declaração de prova é mentir sobre a própria evidência. Este é o
    // teste que não deixa a frase voltar por um "simplifiquei o texto".
    montar()
    await abrir()
    expect(document.body.textContent?.toLowerCase()).not.toContain('editado por')
    expect(document.body.textContent?.toLowerCase()).not.toContain('autenticad')
  })

  it('resume a ação de cada linha', async () => {
    montar()
    await abrir()
    expect(screen.getByText('1 campo alterado')).toBeInTheDocument()
    expect(screen.getByText('Cadastro criado')).toBeInTheDocument()
  })

  it('linha sem motivo não renderiza aspas vazias', async () => {
    montar()
    await abrir()
    expect(screen.queryByText('“”')).not.toBeInTheDocument()
  })

  it('valor vazio no de/para vira travessão, e ZERO continua zero', async () => {
    mockGet.mockResolvedValue([{
      ...DECLARADO,
      alteracoes: [
        { campo: 'tel', de: '', para: '44 1111-1111' },
        { campo: 'limite', de: '5000.00', para: '0' },
      ],
    }])
    montar()
    await abrir()
    expect(screen.getByText('—')).toBeInTheDocument()
    // Um limite ZERADO é a informação inteira daquela linha — não pode virar
    // travessão junto com "campo em branco".
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('o aviso sobre declaração aparece quando há linha declarada', async () => {
    montar()
    await abrir()
    expect(screen.getByRole('note')).toHaveTextContent(/não verifica quem digitou/i)
  })

  it('e não aparece num histórico só do login do dono', async () => {
    mockGet.mockResolvedValue([PELO_LOGIN])
    montar()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await screen.findByText('Registrado no login de Dona Rita')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('data fora do formato vira travessão, nunca a string crua', async () => {
    mockGet.mockResolvedValue([{ ...DECLARADO, criado_em: 'ontem' }])
    montar()
    await abrir()
    expect(screen.queryByText('ontem')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('HistoricoCadastro — estados vazios e falha isolada', () => {
  it('sem nenhuma alteração, explica que o registro começou agora', async () => {
    mockGet.mockResolvedValue([])
    montar()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    const vazio = await screen.findByRole('status')
    expect(vazio).toHaveTextContent(/nenhuma alteração registrada/i)
    expect(vazio).toHaveTextContent(/o que foi alterado antes disso não aparece/i)
  })

  it('falha na busca vira role="status", não derruba nada', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    const erro = await screen.findByRole('status')
    expect(erro).toHaveTextContent(/não foi possível carregar o histórico/i)
    // O botão continua lá; o formulário em volta (fora deste componente) não
    // é tocado.
    expect(screen.getByRole('button', { name: /histórico de alterações/i })).toBeInTheDocument()
  })

  it('a falha NÃO usa role="alert" — é seção secundária, não erro do que o usuário fez', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await screen.findByRole('status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('401 vai para o fluxo de sessão expirada', async () => {
    const onSessaoExpirada = vi.fn()
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'nao autenticado' }))
    montar({ onSessaoExpirada })
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
  })

  it('depois de falhar, não fica repetindo a busca a cada render', async () => {
    mockGet.mockRejectedValue(new ErroApi(500, { erro: 'erro interno' }))
    montar()
    fireEvent.click(screen.getByRole('button', { name: /histórico de alterações/i }))
    await screen.findByRole('status')
    expect(mockGet).toHaveBeenCalledTimes(1)
  })
})
