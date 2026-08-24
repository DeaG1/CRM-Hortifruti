import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { ModalEntrada, type EntradaComItens, type Fornecedor } from '../components/ModalEntrada'
import './EntradasLista.css'

/** Forma de um item de GET /api/entradas (api/src/routes/entradas.ts,
 * paraJsonLista) — cabecalho com totais agregados dos itens, sem os itens
 * em si (GET /:id traz os itens, usado ao editar). */
interface Entrada {
  id: string
  numero: string
  fornecedor_id: string | null
  data: string
  perda_kg: number
  motivo: string
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  forma_pag: string
  obs: string
  valor_total: number
  peso_total: number
}

const PAGO_INFO: Record<string, { cor: string; bg: string }> = {
  Pago: { cor: '#3f8f5b', bg: '#e7f1e8' },
  Pendente: { cor: '#c79320', bg: '#f6efd8' },
  Atrasado: { cor: '#c2502f', bg: '#f6e4dc' },
}

const money = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const peso = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg'

type Modal = { modo: 'novo' } | { modo: 'editar'; entrada: EntradaComItens } | null

interface EntradasListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function EntradasLista({ onSessaoExpirada }: EntradasListaProps) {
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)

  const [modal, setModal] = useState<Modal>(null)
  const [abrindoId, setAbrindoId] = useState<string | null>(null)
  const [erroAbrir, setErroAbrir] = useState('')

  const [confirmando, setConfirmando] = useState<{ id: string; numero: string } | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<Entrada[]>('/api/entradas')
      .then(es => { if (!cancelado) setEntradas(es) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar as entradas.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })

    // Nome do fornecedor e so um complemento visual da tabela — colaborador
    // nao tem permissao pra GET /api/fornecedores (fornecedores.ts exige
    // exigirAdmin) e recebe 403 aqui. Isso nunca pode derrubar a lista de
    // entradas (que o colaborador acessa normalmente): falha e silenciosa,
    // a tabela cai pro fallback (mostra so o id).
    api.get<Fornecedor[]>('/api/fornecedores')
      .then(fs => { if (!cancelado) setFornecedores(fs) })
      .catch(() => {})

    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function nomeFornecedor(id: string | null): string {
    if (!id) return '—'
    return fornecedores.find(f => f.id === id)?.nome ?? id
  }

  async function abrirNovo() {
    setErroAbrir('')
    setModal({ modo: 'novo' })
  }

  async function abrirEdicao(id: string) {
    setErroAbrir('')
    setAbrindoId(id)
    try {
      const detalhe = await api.get<EntradaComItens>(`/api/entradas/${id}`)
      setModal({ modo: 'editar', entrada: detalhe })
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      setErroAbrir('Não foi possível abrir esta entrada. Tente novamente.')
    } finally {
      setAbrindoId(null)
    }
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
      await api.del(`/api/entradas/${confirmando.id}`)
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

  if (carregando) return <p className="entradas-estado">Carregando…</p>
  if (erro) return <p className="entradas-estado entradas-estado--erro" role="alert">{erro}</p>

  const totalPeso = entradas.reduce((s, e) => s + e.peso_total, 0)
  const totalPerda = entradas.reduce((s, e) => s + e.perda_kg, 0)
  const totalValor = entradas.reduce((s, e) => s + e.valor_total, 0)

  return (
    <div className="entradas-lista">
      <div className="entradas-topo">
        <div className="entradas-topo-legenda">
          Coletas e compras dos fornecedores · clique numa entrada para editar
        </div>
        <button type="button" className="entradas-botao-novo" onClick={abrirNovo}>
          <span className="entradas-botao-novo-icone">＋</span> Nova entrada
        </button>
      </div>

      {erroAbrir && <p className="entradas-erro-abrir" role="alert">{erroAbrir}</p>}

      {entradas.length > 0 && (
        <div className="entradas-stats">
          <div className="entradas-stat">
            <div className="entradas-stat-label">ENTRADAS</div>
            <div className="entradas-stat-valor">{entradas.length}</div>
          </div>
          <div className="entradas-stat">
            <div className="entradas-stat-label">PESO RECEBIDO</div>
            <div className="entradas-stat-valor">{peso(totalPeso)}</div>
          </div>
          <div className="entradas-stat">
            <div className="entradas-stat-label">PERDA (COLETA/TRANSPORTE)</div>
            <div className="entradas-stat-valor" style={{ color: '#c2502f' }}>{peso(totalPerda)}</div>
          </div>
          <div className="entradas-stat">
            <div className="entradas-stat-label">VALOR TOTAL</div>
            <div className="entradas-stat-valor">{money(totalValor)}</div>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="entradas-confirma" role="region" aria-label="Confirmar exclusão">
          <p className="entradas-confirma-texto" role="alert">
            Excluir a entrada <strong>{confirmando.numero}</strong>? Essa ação não pode ser desfeita.
          </p>
          {erroExclusao && <p className="entradas-erro-abrir" role="alert">{erroExclusao}</p>}
          <div className="entradas-confirma-acoes">
            <button
              type="button"
              className="entradas-confirma-cancelar"
              onClick={() => setConfirmando(null)}
              disabled={excluindo}
            >
              Cancelar
            </button>
            <button type="button" className="entradas-confirma-excluir" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      )}

      {entradas.length === 0
        ? (
          <div className="estado-vazio entradas-vazio">
            <div className="entradas-vazio-titulo">Nenhuma entrada lançada</div>
            <div className="entradas-vazio-sub">
              Lance a primeira compra do produtor. Ela abastece o estoque e vira a compra de mercadoria no
              Financeiro.
            </div>
            <button type="button" className="entradas-botao-novo" onClick={abrirNovo}>
              <span className="entradas-botao-novo-icone">＋</span> Lançar primeira entrada
            </button>
          </div>
        )
        : (
          <div className="entradas-tabela">
            <div className="entradas-linha entradas-linha--cabecalho">
              <div>ENTRADA</div>
              <div>FORNECEDOR</div>
              <div>MOTIVO</div>
              <div className="entradas-col-num">PESO</div>
              <div className="entradas-col-num">PERDA</div>
              <div className="entradas-col-num">VALOR</div>
              <div>PAGTO</div>
              <div className="entradas-col-num">AÇÃO</div>
            </div>

            {entradas.map(e => {
              const pagoInfo = PAGO_INFO[e.pago] ?? PAGO_INFO.Pendente
              return (
                <div
                  key={e.id}
                  className="entradas-linha entradas-linha--dados"
                  onClick={() => abrirEdicao(e.id)}
                >
                  <div className="entradas-mono entradas-numero">
                    {abrindoId === e.id ? '…' : e.numero}
                  </div>
                  <div className="entradas-fornecedor-bloco">
                    <div className="entradas-fornecedor-nome">{nomeFornecedor(e.fornecedor_id)}</div>
                    <div className="entradas-data">{e.data}</div>
                  </div>
                  <div className="entradas-motivo">{e.motivo || '—'}</div>
                  <div className="entradas-col-num entradas-mono">{peso(e.peso_total)}</div>
                  <div
                    className="entradas-col-num entradas-mono"
                    style={{ color: e.perda_kg > 0 ? '#c2502f' : '#2a2a24' }}
                  >
                    {peso(e.perda_kg)}
                  </div>
                  <div className="entradas-col-num entradas-mono entradas-valor">{money(e.valor_total)}</div>
                  <div>
                    <span className="entradas-pago-badge" style={{ color: pagoInfo.cor, background: pagoInfo.bg }}>
                      {e.pago}
                    </span>
                  </div>
                  <div className="entradas-col-num">
                    <button
                      type="button"
                      className="entradas-excluir"
                      onClick={ev => { ev.stopPropagation(); setConfirmando({ id: e.id, numero: e.numero }) }}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      <div className="entradas-rodape-nota">
        A soma das entradas do período vira a <strong>Compra de mercadoria</strong> no Financeiro automaticamente.
      </div>

      {modal && (
        <ModalEntrada
          entrada={modal.modo === 'editar' ? modal.entrada : null}
          onSalvo={aoSalvar}
          onFechar={() => setModal(null)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
