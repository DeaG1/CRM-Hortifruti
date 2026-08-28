/**
 * AS UNIDADES ACEITAS — A LISTA MORA AQUI, E SÓ AQUI.
 *
 * Espelha o CHECK `produtos_un_check` (migration 009, reescrito pela 018).
 * Todo `<select>` de unidade do sistema lê desta constante: o cadastro de
 * produto (ModalProduto), e também os três lançamentos que gravam a unidade
 * na PRÓPRIA linha — ModalEntrada, ModalSaida e ModalPerda.
 *
 * POR QUE UM LUGAR SÓ. Até a 018 esta mesma lista estava copiada em quatro
 * arquivos (aqui e nos três modais). Quatro cópias não são quatro fontes: são
 * três chances de uma ficar para trás, e a troca de 'DZ' por 'BDJA' foi
 * justamente a prova — a lista teria de ser editada nos quatro, e a que
 * escapasse ofereceria ao usuário uma unidade que o banco rejeita (ou
 * esconderia uma que ele aceita) sem nenhum teste ficar vermelho. Os modais
 * agora importam daqui.
 *
 * OS TRÊS MODAIS USAM A LISTA POR OUTRO MOTIVO, e ele merece ser dito:
 * `entrada_itens.un`, `saida_itens.un` e `perdas.un` são `text` sem CHECK
 * nenhum no banco (009 — verificado em pg_constraint, não suposto). Só
 * `produtos.un` é imposta pelo servidor. Nesses três a lista é disciplina de
 * UI, não invariante do banco: ela existe para o lançamento não inventar uma
 * unidade que o cadastro de produto não conhece. É mais uma razão para ser
 * uma cópia só — é o único lugar que segura aquelas três colunas.
 *
 * 'BDJA' (bandeja) ocupa a posição que era de 'DZ' (dúzia). Não é unidade
 * nova: é a mesma casa com outro nome, porque este hortifruti vende em
 * bandeja e nunca vendeu em dúzia (ver db/migrations/018, que explica a
 * decisão e converte o dado já gravado).
 *
 * Ordem KG, CX, UN, BDJA, MC = ordem de uso no balcão, e é a ordem em que
 * aparecem no `<select>`. Mudar esta lista é mudar o que o sistema aceita:
 * `derive/produtos.test.ts` fixa o conteúdo exato para que a próxima mudança
 * seja deliberada, e não silenciosa.
 */
export const UNIDADES = ['KG', 'CX', 'UN', 'BDJA', 'MC'] as const
export type Unidade = (typeof UNIDADES)[number]

export interface Produto {
  id: string
  nome: string
  un: Unidade
  /** Peso médio da embalagem em kg — converte CX em KG (ver migration 009). 0 = não informado. */
  peso_medio: number
}

/**
 * Valores iniciais ao criar um produto. Vive aqui (e não em ModalProduto.tsx,
 * que consome) pela mesma razão de CLIENTE_NOVO em derive/clientes.ts: um
 * arquivo de componente só pode exportar componentes sem quebrar o fast
 * refresh, e ProdutosLista.tsx precisa do mesmo tipo `Produto` para tipar a
 * lista vinda da API.
 *
 * `peso_medio: ''` (não 0), mesmo motivo de CLIENTE_NOVO.limite
 * (derive/clientes.ts): campo numérico começa vazio com placeholder, não
 * com 0 pré-escrito.
 */
export const PRODUTO_NOVO = {
  nome: '', un: 'KG' as Unidade, peso_medio: '' as number | string,
}
