/**
 * A dispensa manual do guia de primeiros passos (ver derive/primeirosPassos.ts).
 *
 * ONDE ELA MORA, E POR QUÊ
 *
 * `localStorage`, e não uma coluna no servidor. As duas opções têm custo:
 *
 *   - `localStorage` é por navegador: o dono dispensa no computador e o guia
 *     ainda aparece no celular.
 *   - Uma coluna (`usuarios.guia_dispensado_em`) atravessaria migration,
 *     rota, testes de API e cache do cliente — para guardar uma preferência
 *     de UI cuja vida inteira é a janela de onboarding.
 *
 * O primeiro custo é limitado no tempo: o guia fecha sozinho e para sempre
 * assim que a primeira saída é lançada (a "graduação", em
 * derive/primeirosPassos.ts), o que acontece em dias — não em meses. Ver o
 * guia duas vezes em dois aparelhos durante essa janela é barato. Já pagar
 * uma mudança de esquema por isso não é. Se um dia a preferência precisar
 * seguir a pessoa entre aparelhos, este módulo é o único ponto a trocar:
 * ninguém mais no app fala com `localStorage`.
 *
 * CHAVE ÚNICA, SEM TENANT: o cliente não conhece o tenant depois do login (a
 * sessão o resolve no servidor; `GET /api/eu` devolve só usuário e papel).
 * Quem opera duas empresas no mesmo navegador, as duas em onboarding ao
 * mesmo tempo, herda a dispensa da outra — um painel de dica a menos, no
 * pior caso.
 *
 * NADA AQUI PODE QUEBRAR A TELA. `localStorage` falha de três jeitos
 * diferentes e todos acontecem em produção: o próprio acesso a
 * `window.localStorage` LANÇA quando o navegador bloqueia armazenamento de
 * sites (política corporativa, Chrome com cookies de terceiros desligados em
 * iframe), `getItem`/`setItem` lançam em modo privado do Safari e `setItem`
 * lança QuotaExceededError com o disco cheio. Por isso o acesso ao objeto
 * está DENTRO do try, e não só as chamadas — e a falha significa "não há
 * preferência gravada", nunca uma exceção subindo até o React.
 */

const CHAVE = 'crm_hf_guia_primeiros_passos_dispensado'
const VALOR = '1'

/**
 * O `window.localStorage` fica DENTRO do try das duas funções abaixo, e não
 * atrás de um helper com try/catch próprio: um helper desses seria uma
 * segunda camada de defesa que nenhum teste consegue distinguir da primeira
 * (a mutação que a removia passou por todos os testes — mutante equivalente,
 * ou seja, código morto). Uma camada só, e ela é testada.
 */

/** O usuário já dispensou o guia neste navegador? Falha = `false` (o guia
 * aparece), porque o padrão de um guia de onboarding é aparecer. */
export function guiaFoiDispensado(): boolean {
  try {
    return window.localStorage?.getItem(CHAVE) === VALOR
  } catch {
    return false
  }
}

/**
 * Grava a dispensa. Devolve `true` se ela vai sobreviver ao recarregamento e
 * `false` se o armazenamento recusou — quem chama fecha o painel do mesmo
 * jeito (a sessão atual respeita o clique), sabendo que ele volta no próximo
 * F5. Fechar na tela é a resposta ao clique; persistir é o bônus.
 */
export function dispensarGuia(): boolean {
  try {
    const store = window.localStorage
    if (!store) return false
    store.setItem(CHAVE, VALOR)
    return true
  } catch {
    return false
  }
}
