/** Lancamento como a API devolve (api/src/routes/lancamentos.ts). */
export interface Lancamento {
  id: string
  data: string // ISO: aaaa-mm-dd
  categoria: string
  descricao: string
  valor: number
  funcionario_id: string | null
}

/**
 * Categorias que aceitam vincular um funcionário — mesma regra de
 * `CATEGORIAS_COM_FUNCIONARIO` em api/src/routes/lancamentos.ts (nas demais
 * categorias o servidor ignora o valor enviado, não vale a pena mostrar o
 * campo). Duplicada aqui de propósito: é uma regra de UI (que campo exibir),
 * diferente da lista fechada de categorias em si, que nunca é hardcoded no
 * front — sempre vem de `GET /api/lancamentos/categorias`.
 */
export const CATEGORIAS_COM_FUNCIONARIO = new Set(['Salário', 'Adiantamento de salário'])

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
  descricao: '', valor: '' as number | string, funcionario_id: '',
}
