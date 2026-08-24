import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { PRODUTO_NOVO, UNIDADES, type Produto } from '../derive/produtos'
import './ModalProduto.css'

type Rascunho = typeof PRODUTO_NOVO

interface ModalProdutoProps {
  produto: Partial<Produto> | null // null = criando
  onSalvo: (p: Produto) => void
  /** Exclusão confirmada e concluída na API — quem chama decide o que fazer (fechar, recarregar a lista). */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro de salvar/excluir. */
  onSessaoExpirada?: () => void
}

export function ModalProduto({ produto, onSalvo, onExcluido, onFechar, onSessaoExpirada }: ModalProdutoProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({ ...PRODUTO_NOVO, ...(produto ?? {}) })
  const [erroNome, setErroNome] = useState('')
  const [erroPesoMedio, setErroPesoMedio] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(produto?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `produto-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNome('')
    setErroPesoMedio('')
    setErroGeral('')
    if (!rascunho.nome.trim()) {
      setErroNome('Informe o nome.')
      return
    }
    // `min="0"` no input e so UX (form tem noValidate — ver comentario no
    // JSX). Esta e a validacao que decide se o pedido sai; a API valida de
    // novo (defesa em profundidade, mesmo padrao de ModalCliente).
    const pesoNum = Number(rascunho.peso_medio)
    if (Number.isFinite(pesoNum) && pesoNum < 0) {
      setErroPesoMedio('Peso médio não pode ser negativo.')
      return
    }
    setSalvando(true)
    try {
      const corpo = { nome: rascunho.nome, un: rascunho.un, peso_medio: pesoNum || 0 }
      const salvo = editando
        ? await api.put<Produto>(`/api/produtos/${produto!.id}`, corpo)
        : await api.post<Produto>('/api/produtos', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroNome('Já existe um produto com esse nome.')
      } else if (err instanceof ErroApi && err.status === 401) {
        // Sessao expirada no meio do salvamento: volta pro login, o erro de
        // "nao foi possivel salvar" seria enganoso (o problema nao foi o envio).
        onSessaoExpirada?.()
      } else {
        setErroGeral('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/produtos/${produto!.id}`)
      onExcluido(produto!.id as string)
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

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar produto' : 'Novo produto'}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalCliente —
          clicar no fundo fecha, clicar dentro nao propaga; noValidate desliga
          so o bloqueio nativo do form (o `required` do nome continua no DOM
          e mapeando pra aria-required, quem decide bloquear o submit agora
          e a validacao em JS abaixo). */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar produto' : 'Novo produto'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {confirmandoExclusao ? (
            <div className="modal-confirma">
              <p className="modal-confirma-texto" role="alert">
                Excluir <strong>{rascunho.nome}</strong>? O cadastro será apagado definitivamente — não é
                possível desfazer.
              </p>
              {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
            </div>
          ) : (
            <>
              <div className="modal-form-grid">
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="produto-nome">Nome do produto</label>
                  <input
                    className="modal-input"
                    {...campo('nome')}
                    placeholder="Ex.: Batata"
                    autoFocus
                    required
                  />
                  {erroNome && <p className="modal-erro" role="alert">{erroNome}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="produto-un">Unidade padrão</label>
                  <select className="modal-select" {...campo('un')}>
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="produto-peso_medio">Peso médio da embalagem (kg)</label>
                  <input
                    className="modal-input modal-input--mono"
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="Ex.: 20"
                    {...campo('peso_medio')}
                  />
                  {erroPesoMedio && <p className="modal-erro" role="alert">{erroPesoMedio}</p>}
                  <p className="modal-campo-ajuda">
                    Usado para converter caixa (CX) em quilos numa entrada. Deixe 0 se não se aplica.
                  </p>
                </div>

                <div className="modal-campo modal-campo--full modal-dica">
                  <strong>Preço de compra</strong>, <strong>venda</strong>, <strong>markup</strong> e{' '}
                  <strong>% de perda</strong> são calculados automaticamente a partir dos lançamentos
                  (entradas e saídas).
                </div>
              </div>

              {erroGeral && <p className="modal-erro modal-erro-geral" role="alert">{erroGeral}</p>}
            </>
          )}
        </div>

        <div className="modal-rodape">
          {editando && !confirmandoExclusao && (
            <button type="button" className="modal-botao-excluir" onClick={() => setConfirmandoExclusao(true)}>
              Excluir
            </button>
          )}
          <div className="modal-rodape-spacer" />
          {confirmandoExclusao ? (
            <>
              <button
                type="button"
                className="modal-botao-cancelar"
                onClick={() => setConfirmandoExclusao(false)}
                disabled={excluindo}
              >
                Cancelar
              </button>
              <button type="button" className="modal-botao-excluir-confirmar" onClick={excluir} disabled={excluindo}>
                {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="modal-botao-cancelar" onClick={onFechar}>Cancelar</button>
              <button type="submit" className="modal-botao-salvar" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
