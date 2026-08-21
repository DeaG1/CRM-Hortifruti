import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { type Produto } from '../derive/produtos'
import { ModalProduto } from '../components/ModalProduto'
import './ProdutosLista.css'

const NEUTRO = '#9a9784'

interface ProdutosListaProps {
  onSessaoExpirada: () => void
}

/**
 * Lista + cadastro de produtos. Diferente de ClientesLista (onde a
 * orquestração de lista/ficha/modal vive em App.tsx), aqui não há tela de
 * ficha — a tela cuida do próprio modal (criar/editar/excluir) e refaz o
 * fetch depois de salvar, incrementando `versao`.
 */
export function ProdutosLista({ onSessaoExpirada }: ProdutosListaProps) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  // undefined = modal fechado; null = criando; Produto = editando (prefill)
  const [modal, setModal] = useState<Partial<Produto> | null | undefined>(undefined)

  useEffect(() => {
    let cancelado = false
    // Reseta a cada nova versao (apos salvar/excluir) — nao ha um App.tsx
    // remontando esta tela por `key` como no modulo de clientes, entao quem
    // limpa o estado antes de recarregar e o proprio efeito.
    setCarregando(true)
    setErro('')
    api.get<Produto[]>('/api/produtos')
      .then(ps => { if (!cancelado) setProdutos(ps) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os produtos.')
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

  if (carregando) return <p className="produtos-estado">Carregando…</p>
  if (erro) return <p className="produtos-estado produtos-estado--erro" role="alert">{erro}</p>

  if (produtos.length === 0) {
    return (
      <>
        <div className="produtos-vazio">
          <div className="produtos-vazio-titulo">Nenhum produto cadastrado</div>
          <div className="produtos-vazio-sub">
            Comece por aqui: sem produto não é possível lançar entrada nem saída. Cadastre o nome e a
            unidade padrão.
          </div>
          <button type="button" className="produtos-botao-novo" onClick={() => setModal(null)}>
            ＋ Cadastrar primeiro produto
          </button>
        </div>

        {modal !== undefined && (
          <ModalProduto
            produto={modal}
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
    <div className="produtos-lista">
      <div className="produtos-topo">
        <div className="produtos-dica">
          Clique num produto para editar · preços são <strong>por unidade</strong> do produto (KG, CX…),
          calculados das compras e vendas
        </div>
        <button type="button" className="produtos-botao-novo" onClick={() => setModal(null)}>
          ＋ Novo produto
        </button>
      </div>

      <div className="produtos-tabela">
        <div className="produtos-linha produtos-linha--cabecalho">
          <div>PRODUTO</div>
          <div>UNIDADE</div>
          <div className="produtos-col-num">COMPRA MÉD.</div>
          <div className="produtos-col-num">VENDA MÉD.</div>
          <div className="produtos-col-num">MARKUP</div>
          <div className="produtos-col-num">MARGEM</div>
          <div className="produtos-col-num">PERDA</div>
        </div>

        {produtos.map(p => (
          <div key={p.id} className="produtos-linha produtos-linha--dados" onClick={() => setModal(p)}>
            <div className="produtos-celula-nome">
              <span className="produtos-dot" style={{ background: NEUTRO }} />
              <span className="produtos-nome">{p.nome}</span>
            </div>
            <div><span className="produtos-un-badge">{p.un}</span></div>
            {/* Compra/venda/markup/margem/perda dependem de entradas e saídas
                (ainda sem tela nesta fase) — travessão em vez de dado inventado,
                mesma convenção do ticket em ClientesLista. */}
            <div className="produtos-col-num produtos-mono">—</div>
            <div className="produtos-col-num produtos-mono">—</div>
            <div className="produtos-col-num produtos-mono">—</div>
            <div className="produtos-col-num produtos-mono">—</div>
            <div className="produtos-col-num produtos-mono">—</div>
          </div>
        ))}

        <div className="produtos-linha produtos-linha--resumo">
          <div className="produtos-resumo-titulo">Perda média (realizada)</div>
          <div /><div /><div /><div />
          <div className="produtos-col-num produtos-resumo-rotulo">MÉDIA →</div>
          <div className="produtos-col-num produtos-mono produtos-resumo-valor">—</div>
        </div>
      </div>

      <div className="produtos-nota">
        A <strong>perda</strong> acumula da coleta e do depósito, não é estimada. Markup mínimo{' '}
        <strong>≥ 60%</strong> · Perda alvo <strong>≤ 10%</strong>.
      </div>

      {modal !== undefined && (
        <ModalProduto
          produto={modal}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
