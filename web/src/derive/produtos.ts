/** Unidades aceitas pela API (ver constraint `produtos_un_check`, migration 009). */
export const UNIDADES = ['KG', 'CX', 'UN', 'DZ', 'MC'] as const
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
 */
export const PRODUTO_NOVO = {
  nome: '', un: 'KG' as Unidade, peso_medio: 0,
}
