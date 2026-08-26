import { useMemo, type ReactNode } from 'react'
import { ADMIN_ONLY_SCREENS, type Papel, type Tela } from '../telas'
import { opcoesDePeriodo, rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import { SaldoCaixa } from './SaldoCaixa'
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
  // Sem qualificador depois do nome — as outras dez telas deste objeto
  // repetem o rótulo do menu tal e qual (Financeiro/Financeiro,
  // Estoque/Estoque…). 'Clientes — Minimercados' era a única exceção, e
  // amarrava o título ao tipo de cliente do primeiro tenant (hortifruti); um
  // tenant de outro ramo (distribuidora, papelaria) não vende para
  // minimercado nenhum. Tirar o qualificador não só generaliza a palavra,
  // alinha esta tela ao mesmo padrão das outras nove.
  clientes: ['Clientes', 'Carteira completa e health score'],
  entradas: ['Entradas (Compras)', 'Coletas e compras dos fornecedores'],
  pedidos: ['Saídas (Vendas)', 'Entregas aos clientes'],
  estoque: ['Estoque', 'Quantidade por produto'],
  // O subtítulo do protótipo é 'Norte do PR · preços de compra e variação'
  // (linha 2141). A metade que diz o que a tela CALCULA volta agora que as
  // métricas existem — estava encurtada para caber no que havia (cadastro
  // puro), o mesmo apagamento que a auditoria apontou em Funcionários. "Norte
  // do PR" fica de fora de propósito: é a região do cliente do protótipo, não
  // um fato de todo tenant.
  fornecedores: ['Fornecedores', 'Produtores rurais · preço de compra, variação e aproveitamento'],
  produtos: ['Produtos', 'Preço, margem e perda'],
  funcionarios: ['Funcionários', 'Salários, adiantamentos e valores a pagar'],
  veiculos: ['Veículos', 'Frota · gasolina, manutenção e multas por carro'],
  financeiro: ['Financeiro', 'Resultado e ciclo de caixa'],
  relatorios: ['Relatórios', 'Clientes, pedidos e lançamentos do período'],
}

/** Data de hoje em 'AAAA-MM-DD', componentes LOCAIS (nao UTC) — mesmo
 * `hojeIsoLocal()` de ClientesLista/SaidasLista/RelatoriosTela. Fica aqui
 * porque toca `new Date()`; `opcoesDePeriodo` continua pura recebendo a
 * data por parametro. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

interface ShellProps {
  papel: Papel
  telaAtual: Tela
  /** Periodo global (achado S-3). O estado mora em App.tsx, que nao remonta
   * ao trocar de tela — e por isso que o recorte SOBREVIVE a navegacao. */
  periodo: Periodo
  onPeriodo: (periodo: Periodo) => void
  onNavegar: (tela: Tela) => void
  /**
   * Encerra a sessao e leva a tela de login limpa — serve tanto para o dono
   * sair no fim do dia quanto para o funcionario assumir a maquina
   * (computador compartilhado). Um botao so: ver o comentario de `sair()`
   * em App.tsx para o porque de nao haver mais um segundo rotulo para o
   * mesmo efeito.
   */
  onSair: () => void
  /** Sessao expirou (401) — repassado ao badge de saldo, a unica parte do
   * Shell que fala com a API. */
  onSessaoExpirada?: () => void
  children: ReactNode
}

export function Shell({
  papel, telaAtual, periodo, onPeriodo, onNavegar, onSair,
  onSessaoExpirada, children,
}: ShellProps) {
  const isAdmin = papel === 'admin'
  const itens = NAV_DEFS.filter(n => isAdmin || !ADMIN_ONLY_SCREENS.includes(n.key))
  const [titulo, subtitulo] = TITULOS[telaAtual]
  // Uma vez por montagem: a lista de meses nao pode mudar sozinha enquanto o
  // usuario navega (o `<select>` trocaria de opcoes debaixo dele), e a
  // virada de meia-noite com o app aberto e um caso que uma recarga resolve.
  const opcoes = useMemo(() => opcoesDePeriodo(hojeIsoLocal()), [])

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
          <button type="button" className="shell-sair" onClick={onSair}>Sair</button>
        </div>
      </aside>

      <main className="shell-main">
        <header className="shell-header">
          <div className="shell-header-texto">
            <div className="shell-header-titulo">{titulo}</div>
            <div className="shell-header-sub">{subtitulo}</div>
          </div>
          <div className="shell-header-controles">
            {/* Seletor de periodo GLOBAL — protótipo markup 95-101. Vale para
                todas as telas cujo conteudo e temporal; o cadastro puro
                (Produtos, Fornecedores, Funcionarios) continua inteiro, so as
                metricas derivadas respeitam o recorte. Estoque e o saldo em
                caixa sao posicoes ACUMULADAS e nao seguem o filtro — cada um
                diz isso no proprio rotulo. */}
            <div className="shell-periodo">
              <label className="shell-periodo-rotulo" htmlFor="shell-periodo-select">Período</label>
              <select
                id="shell-periodo-select"
                className="shell-periodo-select"
                value={periodo}
                onChange={e => onPeriodo(e.target.value)}
              >
                <option value={PERIODO_TODOS}>{rotuloPeriodo(PERIODO_TODOS)}</option>
                {opcoes.map(p => <option key={p} value={p}>{rotuloPeriodo(p)}</option>)}
              </select>
            </div>
            {/* So admin ve o caixa da empresa (protótipo `sc-if isAdmin`,
                linha 103). Nao e so o badge escondido: GET /api/lancamentos
                exige admin na API, entao o colaborador nem tem como somar o
                numero por fora. */}
            {isAdmin && <SaldoCaixa onSessaoExpirada={onSessaoExpirada} />}
          </div>
        </header>
        <div className="shell-conteudo">{children}</div>
      </main>
    </div>
  )
}
