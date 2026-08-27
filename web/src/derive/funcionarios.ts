import { periodoDe } from './periodo'
import { CATEGORIA_ADIANTAMENTO, CATEGORIA_MULTA, CATEGORIA_SALARIO, type Lancamento } from './lancamentos'
import type { Desconto } from './descontos'

/** Funcionario como a API devolve (api/src/routes/funcionarios.ts). */
export interface Funcionario {
  id: string
  nome: string
  cargo: string
  tel: string
  salario: number
  dia_pag: number
  ativo: boolean
}

/**
 * Valores iniciais ao criar um funcionário. Vive aqui (e não em
 * ModalFuncionario.tsx, que consome) pela mesma razão de CLIENTE_NOVO em
 * derive/clientes.ts: um arquivo de componente só pode exportar componentes
 * sem quebrar o fast refresh. `dia_pag: 5` é o mesmo default de
 * newFuncionario() no protótipo (design/CRM Hortifruti.dc.html:1931) e da
 * coluna no banco (`db/migrations/009_entidades_fase1.sql`) — é uma sugestão
 * útil, mantida como está (é um `<select>`, não sofre do problema de "0"
 * pré-digitado). `salario: ''` (não 0), mesmo motivo de CLIENTE_NOVO.limite
 * (derive/clientes.ts): campo numérico começa vazio com placeholder, não
 * com 0 pré-escrito — `as number | string` porque o spread ao editar
 * sobrescreve com o número real vindo da API.
 */
export const FUNCIONARIO_NOVO = {
  nome: '', cargo: '', tel: '', salario: '' as number | string, dia_pag: 5, ativo: true,
}

/**
 * O lançamento como esta tela precisa dele. Era, até as colunas de dinheiro
 * existirem, um subconjunto de três campos (data/categoria/funcionario_id) —
 * só o que `ultimoSalarioPago` consome. Agora que a mesma tela soma
 * ADIANTADO/PAGO e lista o histórico, ela precisa também de `valor`, `id` e
 * `descricao`: o subconjunto virou o conjunto inteiro, e manter uma cópia
 * declarada aqui só criaria duas definições do mesmo formato pra divergirem
 * com o tempo. O alias mantém o nome (quem lê `derivarFuncionarios` vê que
 * lançamento entra) sem duplicar o tipo.
 */
export type LancamentoParaFuncionario = Lancamento

export type StatusPagamento = 'indefinido' | 'atrasado' | 'proximo' | 'em-dia'

export interface PagamentoInfo {
  /** Data ISO (AAAA-MM-DD) do próximo pagamento previsto. */
  proximaData: string
  /** Dias até o próximo pagamento; negativo = atrasado. */
  diasAte: number | null
  status: StatusPagamento
  rotulo: string
  cor: string
  bg: string
}

const RED = '#c2502f'
const RBG = '#f6e4dc'
const AMBER = '#c79320'
const ABG = '#f6efd8'
const GREEN = '#3f8f5b'
const GBG = '#e7f1e8'
const NEUTRO = '#9a9784'
const NEUTRO_BG = '#f3f0e6'

/**
 * AAAA-MM-DD -> Date local à meia-noite, ou null se não bater o formato.
 * Porta só o ramo ISO de `_parseDate` (design/CRM Hortifruti.dc.html:1854-1861)
 * — o ramo dd/mm legado do protótipo não se aplica aqui: a API sempre
 * devolve `date` em ISO (ver `paraJson` em api/src/routes/lancamentos.ts),
 * então o formato dd/mm nunca chega até esta função.
 */
export function parseDataIso(s: string | null | undefined): Date | null {
  const m = String(s ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
}

function isoDeData(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/**
 * Dia do mês válido pra pagamento: 1..28, igual ao clamp de `_proximoPag`
 * (o protótipo limita a 28 pra nunca quebrar em fevereiro — mesma
 * constraint `dia_pag between 1 and 28` de `db/migrations/009_entidades_fase1.sql`).
 * Cai pra 5 (o default do cadastro) se vier ausente/inválido.
 */
function diaPagValido(diaPag: unknown): number {
  const n = typeof diaPag === 'number' ? diaPag : parseInt(String(diaPag), 10)
  return Math.min(Math.max(Number.isFinite(n) ? n : 5, 1), 28)
}

/**
 * Próxima data de pagamento: o dia escolhido no cadastro, no mês seguinte
 * ao último salário pago. Porta `_proximoPag` do protótipo (design/CRM
 * Hortifruti.dc.html:1942-1955), com fidelidade inclusive à parte que
 * parece estranha à primeira vista: quando ainda não há salário pago
 * (`ultimoPagIso` nulo), o dia de pagamento deste mês só continua sendo o
 * "próximo" se ainda não tiver chegado — comparado contra o instante atual
 * completo (`hoje`, com hora), não contra a data pura. Ou seja, a partir da
 * meia-noite do próprio dia de pagamento (meia-noite de hoje já é "antes de
 * agora" a qualquer hora do dia) o próximo pagamento já pula pro mês
 * seguinte. Isso é assim no original e é reproduzido aqui sem "consertar".
 */
export function proximoPagamento(
  diaPag: number | string | null | undefined,
  ultimoPagIso: string | null,
  hoje: Date = new Date(),
): string {
  const dia = diaPagValido(diaPag)
  let base: Date
  if (ultimoPagIso) {
    const t = parseDataIso(ultimoPagIso)
    base = t ?? new Date(hoje)
    base = new Date(base.getFullYear(), base.getMonth() + 1, dia)
  } else {
    base = new Date(hoje.getFullYear(), hoje.getMonth(), dia)
    if (base.getTime() < hoje.getTime()) base = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia)
  }
  return isoDeData(base)
}

/**
 * Status de atraso do próximo pagamento. Porta o bloco de `pagStatus` do
 * protótipo (design/CRM Hortifruti.dc.html:2570-2576): a contagem de dias
 * compara data-com-data (meia-noite a meia-noite), diferente da comparação
 * com hora cheia usada dentro de `proximoPagamento` acima — mesma
 * distinção do original, que usa `_hojeIso()` (só a data) aqui e
 * `new Date()` (com hora) lá.
 */
export function statusPagamento(proximaData: string, hoje: Date = new Date()): PagamentoInfo {
  const hojeData = parseDataIso(isoDeData(hoje))
  const proxData = parseDataIso(proximaData)
  const diasAte = hojeData && proxData ? Math.round((proxData.getTime() - hojeData.getTime()) / 86400000) : null

  if (diasAte == null) {
    return { proximaData, diasAte, status: 'indefinido', rotulo: '—', cor: NEUTRO, bg: NEUTRO_BG }
  }
  if (diasAte < 0) {
    return { proximaData, diasAte, status: 'atrasado', rotulo: `atrasado ${Math.abs(diasAte)}d`, cor: RED, bg: RBG }
  }
  if (diasAte <= 5) {
    return { proximaData, diasAte, status: 'proximo', rotulo: `vence em ${diasAte}d`, cor: AMBER, bg: ABG }
  }
  return { proximaData, diasAte, status: 'em-dia', rotulo: `em ${diasAte}d`, cor: GREEN, bg: GBG }
}

/**
 * Data (ISO) do salário mais recente pago a este funcionário, considerando
 * todo o histórico — não só um período filtrado na tela. Mesma decisão do
 * protótipo, que comenta "todas as épocas" ao montar `salLancs`
 * (design/CRM Hortifruti.dc.html:2565-2568): o próximo pagamento depende de
 * quando foi o último, independente do filtro de período que a tela de
 * lançamentos possa ter aplicado. Null se nunca foi pago.
 */
export function ultimoSalarioPago(lancamentos: LancamentoParaFuncionario[], funcionarioId: string): string | null {
  const doFuncionario = lancamentos
    .filter(l => l.categoria === CATEGORIA_SALARIO && String(l.funcionario_id ?? '') === String(funcionarioId))
    .slice()
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  return doFuncionario.length ? doFuncionario[0].data : null
}

/* ======================= dinheiro por funcionário ======================= */

/**
 * As somas do período e o que sobra delas, pra UM funcionário. Porta a conta
 * do protótipo (design/CRM Hortifruti.dc.html:2554-2557 e a nota de rodapé da
 * linha 779), com duas parcelas a mais que o protótipo não tinha:
 * `a pagar = salário − adiantamentos − salários pagos − descontos − multas,
 * no período`.
 *
 * O DESCONTO ENTRA AQUI E NÃO NO FINANCEIRO. Ele não é um lançamento — nada
 * se move quando a falta é registrada, a empresa é que vai pagar menos
 * depois. Somá-lo como custo (que é o que o Financeiro faz com todo
 * lançamento) inverteria o sinal: o desconto AUMENTARIA o custo da folha em
 * vez de reduzi-lo. Ver derive/descontos.ts e a migration 016.
 *
 * A MULTA ENTRA NOS DOIS LUGARES, e é o oposto do desconto — não uma variação
 * dele. O dinheiro saiu de verdade (foi paga ao órgão de trânsito), então ela
 * É lançamento: conta como custo no Financeiro e como gasto daquele carro na
 * tela de Veículos, integralmente, independentemente de quem reembolsa. O que
 * o vínculo com o funcionário acrescenta é a RECUPERAÇÃO — a mesma forma de um
 * adiantamento: custo que existe + abatimento na folha.
 *
 * POR QUE `multa` É UM CAMPO PRÓPRIO, e não mais uma coisa somada em
 * `adiantado` (que é mecanicamente idêntico e pouparia uma coluna na tela):
 *
 *  - "adiantado" descreve dinheiro ENTREGUE ao funcionário, e multa não é
 *    isso. Quem lê "Adiantado R$ 350" entende que a pessoa recebeu R$ 350;
 *  - o cartão do topo se chama "Adiantado no período". Ou ele passaria a
 *    incluir multas (e o rótulo mentiria) ou não incluiria (e discordaria da
 *    coluna da linha, que incluiria) — os dois defeitos são piores que uma
 *    sexta coluna;
 *  - o dono pediu para saber DE QUEM foi a infração; separar o número é o que
 *    responde "quanto do abatimento veio de multa" sem abrir o histórico.
 */
export interface SaldoFuncionario {
  /** Salário do cadastro — a base da conta, não vem de lançamento. */
  salario: number
  /** Soma dos lançamentos de 'Adiantamento de salário' do período. */
  adiantado: number
  /** Soma dos lançamentos de 'Salário' do período. */
  pagoSalario: number
  /** Soma dos descontos por falta do período (tabela própria, não lançamento). */
  descontado: number
  /** Soma dos lançamentos de 'Multa' VINCULADOS a este funcionário no período.
   * Multa sem funcionário não entra aqui (nem em ninguém): continua sendo só
   * custo do veículo. */
  multa: number
  /**
   * `salário − adiantado − pago − descontado − multa` SEM piso: fica negativo quando
   * as parcelas somam mais que o salário do período. É o número cru, exposto
   * pra quem precisar dele (o excedente abaixo sai daqui) — não é o que a
   * coluna A PAGAR mostra.
   */
  saldoBruto: number
  /**
   * O que ainda se deve: `saldoBruto` com piso em zero, igual ao
   * `Math.max(0, ...)` do protótipo. Uma dívida negativa não existe — quem
   * adiantou R$ 300 a mais não tem "R$ −300 a pagar", tem zero a pagar e um
   * crédito de R$ 300 (que sai em `excedente`, pra a informação não se
   * perder no clamp).
   */
  aPagar: number
  /** Quanto passou do salário (`-saldoBruto` quando negativo, senão 0). Pode
   * vir de adiantamento, de salário já pago, de desconto, de multa ou de
   * qualquer combinação deles — `sujeitoDoExcedente` diz qual. */
  excedente: number
  /** Protótipo: `podePagar: aPagar>0` — só oferece "Pagar salário" se há o que pagar. */
  podePagar: boolean
  /** Protótipo: `quitadoTxt` aparece exatamente quando `aPagar` não é positivo. */
  quitado: boolean
}

/**
 * Soma os lançamentos e os descontos JÁ FILTRADOS de um funcionário (ver
 * `lancamentosDoFuncionario` e `descontosDoFuncionario`) e devolve o saldo.
 * Categorias fora das três que abatem folha são ignoradas: a API já zera
 * `funcionario_id` fora de CATEGORIAS_COM_FUNCIONARIO
 * (api/src/routes/lancamentos.ts), mas somar por CATEGORIA — e não por "tem
 * funcionário" — mantém a conta certa mesmo se um dia outra categoria passar
 * a aceitar vínculo. Foi exatamente esse cuidado que fez a multa entrar aqui
 * como uma parcela pensada, e não escorregar para dentro de `adiantado` só
 * porque passou a chegar com funcionário preenchido.
 *
 * Os descontos entram como uma lista SEPARADA, e não misturados aos
 * lançamentos, porque são coisas diferentes no banco e no significado: os
 * lançamentos vêm de `GET /api/lancamentos` (dinheiro que se moveu) e os
 * descontos de `GET /api/descontos` (dinheiro que deixará de se mover).
 * Fundi-los num array só antes de chegar aqui só criaria um lugar onde a
 * distinção pode se perder.
 */
export function saldoFuncionario(
  salario: number,
  lancamentosDoPeriodo: LancamentoParaFuncionario[],
  descontosDoPeriodo: Desconto[],
): SaldoFuncionario {
  let adiantado = 0
  let pagoSalario = 0
  let multa = 0
  for (const l of lancamentosDoPeriodo) {
    const v = Number(l.valor) || 0
    if (l.categoria === CATEGORIA_ADIANTAMENTO) adiantado += v
    else if (l.categoria === CATEGORIA_SALARIO) pagoSalario += v
    else if (l.categoria === CATEGORIA_MULTA) multa += v
  }
  let descontado = 0
  for (const d of descontosDoPeriodo) descontado += Number(d.valor) || 0

  const base = Number(salario) || 0
  const saldoBruto = base - adiantado - pagoSalario - descontado - multa
  const aPagar = Math.max(0, saldoBruto)
  return {
    salario: base,
    adiantado,
    pagoSalario,
    descontado,
    multa,
    saldoBruto,
    aPagar,
    excedente: Math.max(0, -saldoBruto),
    podePagar: aPagar > 0,
    quitado: aPagar <= 0,
  }
}

/**
 * QUEM causou o excedente, para a frase da tela dizer a verdade.
 *
 * A mensagem exibida quando o saldo estoura era fixa — "Adiantado R$ X além
 * do salário do período" — e nasceu num mundo onde só havia duas parcelas.
 * Com o desconto entrando na conta ela passa a poder mentir: um funcionário
 * com salário de R$ 2.000 e R$ 2.300 de desconto tem excedente de R$ 300 sem
 * ter recebido um centavo adiantado. (Aliás, ela já podia mentir antes, no
 * caso raro de um salário pago acima do salário do cadastro.)
 *
 * Devolve o SUJEITO da frase — 'Adiantado', 'Descontado', 'Adiantado e
 * descontado'… — e não a frase inteira, porque a formatação do dinheiro é da
 * tela (`money`), não daqui. A ordem é fixa (adiantado, pago, descontado,
 * multado) para o texto não dançar entre renders.
 *
 * `null` quando não há excedente — e também no caso impossível de haver
 * excedente sem nenhuma parcela positiva (só aconteceria com salário
 * negativo, que o banco recusa): melhor não desenhar frase nenhuma do que
 * afirmar uma causa que não se sabe.
 */
export function sujeitoDoExcedente(saldo: SaldoFuncionario): string | null {
  if (saldo.excedente <= 0) return null
  const partes: string[] = []
  if (saldo.adiantado > 0) partes.push('adiantado')
  if (saldo.pagoSalario > 0) partes.push('pago')
  if (saldo.descontado > 0) partes.push('descontado')
  // 'multado' pela mesma razão de 'descontado': um funcionário com R$ 2.300 de
  // multa sobre um salário de R$ 2.000 tem excedente sem ter recebido um
  // centavo adiantado, e a frase precisa dizer de onde o excedente veio.
  if (saldo.multa > 0) partes.push('multado')
  if (partes.length === 0) return null
  // 'adiantado' / 'adiantado e pago' / 'adiantado, pago e descontado'
  const frase = partes.length === 1
    ? partes[0]
    : partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1]
  // Maiúscula só no fim, e não em cada parte: a frase começa com qualquer uma
  // das três (um excedente só de desconto começa em "Descontado"), e escrever
  // 'Adiantado' com maiúscula na origem produzia "pago e descontado" em
  // minúscula abrindo o parágrafo.
  return frase.charAt(0).toUpperCase() + frase.slice(1)
}

/**
 * Lançamentos de um funcionário dentro do período, do mais recente pro mais
 * antigo — a mesma lista que alimenta o saldo e o histórico da linha
 * expandida (protótipo: `meus`, linha 2559). `periodo` é 'AAAA-MM' ou 'all',
 * mesma convenção de `periodoDe`/`filtrarPorPeriodo` em derive/periodo.ts,
 * que agora vale para o sistema inteiro (o período é global).
 */
export function lancamentosDoFuncionario(
  lancamentos: LancamentoParaFuncionario[],
  funcionarioId: string,
  periodo: string = 'all',
): LancamentoParaFuncionario[] {
  return lancamentos
    .filter(l => String(l.funcionario_id ?? '') === String(funcionarioId))
    .filter(l => periodo === 'all' || periodoDe(l.data) === periodo)
    .slice()
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
}

/**
 * O mesmo recorte, para os descontos: os de um funcionário dentro do período,
 * do mais recente pro mais antigo.
 *
 * O FILTRO DE PERÍODO VALE IGUAL AOS ADIANTAMENTOS, e isso é o ponto: a data
 * gravada é a da FALTA, então um desconto de março não abate o salário de
 * agosto. Sem este filtro, trocar o mês no cabeçalho mudaria os
 * adiantamentos e deixaria os descontos parados — e o "a pagar" passaria a
 * ser uma conta que não bate com nenhum período.
 */
export function descontosDoFuncionario(
  descontos: Desconto[],
  funcionarioId: string,
  periodo: string = 'all',
): Desconto[] {
  return descontos
    .filter(d => String(d.funcionario_id ?? '') === String(funcionarioId))
    .filter(d => periodo === 'all' || periodoDe(d.data) === periodo)
    .slice()
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
}

/**
 * Uma linha do histórico expansível do funcionário. União discriminada, e não
 * um objeto achatado com campos opcionais, porque as duas coisas NÃO são o
 * mesmo registro: um lançamento tem categoria e descrição e move dinheiro; um
 * desconto tem motivo e só muda quanto será pago. Achatar os dois num tipo só
 * (`categoria?: string; motivo?: string`) faria a tela ter de adivinhar qual
 * dos dois está lendo — e um clique abre modais diferentes.
 *
 * `id`, `data` e `valor` ficam no nível de cima porque são o que a lista
 * ordena e mede, em ambos os casos.
 */
export type ItemHistorico =
  | { tipo: 'lancamento'; id: string; data: string; valor: number; lancamento: LancamentoParaFuncionario }
  | { tipo: 'desconto'; id: string; data: string; valor: number; desconto: Desconto }

/**
 * O histórico do funcionário: lançamentos e descontos do período na MESMA
 * lista, do mais recente pro mais antigo.
 *
 * Recebe as duas listas JÁ FILTRADAS (por funcionário e por período) para não
 * repetir aqui o recorte que `lancamentosDoFuncionario` e
 * `descontosDoFuncionario` já fazem — e para o saldo e o histórico saírem
 * comprovadamente do mesmo conjunto de registros. Se um dia divergirem, a
 * tela mostraria uma lista que não explica o número ao lado dela.
 *
 * Empate de data entre um lançamento e um desconto: o lançamento vem primeiro
 * (`sort` é estável e os lançamentos entram antes). É arbitrário, mas é
 * determinístico — a lista não muda de ordem sozinha entre renders.
 */
export function historicoDoFuncionario(
  lancamentosDoPeriodo: LancamentoParaFuncionario[],
  descontosDoPeriodo: Desconto[],
): ItemHistorico[] {
  const itens: ItemHistorico[] = [
    ...lancamentosDoPeriodo.map((l): ItemHistorico => ({
      tipo: 'lancamento', id: l.id, data: l.data, valor: Number(l.valor) || 0, lancamento: l,
    })),
    ...descontosDoPeriodo.map((d): ItemHistorico => ({
      tipo: 'desconto', id: d.id, data: d.data, valor: Number(d.valor) || 0, desconto: d,
    })),
  ]
  return itens.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
}

// REMOVIDA: `periodosComFolha`, que montava as opções do seletor de período
// PRÓPRIO desta tela. O seletor deixou de existir quando o período subiu para
// o cabeçalho global (achado S-3), e a função ficou sem chamador. Ela não fica
// aqui "por precaução": a decisão de NÃO derivar as opções dos dados está
// tomada e documentada em derive/periodo.ts (`opcoesDePeriodo`) — manter o
// código da alternativa descartada, com um comentário descrevendo uma tela que
// já não existe, é exatamente o tipo de justificativa que envelhece sozinha e
// que a auditoria apontou. O irmão dela em FinanceiroTela.tsx
// (`periodosDisponiveis`) saiu pelo mesmo motivo, na mesma mudança.

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/**
 * Descrição sugerida ao pagar um salário: 'Salário — junho'. Porta
 * `_mesAtualNome()` do protótipo (linha 1937), inclusive na parte que
 * surpreende: o mês é sempre o de HOJE, não o do filtro de período — quem
 * paga, paga hoje; olhar maio não quer dizer que o pagamento que se vai
 * lançar seja de maio. É só uma sugestão, editável no modal antes de salvar.
 */
export function descricaoSalario(hoje: Date = new Date()): string {
  return 'Salário — ' + MESES_PT[hoje.getMonth()]
}

/* =========================== os quatro cartões =========================== */

/**
 * Os números dos quatro cartões do topo (protótipo: `funcStats`, linha
 * 2596). `null` em vez de 0 nos que dependem de lançamento ou de desconto
 * quando a lista não pôde ser carregada — zero ali seria um dado inventado.
 *
 * Nem todo campo daqui vira cartão: `pagoPeriodo`, `descontadoPeriodo` e
 * `multaPeriodo` são as parcelas de `aPagarTotal`, expostas para a conta poder
 * ser conferida (e testada) sem refazê-la fora.
 */
export interface EstatisticasFuncionarios {
  /** Quantos funcionários cadastrados. */
  quantidade: number
  /** Soma dos salários do cadastro. */
  folhaMensal: number
  /** Adiantado no período, todos os funcionários. `null` = lançamentos indisponíveis. */
  adiantadoPeriodo: number | null
  /** Salários pagos no período, todos os funcionários. `null` = indisponível. */
  pagoPeriodo: number | null
  /** Descontado no período, todos os funcionários. `null` = descontos indisponíveis. */
  descontadoPeriodo: number | null
  /** Multas VINCULADAS a algum funcionário no período. `null` = indisponível.
   * Multa sem funcionário fica de fora, igual ao adiantado e ao pago: ela é
   * custo do veículo e continua contando no Financeiro e na tela de Veículos,
   * mas não abate a folha de ninguém. */
  multaPeriodo: number | null
  /** `max(0, folha − adiantado − pago − descontado − multa)`. `null` = indisponível. */
  aPagarTotal: number | null
}

export function estatisticasFuncionarios(
  funcionarios: Funcionario[],
  lancamentos: LancamentoParaFuncionario[] | null,
  descontos: Desconto[] | null,
  periodo: string = 'all',
): EstatisticasFuncionarios {
  const folhaMensal = funcionarios.reduce((soma, f) => soma + (Number(f.salario) || 0), 0)
  // Basta UMA das duas listas faltar para o cartão "A pagar" virar travessão:
  // com metade da conta em mãos ele mostraria um número maior que o real
  // (sem os descontos) ou menor (sem os salários pagos), e nos dois casos com
  // cara de medição. Só `quantidade` e `folhaMensal` sobrevivem — os dois
  // saem do cadastro, que continua carregado.
  if (lancamentos === null || descontos === null) {
    return {
      quantidade: funcionarios.length,
      folhaMensal,
      adiantadoPeriodo: null,
      pagoPeriodo: null,
      descontadoPeriodo: null,
      multaPeriodo: null,
      aPagarTotal: null,
    }
  }
  let adiantadoPeriodo = 0
  let pagoPeriodo = 0
  let multaPeriodo = 0
  for (const l of lancamentos) {
    // Só lançamento vinculado a funcionário entra — igual ao protótipo, que
    // soma `adiantByFunc`/`salByFunc`, ambos indexados por funcionarioId. É
    // este `continue` que mantém a multa SEM funcionário fora do "a pagar": ela
    // continua sendo custo (Financeiro, e o gasto do carro na tela de
    // Veículos), só não é dívida de ninguém.
    if (!String(l.funcionario_id ?? '')) continue
    if (periodo !== 'all' && periodoDe(l.data) !== periodo) continue
    const v = Number(l.valor) || 0
    if (l.categoria === CATEGORIA_ADIANTAMENTO) adiantadoPeriodo += v
    else if (l.categoria === CATEGORIA_SALARIO) pagoPeriodo += v
    else if (l.categoria === CATEGORIA_MULTA) multaPeriodo += v
  }
  // Os descontos entram na mesma conta do cartão, com o mesmo recorte de
  // período — um desconto de março não pode diminuir a folha de agosto. Sem
  // filtrar por funcionário: aqui é a empresa inteira, e todo desconto tem
  // funcionário (coluna `not null`), então não existe o caso de "desconto
  // solto" que o `continue` acima descarta nos lançamentos.
  let descontadoPeriodo = 0
  for (const d of descontos) {
    if (periodo !== 'all' && periodoDe(d.data) !== periodo) continue
    descontadoPeriodo += Number(d.valor) || 0
  }
  return {
    quantidade: funcionarios.length,
    folhaMensal,
    adiantadoPeriodo,
    pagoPeriodo,
    descontadoPeriodo,
    multaPeriodo,
    // Piso aplicado uma vez, no agregado — e não à soma dos `aPagar` de cada
    // linha. É o que o protótipo faz (linha 2601) e o que a própria sublinha
    // do cartão promete ("salários − adiantado − pago − descontado − multas"):
    // o cartão é a conta da folha inteira, não o total das dívidas
    // individuais. Os dois só divergem quando alguém recebeu adiantado (ou
    // levou desconto ou multa) acima do próprio salário.
    aPagarTotal: Math.max(
      0, folhaMensal - adiantadoPeriodo - pagoPeriodo - descontadoPeriodo - multaPeriodo,
    ),
  }
}

/* ============================== a tela toda ============================== */

export interface FuncionarioDerivado extends Funcionario {
  ultimoPago: string | null
  pagamento: PagamentoInfo
  /**
   * `null` quando os lançamentos ou os descontos não puderam ser carregados —
   * diferente de um saldo com `adiantado: 0`, que é um zero medido (o
   * funcionário existe, o período foi olhado, não houve adiantamento). A tela
   * mostra travessão num caso e R$ 0,00 no outro.
   */
  saldo: SaldoFuncionario | null
  /** Lançamentos E descontos do período, mais recente primeiro (ver
   * `historicoDoFuncionario`). `null` = indisponíveis. */
  historico: ItemHistorico[] | null
}

/**
 * Combina tudo acima pro conjunto de funcionários da tela.
 *
 * `lancamentos: null` significa "GET /api/lancamentos falhou" e
 * `descontos: null`, o mesmo para "GET /api/descontos" — o cadastro (nome,
 * cargo, salário, dia de pagamento) e o próximo pagamento continuam saindo,
 * só o que depende deles vira `null`. `[]` é outra coisa: carregou e não
 * havia nada, então as somas são zero de verdade.
 *
 * BASTA UMA DAS DUAS FALTAR para o saldo inteiro virar `null`, e não só a
 * parcela que faltou: sem os descontos, o "a pagar" seria maior que o real —
 * e o botão "Pagar salário", que pré-preenche esse número, ofereceria o valor
 * CHEIO de quem faltou. Que é exatamente o erro que o desconto existe para
 * evitar. Melhor não oferecer a ação do que oferecê-la com o número errado.
 *
 * `ultimoPago` olha TODAS as épocas, não o período filtrado (protótipo,
 * linha 2565: "todas as épocas") — quando o último salário caiu não muda
 * porque quem olha mexeu no filtro de mês.
 */
export function derivarFuncionarios(
  funcionarios: Funcionario[],
  lancamentos: LancamentoParaFuncionario[] | null,
  descontos: Desconto[] | null,
  hoje: Date = new Date(),
  periodo: string = 'all',
): FuncionarioDerivado[] {
  const folhaDisponivel = lancamentos !== null && descontos !== null
  return funcionarios.map(f => {
    const ultimoPago = lancamentos === null ? null : ultimoSalarioPago(lancamentos, f.id)
    const proximaData = proximoPagamento(f.dia_pag, ultimoPago, hoje)
    if (!folhaDisponivel) {
      return { ...f, ultimoPago, pagamento: statusPagamento(proximaData, hoje), saldo: null, historico: null }
    }
    const meusLancamentos = lancamentosDoFuncionario(lancamentos!, f.id, periodo)
    const meusDescontos = descontosDoFuncionario(descontos!, f.id, periodo)
    return {
      ...f,
      ultimoPago,
      pagamento: statusPagamento(proximaData, hoje),
      saldo: saldoFuncionario(f.salario, meusLancamentos, meusDescontos),
      historico: historicoDoFuncionario(meusLancamentos, meusDescontos),
    }
  })
}
