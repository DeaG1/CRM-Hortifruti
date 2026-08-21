import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { FORNECEDOR_NOVO, type Fornecedor } from '../derive/fornecedores'
import type { Produto } from '../derive/produtos'
import './ModalFornecedor.css'

type Rascunho = typeof FORNECEDOR_NOVO

interface ModalFornecedorProps {
  fornecedor: Partial<Fornecedor> | null // null = criando; `produtos` (se vier) prefila os selecionados
  /** Catálogo completo, para montar a lista de seleção — vem de GET /api/produtos. */
  produtosDisponiveis: Produto[]
  onSalvo: (f: Fornecedor) => void
  /** Exclusão confirmada e concluída na API — quem chama decide o que fazer (fechar, recarregar a lista). */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro de salvar/excluir. */
  onSessaoExpirada?: () => void
}

export function ModalFornecedor(
  { fornecedor, produtosDisponiveis, onSalvo, onExcluido, onFechar, onSessaoExpirada }: ModalFornecedorProps,
) {
  const [rascunho, setRascunho] = useState<Rascunho>({ ...FORNECEDOR_NOVO, ...(fornecedor ?? {}) })
  const [produtoIds, setProdutoIds] = useState<string[]>((fornecedor?.produtos ?? []).map(p => p.id))
  const [erroNome, setErroNome] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(fornecedor?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `fornecedor-${chave}`,
      name: chave,
      value: rascunho[chave] as string,
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  function alternarProduto(id: string) {
    setProdutoIds(atual => (atual.includes(id) ? atual.filter(x => x !== id) : [...atual, id]))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNome('')
    setErroGeral('')
    if (!rascunho.nome.trim()) {
      setErroNome('Informe o nome.')
      return
    }
    setSalvando(true)
    try {
      const corpo = { nome: rascunho.nome, regiao: rascunho.regiao, contato: rascunho.contato }
      if (editando) {
        const salvo = await api.put<Fornecedor>(`/api/fornecedores/${fornecedor!.id}`, { ...corpo, produto_ids: produtoIds })
        onSalvo(salvo)
        return
      }
      // POST nao aceita produto_ids (so PUT sincroniza a relacao — ver
      // api/src/routes/fornecedores.ts). Cria primeiro, depois vincula os
      // produtos selecionados numa segunda chamada, se houver algum.
      const criado = await api.post<Fornecedor>('/api/fornecedores', corpo)
      if (produtoIds.length === 0) {
        onSalvo(criado)
        return
      }
      try {
        const comProdutos = await api.put<Fornecedor>(`/api/fornecedores/${criado.id}`, { produto_ids: produtoIds })
        onSalvo(comProdutos)
      } catch (errVinculo) {
        if (errVinculo instanceof ErroApi && errVinculo.status === 401) {
          onSessaoExpirada?.()
          return
        }
        // O fornecedor ja foi criado no servidor — so a vinculacao dos
        // produtos falhou. Devolve o criado (sem produtos, nao inventa
        // dado) em vez de deixar o modal travado; o usuario pode editar
        // depois para tentar vincular de novo.
        onSalvo(criado)
      }
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroNome('Já existe um fornecedor com esse nome.')
      } else if (err instanceof ErroApi && err.status === 401) {
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
      await api.del(`/api/fornecedores/${fornecedor!.id}`)
      onExcluido(fornecedor!.id as string)
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
      aria-label={editando ? 'Editar fornecedor' : 'Novo fornecedor'}
      onClick={onFechar}
    >
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar fornecedor' : 'Novo fornecedor'}</div>
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
                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="fornecedor-nome">Nome do produtor / fazenda</label>
                  <input
                    className="modal-input"
                    {...campo('nome')}
                    placeholder="Ex.: Fazenda Boa Terra"
                    autoFocus
                    required
                  />
                  {erroNome && <p className="modal-erro" role="alert">{erroNome}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="fornecedor-regiao">Região</label>
                  <input className="modal-input" {...campo('regiao')} placeholder="Ex.: Londrina, Norte do PR" />
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="fornecedor-contato">Telefone / contato</label>
                  <input className="modal-input" {...campo('contato')} />
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="fornecedor-produtos">
                    Produtos fornecidos <span className="modal-rotulo-sub">— {produtoIds.length} selecionado(s)</span>
                  </label>
                  <div id="fornecedor-produtos" className="modal-forn-produtos" role="group" aria-label="Produtos fornecidos">
                    {produtosDisponiveis.map(p => {
                      const selecionado = produtoIds.includes(p.id)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={selecionado ? 'modal-forn-produto modal-forn-produto--selecionado' : 'modal-forn-produto'}
                          onClick={() => alternarProduto(p.id)}
                          aria-pressed={selecionado}
                        >
                          {selecionado && <span className="modal-forn-produto-check">✓</span>}
                          {p.nome}
                          <span className="modal-forn-produto-un">{p.un}</span>
                        </button>
                      )
                    })}
                  </div>
                  {produtosDisponiveis.length === 0 && (
                    <p className="modal-aviso">
                      Nenhum produto cadastrado ainda. Cadastre os produtos primeiro para poder vinculá-los
                      a este fornecedor.
                    </p>
                  )}
                </div>

                <div className="modal-campo modal-campo--full modal-dica">
                  <strong>Preço de compra</strong>, <strong>variação</strong> e <strong>última coleta</strong>{' '}
                  são calculados automaticamente a partir das entradas (compras) deste fornecedor.
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
