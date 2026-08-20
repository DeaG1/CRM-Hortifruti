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

interface ClientesListaProps {
  onAbrir: (id: string) => void
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ClientesLista({ onAbrir, onSessaoExpirada }: ClientesListaProps) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [periodo] = useState('all')
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Cliente[]>('/api/clientes'),
      // Pedidos ainda nao tem endpoint (Fase 1). Ate la, lista vazia:
      // as derivacoes tratam ausencia de pedido sem quebrar (ticket,
      // inadimplencia e participacao aparecem zerados, health nao penaliza).
      Promise.resolve<Pedido[]>([]),
    ])
      .then(([cs, ps]) => { if (!cancelado) { setClientes(cs); setPedidos(ps) } })
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

  const derivados: ClienteDerivado[] = derivarClientes(clientes, pedidos, periodo)
  const visiveis = filtro === 'Todos'
    ? derivados
    : derivados.filter(c => rotuloStatus(c.status) === filtro)

  if (carregando) return <p className="clientes-estado">Carregando…</p>
  if (erro) return <p className="clientes-estado clientes-estado--erro" role="alert">{erro}</p>
  if (clientes.length === 0) {
    return (
      <div className="clientes-vazio">
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
              <div className="clientes-col-num clientes-mono">{c.participacao}%</div>
              <div className="clientes-col-num clientes-mono" style={{ color: corInadimplencia(c.inadimplencia) }}>
                {c.inadimplencia.toFixed(1).replace('.', ',')}%
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
