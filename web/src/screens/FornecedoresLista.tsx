import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { type Fornecedor } from '../derive/fornecedores'
import { type Produto } from '../derive/produtos'
import { ModalFornecedor } from '../components/ModalFornecedor'
import './FornecedoresLista.css'

interface FornecedoresListaProps {
  onSessaoExpirada: () => void
}

/**
 * Lista + cadastro de fornecedores. `GET /api/fornecedores` não traz os
 * produtos vinculados (só `GET /api/fornecedores/:id` faz esse join — ver
 * api/src/routes/fornecedores.ts) — por isso, depois da lista, buscamos o
 * detalhe de cada fornecedor em paralelo para poder mostrar "produtos que
 * entrega" na tabela sem uma segunda tela.
 */
export function FornecedoresLista({ onSessaoExpirada }: FornecedoresListaProps) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [produtosDisponiveis, setProdutosDisponiveis] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  // undefined = modal fechado; null = criando; Fornecedor = editando (prefill)
  const [modal, setModal] = useState<Partial<Fornecedor> | null | undefined>(undefined)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    Promise.all([
      api.get<Fornecedor[]>('/api/fornecedores'),
      api.get<Produto[]>('/api/produtos'),
    ])
      .then(([lista, produtos]) =>
        Promise.all(lista.map(f => api.get<Fornecedor>(`/api/fornecedores/${f.id}`)))
          .then(detalhados => {
            if (cancelado) return
            setFornecedores(detalhados)
            setProdutosDisponiveis(produtos)
          }),
      )
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os fornecedores.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function aoSalvar() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  function aoExcluir() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  if (carregando) return <p className="fornecedores-estado">Carregando…</p>
  if (erro) return <p className="fornecedores-estado fornecedores-estado--erro" role="alert">{erro}</p>

  if (fornecedores.length === 0) {
    return (
      <>
        <div className="fornecedores-topo">
          <div className="fornecedores-dica">Clique num fornecedor para editar</div>
          <button type="button" className="fornecedores-botao-novo" onClick={() => setModal(null)}>
            ＋ Novo fornecedor
          </button>
        </div>
        <div className="estado-vazio fornecedores-vazio">
          <div className="fornecedores-vazio-titulo">Nenhum fornecedor cadastrado</div>
          <div className="fornecedores-vazio-sub">
            Cadastre os produtores de quem você compra. Sem fornecedor não é possível lançar uma entrada.
          </div>
          <button type="button" className="fornecedores-botao-novo" onClick={() => setModal(null)}>
            ＋ Cadastrar primeiro fornecedor
          </button>
        </div>

        {modal !== undefined && (
          <ModalFornecedor
            fornecedor={modal}
            produtosDisponiveis={produtosDisponiveis}
            onSalvo={aoSalvar}
            onExcluido={aoExcluir}
            onFechar={() => setModal(undefined)}
            onSessaoExpirada={onSessaoExpirada}
          />
        )}
      </>
    )
  }

  return (
    <div className="fornecedores-lista">
      <div className="fornecedores-topo">
        <div className="fornecedores-dica">Clique num fornecedor para editar</div>
        <button type="button" className="fornecedores-botao-novo" onClick={() => setModal(null)}>
          ＋ Novo fornecedor
        </button>
      </div>

      <div className="fornecedores-resumo">
        <div className="fornecedores-resumo-card">
          <div className="fornecedores-resumo-label">Variação de preço de compra</div>
          {/* Depende das entradas (compras), ainda sem tela nesta fase —
              travessão em vez de dado inventado. */}
          <div className="fornecedores-resumo-valor">—</div>
          <div className="fornecedores-resumo-sub">Sem entradas registradas ainda</div>
        </div>
      </div>

      <div className="fornecedores-grade">
        {fornecedores.map(f => (
          <div key={f.id} className="fornecedores-card" onClick={() => setModal(f)}>
            <div className="fornecedores-card-topo">
              <div className="fornecedores-nome">{f.nome}</div>
              <div className="fornecedores-sub">{f.regiao || '—'} · {f.contato || '—'}</div>
            </div>

            <div className="fornecedores-produtos">
              {(f.produtos ?? []).length > 0
                ? f.produtos!.map(p => (
                  <span key={p.id} className="fornecedores-produto-chip">{p.nome}</span>
                ))
                : <span className="fornecedores-produto-vazio">Nenhum produto vinculado</span>}
            </div>

            <div className="fornecedores-metricas">
              <div>
                <div className="fornecedores-metrica-label">Preço médio</div>
                <div className="fornecedores-metrica-valor">—</div>
              </div>
              <div>
                <div className="fornecedores-metrica-label">Variação</div>
                <div className="fornecedores-metrica-valor">—</div>
              </div>
              <div>
                <div className="fornecedores-metrica-label">Última coleta</div>
                <div className="fornecedores-metrica-valor">—</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal !== undefined && (
        <ModalFornecedor
          fornecedor={modal}
          produtosDisponiveis={produtosDisponiveis}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
