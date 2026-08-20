export type Papel = 'admin' | 'colaborador'

/** As 10 telas do produto, na ordem do menu do protótipo (navDefs). */
export type Tela =
  | 'dashboard' | 'clientes' | 'entradas' | 'pedidos' | 'estoque'
  | 'fornecedores' | 'produtos' | 'funcionarios' | 'financeiro' | 'relatorios'

/**
 * Telas visíveis só para admin. Portado de `ADMIN_ONLY_SCREENS` do protótipo
 * (design/CRM Hortifruti.dc.html:1784) — colaborador só vê Entradas, Saídas
 * e Estoque.
 */
export const ADMIN_ONLY_SCREENS: Tela[] = [
  'dashboard', 'clientes', 'fornecedores', 'produtos', 'financeiro', 'relatorios', 'funcionarios',
]
