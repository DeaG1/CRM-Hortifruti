import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { derivarClientes, type Cliente, type Pedido, type ClienteDerivado, type StatusCliente, type Health } from '../derive/clientes'
import './ClientesLista.css'

const STATUS_LABEL: Record<StatusCliente, string> = {
  ativo: 'Ativo',
  negociacao: 'Em negociação',
  inadimplente: 'Inadimplente',
  inativo: 'Inativo',
}

function rotuloStatus(s: StatusCliente): string {
  return STATUS_LABEL[s] ?? s
}

const FILTROS = ['Todos', 'Ativo', 'Em negociação', 'Inadimplente', 'Inativo'] as const
type Filtro = (typeof FILTROS)[number]

const COR_FILTRO: Record<Filtro, string> = {
  Todos: '#9a9784',
  Ativo: '#3f8f5b',
  'Em negociação': '#c79320',
  Inadimplente: '#c2502f',
  Inativo: '#9a9784',
}

const HEALTH_INFO: Record<Health, { cor: string; bg: string; label: string }> = {
  green: { cor: '#3f8f5b', bg: '#e7f1e8', label: 'Saudável' },
  amber: { cor: '#c79320', bg: '#f6efd8', label: 'Atenção' },
  red: { cor: '#c2502f', bg: '#f6e4dc', label: 'Risco' },
}

const NEUTRO = '#9a9784'

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/SaidasLista.tsx. Fica na tela
 * (não em derive/clientes.ts) porque toca `new Date()`: a função pura
 * (`derivarClientes` → `inadimplenciaPorCliente` → `situacaoExibidaSaida`)
 * recebe isso como parâmetro, pra continuar testável sem mockar relógio. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Cor do ticket por entrega: portado de entregaColor do protótipo. Zero fica
 * neutro (ainda não há pedidos), em vez de vermelho — sem pedido não é risco. */
function corTicketEntrega(v: number): string {
  if (v <= 0) return NEUTRO
  if (v >= 430) return HEALTH_INFO.green.cor
  if (v >= 150) return HEALTH_INFO.amber.cor
  return HEALTH_INFO.red.cor
}

function corInadimplencia(pct: number): string {
  if (pct <= 1) return HEALTH_INFO.green.cor
  if (pct <= 2) return HEALTH_INFO.amber.cor
  return HEALTH_INFO.red.cor
}

/** Cabeçalho de uma saída (venda), como GET /api/saidas devolve — ver
 * api/src/routes/saidas.ts (paraJson). Só os campos que `paraPedidos`
 * (abaixo) usa; mesmo padrão de tipo raso por consumidor que
 * derive/relatorios.ts (SaidaResumo) e derive/financeiro.ts (SaidaFin) já
 * seguem — não é o tipo "cheio" de ModalSaida.tsx de propósito. */
interface SaidaBruta {
  id: string
  cliente_id: string | null
  entrega: string | null
  valor: number
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  venc: string | null
}

/**
 * Converte o formato bruto de GET /api/saidas (`cliente_id`, chave
 * estrangeira real) para o `Pedido` que `derivarClientes` espera
 * (`cliente`, o NOME do cliente) — `Pedido` é o tipo herdado do protótipo,
 * de antes de existir schema/API, e as demais funções de derive/clientes.ts
 * (ticketPorEntrega, inadimplenciaPorCliente) já dependem de `cliente` ser
 * o nome pra agrupar via `p.cliente === c.nome`. É a resposta que se adapta
 * aqui — não o tipo que se renomeia pra bater com o banco (`Pedido` é usado
 * só aqui hoje, mas nao deveria virar `cliente_id` por isso).
 *
 * Sem `cliente_id` (venda avulsa) ou com um `cliente_id` que não bate com
 * nenhum cliente carregado (cadastro excluído depois da venda), usa o
 * próprio `cliente_id` (ou '' se nulo) como `cliente`: nunca é igual a um
 * nome real, então a venda ainda entra no faturamento total do período
 * (como toda venda real deveria) mas não fica atribuída a cliente nenhum.
 */
function paraPedidos(saidasBrutas: SaidaBruta[], clientes: Cliente[]): Pedido[] {
  const nomePorId = new Map(clientes.map(c => [c.id, c.nome]))
  return saidasBrutas.map(s => ({
    id: s.id,
    cliente: (s.cliente_id && nomePorId.get(s.cliente_id)) || s.cliente_id || '',
    entrega: s.entrega ?? '',
    valor: s.valor,
    status: s.status,
    pag: s.pag,
    venc: s.venc,
  }))
}

interface ClientesListaProps {
  onAbrir: (id: string) => void
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ClientesLista({ onAbrir, onSessaoExpirada }: ClientesListaProps) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saidasBrutas, setSaidasBrutas] = useState<SaidaBruta[]>([])
  const [periodo] = useState('all')
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [erroVendas, setErroVendas] = useState('')

  useEffect(() => {
    let cancelado = false
    api.get<Cliente[]>('/api/clientes')
      .then(cs => { if (!cancelado) setClientes(cs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os clientes.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Vendas do período: busca separada da lista de clientes acima, e falha
  // SOZINHA — se /api/saidas cair, a carteira de clientes (o que esta tela
  // existe pra mostrar) continua visível, so com as metricas que dependem
  // de venda indisponiveis (ver `erroVendas` e o aviso discreto abaixo, e
  // o travessao no lugar de zero nas celulas). Sem filtro de periodo na
  // API porque esta tela nunca oferece um seletor de periodo (so 'all') —
  // RelatoriosTela/DashboardTela ja buscam a lista inteira do mesmo jeito;
  // se o volume de saidas crescer a ponto de isso pesar (aproximando de
  // dezenas de milhares de linhas), a resposta e um endpoint agregado por
  // periodo, igual ao que ja existe para /api/relatorios/produtos.
  useEffect(() => {
    let cancelado = false
    api.get<SaidaBruta[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidasBrutas(ss) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroVendas('Não foi possível carregar as vendas do período — os números da carteira ficam indisponíveis.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  const pedidos = paraPedidos(saidasBrutas, clientes)
  const derivados: ClienteDerivado[] = derivarClientes(clientes, pedidos, periodo, hojeIsoLocal())
  const visiveis = filtro === 'Todos'
    ? derivados
    : derivados.filter(c => rotuloStatus(c.status) === filtro)

  if (carregando) return <p className="clientes-estado">Carregando…</p>
  if (erro) return <p className="clientes-estado clientes-estado--erro" role="alert">{erro}</p>
  if (clientes.length === 0) {
    return (
      <div className="estado-vazio clientes-vazio">
        <div className="clientes-vazio-titulo">Nenhum cliente cadastrado ainda.</div>
        <div className="clientes-vazio-sub">
          Cadastre os minimercados que você atende. Sem cliente não é possível lançar uma saída (venda).
        </div>
      </div>
    )
  }

  const contagem = (rotulo: Filtro) =>
    rotulo === 'Todos' ? derivados.length : derivados.filter(c => rotuloStatus(c.status) === rotulo).length

  return (
    <div className="clientes-lista">
      {erroVendas && (
        <p className="clientes-aviso-vendas" role="status">{erroVendas}</p>
      )}

      <div className="clientes-filtros">
        {FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtro ? 'clientes-filtro clientes-filtro--ativo' : 'clientes-filtro'}
            onClick={() => setFiltro(f)}
            aria-pressed={f === filtro}
          >
            <span className="clientes-filtro-dot" style={{ background: COR_FILTRO[f] }} />
            <span className="clientes-filtro-label">{f}</span>
            <span className="clientes-filtro-contagem">{contagem(f)}</span>
          </button>
        ))}
      </div>

      <div className="clientes-tabela">
        <div className="clientes-linha clientes-linha--cabecalho">
          <div>ESTABELECIMENTO</div>
          <div>ROTA</div>
          <div className="clientes-col-num">TICKET/MÊS</div>
          <div className="clientes-col-num">/ENTREGA</div>
          <div className="clientes-col-num">% FAT</div>
          <div className="clientes-col-num">INADIMP.</div>
          <div className="clientes-col-num">SAÚDE</div>
        </div>

        {visiveis.map(c => {
          const health = HEALTH_INFO[c.health]
          return (
            <div
              key={c.id}
              className="clientes-linha clientes-linha--dados"
              onClick={() => onAbrir(c.id)}
            >
              <div className="clientes-celula-nome">
                <span className="clientes-health-dot" style={{ background: health.cor }} />
                <div className="clientes-nome-bloco">
                  <div className="clientes-nome">{c.nome}</div>
                  <div className="clientes-nome-sub">{c.resp} · {rotuloStatus(c.status)}</div>
                </div>
              </div>
              <div className="clientes-rota">
                {c.rota}
                <div className="clientes-freq">{c.freq}</div>
              </div>
              <div className="clientes-col-num clientes-mono">{c.faturado ? money(c.faturado) : '—'}</div>
              <div className="clientes-col-num clientes-mono" style={{ color: corTicketEntrega(c.ticketEntrega) }}>
                {c.ticketEntrega ? money(c.ticketEntrega) : '—'}
              </div>
              {/* Sem faturado no periodo (cliente sem venda, OU vendas
                  indisponiveis por falha de /api/saidas), participacao e
                  inadimplencia ficam em travessao — nao "0%"/"0,0%", que
                  fingiria ser um dado real (0% de atraso de quem nao
                  vendeu nada e diferente de 0% de atraso de quem vendeu e
                  pagou tudo em dia). */}
              <div className="clientes-col-num clientes-mono">{c.faturado ? `${c.participacao}%` : '—'}</div>
              <div
                className="clientes-col-num clientes-mono"
                style={{ color: c.faturado ? corInadimplencia(c.inadimplencia) : NEUTRO }}
              >
                {c.faturado ? c.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
              </div>
              <div className="clientes-col-num">
                <span className="clientes-health-badge" style={{ color: health.cor, background: health.bg }}>
                  {c.tend} {health.label}
                </span>
              </div>
            </div>
          )
        })}

        {visiveis.length === 0 && (
          <div className="clientes-sem-filtro">Nenhum cliente com este status.</div>
        )}
      </div>
    </div>
  )
}
