import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { ModalPerda, type Perda, type Produto } from '../components/ModalPerda'
import './PerdasLista.css'

const MOTIVO_COR: Record<string, string> = {
  vencimento: '#c2502f',
  armazenagem: '#c79320',
  manuseio: '#c79320',
  transporte: '#c79320',
  'não informado': '#6a685c',
}

function rotuloMotivo(m: string): string {
  if (!m) return 'Não informado'
  return m[0].toUpperCase() + m.slice(1)
}

function motivoMaisFrequente(perdas: Perda[]): string {
  if (perdas.length === 0) return '—'
  const contagem = new Map<string, number>()
  for (const p of perdas) contagem.set(p.motivo, (contagem.get(p.motivo) ?? 0) + 1)
  let melhor = perdas[0].motivo
  let max = 0
  for (const [motivo, n] of contagem) {
    if (n > max) { max = n; melhor = motivo }
  }
  return rotuloMotivo(melhor)
}

type Modal = { modo: 'novo' } | { modo: 'editar'; perda: Perda } | null

interface PerdasListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function PerdasLista({ onSessaoExpirada }: PerdasListaProps) {
  const [perdas, setPerdas] = useState<Perda[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)

  const [modal, setModal] = useState<Modal>(null)

  const [confirmando, setConfirmando] = useState<{ id: string; rotulo: string } | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<Perda[]>('/api/perdas')
      .then(ps => { if (!cancelado) setPerdas(ps) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar as perdas.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })

    // Nome do produto e so um complemento visual da tabela — colaborador nao
    // tem permissao pra GET /api/produtos (produtos.ts exige exigirAdmin) e
    // recebe 403 aqui. Isso nunca pode derrubar a lista de perdas (que o
    // colaborador acessa normalmente): falha e silenciosa, a tabela cai pro
    // fallback (mostra so o id).
    api.get<Produto[]>('/api/produtos')
      .then(ps => { if (!cancelado) setProdutos(ps) })
      .catch(() => {})

    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function nomeProduto(id: string): string {
    return produtos.find(p => p.id === id)?.nome ?? id
  }

  function aoSalvar() {
    setModal(null)
    setVersao(v => v + 1)
  }

  async function excluir() {
    if (!confirmando) return
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/perdas/${confirmando.id}`)
      setConfirmando(null)
      setVersao(v => v + 1)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      setErroExclusao('Não foi possível excluir. Tente novamente.')
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <p className="perdas-estado">Carregando…</p>
  if (erro) return <p className="perdas-estado perdas-estado--erro" role="alert">{erro}</p>

  return (
    <div className="perdas-lista">
      <div className="perdas-topo">
        <div className="perdas-topo-legenda">
          Perdas do depósito, depois que a mercadoria já entrou · clique numa perda para editar
        </div>
        <button type="button" className="perdas-botao-novo" onClick={() => setModal({ modo: 'novo' })}>
          <span className="perdas-botao-novo-icone">＋</span> Nova perda
        </button>
      </div>

      {perdas.length > 0 && (
        <div className="perdas-stats">
          <div className="perdas-stat">
            <div className="perdas-stat-label">PERDAS REGISTRADAS</div>
            <div className="perdas-stat-valor">{perdas.length}</div>
          </div>
          <div className="perdas-stat">
            <div className="perdas-stat-label">MOTIVO MAIS FREQUENTE</div>
            <div className="perdas-stat-valor perdas-stat-valor--texto">{motivoMaisFrequente(perdas)}</div>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="perdas-confirma" role="region" aria-label="Confirmar exclusão">
          <p className="perdas-confirma-texto" role="alert">
            Excluir a perda de <strong>{confirmando.rotulo}</strong>? Essa ação não pode ser desfeita.
          </p>
          {erroExclusao && <p className="perdas-erro-abrir" role="alert">{erroExclusao}</p>}
          <div className="perdas-confirma-acoes">
            <button
              type="button"
              className="perdas-confirma-cancelar"
              onClick={() => setConfirmando(null)}
              disabled={excluindo}
            >
              Cancelar
            </button>
            <button type="button" className="perdas-confirma-excluir" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      )}

      {perdas.length === 0
        ? (
          <div className="perdas-vazio">
            <div className="perdas-vazio-titulo">Nenhuma perda registrada</div>
            <div className="perdas-vazio-sub">
              Registre aqui o que estraga ou some no depósito depois que a mercadoria já entrou — vencimento,
              armazenagem, manuseio ou transporte.
            </div>
            <button type="button" className="perdas-botao-novo" onClick={() => setModal({ modo: 'novo' })}>
              <span className="perdas-botao-novo-icone">＋</span> Registrar primeira perda
            </button>
          </div>
        )
        : (
          <div className="perdas-tabela">
            <div className="perdas-linha perdas-linha--cabecalho">
              <div>DATA</div>
              <div>PRODUTO</div>
              <div className="perdas-col-num">QTD</div>
              <div>MOTIVO</div>
              <div>OBSERVAÇÃO</div>
              <div className="perdas-col-num">AÇÃO</div>
            </div>

            {perdas.map(p => (
              <div
                key={p.id}
                className="perdas-linha perdas-linha--dados"
                onClick={() => setModal({ modo: 'editar', perda: p })}
              >
                <div className="perdas-mono">{p.data}</div>
                <div className="perdas-produto">{nomeProduto(p.produto_id)}</div>
                <div className="perdas-col-num perdas-mono">{p.qtd.toLocaleString('pt-BR')} {p.un}</div>
                <div>
                  <span className="perdas-motivo-badge" style={{ color: MOTIVO_COR[p.motivo] ?? '#6a685c' }}>
                    {rotuloMotivo(p.motivo)}
                  </span>
                </div>
                <div className="perdas-obs">{p.obs || '—'}</div>
                <div className="perdas-col-num">
                  <button
                    type="button"
                    className="perdas-excluir"
                    onClick={ev => {
                      ev.stopPropagation()
                      setConfirmando({ id: p.id, rotulo: `${nomeProduto(p.produto_id)} (${p.data})` })
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      {modal && (
        <ModalPerda
          perda={modal.modo === 'editar' ? modal.perda : null}
          onSalvo={aoSalvar}
          onFechar={() => setModal(null)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
