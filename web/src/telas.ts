export type Papel = 'admin' | 'colaborador'

/** As telas do produto. As 10 originais seguem a ordem do menu do protótipo
 * (navDefs); 'veiculos' é nova (frota: cadastro + despesa por veículo),
 * acrescentada depois de 'funcionarios' no menu. */
export type Tela =
  | 'dashboard' | 'clientes' | 'entradas' | 'pedidos' | 'estoque'
  | 'fornecedores' | 'produtos' | 'funcionarios' | 'veiculos' | 'financeiro' | 'relatorios'

/**
 * Telas visíveis só para admin. Portado de `ADMIN_ONLY_SCREENS` do protótipo
 * (design/CRM Hortifruti.dc.html:1784), onde o colaborador só via Entradas,
 * Saídas e Estoque.
 *
 * 'clientes', 'fornecedores' e 'produtos' SAÍRAM da lista. O dono decidiu que
 * o colaborador passa a ver, criar e editar os três CADASTROS: quem atende o
 * cliente, quem vai à feira e quem recebe a mercadoria é quem descobre que o
 * telefone mudou, que há produtor novo e que falta um produto no cadastro —
 * anotar num papel para o admin digitar depois é como perder a informação.
 * A API acompanhou (POST e PUT das três rotas aceitam colaborador), e o que
 * ficou de fora dele nessas telas não é a tela: são as MÉTRICAS derivadas
 * (ver `podeVerMetricasDeCadastro` logo abaixo) e o botão de excluir
 * (`podeExcluirCadastro`).
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
 * admin em '*', inclusive na leitura. O mesmo vale para as outras quatro que
 * ficaram: painel, Financeiro, Relatórios e Funcionários são feitos INTEIROS
 * de dinheiro agregado, não de cadastro com métrica ao lado — não há o que
 * separar nelas.
 */
export const ADMIN_ONLY_SCREENS: Tela[] = [
  'dashboard', 'financeiro', 'relatorios', 'funcionarios', 'veiculos',
]

/**
 * O colaborador vê o CADASTRO das três telas (Clientes, Produtos,
 * Fornecedores); as métricas derivadas delas, não.
 *
 * O que fica escondido dele, por tela:
 *  - Produtos: compra média, venda média, markup, margem, perda;
 *  - Clientes: faturado, ticket, participação, inadimplência, health score,
 *    limite de crédito;
 *  - Fornecedores: preço médio de compra, variação, aproveitamento, última
 *    coleta.
 *
 * ESCONDER COLUNA NÃO É PERMISSÃO, e é importante não confundir as duas
 * coisas ao ler esta função. Quem protege markup e margem de verdade é o
 * servidor: `GET /api/relatorios/produtos` exige admin, então o colaborador
 * recebe 403 mesmo digitando a URL no navegador. Já faturado, ticket e
 * inadimplência saem de `GET /api/saidas`, e preço médio e aproveitamento de
 * `GET /api/entradas` — duas rotas que ele JÁ acessa, porque Saídas e
 * Entradas são telas dele. Essas ele consegue recalcular por fora, e o dono
 * sabe e aceitou; o que não pode acontecer é a tela ENTREGAR o agregado
 * pronto. Por isso as telas também não BUSCAM esses dados quando o papel é
 * colaborador (ver os `useEffect` guardados em ClientesLista, ClienteFicha,
 * ProdutosLista e FornecedoresLista): não pedir o que não vai mostrar evita
 * o 403 no console e a requisição à toa.
 *
 * `limite` e `prazo` são a exceção honesta da lista: são colunas de
 * `clientes`, chegam no GET que ele precisa ler para lançar venda, e o
 * formulário de cadastro continua editando os dois. Escondê-los é decisão de
 * APRESENTAÇÃO da ficha, não uma barreira.
 */
export function podeVerMetricasDeCadastro(papel: Papel): boolean {
  return papel === 'admin'
}

/**
 * Excluir cliente, produto ou fornecedor continua só do admin — a API recusa
 * o DELETE das três rotas com 403 para colaborador, e o botão some da tela
 * para não oferecer o que vai falhar.
 *
 * A assimetria com editar é deliberada e vem do estrago: cadastro errado se
 * corrige editando; cadastro apagado leva junto o vínculo do histórico
 * SEM ERRO NENHUM — `saidas.cliente_id` e `entradas.fornecedor_id` são
 * ON DELETE SET NULL (db/migrations/014_fk_set_null_por_coluna.sql), então a
 * venda e a coleta sobrevivem órfãs e somem da carteira e do preço médio
 * daquele cadastro para sempre.
 */
export function podeExcluirCadastro(papel: Papel): boolean {
  return papel === 'admin'
}
