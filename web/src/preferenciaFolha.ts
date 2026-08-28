import {
  normalizarCamposFolha, padroesDeCampos,
  type CamposDaFolha, type DefinicaoCampoFolha,
} from './derive/folha'

/**
 * ONDE MORA A ESCOLHA DE "O QUE SAI NA FOLHA" — das TRÊS folhas.
 *
 * `localStorage`, pelo raciocínio que preferenciaRomaneio.ts registrou
 * primeiro e que vale igual para as outras duas:
 *
 *   1. QUEM IMPRIME, IMPRIME DO MESMO LUGAR. A folha sai no computador que
 *      está ligado na impressora, junto do balcão. Não é uma preferência que
 *      a pessoa carrega entre aparelhos — é uma preferência DAQUELE posto de
 *      trabalho, e é bem possível que dois postos queiram folhas diferentes.
 *   2. O CUSTO DA ALTERNATIVA CONTINUA DESPROPORCIONAL. Uma coluna no
 *      esquema atravessaria migration, rota, testes de API e cache do
 *      cliente — e nenhuma destas folhas exige migration nenhuma.
 *   3. E, principalmente, O PIOR CASO É INOFENSIVO. Perder a preferência
 *      devolve o PADRÃO, que é uma folha perfeitamente utilizável — e que tem
 *      preço DESMARCADO nas três. Nenhum caminho de erro aqui consegue LIGAR
 *      um campo de preço: para ligar é preciso um `true` booleano na chave
 *      certa (ver `normalizarCamposFolha`), e o padrão dos campos de preço é
 *      `false`. A assimetria é deliberada — o descuido possível é remarcar
 *      caixas, nunca vazar preço para a mão do cliente errado.
 *
 * UMA CHAVE POR FOLHA, e é o que este módulo genérico acrescenta ao original:
 * as três folhas são documentos diferentes, e quem tira o preço do romaneio
 * não está dizendo nada sobre a folha de conferência da carga. Compartilhar
 * uma chave faria a escolha de uma vazar para as outras duas em silêncio.
 *
 * CHAVE SEM TENANT: mesma limitação e mesmo motivo de preferenciaGuia.ts (o
 * cliente não conhece o tenant depois do login). Quem opera duas empresas no
 * mesmo navegador herda a escolha da outra — uma caixa marcada a mais ou a
 * menos, no pior caso, nunca um dado errado na folha.
 *
 * NADA AQUI PODE QUEBRAR A TELA. `localStorage` falha de três jeitos que
 * acontecem em produção: o acesso a `window.localStorage` LANÇA quando o
 * navegador bloqueia armazenamento de sites, `getItem`/`setItem` lançam no
 * modo privado do Safari, e `setItem` lança QuotaExceededError com o disco
 * cheio. Por isso o acesso ao objeto está DENTRO do try — e não só as
 * chamadas —, e a falha significa "não há preferência gravada", nunca uma
 * exceção subindo até o React. O `JSON.parse` está no mesmo try pelo mesmo
 * motivo: string corrompida na chave é lixo, não pane.
 */

/**
 * A escolha gravada neste navegador para uma folha, ou o padrão dela. NUNCA
 * lança e NUNCA devolve um objeto pela metade: o que sai daqui passou por
 * `normalizarCamposFolha`, então tem exatamente as chaves que aquela folha
 * conhece, todas booleanas.
 *
 * O `window.localStorage` fica DENTRO do try (e não atrás de um helper com
 * try/catch próprio) pela razão registrada em preferenciaGuia.ts: uma segunda
 * camada de defesa que nenhum teste consegue distinguir da primeira é código
 * morto disfarçado de cuidado.
 */
export function camposSalvosDaFolha<C extends string>(
  chave: string,
  defs: readonly DefinicaoCampoFolha<C>[],
): CamposDaFolha<C> {
  try {
    const bruto = window.localStorage?.getItem(chave)
    if (bruto === null || bruto === undefined) return padroesDeCampos(defs)
    return normalizarCamposFolha(defs, JSON.parse(bruto))
  } catch {
    return padroesDeCampos(defs)
  }
}

/**
 * Grava a escolha. Devolve `true` se ela vai sobreviver ao recarregamento e
 * `false` se o armazenamento recusou — quem chama respeita o clique do mesmo
 * jeito (a folha na tela muda na hora), sabendo que a escolha volta ao padrão
 * no próximo F5. Mudar a folha é a resposta ao clique; persistir é o bônus.
 */
export function salvarCamposDaFolha<C extends string>(
  chave: string,
  defs: readonly DefinicaoCampoFolha<C>[],
  campos: CamposDaFolha<C>,
): boolean {
  try {
    const store = window.localStorage
    if (!store) return false
    store.setItem(chave, JSON.stringify(normalizarCamposFolha(defs, campos)))
    return true
  } catch {
    return false
  }
}
