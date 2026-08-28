import {
  normalizarCampos, CAMPOS_ROMANEIO_PADRAO, type CamposRomaneio,
} from './derive/romaneio'

/**
 * A escolha de "o que sai na folha" do romaneio de entregas
 * (ver derive/romaneio.ts).
 *
 * ONDE ELA MORA, E POR QUÊ
 *
 * `localStorage`, pelo mesmo raciocínio de preferenciaGuia.ts — e com uma
 * diferença que vale registrar, porque ela ENFRAQUECE um dos argumentos de
 * lá e mesmo assim não muda a conclusão.
 *
 * Lá o custo do "por navegador" era limitado no tempo: o guia de primeiros
 * passos se aposenta em dias. Aqui não é — quem imprime romaneio imprime
 * todo dia, para sempre. O argumento que sustenta a escolha, então, é outro:
 *
 *   1. QUEM IMPRIME, IMPRIME DO MESMO LUGAR. O romaneio sai no computador
 *      que está ligado na impressora, junto do balcão. Não é uma preferência
 *      que a pessoa carrega entre aparelhos — é uma preferência DAQUELE
 *      posto de trabalho, e é bem possível que dois postos queiram folhas
 *      diferentes (o do balcão sem preço, o do escritório com total).
 *   2. O CUSTO DA ALTERNATIVA CONTINUA DESPROPORCIONAL. Uma coluna
 *      (`usuarios.campos_romaneio`) atravessaria migration, rota, testes de
 *      API e cache do cliente — e a tarefa em curso não deve exigir
 *      migration nenhuma. Guardar preferência de apresentação no esquema do
 *      negócio é dívida cara para o que ela devolve.
 *   3. E, principalmente, O PIOR CASO É INOFENSIVO. Perder a preferência
 *      devolve o PADRÃO (CAMPOS_ROMANEIO_PADRAO), que é uma folha
 *      perfeitamente utilizável — e que tem preço DESMARCADO. Ou seja: toda
 *      falha de armazenamento cai do lado seguro. Nenhum caminho de erro
 *      aqui consegue LIGAR um campo de preço; para ligar é preciso um `true`
 *      booleano na chave certa (ver `normalizarCampos`), e o padrão de todos
 *      os três é `false`. Essa assimetria é deliberada: o descuido possível
 *      é remarcar caixas, nunca vazar preço para a mão do cliente errado.
 *
 * Se um dia a preferência precisar seguir a pessoa entre aparelhos, este
 * módulo é o único ponto a trocar — o resto do app não fala com
 * `localStorage`.
 *
 * CHAVE ÚNICA, SEM TENANT: mesma limitação e mesmo motivo de
 * preferenciaGuia.ts (o cliente não conhece o tenant depois do login). Quem
 * opera duas empresas no mesmo navegador herda a escolha da outra — uma
 * caixa marcada a mais ou a menos, no pior caso, nunca um dado errado na
 * folha.
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

const CHAVE = 'crm_hf_romaneio_campos'

/**
 * A escolha gravada neste navegador, ou o padrão. NUNCA lança e NUNCA
 * devolve um objeto pela metade: o que sai daqui passou por
 * `normalizarCampos`, então tem exatamente as chaves que o app conhece, todas
 * booleanas.
 *
 * O `window.localStorage` fica DENTRO do try (e não atrás de um helper com
 * try/catch próprio) pela razão registrada em preferenciaGuia.ts: uma segunda
 * camada de defesa que nenhum teste consegue distinguir da primeira é código
 * morto disfarçado de cuidado.
 */
export function camposSalvosRomaneio(): CamposRomaneio {
  try {
    const bruto = window.localStorage?.getItem(CHAVE)
    if (bruto === null || bruto === undefined) return { ...CAMPOS_ROMANEIO_PADRAO }
    return normalizarCampos(JSON.parse(bruto))
  } catch {
    return { ...CAMPOS_ROMANEIO_PADRAO }
  }
}

/**
 * Grava a escolha. Devolve `true` se ela vai sobreviver ao recarregamento e
 * `false` se o armazenamento recusou — quem chama respeita o clique do mesmo
 * jeito (a folha na tela muda na hora), sabendo que a escolha volta ao padrão
 * no próximo F5. Mudar a folha é a resposta ao clique; persistir é o bônus.
 */
export function salvarCamposRomaneio(campos: CamposRomaneio): boolean {
  try {
    const store = window.localStorage
    if (!store) return false
    store.setItem(CHAVE, JSON.stringify(normalizarCampos(campos)))
    return true
  } catch {
    return false
  }
}
