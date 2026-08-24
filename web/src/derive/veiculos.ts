/** Uso em aberto de um veículo, agregado pela própria API (GET /api/veiculos
 * — ver api/src/routes/veiculos.ts, paraJsonComUso) para a tela não precisar
 * de uma requisição por carro só pra saber quem está com ele. */
export interface UsoAberto {
  id: string
  funcionario_id: string
  funcionario_nome: string
  /** timestamptz ISO — desde quando o carro está fora. */
  desde: string
}

/** Veículo como a API devolve (api/src/routes/veiculos.ts). */
export interface Veiculo {
  id: string
  placa: string
  modelo: string
  marca: string
  ano: number | null
  ativo: boolean
  obs: string
  /** null = disponível; presente = em uso, com quem pegou e desde quando. */
  uso_aberto: UsoAberto | null
}

/**
 * Valores iniciais ao criar um veículo. Vive aqui (não em ModalVeiculo.tsx,
 * que consome) pela mesma razão de PRODUTO_NOVO em derive/produtos.ts: um
 * arquivo de componente só pode exportar componentes sem quebrar o fast
 * refresh. `ano: ''` (não `null`) porque é o valor que um <input
 * type="number"> controlado espera quando vazio.
 */
export const VEICULO_NOVO = {
  placa: '', modelo: '', marca: '', ano: '' as number | string, ativo: true, obs: '',
}

/** Nome + horário de quem pegou o carro (só o funcionário, sem a lista de
 * opções) — pro seletor de "Pegar" em ModalPegarVeiculo. */
export interface FuncionarioOpcao {
  id: string
  nome: string
}

/** Um item do histórico de uso de um veículo (GET /api/veiculos/:id/historico). */
export interface UsoHistorico {
  id: string
  veiculo_id: string
  funcionario_id: string
  funcionario_nome: string
  saida_em: string
  volta_em: string | null
  obs: string
}

/** Limite (em horas) a partir do qual um uso em aberto é destacado na lista
 * — decisão do dono do negócio: a tela avisa, mas não fecha sozinha (ver
 * comentário grande em VeiculosLista.tsx). */
export const HORAS_LIMITE_ABERTO = 12

/** Horas decorridas desde `desde` (uma data ISO) até `agora`. */
export function horasEmAberto(desde: string, agora: Date = new Date()): number {
  const inicio = new Date(desde).getTime()
  return (agora.getTime() - inicio) / (1000 * 60 * 60)
}

/** true quando um uso em aberto já passou do limite de destaque. */
export function usoAntigo(desde: string, agora: Date = new Date()): boolean {
  return horasEmAberto(desde, agora) > HORAS_LIMITE_ABERTO
}

/** "07:40" a partir de um timestamptz ISO — hora local do navegador. */
export function formatarHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** "23/08 07:40" — usado no histórico, onde a data importa (pode ser de
 * outro dia), diferente da lista principal (que só mostra "desde HH:MM",
 * porque um uso em aberto na lista é sempre recente o bastante pro dia não
 * precisar aparecer — e quando não é, o destaque de "há muito tempo" já
 * avisa isso de outra forma). */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${data} ${hora}`
}
