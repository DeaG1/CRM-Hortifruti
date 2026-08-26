/** Lancamento como a API devolve (api/src/routes/lancamentos.ts). */
export interface Lancamento {
  id: string
  data: string // ISO: aaaa-mm-dd
  categoria: string
  descricao: string
  valor: number
  funcionario_id: string | null
  /** Preenchido só nas categorias de CATEGORIAS_COM_VEICULO — é o que
   * responde "quanto este carro custou no período" (migration 013). */
  veiculo_id: string | null
}

/**
 * Categorias que aceitam vincular um funcionário — mesma regra de
 * `CATEGORIAS_COM_FUNCIONARIO` em api/src/routes/lancamentos.ts (nas demais
 * categorias o servidor ignora o valor enviado, não vale a pena mostrar o
 * campo). Duplicada aqui de propósito: é uma regra de UI (que campo exibir),
 * diferente da lista fechada de categorias em si, que nunca é hardcoded no
 * front — sempre vem de `GET /api/lancamentos/categorias`.
 *
 * As duas categorias também são exportadas nomeadamente
 * (CATEGORIA_SALARIO / CATEGORIA_ADIANTAMENTO) porque quem conta dinheiro
 * por funcionário (derive/funcionarios.ts) precisa distinguir uma da outra
 * — o Set diz "aceita funcionário", não diz qual é qual. É a mesma fonte: o
 * Set é montado a partir delas, então não há como uma divergir da outra.
 */
export const CATEGORIA_SALARIO = 'Salário'
export const CATEGORIA_ADIANTAMENTO = 'Adiantamento de salário'

export const CATEGORIAS_COM_FUNCIONARIO = new Set([CATEGORIA_SALARIO, CATEGORIA_ADIANTAMENTO])

/**
 * As categorias que aceitam vincular um VEÍCULO — mesma regra de
 * `CATEGORIAS_COM_VEICULO` em api/src/routes/lancamentos.ts, duplicada aqui
 * pelo mesmo motivo que o Set de funcionário acima: é uma regra de UI (qual
 * campo exibir). A lista fechada de categorias em si continua vindo sempre de
 * `GET /api/lancamentos/categorias` — nenhuma tela monta um `<select>` a
 * partir daqui.
 *
 * `CATEGORIAS_COM_VEICULO_ORDEM` existe porque a tela de Veículos abre o
 * gasto do período POR categoria, e um `Set` não promete ordem estável de
 * leitura para quem renderiza cartões lado a lado. O `Set` é montado a partir
 * do array, então não há como as duas divergirem.
 *
 * 'Frete' NÃO está aqui, e essa foi a única das quatro candidatas que exigiu
 * decisão: gasolina, manutenção e multa só existem porque a empresa tem
 * carro; frete é o transporte COMPRADO de terceiro. Atribuí-lo a uma placa
 * afirmaria que aquele carro custou um dinheiro pago a outra empresa — e
 * quando o frete é feito com carro próprio, o custo já aparece como a
 * gasolina e a manutenção daquele carro. Ver o comentário completo na API,
 * que é onde a regra é aplicada de verdade.
 */
export const CATEGORIA_GASOLINA = 'Gasolina'
export const CATEGORIA_MANUTENCAO = 'Manutenção dos Carros'
export const CATEGORIA_MULTA = 'Multa'

export const CATEGORIAS_COM_VEICULO_ORDEM: readonly string[] = [
  CATEGORIA_GASOLINA, CATEGORIA_MANUTENCAO, CATEGORIA_MULTA,
]

export const CATEGORIAS_COM_VEICULO = new Set(CATEGORIAS_COM_VEICULO_ORDEM)

/**
 * Valores iniciais ao criar um lançamento novo, exceto `data` e `categoria`:
 * `data` é a data de hoje (calculada no componente, não aqui — não faz
 * sentido "congelar" um valor de `new Date()` num módulo importado uma vez
 * só) e `categoria` é o primeiro item da lista vinda de
 * `GET /api/lancamentos/categorias` — de novo, pra não fixar um nome de
 * categoria específico no front (nem repetir a lista, nem escolher um valor
 * arbitrário dela).
 *
 * `valor: ''` (não 0), mesmo motivo de CLIENTE_NOVO.limite
 * (derive/clientes.ts): campo numérico começa vazio com placeholder, não
 * com 0 pré-escrito — `as number | string` porque o spread ao editar
 * sobrescreve com o número real vindo da API.
 */
export const LANCAMENTO_NOVO_BASE = {
  descricao: '', valor: '' as number | string, funcionario_id: '', veiculo_id: '',
}
