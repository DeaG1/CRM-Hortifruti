import { useEffect, useRef, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  ultimaMovimentacao,
  textoMovimentacao,
  agruparMovimentacoes,
  chaveEstoque,
  type MovimentacaoEstoque,
} from '../derive/estoque'
import { PerdasLista } from './PerdasLista'
import './EstoqueLista.css'

/** Leitura secundária em embalagens (as mesmas quantidades divididas pelo
 * `peso_medio`), quando `un` não é KG e o produto tem peso médio cadastrado.
 * O número principal é o kg — é a única unidade em que a conta fecha, porque
 * duas das parcelas da perda nascem em quilos por contrato. Ver o comentário
 * de `paraJson` em api/src/routes/estoque.ts. */
interface EquivalenteUn {
  entrou: number
  perda: number
  saiu: number
  saldo: number
}

/** Espelha o corpo de GET /api/estoque (api/src/routes/estoque.ts).
 * `entrou`/`perda`/`saiu`/`saldo` vêm todos EM KG. */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  entrou: number
  perda: number
  saiu: number
  saldo: number
  peso_medio: number
  equivalente_un: EquivalenteUn | null
  /** Lançamentos desta linha que ficaram fora das quantidades por não serem
   * convertíveis em quilos (unidade ≠ KG sem `peso_medio` cadastrado). */
  itens_sem_conversao: number
  /** Data da movimentação mais recente de cada fonte, ISO 'AAAA-MM-DD' ou
   * `null`. Vêm do MESMO agregado das quantidades (um `max()` nas CTEs que
   * já existiam), então nunca ficam indisponíveis sem a tabela toda ficar —
   * é o histórico expansível que é buscado à parte. Qual das três é "a
   * última" é decidido por `ultimaMovimentacao` (derive/estoque.ts). */
  ultima_entrada: string | null
  ultima_saida: string | null
  ultima_perda: string | null
}

const TEXTO = '#2a2a24'
const SUAVE = '#6a685c'
const VERMELHO = '#c2502f'

/** Quantidade com no máximo uma casa decimal. A conversão produz fração dos
 * dois lados: em kg, quando o rateio da perda de coleta divide um total
 * entre os itens da entrada; em embalagens, quando um saldo em kg carrega
 * uma perda que nasceu em quilos (149 kg / 15 = 9,9 CX). */
const fmtQtd = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** Saldo negativo é o alerta que importa nesta tela — vermelho. Zero fica
 * neutro (produto zerado não é risco, só não tem estoque agora). Positivo
 * usa o texto padrão. Portado de `saldoColor` em logica-estoque.txt.
 *
 * `incompleta`: linha com lançamento não convertível não recebe a cor de
 * alerta. O vermelho é um julgamento ("está faltando mercadoria"), e o saldo
 * de uma linha incompleta é negativo por construção — as quantidades ficaram
 * de fora e só as perdas em kg entraram. Marcar com `*` conserta a leitura;
 * pintar de vermelho criaria um alarme falso que o `*` não desfaz. */
function corSaldo(saldo: number, incompleta: boolean): string {
  if (incompleta) return SUAVE
  if (saldo < 0) return VERMELHO
  if (saldo === 0) return SUAVE
  return TEXTO
}

// ------------------------------------- quantidade incompleta (sem peso médio)

/**
 * Texto do aviso — mesma regra e mesma marca das outras telas afetadas
 * (RelatoriosTela.tsx, ProdutosLista.tsx, EntradasLista.tsx), com a
 * consequência desta: aqui o número que fica incompleto é o SALDO, o que o
 * funcionário abre a tela para ver.
 *
 * As quantidades saem da API em quilos, cada lançamento convertido pela
 * unidade dele; lançamento em unidade diferente de KG cujo produto não tem
 * peso médio cadastrado NÃO é convertível, e a API prefere deixá-lo de fora
 * a inventar um fator (ver `itens_sem_conversao` em
 * api/src/routes/estoque.ts). Como a linha é (produto, unidade lançada), o
 * fator é o mesmo para a linha inteira: ou tudo converte, ou nada converte e
 * sobram só as perdas que já eram kg por contrato — por isso a marca vai nas
 * quatro colunas, nunca em uma só.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 lançamento' : `${n} lançamentos`
  const verbo = n === 1 ? 'ficou' : 'ficaram'
  return `${itens} desta linha em unidade diferente de KG, sem peso médio cadastrado no `
    + `produto, ${verbo} fora das quantidades — sem o peso da embalagem não há como somar `
    + 'em quilos. O saldo desta linha está incompleto.'
}

/** O mesmo aviso, no singular de UMA movimentação do histórico: ali não há
 * quantidade nenhuma a exibir (nem zero, que fingiria uma medição), só a
 * marca e a explicação. */
const AVISO_MOVIMENTACAO_SEM_CONVERSAO =
  'Este lançamento foi feito em unidade diferente de KG, e o produto não tem peso médio '
  + 'cadastrado — sem o peso da embalagem não há como dizer quantos quilos se moveram. '
  + 'É um dos lançamentos que ficaram fora das quantidades desta linha.'

/** Um número que pode estar incompleto: com `n` = 0 sai limpo (o caso
 * normal); com `n` > 0 ganha o `*` e a explicação no `title`. */
function NumIncompleto({ texto, n }: { texto: string; n: number }) {
  if (!n) return <>{texto}</>
  return <span className="estoque-incompleto" title={avisoSemConversao(n)}>{texto}*</span>
}

/** O que a coluna ÚLTIMA MOVIMENTAÇÃO diz quando não há nenhuma — o
 * travessão precisa dizer o que significa, senão vira "a tela está
 * quebrada". O caso é real: uma linha cuja única movimentação é uma saída
 * ainda sem data de entrega tem quantidade descontada e data nenhuma. */
const AVISO_SEM_MOVIMENTACAO =
  'Nenhuma movimentação com data registrada. Saídas ainda sem data de entrega preenchida '
  + 'contam na quantidade, mas não dizem quando a mercadoria saiu.'

interface EstoqueListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

/**
 * Estoque não guarda dado próprio — é uma conta (entradas − perdas − saídas),
 * calculada em SQL num endpoint agregado (GET /api/estoque) porque soma todo
 * o histórico de itens já movimentados, não só a dúzia de registros que as
 * outras telas desta fase carregam. Este componente só busca e exibe o
 * resultado já pronto.
 *
 * A seção de perdas do depósito (registro/CRUD) reaproveita PerdasLista, que
 * já existia como paliativo nesta tela — trocado aqui pelo saldo de verdade,
 * mas o registro de perdas continua funcionando, agora como a segunda metade
 * da tela de Estoque (mesmo layout do protótipo, tela-estoque.html).
 *
 * ---- rastreamento de movimentação ----
 *
 * A tela dizia QUANTO tem de cada item e não QUANDO aquilo mexeu. Duas
 * respostas foram acrescentadas, e elas têm origens diferentes de propósito:
 *
 *   1. ÚLTIMA MOVIMENTAÇÃO, na própria linha. Vem junto de GET /api/estoque:
 *      são três `max()` dentro das CTEs que já somavam entrada, saída e
 *      perda — nenhuma consulta a mais, nenhum endpoint a mais. Como chega
 *      com os saldos, nunca fica indisponível sem a tabela inteira ficar.
 *   2. HISTÓRICO por item, ao expandir a linha. Esse sim é uma segunda
 *      busca, GET /api/estoque/movimentacoes, disparada na PRIMEIRA expansão
 *      e reusada por todas as seguintes — a resposta traz o histórico de
 *      TODAS as linhas de uma vez. Ver `buscarMovimentacoesEstoque` na API
 *      para o custo: uma consulta por item expandido multiplicaria invocações
 *      do Worker e transações no banco numa tela com dezenas de produtos.
 *
 * A linha expansível segue FuncionariosLista.tsx (commit 7c18cab): a linha
 * inteira é o botão que abre/fecha, com `aria-expanded`, seta ▸/▾ e o
 * detalhe logo abaixo, dentro do mesmo bloco.
 *
 * ISOLAÇÃO DE FALHA: o histórico cai sozinho. Se a segunda busca falhar, a
 * tabela continua inteira — saldos, quantidades e a última movimentação de
 * cada linha —, e um aviso `role="status"` diz o que faltou. Mesmo padrão de
 * ClientesLista.tsx, onde a queda de /api/saidas não leva o cadastro junto.
 *
 * ESTA É A TELA QUE NÃO SEGUE O PERÍODO GLOBAL (achado S-3), e é de
 * propósito. Estoque é uma POSIÇÃO acumulada — o que existe no depósito
 * agora —, não um fluxo do mês: "o estoque de junho" não é a soma das
 * movimentações de junho (isso daria saldo negativo em todo mês que se vende
 * mais do que se compra, e ignoraria o que sobrou de maio). Seria "o saldo
 * ATÉ o fim de junho", uma pergunta diferente de "quanto vendi em junho" que
 * todas as outras telas respondem, e que exigiria um recorte "até" no
 * endpoint agregado (GET /api/estoque não tem, e nem deveria ganhar um por
 * causa do cabeçalho). O RASTREAMENTO SEGUE A MESMA REGRA, pela mesma razão:
 * "a última vez que este item mexeu" é uma posição no tempo, não um fluxo —
 * recortada por julho ela responderia "a última vez que mexeu em julho", e um
 * item parado desde maio apareceria como nunca movimentado. Pelo mesmo motivo
 * o saldo em caixa também é sempre acumulado — ver derive/caixa.ts. A nota
 * abaixo da tabela diz isso ao usuário, para o número não parecer estar
 * ignorando o filtro por defeito.
 *
 * A lista de perdas do depósito, embutida abaixo, acompanha essa decisão: é
 * ela que produz a coluna PERDAS do saldo, e filtrar uma sem a outra faria a
 * tabela não fechar com a lista logo abaixo dela, na mesma tela.
 */
export function EstoqueLista({ onSessaoExpirada }: EstoqueListaProps) {
  const [linhas, setLinhas] = useState<LinhaEstoque[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  // `null` = ainda não buscado (ou a busca falhou). `[]` = buscou e não há
  // nenhuma. São coisas diferentes: a primeira vira "carregando/indisponível",
  // a segunda vira "nenhuma movimentação", que é uma afirmação medida.
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoEstoque[] | null>(null)
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [erroHistorico, setErroHistorico] = useState('')

  // A busca do histórico acontece UMA vez por montagem, na primeira expansão.
  // O ref (não estado) porque o guarda precisa valer já na mesma chamada que
  // dispara a busca — um estado só estaria atualizado no render seguinte, e
  // dois cliques rápidos em linhas diferentes disparariam duas buscas.
  const historicoPedido = useRef(false)
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  useEffect(() => {
    let cancelado = false
    api.get<LinhaEstoque[]>('/api/estoque')
      .then(ls => { if (!cancelado) setLinhas(ls) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar o estoque.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  /**
   * Abre/fecha uma linha e, na primeira vez, busca o histórico de TODAS as
   * linhas de uma vez só. Expandir o segundo, o terceiro e o décimo item não
   * custa requisição nenhuma — o custo é O(1) na quantidade de itens
   * expandidos, e zero para quem só abre a tela para ver os saldos.
   */
  function alternar(chave: string) {
    setExpandido(atual => (atual === chave ? null : chave))
    if (historicoPedido.current) return
    historicoPedido.current = true
    setCarregandoHistorico(true)
    api.get<MovimentacaoEstoque[]>('/api/estoque/movimentacoes')
      .then(ms => { if (montado.current) setMovimentacoes(ms) })
      .catch((err: unknown) => {
        if (!montado.current) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        // O histórico cai SOZINHO: os saldos e a última movimentação de cada
        // linha continuam na tela, porque vêm do outro endpoint.
        setErroHistorico('Não foi possível carregar o histórico de movimentação. Os saldos continuam corretos.')
      })
      .finally(() => { if (montado.current) setCarregandoHistorico(false) })
  }

  const comEstoque = linhas.filter(l => l.saldo > 0).length
  const totalSemConversao = linhas.reduce((s, l) => s + (l.itens_sem_conversao || 0), 0)
  const historicoPorChave = movimentacoes ? agruparMovimentacoes(movimentacoes) : null

  return (
    <div className="estoque-modulo">
      <section className="estoque-saldo-secao">
        {carregando && <p className="estoque-estado">Carregando…</p>}

        {!carregando && erro && (
          <p className="estoque-estado estoque-estado--erro" role="alert">{erro}</p>
        )}

        {!carregando && !erro && linhas.length === 0 && (
          <div className="estado-vazio estoque-vazio">
            <div className="estoque-vazio-titulo">Nada em estoque ainda</div>
            <div className="estoque-vazio-sub">
              O estoque se preenche sozinho: lance uma <strong>Entrada (compra)</strong> e a
              quantidade aparece aqui.
            </div>
          </div>
        )}

        {!carregando && !erro && linhas.length > 0 && (
          <>
            {/* role="status", não "alert": a tela não quebrou, só uma parte
                dela não carregou. Mesmo tratamento de ClientesLista. */}
            {erroHistorico && (
              <p className="estoque-aviso-historico" role="status">{erroHistorico}</p>
            )}

            <div className="estoque-stats">
              <div className="estoque-stat">
                <div className="estoque-stat-label">ITENS COM ESTOQUE</div>
                <div className="estoque-stat-valor">{comEstoque}</div>
                <div className="estoque-stat-sub">{linhas.length} item(ns) movimentados</div>
              </div>
            </div>

            <div className="estoque-tabela">
              <div className="estoque-linha estoque-linha--cabecalho">
                <div>PRODUTO</div>
                <div>LANÇADO EM</div>
                <div>ÚLTIMA MOVIMENTAÇÃO</div>
                <div className="estoque-col-num">ENTROU (KG)</div>
                <div className="estoque-col-num">PERDAS (KG)</div>
                <div className="estoque-col-num">SAIU (KG)</div>
                <div className="estoque-col-num">EM ESTOQUE (KG)</div>
              </div>

              {linhas.map(l => {
                // Linha com lançamento não convertível tem as QUATRO
                // quantidades erradas na mesma medida — todas saem das mesmas
                // embalagens. Marcar só uma sugeriria que as outras fecham.
                const inc = l.itens_sem_conversao || 0
                const chave = chaveEstoque(l.produto_id, l.un)
                const aberto = expandido === chave
                const ultima = ultimaMovimentacao(l)
                const historico = historicoPorChave?.get(chave) ?? []
                return (
                  <div key={chave} className={aberto ? 'estoque-item estoque-item--aberto' : 'estoque-item'}>
                    {/* Botão de verdade (não div com onClick): a linha agora
                        tem estado — aria-expanded — e precisa ser alcançável
                        pelo teclado. Mesmo padrão de FuncionariosLista. */}
                    <button
                      type="button"
                      className="estoque-linha estoque-linha--dados"
                      aria-expanded={aberto}
                      onClick={() => alternar(chave)}
                    >
                      <div className="estoque-nome">
                        <span className="estoque-seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                        {l.nome}
                      </div>
                      <div><span className="estoque-un-badge">{l.un}</span></div>
                      <div className="estoque-ultima">
                        {ultima ? (
                          <span
                            className={`estoque-mov estoque-mov--${ultima.tipo}`}
                            title={`Última movimentação: ${ultima.rotulo} em ${ultima.data}`}
                          >
                            {ultima.texto}
                          </span>
                        ) : (
                          // Travessão, nunca a data de hoje nem uma data falsa.
                          <span className="estoque-sem-mov" title={AVISO_SEM_MOVIMENTACAO}>—</span>
                        )}
                      </div>
                      <div className="estoque-col-num estoque-mono">
                        <NumIncompleto texto={fmtQtd(l.entrou)} n={inc} />
                      </div>
                      <div className="estoque-col-num estoque-mono estoque-perda">
                        <NumIncompleto texto={fmtQtd(l.perda)} n={inc} />
                      </div>
                      <div className="estoque-col-num estoque-mono">
                        <NumIncompleto texto={fmtQtd(l.saiu)} n={inc} />
                      </div>
                      <div className="estoque-col-num estoque-mono estoque-saldo">
                        <span className="estoque-saldo-valor" style={{ color: corSaldo(l.saldo, inc > 0) }}>
                          <NumIncompleto texto={fmtQtd(l.saldo)} n={inc} />
                        </span>
                        {l.equivalente_un && (
                          <div className="estoque-saldo-kg">≈ {fmtQtd(l.equivalente_un.saldo)} {l.un}</div>
                        )}
                      </div>
                    </button>

                    {aberto && (
                      <div className="estoque-detalhe">
                        <div className="estoque-historico-titulo">
                          HISTÓRICO — {tituloHistorico(
                            carregandoHistorico, erroHistorico, movimentacoes, historico,
                          )}
                        </div>

                        {carregandoHistorico ? (
                          <div className="estoque-historico-vazio">Carregando…</div>
                        ) : erroHistorico || movimentacoes === null ? (
                          <div className="estoque-historico-vazio">
                            As movimentações não puderam ser carregadas. Recarregue a página para ver o
                            histórico — os saldos acima não dependem dele.
                          </div>
                        ) : historico.length === 0 ? (
                          <div className="estoque-historico-vazio">{AVISO_SEM_MOVIMENTACAO}</div>
                        ) : (
                          historico.map((m, i) => (
                            <div
                              // Duas movimentações do mesmo tipo, dia e
                              // referência são possíveis (dois itens da mesma
                              // saída); o índice é o único identificador
                              // estável dentro de uma lista que nunca é
                              // reordenada no cliente.
                              key={`${m.tipo}|${m.data}|${m.referencia}|${i}`}
                              className="estoque-movimentacao"
                            >
                              <span
                                className={`estoque-mov estoque-mov--${m.tipo}`}
                                title={`Data completa: ${m.data}`}
                              >
                                {textoMovimentacao(m.tipo, m.data)}
                              </span>
                              <span className="estoque-movimentacao-ref">{m.referencia || '—'}</span>
                              <span className="estoque-col-num estoque-mono">
                                {m.qtd_kg === null ? (
                                  <span
                                    className="estoque-incompleto"
                                    title={AVISO_MOVIMENTACAO_SEM_CONVERSAO}
                                  >—*</span>
                                ) : (
                                  `${fmtQtd(m.qtd_kg)} kg`
                                )}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="estoque-legenda">
              Estoque = <strong style={{ color: TEXTO }}>entradas − perdas − saídas</strong>, sempre
              em <strong style={{ color: TEXTO }}>quilos</strong> (caixas convertidas pelo peso médio
              do produto). <strong style={{ color: TEXTO }}>LANÇADO EM</strong> é a unidade em que a
              movimentação foi registrada — cada uma tem sua própria linha.
            </div>

            <div className="estoque-legenda">
              <strong style={{ color: TEXTO }}>ÚLTIMA MOVIMENTAÇÃO</strong> é a mais recente entre
              entrada, saída e perda daquele item — a saída conta pela{' '}
              <strong style={{ color: TEXTO }}>data de entrega</strong>, não pela do pedido, e pedido
              cancelado ou devolvido não conta (nunca saiu do depósito).{' '}
              <strong style={{ color: TEXTO }}>Clique na linha</strong> para ver as datas de cada
              entrada, saída e perda daquele item.
            </div>

            {/* Sem esta linha, um usuário que trocou o período no cabeçalho e
                viu o estoque não mudar concluiria que o filtro está quebrado. */}
            <div className="estoque-legenda" role="note" aria-label="Escopo do estoque">
              Esta tela mostra a <strong style={{ color: TEXTO }}>posição acumulada</strong> do
              depósito e <strong style={{ color: TEXTO }}>não segue o filtro de período</strong> do
              cabeçalho: o que sobrou de um mês continua no estoque no mês seguinte. A{' '}
              <strong style={{ color: TEXTO }}>última movimentação</strong> e o histórico de cada item
              também são absolutos — recortados por um mês, um item parado desde maio apareceria como
              nunca movimentado. Para o movimento de um período, veja Entradas, Saídas ou
              Relatórios ▸ Perdas.
            </div>

            {totalSemConversao > 0 && (
              <div
                className="estoque-legenda estoque-legenda--incompleto"
                role="note"
                aria-label="Quantidade incompleta"
              >
                <strong>*</strong> {avisoSemConversao(totalSemConversao)} Cadastre o peso médio da
                embalagem em Produtos para que entrem na conta.
              </div>
            )}
          </>
        )}
      </section>

      <section className="estoque-perdas-secao">
        <PerdasLista onSessaoExpirada={onSessaoExpirada} />
      </section>
    </div>
  )
}

/**
 * O sufixo do título do histórico. Diz sempre O QUE ESTÁ SENDO MOSTRADO, e
 * quando a API truncou (ela devolve só as mais recentes, até um teto) diz
 * "N de M" em vez de deixar o usuário achar que o item mexeu N vezes na vida.
 *
 * Fora do componente por ser só decisão de texto — nada de React aqui.
 */
function tituloHistorico(
  carregando: boolean,
  erro: string,
  movimentacoes: MovimentacaoEstoque[] | null,
  historico: MovimentacaoEstoque[],
): string {
  if (carregando) return 'carregando…'
  if (erro || movimentacoes === null) return 'indisponível'
  if (historico.length === 0) return 'nenhuma movimentação com data'
  const total = historico[0].total
  if (total > historico.length) {
    return `${historico.length} de ${total} movimentações — as mais recentes`
  }
  return `${historico.length} movimentação(ões)`
}
