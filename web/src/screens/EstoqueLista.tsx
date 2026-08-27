import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  ultimaMovimentacao,
  textoMovimentacao,
  agruparMovimentacoes,
  chaveEstoque,
  posicaoEstoque,
  avisoSaidasSemData,
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
  /** Itens de saída desta linha que descontam do saldo SEM ter data de
   * entrega. Eles contam em qualquer data escolhida — ver
   * `avisoSaidasSemData` (derive/estoque.ts) e o comentário da API. */
  itens_saida_sem_data: number
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

/**
 * A coluna SAIU numa posição HISTÓRICA, quando parte do que saiu não tem data
 * de entrega. Marca de rodapé `†` — deliberadamente DIFERENTE do `*` de
 * `NumIncompleto`, que significa outra coisa (quantidade que ficou de fora por
 * falta de peso médio). Dois problemas distintos com a mesma marca fariam o
 * usuário ler um pelo outro.
 *
 * Só aparece na posição histórica: em hoje essa saída já é o saldo de agora e
 * não há nada de estranho a explicar.
 */
function NumSemData({ texto, n }: { texto: string; n: number }) {
  if (!n) return <>{texto}</>
  return <span className="estoque-sem-data" title={avisoSaidasSemData(n)}>{texto}†</span>
}

/** O que a coluna ÚLTIMA MOVIMENTAÇÃO diz quando não há nenhuma — o
 * travessão precisa dizer o que significa, senão vira "a tela está
 * quebrada". O caso é real: uma linha cuja única movimentação é uma saída
 * ainda sem data de entrega tem quantidade descontada e data nenhuma. */
const AVISO_SEM_MOVIMENTACAO =
  'Nenhuma movimentação com data registrada. Saídas ainda sem data de entrega preenchida '
  + 'contam na quantidade, mas não dizem quando a mercadoria saiu.'

/** AAAA-MM-DD de hoje, no fuso local — mesmo padrão de `hojeIsoLocal()` em
 * Shell.tsx e SaldoCaixa.tsx. Fica no componente porque toca `new Date()`;
 * `posicaoEstoque` continua pura recebendo a data como argumento. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

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
 * ESTA É A TELA QUE NÃO SEGUE O PERÍODO GLOBAL (achado S-3), e continua sendo
 * de propósito. Estoque é uma POSIÇÃO — o que existe no depósito num
 * instante —, não um fluxo do mês: "o estoque de junho" não é a soma das
 * movimentações de junho (isso daria saldo negativo em todo mês que se vende
 * mais do que se compra, e ignoraria o que sobrou de maio). Pelo mesmo motivo
 * o saldo em caixa também é sempre acumulado — ver derive/caixa.ts.
 *
 * ---- data própria: "posição em" ----
 *
 * O que faltava era a pergunta certa: não "o movimento de junho", e sim
 * QUANTO HAVIA NO DEPÓSITO NUM DIA. Essa é a data própria desta tela, e ela
 * é um CORTE, não um intervalo: soma tudo que aconteceu DESDE SEMPRE ATÉ a
 * data escolhida, inclusive ela. Sem `de`, porque não existe início — o
 * depósito não começa em junho. O recorte roda no mesmo endpoint agregado
 * (`?posicao_em=`, ver api/src/routes/estoque.ts): as CTEs que já existiam
 * ganharam um `where`, sem tabela nova e sem migration.
 *
 * PADRÃO É HOJE, E HOJE É SEM CORTE. Abrir a tela mostra a posição atual, com
 * a mesma requisição de sempre (`posicaoEstoque` devolve `query: ''`). Isso
 * garante a invariante que sustenta a tela: a posição em hoje é idêntica à
 * posição atual, por construção e não por coincidência.
 *
 * SAIR E VOLTAR À TELA VOLTA PARA HOJE. A data é estado local deste
 * componente (`useState`), e a troca de tela desmonta o componente — então
 * voltar já reinicia em hoje, e nada é gravado em sessão/localStorage de
 * propósito. O critério é o dano de cada erro: quem perdeu a data escolhida
 * clica de novo e perde cinco segundos; quem volta à tela achando ver o
 * estoque de agora e está vendo o de 15/08 compra errado. Só um dos dois erros
 * custa mercadoria, e é o que esta decisão impede.
 *
 * DATA FUTURA NÃO EXISTE. O seletor é limitado a hoje (`max`), porque escolher
 * amanhã não pode inventar nada — nada aconteceu ainda. Como `max` de
 * `<input type="date">` não impede digitação, `posicaoEstoque` normaliza
 * qualquer data posterior a hoje para a posição atual: a tela nunca pede ao
 * servidor uma posição no futuro, por nenhum caminho.
 *
 * QUANDO NÃO É HOJE, A TELA MUDA DE CARA. Um aviso `role="status"`, um botão
 * "Voltar para hoje" e a tabela marcada — um estoque histórico com a mesma
 * aparência do atual é um convite a decidir com o número errado.
 *
 * O RASTREAMENTO SEGUE O MESMO CORTE: a última movimentação e o histórico de
 * cada item respeitam a data escolhida, senão o histórico contradiria o saldo
 * logo acima dele, na mesma tela. O que eles continuam não seguindo é o
 * PERÍODO global — recortada por julho, "a última vez que este item mexeu"
 * responderia "a última vez que mexeu em julho", e um item parado desde maio
 * apareceria como nunca movimentado.
 *
 * PRODUTO QUE AINDA NÃO EXISTIA NA DATA não aparece na lista — não vira "0 kg
 * em estoque". Zero seria uma medição, e ninguém mediu um produto que não
 * tinha sido comprado. Isso vem da própria API (a linha não nasce), pela mesma
 * regra que já valia para produto sem nenhuma movimentação.
 *
 * A lista de perdas do depósito, embutida abaixo, NÃO recebe o corte: ela é o
 * cadastro/CRUD das perdas (registrar, editar, excluir), não uma leitura da
 * posição — esconder as perdas mais recentes da lista de trabalho por causa
 * de uma consulta histórica tiraria da tela o que o usuário precisa editar.
 * A nota da tabela diz isso.
 */
export function EstoqueLista({ onSessaoExpirada }: EstoqueListaProps) {
  // Hoje é lido UMA vez por montagem: a data escolhida é comparada com ele o
  // tempo todo, e um `new Date()` a cada render faria a tela mudar de estado
  // sozinha na virada da meia-noite, no meio de uma leitura.
  const hoje = useMemo(() => hojeIsoLocal(), [])
  // Começa em hoje — e desmontar a tela (trocar de tela no menu) devolve
  // exatamente este valor. Ver "sair e voltar à tela volta para hoje" acima.
  const [dataEscolhida, setDataEscolhida] = useState(hoje)
  const posicao = posicaoEstoque(dataEscolhida, hoje)

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

  /**
   * Trocar a data escolhida — pelo seletor ou pelo botão "Voltar para hoje".
   *
   * A limpeza mora AQUI, no evento que causou a mudança, e não dentro do
   * efeito: o histórico já buscado é o do corte ANTERIOR e a tabela na tela é
   * a da data anterior. Sem isto, a linha expandida mostraria movimentações
   * posteriores à data escolhida, contradizendo o saldo logo acima dela.
   *
   * O `return` antecipado é o que impede a tela de travar em "Carregando…":
   * datas diferentes podem dar o MESMO corte (hoje e qualquer data futura dão
   * `query: ''`), e aí não há busca nova para desligar o carregando.
   */
  function escolherData(valor: string) {
    setDataEscolhida(valor)
    if (posicaoEstoque(valor, hoje).query === posicao.query) return
    setCarregando(true)
    setErro('')
    historicoPedido.current = false
    setMovimentacoes(null)
    setErroHistorico('')
    setExpandido(null)
  }

  // Depende de `posicao.query` (uma string, estável entre renders com a mesma
  // data), não do objeto `posicao`, que é recriado a cada render e dispararia
  // a busca em loop.
  useEffect(() => {
    let cancelado = false
    api.get<LinhaEstoque[]>(`/api/estoque${posicao.query}`)
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
  }, [onSessaoExpirada, posicao.query])

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
    // O MESMO corte da listagem: as duas buscas têm de concordar sobre o que
    // já tinha acontecido na data escolhida.
    api.get<MovimentacaoEstoque[]>(`/api/estoque/movimentacoes${posicao.query}`)
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
  // Só interessa quando se está olhando para trás: em hoje, a saída sem data
  // de entrega não tem nada de estranho — ela já é o saldo de agora.
  const totalSaidasSemData = posicao.historica
    ? linhas.reduce((s, l) => s + (l.itens_saida_sem_data || 0), 0)
    : 0
  const historicoPorChave = movimentacoes ? agruparMovimentacoes(movimentacoes) : null

  return (
    <div className="estoque-modulo">
      <section
        className={
          posicao.historica ? 'estoque-saldo-secao estoque-saldo-secao--historica' : 'estoque-saldo-secao'
        }
      >
        {/* FORA dos estados de carregando/erro/vazio, de propósito: se a busca
            de uma data passada falhar ou vier vazia, o usuário precisa
            continuar podendo voltar para hoje sem recarregar a página. */}
        <div className="estoque-posicao">
          <label className="estoque-posicao-rotulo" htmlFor="estoque-posicao-em">Posição em</label>
          <input
            id="estoque-posicao-em"
            className="estoque-posicao-data"
            type="date"
            value={dataEscolhida}
            // Amanhã não pode inventar nada: nada aconteceu ainda. `max` é a
            // primeira barreira; `posicaoEstoque` normaliza o que passar por
            // ela (digitação) para a posição atual.
            max={hoje}
            onChange={e => escolherData(e.target.value)}
          />
          {posicao.historica && (
            <button
              type="button"
              className="estoque-posicao-hoje"
              onClick={() => escolherData(hoje)}
            >
              Voltar para hoje
            </button>
          )}
        </div>

        {/* role="status": é um aviso sobre o que está sendo exibido, não um
            erro. Fica junto do controle e antes da tabela, para não haver
            como ler os números sem ter passado por ele. O `title` carrega a
            data por extenso — o rótulo curto não mostra o ano. */}
        {posicao.historica && (
          <p
            className="estoque-posicao-aviso"
            role="status"
            title={`Posição do depósito em ${posicao.corte}`}
          >
            <strong>Posição histórica:</strong> {posicao.aviso}
          </p>
        )}

        {carregando && <p className="estoque-estado">Carregando…</p>}

        {!carregando && erro && (
          <p className="estoque-estado estoque-estado--erro" role="alert">{erro}</p>
        )}

        {/* Duas mensagens diferentes para o mesmo "lista vazia": em hoje, o
            depósito nunca recebeu nada e o caminho é lançar uma entrada; numa
            data passada, ele podia estar vazio naquele dia e continuar cheio
            hoje — sugerir "lance uma entrada" ali seria conselho errado. */}
        {!carregando && !erro && linhas.length === 0 && (
          posicao.historica ? (
            <div className="estado-vazio estoque-vazio">
              <div className="estoque-vazio-titulo">Nada em estoque em {posicao.texto}</div>
              <div className="estoque-vazio-sub">
                Nenhuma movimentação registrada até essa data. Produto comprado depois dela ainda
                não existia no depósito — por isso fica <strong>fora da lista</strong>, e não com
                saldo zero.
              </div>
            </div>
          ) : (
            <div className="estado-vazio estoque-vazio">
              <div className="estoque-vazio-titulo">Nada em estoque ainda</div>
              <div className="estoque-vazio-sub">
                O estoque se preenche sozinho: lance uma <strong>Entrada (compra)</strong> e a
                quantidade aparece aqui.
              </div>
            </div>
          )
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
                <div className="estoque-stat-label">
                  ITENS COM ESTOQUE{posicao.historica ? ` EM ${posicao.texto}` : ''}
                </div>
                <div className="estoque-stat-valor">{comEstoque}</div>
                <div className="estoque-stat-sub">
                  {linhas.length} item(ns) movimentados
                  {posicao.historica ? ` até ${posicao.texto}` : ''}
                </div>
              </div>
            </div>

            <div className={posicao.historica ? 'estoque-tabela estoque-tabela--historica' : 'estoque-tabela'}>
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
                        <NumSemData
                          texto={fmtQtd(l.saiu)}
                          n={posicao.historica ? (l.itens_saida_sem_data || 0) : 0}
                        />
                        {inc > 0 && (
                          <span className="estoque-incompleto" title={avisoSemConversao(inc)}>*</span>
                        )}
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
                viu o estoque não mudar concluiria que o filtro está quebrado.
                Ela passou a ter uma segunda metade: a tela continua fora do
                filtro global, mas ganhou data própria, e a nota antiga (só
                "não segue o filtro") ficaria incompleta a ponto de enganar. */}
            <div className="estoque-legenda" role="note" aria-label="Escopo do estoque">
              Esta tela mostra a <strong style={{ color: TEXTO }}>posição acumulada</strong> do
              depósito e <strong style={{ color: TEXTO }}>não segue o filtro de período</strong> do
              cabeçalho — aquele é um <em>intervalo</em> (o movimento de um mês), e aqui a pergunta é
              outra: quanto havia no depósito num dia. Para isso a tela tem{' '}
              <strong style={{ color: TEXTO }}>data própria</strong>, o “Posição em” lá em cima: um{' '}
              <strong style={{ color: TEXTO }}>corte</strong> que soma tudo que aconteceu{' '}
              <strong style={{ color: TEXTO }}>até</strong> a data escolhida, nunca só o que
              aconteceu dentro dela — o que sobrou de um mês continua no estoque no mês seguinte. A{' '}
              <strong style={{ color: TEXTO }}>última movimentação</strong> e o histórico de cada item
              seguem o mesmo corte, e continuam fora do filtro de período: recortados por um mês, um
              item parado desde maio apareceria como nunca movimentado. Item sem nenhuma movimentação
              até a data escolhida <strong style={{ color: TEXTO }}>não aparece na lista</strong> —
              ele ainda não tinha sido comprado, e isso não é saldo zero. O registro de perdas do
              depósito, abaixo, continua mostrando tudo: ele é a lista de trabalho, não a posição.
              Para o movimento de um período, veja Entradas, Saídas ou Relatórios ▸ Perdas.
            </div>

            {/* Só quando há o que explicar: em hoje a saída sem data de
                entrega já é o saldo de agora e não surpreende ninguém. Numa
                data passada ela aparece antes de existir, e um número que muda
                sem explicação destrói a confiança na tela inteira. */}
            {totalSaidasSemData > 0 && (
              <div
                className="estoque-legenda estoque-legenda--incompleto"
                role="note"
                aria-label="Saídas sem data de entrega"
              >
                {avisoSaidasSemData(totalSaidasSemData)}
              </div>
            )}

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
