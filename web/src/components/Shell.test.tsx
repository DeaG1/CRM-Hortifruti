import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { Shell } from './Shell'
import { api } from '../api/client'

// O Shell passou a montar o badge de saldo em caixa (SaldoCaixa), que busca
// /api/saidas, /api/entradas e /api/lancamentos. Mock so de `api.get` —
// mesmo molde de FinanceiroTela.test.tsx.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockResolvedValue([])
})

/** Props obrigatorias do Shell que nenhum destes testes exercita — o foco
 * de cada `it` continua sendo so o que ele nomeia. */
const PERIODO_PADRAO = { periodo: 'all', onPeriodo: () => {} }

const ITENS_ADMIN = [
  'Saúde do Negócio', 'Clientes', 'Entradas (Compras)', 'Saídas (Vendas)', 'Estoque',
  'Fornecedores', 'Produtos', 'Funcionários', 'Veículos', 'Financeiro', 'Relatórios',
]
const ITENS_ADMIN_ONLY = [
  'Saúde do Negócio', 'Clientes', 'Fornecedores', 'Produtos', 'Funcionários', 'Financeiro',
  'Relatórios', 'Veículos',
]
// Veiculos PASSOU a ser admin-only. Enquanto a tela era check-in/check-out ela
// ficava de fora: quem pega o carro no dia a dia e o colaborador. Com o
// check-in/check-out removido, o que a tela mostra e quanto cada carro custou
// no periodo — dado que vem de GET /api/lancamentos, admin-only. Ver o
// comentario de ADMIN_ONLY_SCREENS em telas.ts.
const ITENS_COLABORADOR = ['Entradas (Compras)', 'Saídas (Vendas)', 'Estoque']

describe('Shell — menu por papel', () => {
  it('admin ve as 11 entradas do menu', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    for (const label of ITENS_ADMIN) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('colaborador ve so Entradas, Saidas e Estoque', () => {
    render(
      <Shell papel="colaborador" telaAtual="entradas" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    for (const label of ITENS_COLABORADOR) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const label of ITENS_ADMIN_ONLY) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('clicar num item do menu chama onNavegar com a chave certa', () => {
    const onNavegar = vi.fn()
    render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={onNavegar} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fornecedores' }))
    expect(onNavegar).toHaveBeenCalledWith('fornecedores')
  })

  it('marca a tela atual com aria-current', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.getByRole('button', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Estoque' })).not.toHaveAttribute('aria-current')
  })

  it('clicar em Sair chama onSair', () => {
    const onSair = vi.fn()
    render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={onSair}>
        <p>conteudo</p>
      </Shell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(onSair).toHaveBeenCalledOnce()
  })

  // ---------------------------------------- um so botao de saida (computador
  // compartilhado): ja existiu um segundo botao ("Trocar de usuário") para o
  // funcionario assumir a maquina, mas fazia exatamente o mesmo que "Sair" —
  // sair() ja leva a uma tela de login limpa desde 478133f. Guarda contra
  // reintroducao do segundo botao.

  it('ha exatamente um botao de sair na barra lateral', () => {
    const { container } = render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    // Conta os botoes do CONTAINER de saida, nao por rotulo: um segundo
    // botao reintroduzido pode nao conter a palavra "sair" (o antigo
    // "Trocar de usuário" nao continha), e so contar por nome deixaria essa
    // reintroducao passar batido.
    expect(container.querySelectorAll('.shell-sair-container button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('o colaborador tambem ve exatamente um botao de sair', () => {
    const { container } = render(
      <Shell papel="colaborador" telaAtual="entradas" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(container.querySelectorAll('.shell-sair-container button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('renderiza o titulo da tela atual no cabecalho', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" {...PERIODO_PADRAO} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    // Selector explicito: 'Clientes' tambem e o rotulo do item de menu
    // correspondente (a mesma palavra aparece duas vezes na tela).
    expect(screen.getByText('Clientes', { selector: '.shell-header-titulo' })).toBeInTheDocument()
  })
})

// ============================================ periodo global (achado S-3)

describe('Shell — seletor de periodo global', () => {
  it('oferece "Todo o periodo" mais os doze meses recentes', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" periodo="all" onPeriodo={() => {}} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    const select = screen.getByLabelText('Período') as HTMLSelectElement
    // 1 ("Todo o periodo") + MESES_NO_SELETOR
    expect(select.options).toHaveLength(13)
    expect(select.options[0].value).toBe('all')
  })

  it('mostra o periodo recebido, nao um estado proprio', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" periodo="2026-06" onPeriodo={() => {}} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe('2026-06')
  })

  it('trocar o mes chama onPeriodo (quem guarda o estado e o App)', () => {
    const onPeriodo = vi.fn()
    render(
      <Shell papel="admin" telaAtual="clientes" periodo="all" onPeriodo={onPeriodo} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    const select = screen.getByLabelText('Período') as HTMLSelectElement
    fireEvent.change(select, { target: { value: select.options[1].value } })
    expect(onPeriodo).toHaveBeenCalledWith(select.options[1].value)
  })

  it('colaborador tambem tem o seletor de periodo', () => {
    render(
      <Shell papel="colaborador" telaAtual="entradas" periodo="all" onPeriodo={() => {}} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.getByLabelText('Período')).toBeInTheDocument()
  })
})

// ======================================== saldo em caixa (achado S-4)

describe('Shell — badge de saldo em caixa por papel', () => {
  it('admin ve o badge', async () => {
    render(
      <Shell papel="admin" telaAtual="clientes" periodo="all" onPeriodo={() => {}} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.getByText('SALDO EM CAIXA · ACUMULADO')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('R$ 0'))
  })

  it('colaborador NAO ve o badge, e o Shell nem busca as tres fontes', () => {
    render(
      <Shell papel="colaborador" telaAtual="entradas" periodo="all" onPeriodo={() => {}} onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })
})
