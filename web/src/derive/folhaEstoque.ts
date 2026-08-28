import {
  quantidadeNaUnidade, dataPorExtensoFolha, contagemPorExtenso,
  normalizarCamposFolha, padroesDeCampos,
  type CamposDaFolha, type DefinicaoCampoFolha,
} from './folha'
import {
  situacaoSaldo, SELO_SITUACAO, ultimaMovimentacao, chaveEstoque,
  type SituacaoSaldo, type DatasMovimentacao,
} from './estoque'

/**
 * A FOLHA DE CONTAGEM FÍSICA — a prancheta com que se anda pela câmara fria
 * conferindo o que o sistema diz contra o que existe na prateleira.
 *
 * ============================== A COLUNA EM BRANCO É O MOTIVO DA FOLHA
 *
 * Produto, unidade lançada, saldo do sistema — e uma COLUNA VAZIA para
 * escrever a contagem real. Sem ela a folha não serve ao que motiva
 * imprimi-la: viraria uma segunda cópia do que a tela já mostra, e a pessoa
 * teria de anotar os números no verso ou decorar. Por isso a coluna em branco
 * é fixa, sem caixa para desmarcar (ver `CAMPOS_FIXOS_FOLHA_CONTAGEM`).
 *
 * ==================== ZERADOS: DUAS CAIXAS, PORQUE SÃO DOIS ZEROS DIFERENTES
 *
 * A pergunta "inclui os produtos zerados?" não tem uma resposta só, porque o
 * sistema tem DOIS zeros e eles pedem coisas opostas de quem conta — a mesma
 * distinção que a tela de Estoque já faz com os selos "Acabou" e "Nunca
 * comprado" (`situacaoSaldo`, derive/estoque.ts):
 *
 *   ACABOU — teve entrada e saiu tudo. Sai na folha POR PADRÃO. É exatamente
 *   a linha que quem confere inventário mais precisa ver: "o sistema diz que
 *   não tem" é uma afirmação a verificar, e é a que mais erra. Quando sobra
 *   mercadoria numa prateleira que o sistema zerou, o que faltou foi lançar
 *   uma entrada — e o único jeito de descobrir isso é a folha mandar olhar.
 *   Tirá-la seria esconder justamente a divergência que a contagem procura.
 *
 *   NUNCA COMPRADO — produto de catálogo que nunca entrou no depósito.
 *   DESMARCADO por padrão. Não há prateleira para conferir: ninguém comprou,
 *   nada chegou, e o zero não é uma afirmação sobre o estoque físico, é sobre
 *   o cadastro. Numa base com 21 produtos e 17 nunca comprados, marcá-los
 *   transformaria uma folha de 4 linhas úteis numa de 21, e a maior parte do
 *   papel seria gasta com linhas em que a resposta certa já se sabe. Papel
 *   desperdiçado não é só custo: uma folha longa demais é uma folha que
 *   ninguém termina de conferir.
 *
 * A caixa continua lá para quem quiser — uma varredura anual de catálogo
 * inteiro é um uso legítimo, e é a pessoa que imprime quem sabe qual das duas
 * coisas está fazendo hoje. O que a decisão faz é escolher o PADRÃO certo
 * para a contagem de rotina, que é o que se imprime toda semana.
 *
 * SALDO NEGATIVO E LINHA COM CONTA ABERTA SAEM SEMPRE, sem caixa nenhuma.
 * Negativo é o sistema afirmando algo impossível sobre o depósito ("saiu mais
 * do que entrou"), e é a linha em que a contagem física é a única fonte de
 * verdade — deixá-la de fora por uma escolha de impressão seria esconder o
 * problema de quem está com a caneta na mão.
 *
 * ================================================= A DATA É PARTE DO DADO
 *
 * A tela tem "Posição em" (9fc424c): o saldo pode ser o de hoje ou o de
 * qualquer dia passado. Conferir o estoque FÍSICO DE HOJE contra uma posição
 * de duas semanas atrás e não perceber é o erro que esta folha pode causar, e
 * ele acusaria diferença em tudo que se moveu no meio — mandando corrigir
 * lançamentos que estão certos. Por isso a data sai carimbada por extenso no
 * topo E, quando não é hoje, com um alerta emoldurado dentro da própria folha
 * (`alertaHistorico`), que vai para o papel. Quem anda com a prancheta não
 * tem a tela na frente.
 */

// ============================================ o que sai na folha (escolhível)

export type CampoFolhaContagem =
  | 'acabaram' | 'nuncaComprados'
  | 'ultimaMovimentacao' | 'emKg' | 'observacao'

export type CamposFolhaContagem = CamposDaFolha<CampoFolhaContagem>

export const CAMPOS_FOLHA_CONTAGEM: readonly DefinicaoCampoFolha<CampoFolhaContagem>[] = [
  {
    chave: 'acabaram', rotulo: 'Produtos que acabaram', grupo: 'Linhas', padrao: true,
    ajuda: 'Saldo zero POR CONSUMO (teve entrada e saiu tudo). Marcado por padrão: '
      + '"o sistema diz que não tem" é a afirmação que mais erra, e sobrar mercadoria '
      + 'numa prateleira zerada é entrada que ninguém lançou.',
  },
  {
    chave: 'nuncaComprados', rotulo: 'Produtos nunca comprados', grupo: 'Linhas', padrao: false,
    ajuda: 'Cadastrados que nunca entraram no depósito. Desmarcados por padrão: não há '
      + 'prateleira para conferir, e eles podem ser a maioria das linhas — folha longa '
      + 'demais é folha que ninguém termina.',
  },
  {
    chave: 'ultimaMovimentacao', rotulo: 'Última movimentação', grupo: 'Colunas', padrao: true,
    ajuda: 'Ajuda a julgar a divergência: item parado há dois meses que aparece a menos '
      + 'é outra história de um que saiu ontem.',
  },
  {
    chave: 'emKg', rotulo: 'Equivalente em quilos', grupo: 'Colunas', padrao: false,
    ajuda: 'Leitura secundária, para quem pesa em vez de contar embalagem. Desmarcada '
      + 'por padrão: quem confere conta CAIXA, e a conversão usa peso médio aproximado.',
  },
  {
    chave: 'observacao', rotulo: 'Coluna de observação', grupo: 'Colunas', padrao: false,
    ajuda: 'Espaço em branco a mais para anotar o motivo da diferença ali mesmo '
      + '(“3 caixas na câmara 2”).',
  },
]

/**
 * O que sai SEMPRE. A coluna em branco está aqui e não entre as escolhíveis
 * porque uma folha de contagem sem ela não conta nada — ver o comentário do
 * módulo.
 */
export const CAMPOS_FIXOS_FOLHA_CONTAGEM: readonly string[] = [
  'Produto e a unidade em que ele foi lançado',
  'Saldo do sistema, na unidade lançada',
  'Coluna EM BRANCO para escrever a contagem real (é o motivo da folha)',
  'Saldo negativo e linha com perda fora da unidade (a contagem é a única fonte de verdade neles)',
]

export const CAMPOS_FOLHA_CONTAGEM_PADRAO: CamposFolhaContagem =
  Object.freeze(padroesDeCampos(CAMPOS_FOLHA_CONTAGEM)) as CamposFolhaContagem

export function normalizarCamposContagem(bruto: unknown): CamposFolhaContagem {
  return normalizarCamposFolha(CAMPOS_FOLHA_CONTAGEM, bruto)
}

// ================================================= o que chega da API

/** O que a folha precisa de uma linha de `GET /api/estoque`. Subconjunto de
 * `LinhaEstoque` (screens/EstoqueLista.tsx) — só o que ela lê, para a função
 * continuar testável sem montar a linha inteira. */
export interface LinhaContagemBruta extends DatasMovimentacao {
  produto_id: string
  nome: string
  /** A unidade LANÇADA. A linha é (produto, unidade) e o saldo vem nela. */
  un: string
  saldo: number
  movimentada: boolean
  perda_fora_da_unidade?: number
  em_kg: { saldo: number } | null
}

// ================================================== a folha montada

export interface LinhaFolhaContagem {
  chave: string
  produto: string
  un: string
  /** "45 UN" — o saldo do sistema, na unidade lançada. */
  saldoSistema: string
  situacao: SituacaoSaldo
  /** "Acabou" / "Nunca comprado" / "Conferir lançamento" / `''`. */
  selo: string
  /** "Entrada 24/08", `'—'` quando não há nenhuma, `null` quando o campo está
   * desligado. */
  ultimaMovimentacao: string | null
  /** "≈ 149 kg", `null` quando o campo está desligado ou a conversão não é
   * possível (nem por isso a quantidade da linha deixa de ser exata). */
  emKg: string | null
}

export interface FolhaContagem {
  /** ISO da data da posição (hoje, ou o corte escolhido). */
  data: string
  dataPorExtenso: string | null
  /** `true` quando se está olhando um dia PASSADO. */
  historica: boolean
  /** O alerta que vai para o PAPEL quando a posição não é a de hoje; `''` em
   * hoje. */
  alertaHistorico: string
  linhas: LinhaFolhaContagem[]
  /** Quantas linhas ficaram de fora pela escolha de campos. */
  ocultas: number
  /** A frase que declara o recorte na folha; nunca vazia. */
  resumo: string
  campos: CamposFolhaContagem
}

/** Quantidade com no máximo uma casa — mesmo `fmtQtd` de EstoqueLista. */
function umaCasa(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

/**
 * Decide se uma linha sai na folha.
 *
 * Positivo, negativo e "conta não fechada" saem SEMPRE. Os dois zeros são
 * escolha — e são escolhas separadas, porque significam coisas diferentes.
 * Ver o comentário do módulo.
 */
export function saiNaFolha(situacao: SituacaoSaldo, campos: CamposFolhaContagem): boolean {
  if (situacao === 'acabou') return campos.acabaram
  if (situacao === 'nunca_comprado') return campos.nuncaComprados
  return true
}

/**
 * Monta a folha de contagem.
 *
 * `dataIso` é a data da POSIÇÃO (o "Posição em" da tela) e `hojeIso` é hoje —
 * as duas entram por parâmetro para a função continuar pura, sem `new Date()`,
 * exatamente como `posicaoEstoque` faz.
 *
 * A ORDEM É A DA TELA. A API já devolve as linhas ordenadas, e reordenar aqui
 * faria a folha discordar do monitor de onde ela foi impressa — quem confere
 * costuma ter os dois à vista, e duas ordens diferentes viram desconfiança na
 * folha.
 */
export function montarFolhaContagem(
  linhasBrutas: readonly LinhaContagemBruta[],
  campos: CamposFolhaContagem,
  dataIso: string,
  hojeIso: string,
): FolhaContagem {
  const brutas = Array.isArray(linhasBrutas) ? linhasBrutas : []
  const historica = ehPassado(dataIso, hojeIso)
  const porExtenso = dataPorExtensoFolha(dataIso)

  const linhas: LinhaFolhaContagem[] = []
  let ocultas = 0

  for (const l of brutas) {
    const situacao = situacaoSaldo(l)
    if (!saiNaFolha(situacao, campos)) { ocultas += 1; continue }
    const ultima = ultimaMovimentacao(l)
    linhas.push({
      chave: chaveEstoque(l.produto_id, l.un),
      produto: (l.nome ?? '').trim() || '—',
      un: l.un,
      // NA UNIDADE LANÇADA, exata. Quem confere conta CAIXA, não quilo
      // convertido — a decisão de 88318ee, aplicada ao papel.
      saldoSistema: quantidadeNaUnidade(l.saldo, l.un),
      situacao,
      selo: SELO_SITUACAO[situacao],
      ultimaMovimentacao: campos.ultimaMovimentacao ? (ultima ? ultima.texto : '—') : null,
      // Só quando a linha não está em KG (em KG seria repetir o número ao
      // lado) e a conversão existe. Ausência não vira zero.
      emKg: campos.emKg && l.un !== 'KG' && l.em_kg
        ? `≈ ${umaCasa(l.em_kg.saldo)} kg`
        : null,
    })
  }

  return {
    data: dataIso,
    dataPorExtenso: porExtenso,
    historica,
    alertaHistorico: historica
      ? `ATENÇÃO: esta folha NÃO é a posição de hoje. Ela mostra o depósito como ele estava`
        + ` no fim de ${porExtenso ?? dataIso}. Conferir a contagem física de hoje contra ela`
        + ' vai acusar diferença em tudo que entrou, saiu ou se perdeu desde então — e essa'
        + ' diferença não é erro de lançamento.'
      : '',
    linhas,
    ocultas,
    resumo: resumoDaContagem(linhas.length, ocultas),
    campos,
  }
}

/** `true` só quando a data escolhida é anterior a hoje — a mesma regra de
 * `posicaoEstoque` (data futura ou inválida conta como "agora"). */
function ehPassado(dataIso: string, hojeIso: string): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/
  return re.test(dataIso) && re.test(hojeIso) && dataIso < hojeIso
}

/**
 * A frase de conferência do topo: "12 linhas a contar · 17 linhas fora da
 * folha por escolha".
 *
 * A SEGUNDA METADE É OBRIGATÓRIA quando há linhas de fora, e é o que impede a
 * folha de mentir por omissão: quem recebe uma folha de 4 linhas precisa saber
 * que existem 17 produtos que ela decidiu não trazer, senão vai concluir que o
 * depósito tem 4 produtos. A folha declara o próprio recorte.
 */
export function resumoDaContagem(mostradas: number, ocultas: number): string {
  const base = contagemPorExtenso(mostradas, 'linha a contar', 'linhas a contar')
  if (ocultas <= 0) return base
  return `${base} · ${contagemPorExtenso(ocultas, 'linha fora', 'linhas fora')} da folha por escolha`
}
