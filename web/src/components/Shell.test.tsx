import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { Shell } from './Shell'

const ITENS_ADMIN = [
  'Saúde do Negócio', 'Clientes', 'Entradas (Compras)', 'Saídas (Vendas)', 'Estoque',
  'Fornecedores', 'Produtos', 'Funcionários', 'Veículos', 'Financeiro', 'Relatórios',
]
const ITENS_ADMIN_ONLY = [
  'Saúde do Negócio', 'Clientes', 'Fornecedores', 'Produtos', 'Funcionários', 'Financeiro', 'Relatórios',
]
// Veiculos e visivel pro colaborador (nao esta em ADMIN_ONLY_SCREENS): quem
// de fato pega/devolve o carro no dia a dia precisa ver a tela.
const ITENS_COLABORADOR = ['Entradas (Compras)', 'Saídas (Vendas)', 'Estoque', 'Veículos']

describe('Shell — menu por papel', () => {
  it('admin ve as 11 entradas do menu', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    for (const label of ITENS_ADMIN) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('colaborador ve so Entradas, Saidas e Estoque', () => {
    render(
      <Shell papel="colaborador" telaAtual="entradas" onNavegar={() => {}} onSair={() => {}}>
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
      <Shell papel="admin" telaAtual="clientes" onNavegar={onNavegar} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fornecedores' }))
    expect(onNavegar).toHaveBeenCalledWith('fornecedores')
  })

  it('marca a tela atual com aria-current', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.getByRole('button', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Estoque' })).not.toHaveAttribute('aria-current')
  })

  it('clicar em Sair da conta chama onSair', () => {
    const onSair = vi.fn()
    render(
      <Shell papel="admin" telaAtual="clientes" onNavegar={() => {}} onSair={onSair}>
        <p>conteudo</p>
      </Shell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }))
    expect(onSair).toHaveBeenCalledOnce()
  })

  it('renderiza o titulo da tela atual no cabecalho', () => {
    render(
      <Shell papel="admin" telaAtual="clientes" onNavegar={() => {}} onSair={() => {}}>
        <p>conteudo</p>
      </Shell>,
    )
    expect(screen.getByText('Clientes — Minimercados')).toBeInTheDocument()
  })
})
