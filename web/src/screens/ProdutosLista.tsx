import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { type Produto } from '../derive/produtos'
import { derivarRelatorioProdutos, type ProdutoAgregado } from '../derive/relatorios'
import { ModalProduto } from '../components/ModalProduto'
import './ProdutosLista.css'

const NEUTRO = '#9a9784'

// ---------------------------------------------------------- formatação

/** Preço médio com 2 casas — mesma convenção de `moneyDetalhado` em
 * RelatoriosTela.tsx (só "preço médio" usa 2 casas; os demais valores em
 * R$ desta tela usam `money`, arredondado). Formatação é responsabilidade
 * da tela, não de derive/relatorios.ts — mesmo padrão do resto do app. */
const moneyDetalhado = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',')
const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const pctInt = (n: number) => Math.round(n) + '%'
const pct1 = (n: number) => n.toFixed(1).replace('.', ',') + '%'

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

  // Métricas (compra média, venda média, markup, margem, perda): busca
  // separada de GET /api/relatorios/produtos — o mesmo agregado em SQL que
  // RelatoriosTela.tsx usa para o mesmo cálculo (ver justificativa em
  // api/src/routes/relatorios.ts: entradas/saídas não trazem os itens na
  // listagem, buscar item por item seria N+1). Falha SOZINHA: se o agregado
  // cair, o cadastro (o que esta tela existe pra mostrar) continua visível,
  // só com as 5 colunas de métrica em travessão — mesmo padrão de
  // ClientesLista sobre GET /api/saidas (erroVendas/aviso discreto, ver
  // `erroMetricas` abaixo).
  const [agregados, setAgregados] = useState<ProdutoAgregado[]>([])
  const [erroMetricas, setErroMetricas] = useState('')

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

  useEffect(() => {
    let cancelado = false
    api.get<ProdutoAgregado[]>('/api/relatorios/produtos')
      .then(rs => { if (!cancelado) setAgregados(rs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroMetricas('Não foi possível carregar as métricas de compra e venda — as colunas ficam indisponíveis.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

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
        <div className="estado-vazio produtos-vazio">
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

  // Reusa derivarRelatorioProdutos (web/src/derive/relatorios.ts) — a MESMA
  // função que RelatoriosTela.tsx usa para markup/margem/perda: nunca
  // reimplementar essas fórmulas por aqui, ou as duas telas podem divergir.
  // Compra média/venda média não são um campo dela (ela só usa esses dois
  // valores por dentro, pra calcular markup) — são a única conta feita no
  // ponto de uso, abaixo: uma divisão simples guardada por qtd > 0, não uma
  // fórmula composta como markup/margem.
  const { linhas: linhasRelatorio } = derivarRelatorioProdutos(agregados, produtos.length)
  const linhaPorProduto = new Map(linhasRelatorio.map(l => [l.produtoId, l]))
  const agregadoPorProduto = new Map(agregados.map(a => [a.produto_id, a]))

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

      {erroMetricas && (
        <p className="produtos-aviso-metricas" role="status">{erroMetricas}</p>
      )}

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

        {produtos.map(p => {
          // Sem entrada/saída deste produto no período (nunca comprado nem
          // vendido), GET /api/relatorios/produtos nem devolve a linha (ver
          // o `where` da query em api/src/routes/relatorios.ts) — `ag`/
          // `linha` ficam `undefined` e as cinco colunas caem no travessão
          // dos operadores abaixo, nunca em zero.
          const ag = agregadoPorProduto.get(p.id)
          const linha = linhaPorProduto.get(p.id)
          // Preço médio de compra/venda: sem base (nunca comprado/vendido),
          // travessão — nunca "R$ 0,00", que fingiria um preço medido.
          const compraMedia = ag && ag.compra_qtd > 0 ? ag.compra_valor / ag.compra_qtd : null
          const vendaMedia = ag && ag.venda_qtd > 0 ? ag.venda_valor / ag.venda_qtd : null
          // Margem sempre vem calculada de derivarRelatorioProdutos (vira 0
          // quando vendidoQtd é 0) — mesmo guard de vendidoQtd que
          // RelatoriosTela.tsx usa pra decidir entre valor e travessão.
          const temVenda = !!linha && linha.vendidoQtd > 0
          return (
            <div key={p.id} className="produtos-linha produtos-linha--dados" onClick={() => setModal(p)}>
              <div className="produtos-celula-nome">
                <span className="produtos-dot" style={{ background: NEUTRO }} />
                <span className="produtos-nome">{p.nome}</span>
              </div>
              <div><span className="produtos-un-badge">{p.un}</span></div>
              <div className="produtos-col-num produtos-mono">
                {compraMedia != null ? moneyDetalhado(compraMedia) : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {vendaMedia != null ? moneyDetalhado(vendaMedia) : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {linha?.markupPct != null ? pctInt(linha.markupPct) : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {temVenda ? money(linha!.margem) : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {linha?.perdaPct != null ? pct1(linha.perdaPct) : '—'}
              </div>
            </div>
          )
        })}

        <div className="produtos-linha produtos-linha--resumo">
          <div className="produtos-resumo-titulo">Perda média (realizada)</div>
          <div /><div /><div /><div />
          <div className="produtos-col-num produtos-resumo-rotulo">MÉDIA →</div>
          {/* Continua travessão fixo, fora do escopo desta wiring: não é
              uma das cinco colunas por produto, e nenhum relatório hoje
              expõe uma perda média PONDERADA entre todos os produtos —
              ficaria pra uma soma nova, não uma reexibição do que
              derivarRelatorioProdutos já calcula. */}
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
