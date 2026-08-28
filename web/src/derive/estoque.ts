import { dataBrCurta } from './pagamento'

// Padrão de derive/fornecedores.ts e derive/clientes.ts: função pura, sem
// React, sem fetch, sem `new Date()` — a tela só exibe o que sai daqui.
//
// A conta pesada do estoque (quanto entrou, quanto saiu, quanto sobrou) mora
// em SQL, no endpoint agregado — ver o comentário grande de
// api/src/routes/estoque.ts. O que mora aqui é a parte que NÃO é somatório:
// decidir qual das três datas que a API devolve é "a última movimentação", e
// dar a ela um rótulo que não confunda perda com saída.

/**
 * Os três tipos de movimentação que a tela reconhece — os mesmos três da
 * conta do saldo (entradas − perdas − saídas), nem um a mais.
 *
 * PERDA É MOVIMENTAÇÃO, e é uma decisão: o dono falou em "entrada ou saída",
 * mas perda também tira mercadoria do depósito, também tem data própria, e
 * saber que o item perdeu 12 kg ontem muda a mesma decisão que saber que ele
 * vendeu 12 kg ontem. Fora do rastreamento, um item que só perde ficaria
 * eternamente "sem movimentação" enquanto o saldo derretia.
 *
 * O preço de incluir é que ela precisa ficar VISÍVEL como perda: o rótulo é
 * sempre impresso junto da data (`textoMovimentacao`), nunca só a data. Uma
 * perda exibida com cara de saída seria pior do que não exibi-la — a tela
 * diria que a mercadoria foi vendida.
 */
export const TIPOS_MOVIMENTACAO = ['entrada', 'saida', 'perda'] as const
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number]

/** Rótulo visível de cada tipo. Os três são distintos de propósito — ver
 * `TIPOS_MOVIMENTACAO` para por que "perda" não pode virar "saída". */
export const ROTULO_MOVIMENTACAO: Record<TipoMovimentacao, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  perda: 'Perda',
}

/**
 * Ordem de desempate quando duas fontes têm a MESMA data — e elas têm com
 * frequência: no hortifrúti a mercadoria comprada de madrugada no CEASA sai
 * para entrega no mesmo dia, então entrada e saída dividem a data o tempo
 * todo. As colunas do banco são `date` (sem hora), então não existe resposta
 * medida para "qual foi a última"; o que não pode acontecer é a tela alternar
 * entre dois rótulos a cada carregamento.
 *
 * A ordem escolhida vai do fim do fluxo para o começo — saída, depois perda,
 * depois entrada —, que é a sequência típica do dia: a mercadoria chega, uma
 * parte estraga, o resto sai. Empatadas na data, a saída é a mais provável de
 * ter sido a última coisa que aconteceu com aquele item.
 */
const PRECEDENCIA_NO_EMPATE: TipoMovimentacao[] = ['saida', 'perda', 'entrada']

/** As três datas cruas de GET /api/estoque — cada uma o `max()` da sua fonte,
 * em ISO 'AAAA-MM-DD', ou `null` quando aquela fonte nunca movimentou a
 * linha. Ver api/src/routes/estoque.ts para de que coluna sai cada uma (a da
 * saída é `entrega`, não `data_pedido`). */
export interface DatasMovimentacao {
  ultima_entrada: string | null
  ultima_saida: string | null
  ultima_perda: string | null
}

export interface UltimaMovimentacao {
  tipo: TipoMovimentacao
  /** ISO 'AAAA-MM-DD', como veio da API — é o que preserva o ANO, que
   * `texto` (formato curto) não mostra. A tela usa nos atributos que
   * precisam da data inteira. */
  data: string
  /** 'Entrada' | 'Saída' | 'Perda' */
  rotulo: string
  /** O que a célula imprime: 'Saída · 12/08'. */
  texto: string
}

/**
 * 'AAAA-MM-DD' -> 'DD/MM', via `dataBrCurta` (derive/pagamento.ts). NÃO é um
 * segundo formatador de data: é a mesma função, reusada pelo mesmo motivo que
 * `notaUltimoPreco` (derive/memoriaPreco.ts) a reusa. O projeto tem um
 * formatador curto só, e ele fica lá.
 *
 * Data que não casa com o formato volta crua em vez de virar `null`: a
 * movimentação ACONTECEU, e engolir a linha por causa de um formato
 * inesperado esconderia um evento real. O travessão é reservado para "não
 * houve movimentação", que é outra coisa.
 */
function curta(iso: string): string {
  return dataBrCurta(iso) ?? iso
}

/** 'Saída · 12/08' — rótulo SEMPRE junto da data. Ver `TIPOS_MOVIMENTACAO`:
 * é isto que impede uma perda de se passar por saída no meio da tabela. */
export function textoMovimentacao(tipo: TipoMovimentacao, dataIso: string): string {
  return `${ROTULO_MOVIMENTACAO[tipo]} · ${curta(dataIso)}`
}

/**
 * A última movimentação de uma linha da tabela: a mais recente entre as três
 * datas, com o tipo dela junto.
 *
 * `null` quando NENHUMA das três existe — e a tela imprime travessão. Isso é
 * alcançável de verdade: uma linha cuja única movimentação é uma saída ainda
 * sem data de entrega registrada entra na tabela (a quantidade é descontada
 * do saldo) sem produzir data nenhuma. Travessão nunca vira zero, nem a data
 * de hoje, nem '01/01/1970' — dizer "mexeu hoje" de um item parado desde maio
 * é exatamente o erro que este rastreamento existe para não cometer.
 *
 * Comparação lexicográfica sobre 'AAAA-MM-DD', que nesse formato é a mesma
 * ordem da cronológica — sem `Date`, sem fuso, igual a `situacaoExibidaSaida`
 * (derive/pagamento.ts).
 *
 * O empate resolve por `PRECEDENCIA_NO_EMPATE`: os candidatos são varridos
 * nessa ordem e a troca exige data ESTRITAMENTE maior, então o primeiro da
 * precedência sobrevive ao empate. Sem isso, a linha alternaria entre
 * "Entrada · 12/08" e "Saída · 12/08" conforme a ordem em que os campos
 * fossem lidos — a mesma classe de defeito que f8e2954 corrigiu no
 * desempate das coletas de um fornecedor.
 *
 * NÃO recebe período: estoque é posição acumulada e não segue o filtro global
 * (commit eae52e0, e a nota que a própria tela imprime). "A última vez que
 * mexeu em julho" não é a pergunta — um item parado desde maio apareceria
 * como nunca movimentado num julho qualquer.
 */
export function ultimaMovimentacao(datas: DatasMovimentacao): UltimaMovimentacao | null {
  const porTipo: Record<TipoMovimentacao, string | null> = {
    entrada: datas.ultima_entrada,
    saida: datas.ultima_saida,
    perda: datas.ultima_perda,
  }

  let melhor: { tipo: TipoMovimentacao; data: string } | null = null
  for (const tipo of PRECEDENCIA_NO_EMPATE) {
    const data = porTipo[tipo]
    if (!data) continue
    if (!melhor || data > melhor.data) melhor = { tipo, data }
  }
  if (!melhor) return null

  return {
    tipo: melhor.tipo,
    data: melhor.data,
    rotulo: ROTULO_MOVIMENTACAO[melhor.tipo],
    texto: textoMovimentacao(melhor.tipo, melhor.data),
  }
}

/** Uma linha do histórico, como chega de GET /api/estoque/movimentacoes. */
export interface MovimentacaoEstoque {
  produto_id: string
  un: string
  tipo: TipoMovimentacao
  /** ISO 'AAAA-MM-DD'. Movimentação sem data não vem — ver a query. */
  data: string
  /** A quantidade COMO FOI LANÇADA, na unidade `un` desta movimentação. Uma
   * movimentação é UM lançamento, com uma unidade só: aqui não há soma
   * nenhuma e portanto não há mistura de unidades possível. É o número que o
   * histórico imprime. */
  qtd: number
  /** A mesma quantidade em quilos — leitura secundária. `null` quando o
   * lançamento não é convertível (unidade ≠ KG sem `peso_medio` cadastrado):
   * é um dos `itens_sem_conversao` da linha. Null significa "não há leitura
   * em quilos desta movimentação", nunca "não houve movimentação" — a
   * quantidade continua em `qtd`. */
  qtd_kg: number | null
  /** Número da entrada/saída, ou o motivo da perda. */
  referencia: string
  /** Quantas movimentações a linha tem NO TOTAL — pode ser maior que
   * quantas vieram (a API devolve as mais recentes até um teto), para a tela
   * dizer "12 de 47" em vez de truncar calada. */
  total: number
}

/** Chave de uma linha da tabela: (produto, unidade lançada). É a mesma chave
 * do agregado (`group by produto_id, un` em buscarEstoque) e a mesma que a
 * tabela já usa como `key` do React — um produto lançado em CX e em KG são
 * duas linhas, e portanto dois históricos. */
export function chaveEstoque(produtoId: string, un: string): string {
  return `${produtoId}|${un}`
}

/**
 * Indexa o histórico plano da API por linha da tabela, para a tela achar o
 * histórico de um item expandido sem varrer o array inteiro a cada render.
 *
 * A ORDEM DENTRO DE CADA GRUPO É PRESERVADA, nunca reordenada aqui. Não é
 * economia: a API já devolve ordenado (data desc, criado_em desc, id desc) e
 * TRUNCA nas N mais recentes segundo essa ordem. Reordenar do lado de cá
 * poderia produzir uma lista que discorda do próprio corte — mostrando como
 * "as mais recentes" um conjunto escolhido por outro critério. O desempate
 * estável vive junto do corte, no `row_number()` da query.
 */
export function agruparMovimentacoes(
  movimentacoes: MovimentacaoEstoque[],
): Map<string, MovimentacaoEstoque[]> {
  const porChave = new Map<string, MovimentacaoEstoque[]>()
  movimentacoes.forEach(m => {
    const chave = chaveEstoque(m.produto_id, m.un)
    const atuais = porChave.get(chave)
    if (atuais) atuais.push(m)
    else porChave.set(chave, [m])
  })
  return porChave
}

// ============================================ posição num dia passado (corte)

/**
 * O nome do parâmetro na URL das duas buscas — `api/src/routes/estoque.ts`
 * lê exatamente este. NÃO é `de`/`ate`: aquele par é o INTERVALO de meses do
 * filtro de período global (derive/periodo.ts, relatórios), e esta tela
 * continua fora dele. Aqui é um PONTO no tempo, e o nome tem de deixar isso
 * claro para quem lê a URL — ver `posicaoEstoque` logo abaixo.
 */
export const PARAM_POSICAO = 'posicao_em'

const DATA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** O que a tela precisa saber sobre a data escolhida — ver `posicaoEstoque`. */
export interface PosicaoEstoque {
  /** ISO 'AAAA-MM-DD' do corte, ou `null` quando é hoje. `null` significa
   * literalmente SEM CORTE: a busca sai sem parâmetro nenhum, e a API
   * responde exatamente o que respondia antes desta funcionalidade existir. */
  corte: string | null
  /** `true` só quando se está olhando um dia PASSADO. A tela usa isto para
   * mudar de cara — um estoque histórico com a mesma aparência do atual é um
   * convite a decidir com o número errado. */
  historica: boolean
  /** O sufixo das DUAS buscas (`/api/estoque` e `/api/estoque/movimentacoes`):
   * `''` ou `'?posicao_em=AAAA-MM-DD'`. As duas recebem o mesmo corte, senão
   * o histórico contradiria o saldo logo acima dele, na mesma tela. */
  query: string
  /** Rótulo curto: `'hoje'` ou `'15/08'` (via `dataBrCurta`, o formatador
   * único do projeto). O ano fica no `corte`, que a tela imprime no `title` —
   * mesma divisão de `UltimaMovimentacao` (`texto` curto, `data` inteira). */
  texto: string
  /** A frase de alerta a exibir quando não se está olhando hoje; `''` em
   * hoje. */
  aviso: string
}

/**
 * A data escolhida no controle "Posição em", normalizada no que a tela e a
 * API precisam.
 *
 * ---- é CORTE, não intervalo ----
 *
 * "Posição em 15/08" é tudo que aconteceu DESDE SEMPRE ATÉ 15/08, não o que
 * aconteceu DENTRO de agosto. A diferença é a funcionalidade inteira: um
 * recorte por mês daria saldo negativo em todo mês de venda forte e ignoraria
 * o que sobrou do mês anterior. Por isso não existe `de` aqui — só o `até`.
 * O filtro de período global (`Periodo`, derive/periodo.ts) continua sem se
 * aplicar a esta tela; são perguntas diferentes, e a nota da tela diz as duas.
 *
 * ---- hoje é SEM CORTE, de propósito ----
 *
 * Escolher hoje (ou abrir a tela, que começa em hoje) devolve `corte: null` e
 * `query: ''` — a busca sai sem parâmetro e a API responde o mesmo de sempre.
 * Isso garante a única invariante que sustenta a tela: a posição em hoje é
 * IDÊNTICA à posição atual. Se hoje virasse um corte como outro qualquer, a
 * mesma data poderia dar dois números conforme o usuário tivesse escolhido
 * hoje ou apenas aberto a tela.
 *
 * ---- data futura ----
 *
 * Amanhã não pode inventar nada: nada aconteceu ainda. O controle da tela já
 * é limitado a hoje (`max`), mas `max` de `<input type="date">` não impede o
 * usuário de digitar — então aqui qualquer data POSTERIOR a hoje cai em
 * `null`, ou seja, vira a posição atual. A tela nunca pede ao servidor uma
 * posição no futuro, por nenhum caminho.
 *
 * Data fora do formato também cai em `null` (a posição atual) em vez de virar
 * um corte quebrado: quando não dá para saber que dia é, a resposta segura é
 * "agora", nunca uma data inventada. Vale para `hojeIso` também — se ele não
 * for uma data ISO, nada pode ser declarado "passado" com segurança.
 *
 * `hojeIso` é parâmetro (não `new Date()` interno) para a função continuar
 * pura e testável sem mockar relógio — mesmo padrão de `situacaoExibidaSaida`
 * (derive/pagamento.ts) e `opcoesDePeriodo` (derive/periodo.ts).
 */
export function posicaoEstoque(
  escolhida: string | null | undefined,
  hojeIso: string,
): PosicaoEstoque {
  const valor = String(escolhida ?? '')
  const ehPassado = DATA_ISO_RE.test(valor) && DATA_ISO_RE.test(hojeIso) && valor < hojeIso
  if (!ehPassado) {
    return { corte: null, historica: false, query: '', texto: 'hoje', aviso: '' }
  }
  const texto = curta(valor)
  return {
    corte: valor,
    historica: true,
    query: `?${PARAM_POSICAO}=${valor}`,
    texto,
    aviso: `Você está vendo o depósito como ele estava no fim de ${texto} — `
      + 'não é o estoque de agora.',
  }
}

/**
 * O que a tela diz sobre as saídas SEM data de entrega quando se está olhando
 * uma data passada — `itens_saida_sem_data`, que vem em cada linha de
 * GET /api/estoque.
 *
 * A saída sem `entrega` desconta do saldo (decisão de 4bee3f0: só
 * Cancelado/Devolvido saem da conta) mas não tem data, então não dá para
 * dizer se ela já tinha saído em 15/08. A API escolheu INCLUÍ-LA em qualquer
 * corte — ver o raciocínio completo em api/src/routes/estoque.ts —, e o preço
 * dessa escolha é que ela aparece até numa data anterior ao pedido existir.
 * Isso pode surpreender, e número que muda sem explicação destrói a confiança
 * na tela inteira; por isso a tela imprime esta frase em vez de deixar a
 * diferença sem resposta.
 *
 * `''` quando não há nenhuma (o caso comum) — a tela não mostra aviso de
 * coisa que não aconteceu.
 */
export function avisoSaidasSemData(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const um = n === 1
  const quantas = um ? '1 saída' : `${n} saídas`
  return `${quantas} sem data de entrega ${um ? 'está descontada' : 'estão descontadas'} `
    + `${um ? 'desta' : 'destas'} posição. Sem a data não dá para saber se `
    + `${um ? 'ela já tinha' : 'elas já tinham'} saído do depósito na data escolhida, então `
    + `${um ? 'ela conta' : 'elas contam'} em todas — inclusive nas anteriores ao pedido. `
    + 'Preencha a entrega na tela de Saídas para a posição histórica ficar exata.'
}

// =================================== o que o saldo diz, e o que ele alerta

/**
 * As situações em que o saldo de uma linha pode estar. Elas NÃO são graus da
 * mesma coisa: três delas imprimem zero (ou menos) e significam coisas
 * diferentes para quem decide a compra do dia.
 *
 *   `positivo`           tem mercadoria. Nada a sinalizar.
 *
 *   `acabou`             teve entrada e saiu tudo: zero POR CONSUMO. É o
 *                        alerta que o dono quer — este produto ele estoca, e
 *                        agora não tem. A ação é comprar.
 *
 *   `nunca_comprado`     produto cadastrado sem nenhuma movimentação. Também
 *                        está zerado, mas não "acabou": nunca entrou no
 *                        depósito. Não é reposição atrasada, é um item do
 *                        catálogo que ninguém comprou ainda — e tratá-lo como
 *                        alerta encheria a tela de vermelho justamente onde
 *                        não há nada de novo acontecendo.
 *
 *   `negativo`           saiu mais do que entrou. Isso NÃO é falta de
 *                        mercadoria: é DADO INCONSISTENTE, quase sempre uma
 *                        entrada que não foi lançada. A ação é corrigir o
 *                        lançamento, não comprar — por isso não pode receber
 *                        o mesmo tratamento do zero, e precisa de um mais
 *                        forte: um saldo zero atrapalha uma compra, um saldo
 *                        negativo põe em dúvida a tabela inteira.
 *
 *   `sem_conta_fechada`  a linha carrega perda gravada em quilos que não cabe
 *                        na unidade dela (`perda_fora_da_unidade` > 0), então
 *                        o saldo exibido não é a conta inteira. Não recebe
 *                        destaque: a marca `‡` já conserta a leitura, e um
 *                        alarme sobre um número incompleto POR CONSTRUÇÃO
 *                        seria arbitrário — é a mesma decisão que já valia
 *                        para a cor do saldo antes desta classificação
 *                        existir, agora escrita num lugar só.
 */
export const SITUACOES_SALDO = [
  'positivo', 'acabou', 'nunca_comprado', 'negativo', 'sem_conta_fechada',
] as const
export type SituacaoSaldo = (typeof SITUACOES_SALDO)[number]

/** O que `situacaoSaldo` precisa de uma linha de GET /api/estoque — só isto,
 * para a função continuar pura e testável sem montar a linha inteira. */
export interface LinhaClassificavel {
  /** O saldo NA UNIDADE LANÇADA, como a API publica. */
  saldo: number
  /** `true` quando a linha nasceu de movimentação; `false` quando nasceu do
   * cadastro (produto que nunca se moveu). Vem da API — ver a CTE `chaves`
   * em api/src/routes/estoque.ts. Não é dedutível dos números: entrou 0 /
   * saiu 0 também descreve uma entrada de quantidade zero. */
  movimentada: boolean
  /** Quilos de perda que não cabem na unidade desta linha. > 0 significa que
   * o saldo exibido não é a conta inteira. */
  perda_fora_da_unidade?: number
}

/**
 * Em que situação está o saldo de uma linha.
 *
 * A ORDEM DAS PERGUNTAS É A DECISÃO. Ela vai da menos para a mais
 * interpretável:
 *
 *   1. A conta fecha? Se a linha deixa quilos de perda de fora, nenhuma
 *      afirmação sobre "falta" ou "sobra" se sustenta — sai antes de tudo.
 *   2. É negativo? Vence qualquer outra leitura, inclusive a de cadastro:
 *      saldo negativo é o único caso em que a tela está dizendo algo
 *      impossível sobre o depósito, e esconder isso atrás de outro rótulo
 *      seria pior do que qualquer alarme.
 *   3. Nunca se moveu? Então o zero é de catálogo, não de consumo.
 *   4. É zero? Então acabou — sobrou a única leitura possível.
 *
 * Trocar 3 por 4 dá o mesmo resultado hoje (linha de cadastro tem saldo 0 por
 * construção), mas a ordem escrita é a que continua certa se um dia a API
 * publicar uma linha de cadastro com saldo diferente de zero.
 */
export function situacaoSaldo(linha: LinhaClassificavel): SituacaoSaldo {
  if ((linha.perda_fora_da_unidade ?? 0) > 0) return 'sem_conta_fechada'
  if (linha.saldo < 0) return 'negativo'
  if (!linha.movimentada) return 'nunca_comprado'
  if (linha.saldo === 0) return 'acabou'
  return 'positivo'
}

/**
 * O selo escrito ao lado do número — `''` quando não há nenhum.
 *
 * ELE EXISTE PORQUE COR SOZINHA NÃO COMUNICA. Quem não distingue vermelho
 * precisa perceber a mesma coisa, e o selo é texto de verdade: aparece na
 * tela, no leitor de tela e numa impressão em preto e branco. A cor é o
 * atalho para quem enxerga; o selo é a informação.
 *
 * E ele é o que separa os dois zeros. "Acabou" e "Nunca comprado" imprimem o
 * MESMO número — zero —, então nenhuma diferença de cor os distinguiria de
 * verdade: só a palavra faz isso.
 */
export const SELO_SITUACAO: Record<SituacaoSaldo, string> = {
  positivo: '',
  acabou: 'Acabou',
  nunca_comprado: 'Nunca comprado',
  negativo: 'Conferir lançamento',
  sem_conta_fechada: '',
}

/** A explicação de cada situação — vai no `title` do número e do selo, e é o
 * que transforma um rótulo de três palavras na frase inteira. `''` onde não
 * há o que explicar. */
export const AVISO_SITUACAO: Record<SituacaoSaldo, string> = {
  positivo: '',
  acabou: 'Este produto teve entrada e saiu tudo: o saldo é zero. Não é erro de '
    + 'lançamento — é mercadoria que acabou, e é hora de comprar.',
  nunca_comprado: 'Produto cadastrado que nunca foi movimentado: nenhuma entrada, nenhuma '
    + 'saída, nenhuma perda. O saldo é zero e é medido — ele não acabou, nunca foi comprado.',
  negativo: 'Saiu mais do que entrou. Isso não é falta de mercadoria: é lançamento faltando, '
    + 'quase sempre uma entrada que não foi registrada. Confira as Entradas e as Saídas deste '
    + 'produto — o caminho aqui é corrigir o lançamento, não comprar.',
  sem_conta_fechada: '',
}

/** Os números do cartão do topo — ver `resumoEstoque`. */
export interface ResumoEstoque {
  /** Quantas linhas a tabela tem. É o que o cartão CONTA quando diz "linhas
   * listadas", e desde que a lista passou a trazer todo produto cadastrado
   * ele não é mais "itens movimentados". */
  linhas: number
  /** Linhas com saldo maior que zero — o número grande do cartão. */
  comEstoque: number
  acabou: number
  nuncaComprado: number
  negativo: number
  /** `acabou` + `nuncaComprado`: o que está zerado e SE SABE que está. A
   * linha sem conta fechada fica de fora dos dois — o saldo dela não é uma
   * afirmação sobre ter ou não ter. */
  semEstoque: number
}

/**
 * Conta as linhas por situação, para o cartão do topo.
 *
 * Existe porque o rótulo do cartão PRECISA bater com o que ele conta. Ele
 * dizia "N itens movimentados" quando a lista era só de itens movimentados; a
 * lista passou a trazer todo produto cadastrado e a frase virou mentira, sem
 * que nenhum número mudasse. Contar aqui, uma vez, é o que impede o texto e o
 * número de divergirem de novo.
 */
export function resumoEstoque(linhas: readonly LinhaClassificavel[]): ResumoEstoque {
  let comEstoque = 0, acabou = 0, nuncaComprado = 0, negativo = 0
  for (const l of linhas) {
    if (l.saldo > 0) comEstoque += 1
    const s = situacaoSaldo(l)
    if (s === 'acabou') acabou += 1
    else if (s === 'nunca_comprado') nuncaComprado += 1
    else if (s === 'negativo') negativo += 1
  }
  return {
    linhas: linhas.length,
    comEstoque,
    acabou,
    nuncaComprado,
    negativo,
    semEstoque: acabou + nuncaComprado,
  }
}

/**
 * A legenda sob o número do cartão. Diz o denominador (quantas linhas a
 * tabela tem) e, quando existem, as duas coisas que o dono abre esta tela
 * para ver: quantas estão zeradas e quantas estão negativas.
 *
 * "linha(s) listada(s)" e não "itens movimentados": a lista traz todo produto
 * cadastrado, e um produto lançado em duas unidades ocupa duas linhas. Linha é
 * o que a tabela tem e o que este número conta — dizer "produtos" seria a
 * mesma classe de erro que a frase antiga cometia.
 *
 * `ate`: o rótulo curto da posição histórica ('15/08'), ou `null`/omitido em
 * hoje. Fica aqui, e não concatenado na tela, para a frase inteira ter um
 * dono só.
 */
export function textoResumoEstoque(r: ResumoEstoque, ate?: string | null): string {
  const partes = [`${r.linhas} linha(s) listada(s)${ate ? ` até ${ate}` : ''}`]
  if (r.semEstoque > 0) partes.push(`${r.semEstoque} sem estoque`)
  if (r.negativo > 0) partes.push(`${r.negativo} com saldo negativo`)
  return partes.join(' · ')
}
