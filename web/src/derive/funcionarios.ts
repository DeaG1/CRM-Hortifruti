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
 * coluna no banco (`db/migrations/009_entidades_fase1.sql`).
 */
export const FUNCIONARIO_NOVO = {
  nome: '', cargo: '', tel: '', salario: 0, dia_pag: 5, ativo: true,
}

/**
 * Só os campos que a derivação de próximo pagamento precisa de um
 * lançamento — o resto (descrição, valor, etc.) não entra nesta conta.
 * `Lancamento` completo vive em derive/lancamentos.ts; esta interface
 * enxuta evita que este módulo dependa daquele (funcionarios.ts é
 * consumido por FuncionariosLista, que não precisa do resto do formato).
 */
export interface LancamentoParaFuncionario {
  data: string
  categoria: string
  funcionario_id: string | null
}

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
    .filter(l => l.categoria === 'Salário' && String(l.funcionario_id ?? '') === String(funcionarioId))
    .slice()
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  return doFuncionario.length ? doFuncionario[0].data : null
}

export interface FuncionarioDerivado extends Funcionario {
  ultimoPago: string | null
  pagamento: PagamentoInfo
}

/** Combina as três funções acima pro conjunto de funcionários da tela. */
export function derivarFuncionarios(
  funcionarios: Funcionario[],
  lancamentos: LancamentoParaFuncionario[],
  hoje: Date = new Date(),
): FuncionarioDerivado[] {
  return funcionarios.map(f => {
    const ultimoPago = ultimoSalarioPago(lancamentos, f.id)
    const proximaData = proximoPagamento(f.dia_pag, ultimoPago, hoje)
    return { ...f, ultimoPago, pagamento: statusPagamento(proximaData, hoje) }
  })
}
