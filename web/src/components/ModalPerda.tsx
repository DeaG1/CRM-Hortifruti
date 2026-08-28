import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { UNIDADES } from '../derive/produtos'
import './ModalPerda.css'

/** Motivos aceitos — exatamente o CHECK de `perdas.motivo`
 * (db/migrations/009_entidades_fase1.sql:168). */
const MOTIVOS = ['vencimento', 'armazenagem', 'manuseio', 'transporte', 'não informado'] as const

export interface Produto {
  id: string
  nome: string
  un: string
  peso_medio: number
}

/** Os mesmos campos em POST/PUT (api/src/routes/perdas.ts, CAMPOS). */
export interface Perda {
  id: string
  data: string
  produto_id: string
  un: string
  qtd: number
  motivo: string
  obs: string
}

const PERDA_NOVA = {
  data: '',
  produto_id: '',
  un: 'KG',
  qtd: '',
  motivo: 'não informado' as string,
  obs: '',
}

type Rascunho = typeof PERDA_NOVA

function rascunhoDePerda(p: Perda | null): Rascunho {
  if (!p) return { ...PERDA_NOVA }
  return {
    data: p.data,
    produto_id: p.produto_id,
    un: p.un,
    qtd: String(p.qtd),
    motivo: p.motivo,
    obs: p.obs ?? '',
  }
}

interface ModalPerdaProps {
  perda: Perda | null // null = criando
  onSalvo: (p: Perda) => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ModalPerda({ perda, onSalvo, onFechar, onSessaoExpirada }: ModalPerdaProps) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDePerda(perda))
  const editando = Boolean(perda)

  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregandoProdutos, setCarregandoProdutos] = useState(true)
  const [erroProdutos, setErroProdutos] = useState('')

  const [erroData, setErroData] = useState('')
  const [erroProduto, setErroProduto] = useState('')
  const [erroQtd, setErroQtd] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let cancelado = false
    api.get<Produto[]>('/api/produtos')
      .then(ps => { if (!cancelado) setProdutos(ps) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        // 403 acontece para colaborador (produtos.ts exige exigirAdmin) — a
        // tela de perdas em si e permitida pro colaborador, mas hoje ele nao
        // tem como listar produtos. Degrada pro resto do formulario continuar
        // usavel, em vez do modal inteiro quebrar.
        setErroProdutos('Não foi possível carregar a lista de produtos.')
      })
      .finally(() => { if (!cancelado) setCarregandoProdutos(false) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `perda-${chave}`,
      name: chave,
      value: rascunho[chave],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const valor = e.target.value
        setRascunho(r => {
          if (chave === 'produto_id') {
            // Sugere a unidade cadastrada no produto — o usuario ainda pode
            // trocar depois, isto e so o ponto de partida (mesma ideia do
            // ModalEntrada).
            const produto = produtos.find(p => p.id === valor)
            return { ...r, produto_id: valor, un: produto?.un ?? r.un }
          }
          return { ...r, [chave]: valor }
        })
      },
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroData('')
    setErroProduto('')
    setErroQtd('')
    setErroGeral('')

    if (!rascunho.data) {
      setErroData('Informe a data.')
      return
    }
    if (!rascunho.produto_id) {
      setErroProduto('Selecione o produto.')
      return
    }
    const qtdNum = Number(rascunho.qtd)
    if (rascunho.qtd === '' || !Number.isFinite(qtdNum) || qtdNum < 0) {
      setErroQtd('Informe uma quantidade válida (maior ou igual a zero).')
      return
    }

    setSalvando(true)
    try {
      const corpo = {
        data: rascunho.data,
        produto_id: rascunho.produto_id,
        un: rascunho.un || 'KG',
        qtd: qtdNum,
        motivo: rascunho.motivo,
        obs: rascunho.obs,
      }
      const salvo = editando
        ? await api.put<Perda>(`/api/perdas/${perda!.id}`, corpo)
        : await api.post<Perda>('/api/perdas', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
      } else if (err instanceof ErroApi && err.status === 409) {
        setErroGeral('Já existe um registro equivalente.')
      } else {
        setErroGeral('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="modal-perda-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar perda' : 'Nova perda'}
      onClick={onFechar}
    >
      <form className="modal-perda-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-perda-header">
          <span className="modal-perda-header-dot" />
          <div className="modal-perda-header-titulo">{editando ? 'Editar perda' : 'Nova perda'}</div>
          <button type="button" className="modal-perda-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-perda-corpo">
          <div className="modal-perda-grid">
            <div className="modal-perda-campo">
              <label className="modal-perda-rotulo" htmlFor="perda-data">Data da perda</label>
              <input className="modal-perda-input" type="date" {...campo('data')} autoFocus required />
              {erroData && <p className="modal-perda-erro" role="alert">{erroData}</p>}
            </div>

            <div className="modal-perda-campo">
              <label className="modal-perda-rotulo" htmlFor="perda-produto_id">Produto</label>
              <select className="modal-perda-select" {...campo('produto_id')} disabled={carregandoProdutos} required>
                <option value="">{carregandoProdutos ? 'Carregando…' : 'Selecione…'}</option>
                {produtos.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
              {erroProduto && <p className="modal-perda-erro" role="alert">{erroProduto}</p>}
              {erroProdutos && <p className="modal-perda-erro" role="alert">{erroProdutos}</p>}
            </div>

            <div className="modal-perda-campo">
              <label className="modal-perda-rotulo" htmlFor="perda-un">Unidade</label>
              <select className="modal-perda-select" {...campo('un')}>
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="modal-perda-campo">
              <label className="modal-perda-rotulo" htmlFor="perda-qtd">Quantidade perdida</label>
              <input
                className="modal-perda-input modal-perda-input--mono"
                type="number"
                min="0"
                step="0.001"
                placeholder="Ex.: 8"
                {...campo('qtd')}
              />
              {erroQtd && <p className="modal-perda-erro" role="alert">{erroQtd}</p>}
            </div>

            <div className="modal-perda-campo modal-perda-campo--full">
              <label className="modal-perda-rotulo" htmlFor="perda-motivo">Motivo</label>
              <select className="modal-perda-select" {...campo('motivo')}>
                {MOTIVOS.map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
              </select>
            </div>

            <div className="modal-perda-campo modal-perda-campo--full">
              <label className="modal-perda-rotulo" htmlFor="perda-obs">Observação</label>
              <input
                className="modal-perda-input"
                {...campo('obs')}
                placeholder="Ex.: caixa amassada no empilhamento"
              />
            </div>

            <div className="modal-perda-campo modal-perda-campo--full modal-perda-dica">
              Esta perda <strong>desconta do estoque</strong> e entra no <strong>índice de perdas</strong> junto
              com a perda registrada nas compras.
            </div>
          </div>

          {erroGeral && <p className="modal-perda-erro modal-perda-erro-geral" role="alert">{erroGeral}</p>}
        </div>

        <div className="modal-perda-rodape">
          <div className="modal-perda-rodape-spacer" />
          <button type="button" className="modal-perda-botao-cancelar" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="modal-perda-botao-salvar" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
