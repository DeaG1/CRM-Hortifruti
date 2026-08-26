export type Papel = 'admin' | 'colaborador'

/** As telas do produto. As 10 originais seguem a ordem do menu do protótipo
 * (navDefs); 'veiculos' é nova (frota: cadastro + despesa por veículo),
 * acrescentada depois de 'funcionarios' no menu. */
export type Tela =
  | 'dashboard' | 'clientes' | 'entradas' | 'pedidos' | 'estoque'
  | 'fornecedores' | 'produtos' | 'funcionarios' | 'veiculos' | 'financeiro' | 'relatorios'

/**
 * Telas visíveis só para admin. Portado de `ADMIN_ONLY_SCREENS` do protótipo
 * (design/CRM Hortifruti.dc.html:1784) — colaborador só vê Entradas, Saídas
 * e Estoque.
 *
 * 'veiculos' ENTROU nesta lista, e é a única entrada que não vem do
 * protótipo. Enquanto a tela era check-in/check-out ela ficava de fora de
 * propósito: quem pega o carro no dia a dia é o colaborador, e uma ação que
 * dependesse do admin estar por perto não seria registrada por ninguém. Essa
 * ação deixou de existir — o dono do negócio usou e concluiu que não serve.
 * O que a tela mostra agora é quanto cada carro custou no período, que sai de
 * `GET /api/lancamentos`, admin-only desde sempre (mesma classe de dado do
 * Financeiro e dos salários em Funcionários).
 *
 * Deixá-la visível ao colaborador daria uma tela sem ação nenhuma, sem o
 * número que é o motivo dela existir, e com um 403 garantido no próprio
 * carregamento. A API concorda: `api/src/routes/veiculos.ts` passou a exigir
 * admin em '*', inclusive na leitura.
 */
export const ADMIN_ONLY_SCREENS: Tela[] = [
  'dashboard', 'clientes', 'fornecedores', 'produtos', 'financeiro', 'relatorios',
  'funcionarios', 'veiculos',
]
