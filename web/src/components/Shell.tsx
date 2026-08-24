import type { ReactNode } from 'react'
import { ADMIN_ONLY_SCREENS, type Papel, type Tela } from '../telas'
import './Shell.css'

const NAV_DEFS: { key: Tela; label: string }[] = [
  { key: 'dashboard', label: 'Saúde do Negócio' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'entradas', label: 'Entradas (Compras)' },
  { key: 'pedidos', label: 'Saídas (Vendas)' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'fornecedores', label: 'Fornecedores' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'funcionarios', label: 'Funcionários' },
  { key: 'veiculos', label: 'Veículos' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'relatorios', label: 'Relatórios' },
]

/** Título e subtítulo do topo, por tela — portado do objeto `titles` do protótipo. */
const TITULOS: Record<Tela, [string, string]> = {
  dashboard: ['Saúde do Negócio', 'Visão geral da operação'],
  clientes: ['Clientes — Minimercados', 'Carteira completa e health score'],
  entradas: ['Entradas (Compras)', 'Coletas e compras dos fornecedores'],
  pedidos: ['Saídas (Vendas)', 'Entregas aos minimercados'],
  estoque: ['Estoque', 'Quantidade por produto'],
  fornecedores: ['Fornecedores', 'Produtores rurais'],
  produtos: ['Produtos', 'Preço, margem e perda'],
  funcionarios: ['Funcionários', 'Salários e adiantamentos'],
  veiculos: ['Veículos', 'Quem pegou qual carro'],
  financeiro: ['Financeiro', 'Resultado e ciclo de caixa'],
  relatorios: ['Relatórios', 'Clientes, pedidos e lançamentos do período'],
}

interface ShellProps {
  papel: Papel
  telaAtual: Tela
  onNavegar: (tela: Tela) => void
  onSair: () => void
  children: ReactNode
}

export function Shell({ papel, telaAtual, onNavegar, onSair, children }: ShellProps) {
  const isAdmin = papel === 'admin'
  const itens = NAV_DEFS.filter(n => isAdmin || !ADMIN_ONLY_SCREENS.includes(n.key))
  const [titulo, subtitulo] = TITULOS[telaAtual]

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-marca">
          <div className="shell-marca-logo">
            <div className="shell-marca-logo-forma" />
          </div>
          <div>
            <div className="shell-marca-titulo">CRM</div>
            <div className="shell-marca-sub">Gestão da operação</div>
          </div>
        </div>

        <nav className="shell-nav" aria-label="Navegação principal">
          <div className="shell-nav-secao">OPERAÇÃO</div>
          {itens.map(n => {
            const ativo = n.key === telaAtual
            return (
              <button
                key={n.key}
                type="button"
                className={ativo ? 'shell-navitem shell-navitem--ativo' : 'shell-navitem'}
                aria-current={ativo ? 'page' : undefined}
                onClick={() => onNavegar(n.key)}
              >
                <span className="shell-navitem-dot" />
                <span className="shell-navitem-label">{n.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="shell-perfil">
          <div className="shell-perfil-avatar">{isAdmin ? 'AD' : 'FU'}</div>
          <div>
            <div className="shell-perfil-nome">{isAdmin ? 'Tela admin' : 'Funcionário'}</div>
            <div className="shell-perfil-sub">{isAdmin ? 'acesso total' : 'entrada · saída · estoque'}</div>
          </div>
        </div>
        <div className="shell-sair-container">
          <button type="button" className="shell-sair" onClick={onSair}>Sair da conta</button>
        </div>
      </aside>

      <main className="shell-main">
        <header className="shell-header">
          <div className="shell-header-titulo">{titulo}</div>
          <div className="shell-header-sub">{subtitulo}</div>
        </header>
        <div className="shell-conteudo">{children}</div>
      </main>
    </div>
  )
}
