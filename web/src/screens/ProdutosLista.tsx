import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { type Produto } from '../derive/produtos'
import { derivarRelatorioProdutos, type ProdutoAgregado } from '../derive/relatorios'
import { ModalProduto } from '../components/ModalProduto'
import { queryDePeriodo, rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
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

// ------------------------------------------- métrica incompleta (sem peso médio)

/**
 * Texto do aviso de quantidade incompleta — mesmo texto e mesma regra do
 * relatório de produtos (RelatoriosTela.tsx, avisoSemConversao), porque é o
 * MESMO agregado (GET /api/relatorios/produtos) exibido nas duas telas.
 *
 * As quantidades do agregado saem da API em quilos, com cada lançamento
 * convertido pela unidade dele; lançamento em unidade diferente de KG cujo
 * produto não tem peso médio cadastrado NÃO é convertível, e a API prefere
 * deixá-lo de fora a inventar um fator (ver `itens_sem_conversao` em
 * api/src/routes/relatorios.ts). Quando isso acontece as cinco métricas ainda
 * saem — mas compra média e venda média saem PARA CIMA, porque o valor desses
 * lançamentos continua no numerador e o peso deles não entra no denominador.
 * Esta é a tela onde o dono decide preço de venda: exibir markup incompleto
 * como número limpo seria a pior das opções.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 lançamento' : `${n} lançamentos`
  const verbo = n === 1 ? 'ficou' : 'ficaram'
  return `${itens} deste produto em unidade diferente de KG, sem peso médio cadastrado, ${verbo} `
    + 'fora das quantidades — sem o peso da embalagem não há como somar em quilos. '
    + 'As métricas desta linha estão calculadas sobre quantidade incompleta.'
}

/** Um número que pode estar incompleto: com `n` = 0 sai limpo (o caso normal);
 * com `n` > 0 ganha o `*` e a explicação no `title`. Mesmo sinal das outras
 * duas telas afetadas (EntradasLista, RelatoriosTela). */
function NumIncompleto({ texto, n }: { texto: string; n: number }) {
  if (!n) return <>{texto}</>
  return (
    <span className="produtos-incompleto" title={avisoSemConversao(n)}>{texto}*</span>
  )
}

interface ProdutosListaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). O CADASTRO não some
   * com ele: um produto não deixa de existir porque não foi comprado nem
   * vendido em julho. O que respeita o recorte são as cinco métricas
   * derivadas (compra média, venda média, markup, margem, perda), que vêm do
   * agregado em SQL — produto sem movimento no período aparece na lista com
   * travessão em todas elas, que é a resposta certa.
   */
  periodo?: Periodo
  onSessaoExpirada: () => void
}

/**
 * Lista + cadastro de produtos. Diferente de ClientesLista (onde a
 * orquestração de lista/ficha/modal vive em App.tsx), aqui não há tela de
 * ficha — a tela cuida do próprio modal (criar/editar/excluir) e refaz o
 * fetch depois de salvar, incrementando `versao`.
 */
export function ProdutosLista({ periodo = PERIODO_TODOS, onSessaoExpirada }: ProdutosListaProps) {
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

  // Refeito a cada troca de período: o agregado já sai filtrado do servidor
  // (?de=&ate=), mesma rota e mesmo recorte que RelatoriosTela e o Dashboard
  // usam — as três telas mostram o mesmo número para o mesmo mês.
  useEffect(() => {
    let cancelado = false
    setErroMetricas('')
    api.get<ProdutoAgregado[]>(`/api/relatorios/produtos${queryDePeriodo(periodo)}`)
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
  }, [periodo, onSessaoExpirada])

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
  const { linhas: linhasRelatorio, totais } = derivarRelatorioProdutos(agregados, produtos.length)
  const linhaPorProduto = new Map(linhasRelatorio.map(l => [l.produtoId, l]))
  const agregadoPorProduto = new Map(agregados.map(a => [a.produto_id, a]))

  return (
    <div className="produtos-lista">
      <div className="produtos-topo">
        <div className="produtos-dica">
          {/* Antes dizia "por unidade do produto (KG, CX…)": as quantidades do
              agregado somavam caixa com quilo, então o preço médio não era por
              nada em particular. Agora a API converte cada lançamento pelo peso
              médio da embalagem e as cinco métricas são por QUILO, para
              qualquer produto — o que também as torna comparáveis entre si. */}
          Clique num produto para editar · preços são <strong>por quilo</strong> (caixas convertidas pelo
          peso médio do produto), calculados das compras e vendas de{' '}
          <strong>{rotuloPeriodo(periodo)}</strong> · o cadastro aparece inteiro, independente do período
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
          // Lançamento não convertível (unidade ≠ KG sem peso médio) deixa as
          // CINCO métricas desta linha calculadas sobre quantidade incompleta,
          // não só uma — marcar apenas parte delas sugeriria que o resto está
          // fechado. Ver `itensSemConversao` em derive/relatorios.ts.
          const inc = linha?.itensSemConversao ?? 0
          return (
            <div key={p.id} className="produtos-linha produtos-linha--dados" onClick={() => setModal(p)}>
              <div className="produtos-celula-nome">
                <span className="produtos-dot" style={{ background: NEUTRO }} />
                <span className="produtos-nome">{p.nome}</span>
              </div>
              <div><span className="produtos-un-badge">{p.un}</span></div>
              <div className="produtos-col-num produtos-mono">
                {compraMedia != null ? <NumIncompleto texto={moneyDetalhado(compraMedia)} n={inc} /> : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {vendaMedia != null ? <NumIncompleto texto={moneyDetalhado(vendaMedia)} n={inc} /> : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {linha?.markupPct != null ? <NumIncompleto texto={pctInt(linha.markupPct)} n={inc} /> : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {temVenda ? <NumIncompleto texto={money(linha!.margem)} n={inc} /> : '—'}
              </div>
              <div className="produtos-col-num produtos-mono">
                {linha?.perdaPct != null ? <NumIncompleto texto={pct1(linha.perdaPct)} n={inc} /> : '—'}
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

      {totais.itensSemConversao > 0 && (
        // A nota fala do total da tela, então tem redação própria: o texto de
        // `avisoSemConversao` é "deste produto" (título de célula), e reusá-lo
        // aqui diria "deste produto" sobre a soma de vários.
        <div className="produtos-nota produtos-nota--incompleto" role="note">
          <strong>*</strong> {totais.itensSemConversao === 1 ? '1 lançamento' : `${totais.itensSemConversao} lançamentos`}
          {' '}em unidade diferente de KG, sem peso médio cadastrado no produto,
          {totais.itensSemConversao === 1 ? ' ficou' : ' ficaram'} fora das quantidades — sem o peso da
          embalagem não há como somar em quilos. As métricas marcadas com <strong>*</strong> estão
          calculadas sobre quantidade incompleta. Cadastre o peso médio da embalagem (campo{' '}
          <strong>Peso médio</strong> do produto) para que entrem na conta.
        </div>
      )}

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
