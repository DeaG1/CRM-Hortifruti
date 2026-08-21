import type { Produto } from './produtos'

export interface Fornecedor {
  id: string
  nome: string
  regiao: string
  contato: string
  /**
   * Produtos vinculados (tabela `fornecedor_produtos`). Só vem preenchido
   * quando o dado veio de `GET /api/fornecedores/:id` (ou de um `PUT` que
   * sincronizou a relação) — `GET /api/fornecedores` (lista) não faz esse
   * join, ver api/src/routes/fornecedores.ts.
   */
  produtos?: Produto[]
}

/**
 * Valores iniciais ao criar um fornecedor. Vive aqui pela mesma razão de
 * PRODUTO_NOVO em derive/produtos.ts (fast refresh — componente só pode
 * exportar componente).
 */
export const FORNECEDOR_NOVO = {
  nome: '', regiao: '', contato: '',
}
