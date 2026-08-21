import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import { ModalSaida, type Saida, type StatusSaida, type PagSaida } from '../components/ModalSaida'
import './SaidasLista.css'

const STATUS_FILTROS = ['Todos', 'Pendente', 'Em rota', 'Entregue', 'Devolvido', 'Cancelado'] as const
type FiltroStatus = (typeof STATUS_FILTROS)[number]

const PAG_FILTROS = ['Todos', 'Pago', 'Pendente', 'Atrasado', '—'] as const
type FiltroPag = (typeof PAG_FILTROS)[number]

// Semaforo pedido no briefing: verde/ambar/vermelho + neutro pra estados sem
// carga de julgamento (Em rota e so "em andamento", "—" e so "nao se aplica").
const NEUTRO = '#9a9784'
const VERDE = '#3f8f5b'
const AMBAR = '#c79320'
const VERMELHO = '#c2502f'

const COR_STATUS: Record<StatusSaida, string> = {
  Pendente: AMBAR,
  'Em rota': NEUTRO,
  Entregue: VERDE,
  Cancelado: VERMELHO,
  Devolvido: VERMELHO,
}
const BG_STATUS: Record<StatusSaida, string> = {
  Pendente: '#f6efd8',
  'Em rota': '#f1eee2',
  Entregue: '#e7f1e8',
  Cancelado: '#f6e4dc',
  Devolvido: '#f6e4dc',
}
const COR_PAG: Record<PagSaida, string> = {
  Pago: VERDE,
  Pendente: AMBAR,
  Atrasado: VERMELHO,
  '—': NEUTRO,
}
const BG_PAG: Record<PagSaida, string> = {
  Pago: '#e7f1e8',
  Pendente: '#f6efd8',
  Atrasado: '#f6e4dc',
  '—': '#f1eee2',
}

const COR_FILTRO_STATUS: Record<FiltroStatus, string> = {
  Todos: NEUTRO, Pendente: AMBAR, 'Em rota': NEUTRO, Entregue: VERDE, Devolvido: VERMELHO, Cancelado: VERMELHO,
}
const COR_FILTRO_PAG: Record<FiltroPag, string> = {
  Todos: NEUTRO, Pago: VERDE, Pendente: AMBAR, Atrasado: VERMELHO, '—': NEUTRO,
}

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')
const pesoTxt = (n: number) => n.toLocaleString('pt-BR') + ' kg'

/** 'AAAA-MM-DD' -> 'DD/MM'. Vazio/nulo vira travessao. */
function dataBr(iso: string | null): string {
  if (!iso || iso.length < 10) return '—'
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

interface SaidasListaProps {
  onSessaoExpirada: () => void
}

export function SaidasLista({ onSessaoExpirada }: SaidasListaProps) {
  const [saidas, setSaidas] = useState<Saida[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('Todos')
  const [filtroPag, setFiltroPag] = useState<FiltroPag>('Todos')
  // undefined = modal fechado; null = criando; string = editando (id da saida)
  const [modal, setModal] = useState<string | null | undefined>(undefined)
  // Muda a cada salvamento/exclusao pra forcar o refetch da lista.
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<Saida[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidas(ss) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada(); return }
        setErro('Não foi possível carregar as saídas.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  // Resolve cliente_id -> nome pra exibir na tabela. GET /api/saidas so traz
  // o id (coluna real, nao o nome); busca separada, e falha sozinha sem
  // quebrar a lista de saidas — hoje /api/clientes e admin-only
  // (exigirAdmin), diferente de /api/saidas: um colaborador ainda ve a
  // lista de saidas normalmente, so sem o nome do cliente resolvido.
  useEffect(() => {
    let cancelado = false
    api.get<Cliente[]>('/api/clientes')
      .then(cs => { if (!cancelado) setClientes(cs) })
      .catch((err: unknown) => {
        if (cancelado || !(err instanceof ErroApi) || err.status !== 401) return
        onSessaoExpirada()
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function nomeCliente(id: string | null): string {
    if (!id) return '—'
    return clientes.find(c => c.id === id)?.nome ?? '—'
  }

  function aoSalvar() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  function aoExcluir() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  if (carregando) return <p className="saidas-estado">Carregando…</p>
  if (erro) return <p className="saidas-estado saidas-estado--erro" role="alert">{erro}</p>

  const modalAtivo = modal !== undefined && (
    <ModalSaida
      saidaId={modal}
      onSalvo={aoSalvar}
      onExcluido={aoExcluir}
      onFechar={() => setModal(undefined)}
      onSessaoExpirada={onSessaoExpirada}
    />
  )

  if (saidas.length === 0) {
    return (
      <>
        <div className="saidas-vazio">
          <div className="saidas-vazio-titulo">Nenhuma saída lançada ainda.</div>
          <div className="saidas-vazio-sub">
            Lance a primeira venda entregue a um minimercado. Ela alimenta faturamento, ticket médio e estoque.
          </div>
          <button type="button" className="saidas-botao-novo" onClick={() => setModal(null)}>
            ＋ Lançar primeira saída
          </button>
        </div>
        {modalAtivo}
      </>
    )
  }

  const visiveis = saidas.filter(s =>
    (filtroStatus === 'Todos' || s.status === filtroStatus)
    && (filtroPag === 'Todos' || s.pag === filtroPag),
  )

  const contagemStatus = (f: FiltroStatus) =>
    f === 'Todos' ? saidas.length : saidas.filter(s => s.status === f).length
  const contagemPag = (f: FiltroPag) =>
    f === 'Todos' ? saidas.length : saidas.filter(s => s.pag === f).length

  return (
    <div className="saidas-lista">
      <div className="saidas-topo">
        <div className="saidas-topo-dica">Clique numa saída para editar</div>
        <button type="button" className="saidas-botao-novo" onClick={() => setModal(null)}>
          ＋ Novo pedido
        </button>
      </div>

      <div className="saidas-filtros" role="group" aria-label="Filtrar por status">
        {STATUS_FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtroStatus ? 'saidas-filtro saidas-filtro--ativo' : 'saidas-filtro'}
            onClick={() => setFiltroStatus(f)}
            aria-pressed={f === filtroStatus}
          >
            <span className="saidas-filtro-dot" style={{ background: COR_FILTRO_STATUS[f] }} />
            <span className="saidas-filtro-label">{f}</span>
            <span className="saidas-filtro-contagem">{contagemStatus(f)}</span>
          </button>
        ))}
      </div>

      <div className="saidas-filtros" role="group" aria-label="Filtrar por pagamento">
        {PAG_FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtroPag ? 'saidas-filtro saidas-filtro--ativo' : 'saidas-filtro'}
            onClick={() => setFiltroPag(f)}
            aria-pressed={f === filtroPag}
          >
            <span className="saidas-filtro-dot" style={{ background: COR_FILTRO_PAG[f] }} />
            <span className="saidas-filtro-label">{f === '—' ? 'Não aplicável' : f}</span>
            <span className="saidas-filtro-contagem">{contagemPag(f)}</span>
          </button>
        ))}
      </div>

      <div className="saidas-tabela">
        <div className="saidas-linha saidas-linha--cabecalho">
          <div>PEDIDO</div>
          <div>CLIENTE</div>
          <div>ENTREGA</div>
          <div className="saidas-col-num">PESO</div>
          <div className="saidas-col-num">VALOR</div>
          <div>STATUS</div>
          <div>PAGAMENTO</div>
        </div>

        {visiveis.map(s => (
          <div key={s.id} className="saidas-linha saidas-linha--dados" onClick={() => setModal(s.id)}>
            <div className="saidas-numero">{s.numero}</div>
            <div className="saidas-cliente">
              <div className="saidas-cliente-nome">{nomeCliente(s.cliente_id)}</div>
              <div className="saidas-rota">{s.rota || '—'}</div>
            </div>
            <div className="saidas-entrega">{dataBr(s.entrega)}</div>
            <div className="saidas-col-num saidas-mono">{pesoTxt(s.peso ?? 0)}</div>
            <div className="saidas-col-num saidas-mono saidas-valor">{money(s.valor ?? 0)}</div>
            <div>
              <span className="saidas-badge" style={{ color: COR_STATUS[s.status], background: BG_STATUS[s.status] }}>
                {s.status}
              </span>
            </div>
            <div>
              <span className="saidas-badge" style={{ color: COR_PAG[s.pag], background: BG_PAG[s.pag] }}>
                {s.pag}
              </span>
              {s.venc && <div className="saidas-venc">venc. {dataBr(s.venc)}</div>}
            </div>
          </div>
        ))}

        {visiveis.length === 0 && (
          <div className="saidas-sem-filtro">Nenhuma saída com estes filtros.</div>
        )}
      </div>

      {modalAtivo}
    </div>
  )
}
