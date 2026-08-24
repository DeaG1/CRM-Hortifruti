export type Papel = 'admin' | 'colaborador'

/** As telas do produto. As 10 originais seguem a ordem do menu do protótipo
 * (navDefs); 'veiculos' é nova (controle de veículos — cadastro +
 * check-in/check-out), acrescentada depois de 'funcionarios' no menu. */
export type Tela =
  | 'dashboard' | 'clientes' | 'entradas' | 'pedidos' | 'estoque'
  | 'fornecedores' | 'produtos' | 'funcionarios' | 'veiculos' | 'financeiro' | 'relatorios'

/**
 * Telas visíveis só para admin. Portado de `ADMIN_ONLY_SCREENS` do protótipo
 * (design/CRM Hortifruti.dc.html:1784) — colaborador só vê Entradas, Saídas
 * e Estoque.
 */
export const ADMIN_ONLY_SCREENS: Tela[] = [
  'dashboard', 'clientes', 'fornecedores', 'produtos', 'financeiro', 'relatorios', 'funcionarios',
]
