import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarFornecedores, VARIACAO_ALERTA_PCT, VARIACAO_ATENCAO_PCT,
  type Fornecedor, type MetricasFornecedor,
} from '../derive/fornecedores'
import { type Produto } from '../derive/produtos'
import { type EntradaResumo } from '../derive/relatorios'
import { ModalFornecedor } from '../components/ModalFornecedor'
import { intervaloDoPeriodo, rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import { podeVerMetricasDeCadastro, podeExcluirCadastro, type Papel } from '../telas'
import './FornecedoresLista.css'

const GREEN = '#3f8f5b'
const AMBER = '#c79320'
const RED = '#c2502f'
const NEUTRO = '#9a9784'

// ---------------------------------------------------------- formatação

/** Preço médio com 2 casas — mesma convenção de `moneyDetalhado` em
 * RelatoriosTela.tsx e ProdutosLista.tsx (só "preço médio" usa 2 casas).
 * Formatação é responsabilidade da tela, não de derive/. */
const moneyDetalhado = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',')
const pctInt = (n: number) => Math.round(n) + '%'
/** Variação sempre com sinal: "+3,2%" / "-1,8%" — o sinal É a informação
 * (subiu ou caiu), igual ao protótipo (`(v>0?'+':'')+v.toFixed(1)`). */
const pctVariacao = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + '%'

/** 'AAAA-MM-DD' -> 'DD/MM'. Mesmo `_fmtDM` do protótipo e mesmo `dataBr` de
 * SaidasLista.tsx/RelatoriosTela.tsx. */
function dataBr(iso: string | null): string {
  if (!iso || iso.length < 10) return '—'
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA', só para o `title` da última coleta: com o
 * período em "Todo o período" a tela soma a base inteira, e "12/03" sozinho
 * não diz de qual ano é a última coleta de um fornecedor parado há um ano. */
function dataBrCompleta(iso: string | null): string {
  if (!iso || iso.length < 10) return '—'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Semáforo da variação de preço de compra da célula do fornecedor: até 4% é
 * ruído, de 4% a 7% pede atenção, a partir de 7% o produtor mudou de
 * patamar. Vale para os dois lados: cair 9% também é uma mudança de patamar
 * que o comprador precisa notar (safra, qualidade caindo), não uma boa
 * notícia silenciosa.
 *
 * Os dois limiares saem de `derive/fornecedores.ts` e são herdados do
 * protótipo — não são referência de mercado consultada em lugar nenhum. Ver
 * o comentário deles lá antes de tratá-los como cotação.
 */
function corVariacao(pct: number | null): string {
  if (pct == null) return NEUTRO
  const v = Math.abs(pct)
  if (v >= VARIACAO_ALERTA_PCT) return RED
  if (v >= VARIACAO_ATENCAO_PCT) return AMBER
  return GREEN
}

// ------------------------------------------- métrica incompleta (sem peso médio)

/**
 * Texto do aviso de quantidade incompleta — mesma regra e mesmo sinal (`*` +
 * `title` + nota de rodapé) das abas Compras/Produtos/Perdas de Relatórios e
 * de ProdutosLista, porque o problema é o mesmo: `GET /api/entradas` entrega
 * `peso_total` em quilos convertendo cada item pela unidade dele, e item em
 * unidade diferente de KG cujo produto não tem peso médio cadastrado NÃO é
 * convertível — a API deixa o item de fora do peso e conta quantos foram em
 * `itens_sem_conversao`, em vez de inventar um fator (uma caixa não pesa um
 * quilo).
 *
 * Quando isso acontece as métricas ainda saem, mas o preço médio (e a
 * variação, que é feita de preços médios) sai PARA CIMA — o valor em reais do
 * item continua no numerador e o peso dele não entra no denominador — e o
 * aproveitamento fica medido sobre uma carga menor do que a que chegou. É
 * exatamente a tela onde o dono escolhe de quem comprar: exibir isso como
 * número limpo seria a pior das opções.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 item' : `${n} itens`
  const verbo = n === 1 ? 'ficou' : 'ficaram'
  return `${itens} das coletas deste fornecedor em unidade diferente de KG, sem peso médio `
    + `cadastrado no produto, ${verbo} fora do peso — sem o peso da embalagem não há como somar `
    + 'em quilos. Preço médio e variação saem para cima, e o aproveitamento está medido sobre '
    + 'uma carga menor que a real.'
}

/** Um número que pode estar incompleto: com `n` = 0 sai limpo (o caso
 * normal); com `n` > 0 ganha o `*` e a explicação no `title`. Mesmo sinal das
 * outras telas afetadas (EntradasLista, ProdutosLista, RelatoriosTela). */
function NumIncompleto({ texto, n }: { texto: string; n: number }) {
  if (!n) return <>{texto}</>
  return <span className="fornecedores-incompleto" title={avisoSemConversao(n)}>{texto}*</span>
}

/**
 * Por que a variação está em travessão. Um fornecedor com UMA coleta é o caso
 * comum e o mais importante de explicar: variação é a comparação entre a
 * última compra e a anterior, e com uma compra só não existe anterior. Zerar
 * ("0,0%") diria que o preço não mudou — uma medição que ninguém fez.
 */
function motivoSemVariacao(m: MetricasFornecedor): string {
  if (m.coletas === 0) return 'Nenhuma coleta deste fornecedor no período escolhido.'
  if (m.coletas === 1) {
    return 'Variação compara o preço da última coleta com o da anterior — este fornecedor tem '
      + 'só 1 coleta registrada. Aparece a partir da segunda.'
  }
  return 'A coleta anterior não tem preço por quilo para comparar (peso não convertível em kg).'
}

const METRICAS_SEM_ENTRADAS: MetricasFornecedor = {
  coletas: 0, ultimaColeta: null, precoMedio: null, variacaoPct: null,
  aproveitPct: null, itensSemConversao: 0,
}

interface FornecedoresListaProps {
  /**
   * Quem está olhando. O colaborador vê e edita o CADASTRO (nome, região,
   * contato, produtos que entrega) e não vê as quatro métricas — preço médio
   * de compra, variação, aproveitamento e última coleta —, nem o botão de
   * excluir. Quem decide é `podeVerMetricasDeCadastro`/`podeExcluirCadastro`
   * (telas.ts); esta tela só exibe. Sem default: um valor padrão seria
   * fail-open.
   */
  papel: Papel
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). O CADASTRO não some
   * com ele — um fornecedor não deixa de existir porque não houve coleta em
   * julho. O que respeita o recorte são as quatro métricas derivadas (última
   * coleta, preço médio, variação, aproveitamento): fornecedor sem coleta no
   * período fica na lista com travessão nas quatro, e `motivoSemVariacao` já
   * explica cada caso.
   */
  periodo?: Periodo
  onSessaoExpirada: () => void
}

/**
 * Lista + cadastro de fornecedores. `GET /api/fornecedores` não traz os
 * produtos vinculados (só `GET /api/fornecedores/:id` faz esse join — ver
 * api/src/routes/fornecedores.ts) — por isso, depois da lista, buscamos o
 * detalhe de cada fornecedor em paralelo para poder mostrar "produtos que
 * entrega" na tabela sem uma segunda tela.
 */
export function FornecedoresLista(
  { papel, periodo = PERIODO_TODOS, onSessaoExpirada }: FornecedoresListaProps,
) {
  const verMetricas = podeVerMetricasDeCadastro(papel)
  const podeExcluir = podeExcluirCadastro(papel)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [produtosDisponiveis, setProdutosDisponiveis] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)
  // undefined = modal fechado; null = criando; Fornecedor = editando (prefill)
  const [modal, setModal] = useState<Partial<Fornecedor> | null | undefined>(undefined)

  // Coletas (entradas): busca separada da lista de fornecedores, e falha
  // SOZINHA — se GET /api/entradas cair, o cadastro (nome, região, contato,
  // produtos que entrega) continua visível, só com as quatro métricas em
  // travessão e o aviso `role="status"` abaixo. Mesmo padrão de ClientesLista
  // sobre /api/saidas e de ProdutosLista sobre /api/relatorios/produtos.
  //
  // Permissão — e aqui está a parte honesta desta tela. `GET /api/entradas`
  // exige só sessão (Entradas é tela do colaborador, ver o comentário em
  // api/src/routes/entradas.ts), então as quatro métricas daqui NÃO são
  // protegíveis por permissão: quem lança coleta pode somar essas coletas por
  // fora. O dono sabe e aceitou. O que não pode acontecer é esta tela
  // ENTREGAR o agregado pronto — por isso, com `verMetricas` falso, o efeito
  // abaixo nem busca (`return` antes do `api.get`) e os quatro campos não são
  // renderizados. Chamar isto de segurança seria teatro; é apresentação, e
  // está escrito assim em `podeVerMetricasDeCadastro` (telas.ts).
  //
  // A busca traz a base inteira e o recorte é aplicado em memória por
  // `derivarFornecedores` (que já recebia de/ate por parâmetro): trocar o
  // período no cabeçalho não dispara uma ida ao servidor.
  const [entradas, setEntradas] = useState<EntradaResumo[]>([])
  const [erroEntradas, setErroEntradas] = useState('')

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

  useEffect(() => {
    if (!verMetricas) return
    let cancelado = false
    api.get<EntradaResumo[]>('/api/entradas')
      .then(es => { if (!cancelado) setEntradas(es) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroEntradas(
          'Não foi possível carregar as coletas (entradas) — preço médio, variação, '
          + 'última coleta e aproveitamento ficam indisponíveis.',
        )
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao, verMetricas])

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
            podeExcluir={podeExcluir}
            papel={papel}
            onSalvo={aoSalvar}
            onExcluido={aoExcluir}
            onFechar={() => setModal(undefined)}
            onSessaoExpirada={onSessaoExpirada}
          />
        )}
      </>
    )
  }

  // Reusa derivarRelatorioCompras por dentro (ver derive/fornecedores.ts): o
  // preço médio e o aproveitamento aqui são os MESMOS números da aba Compras
  // de Relatórios, não uma segunda conta com o mesmo nome.
  // O período global vira o intervalo De/Até que `derivarFornecedores` (e
  // `derivarRelatorioCompras` por dentro dela) já entendia — um mês civil é o
  // intervalo fechado [mês, mês]. Os fornecedores entram INTEIROS: quem não
  // teve coleta no período continua na lista, só sem métricas.
  const { de, ate } = intervaloDoPeriodo(periodo)
  const { porFornecedor, resumo } = derivarFornecedores(fornecedores, entradas, de, ate)

  return (
    <div className="fornecedores-lista">
      <div className="fornecedores-topo">
        <div className="fornecedores-dica">
          {/* Sem as métricas na tela, a explicação de onde elas vêm falaria de
              números que não estão ali. Sobra a parte que continua verdadeira. */}
          {verMetricas
            ? (
              <>
                Clique num fornecedor para editar · preço, variação e aproveitamento vêm das{' '}
                <strong>coletas lançadas em Entradas</strong> em{' '}
                <strong>{rotuloPeriodo(periodo)}</strong> · o cadastro aparece inteiro, independente do
                período
              </>
            )
            : 'Clique num fornecedor para editar'}
        </div>
        <button type="button" className="fornecedores-botao-novo" onClick={() => setModal(null)}>
          ＋ Novo fornecedor
        </button>
      </div>

      {erroEntradas && (
        <p className="fornecedores-aviso-metricas" role="status">{erroEntradas}</p>
      )}

      <div className="fornecedores-grade">
        {fornecedores.map(f => {
          const m = porFornecedor.get(f.id) ?? METRICAS_SEM_ENTRADAS
          // Com as entradas indisponíveis não há o que explicar por métrica —
          // o aviso `role="status"` no topo já diz o que houve, e um `title`
          // dizendo "nenhuma coleta registrada" seria falso.
          const tituloVariacao = erroEntradas ? undefined : motivoSemVariacao(m)
          return (
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

              {verMetricas && (
              <div className="fornecedores-metricas">
                <div>
                  <div className="fornecedores-metrica-label">Preço médio</div>
                  {/* Fornecedor sem coleta no período não tem preço médio:
                      travessão, nunca "R$ 0,00" — que fingiria um preço
                      medido e mais barato que o de todo mundo. */}
                  <div className="fornecedores-metrica-valor">
                    {m.precoMedio == null
                      ? '—'
                      : <NumIncompleto texto={moneyDetalhado(m.precoMedio)} n={m.itensSemConversao} />}
                  </div>
                </div>
                <div>
                  <div className="fornecedores-metrica-label">Variação</div>
                  <div
                    className="fornecedores-metrica-valor"
                    style={{ color: corVariacao(m.variacaoPct) }}
                  >
                    {m.variacaoPct == null
                      ? <span title={tituloVariacao}>—</span>
                      : <NumIncompleto texto={pctVariacao(m.variacaoPct)} n={m.itensSemConversao} />}
                  </div>
                </div>
                <div>
                  <div className="fornecedores-metrica-label">Última coleta</div>
                  <div className="fornecedores-metrica-valor">
                    {m.ultimaColeta == null
                      ? '—'
                      : (
                        <span title={dataBrCompleta(m.ultimaColeta)}>
                          {dataBr(m.ultimaColeta)}
                        </span>
                      )}
                  </div>
                </div>
                <div>
                  <div className="fornecedores-metrica-label">Aproveit.</div>
                  {/* Aproveitamento é a métrica de QUALIDADE: quanto da carga
                      chega vendável. Sem ela o preço médio sozinho leva à
                      decisão errada — comprar a R$ 2,00 com 20% de perda sai
                      mais caro que a R$ 2,30 com 3%. 100% aqui é medido (quem
                      comprou e não perdeu nada); quem não comprou fica em
                      travessão, não em 100%. */}
                  <div className="fornecedores-metrica-valor">
                    {m.aproveitPct == null
                      ? '—'
                      : <NumIncompleto texto={pctInt(m.aproveitPct)} n={m.itensSemConversao} />}
                  </div>
                </div>
              </div>
              )}
            </div>
          )
        })}
      </div>

      {verMetricas && resumo.itensSemConversao > 0 && (
        // Redação própria (não o `title` da célula, que fala "deste
        // fornecedor"): a nota fala do total da tela.
        <div className="fornecedores-nota fornecedores-nota--incompleto" role="note">
          <strong>*</strong> {resumo.itensSemConversao === 1 ? '1 item' : `${resumo.itensSemConversao} itens`}
          {' '}de coleta em unidade diferente de KG, sem peso médio cadastrado no produto,
          {resumo.itensSemConversao === 1 ? ' ficou' : ' ficaram'} fora do peso — sem o peso da
          embalagem não há como somar em quilos. As métricas marcadas com <strong>*</strong> estão
          calculadas sobre carga incompleta. Cadastre o peso médio da embalagem (campo{' '}
          <strong>Peso médio</strong> do produto) para que entrem na conta.
        </div>
      )}

      {modal !== undefined && (
        <ModalFornecedor
          fornecedor={modal}
          produtosDisponiveis={produtosDisponiveis}
          podeExcluir={podeExcluir}
          papel={papel}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
