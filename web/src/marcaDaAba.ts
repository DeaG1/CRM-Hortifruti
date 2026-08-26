/**
 * A MARCA DA ABA — terceira e ultima camada da politica de computador
 * compartilhado.
 *
 * O QUE AINDA FALTAVA
 *
 * As duas camadas de 478133f fecharam dois buracos e deixaram um aberto:
 *
 *   1. cookie de sessao (sem Max-Age) — morre ao fechar O NAVEGADOR INTEIRO;
 *   2. 30 minutos de inatividade no servidor — morre com a maquina parada.
 *
 * Nenhuma das duas cobre FECHAR A ABA. Cookie e escopo de navegador, nao de
 * aba: fechar a guia do CRM e abrir outra devolve a mesma sessao, sem tela de
 * login. No balcao isso e o mesmo problema de sempre com outra roupa — o dono
 * fecha a aba achando que saiu, o funcionario abre uma nova e cai dentro de
 * Financeiro.
 *
 * COMO A ABA E DETECTADA (E POR QUE NAO POR EVENTO DE SAIDA)
 *
 * A aba logada grava uma marca aqui. No boot da aplicacao (App.tsx), cookie
 * sem marca = aba que nunca autenticou: a sessao e ENCERRADA NO SERVIDOR e a
 * pessoa digita a senha.
 *
 * A tentacao e usar `beforeunload`/`pagehide` para deslogar quando a aba
 * fecha. NAO SERVE, e nao e questao de gosto: esses eventos disparam
 * IGUALZINHO em F5 e em navegacao para outra pagina. Um F5 acidental
 * derrubaria a sessao do funcionario no meio de um pedido — e F5 acidental
 * acontece o tempo todo. A deteccao aqui e pela AUSENCIA DA MARCA no boot,
 * que e um estado, nao um evento: recarregar nao apaga a marca, entao
 * recarregar nao desloga.
 *
 * POR QUE `sessionStorage`, E POR QUE NAO `localStorage`
 *
 * `sessionStorage` e por ABA e sobrevive ao recarregamento — exatamente o
 * recorte que esta camada precisa. `localStorage` seria trocar o bug pelo
 * bug: ele e por ORIGEM e sobrevive a fechar a aba, ao navegador e a
 * reiniciar a maquina, ou seja, a marca nunca faltaria e a camada inteira
 * viraria enfeite. Ha um teste so para isso (marcaDaAba.test.ts): gravar a
 * marca nao pode deixar nada em `localStorage`.
 *
 * LIMITE CONHECIDO, DITO SEM MAQUIAGEM: aba FILHA copia a marca. Quando o
 * navegador abre uma aba a partir de outra (`window.open`, link com
 * `target="_blank"`, "Duplicar guia"), ele CLONA o sessionStorage da aba de
 * origem. Essa aba nasce marcada e passa pelo boot sem ser barrada. O CRM nao
 * tem nenhum link assim para si mesmo (nao ha `window.open` nem `_blank` em
 * web/src), entao sobra o caso de quem duplica a guia de proposito — que ja
 * esta dentro da sessao naquele instante e nao ganha acesso nenhum que nao
 * tivesse. Abrir aba nova pela barra de enderecos, por atalho ou por
 * favorito, que e como uma segunda pessoa chega, comeca com sessionStorage
 * VAZIO e cai na regra.
 *
 * FALHA FECHADA. Navegador com armazenamento de sites bloqueado faz o proprio
 * acesso a `window.sessionStorage` LANCAR, antes de qualquer leitura — por
 * isso o objeto e alcancado DENTRO do try, e nao so as chamadas de metodo.
 * E, ao contrario de preferenciaGuia.ts (onde falhar significa "mostra o guia
 * de novo", um incomodo), falhar aqui significa "nao ha marca", e nao ha
 * marca significa EXIGIR LOGIN. Quem bloqueia armazenamento digita a senha a
 * cada recarregamento; ninguem entra sem digitar.
 */

const CHAVE = 'crm_hf_aba_autenticada'
const VALOR = '1'

/**
 * Esta aba ja autenticou alguem?
 *
 * `false` em qualquer duvida — armazenamento bloqueado, ausente ou com lixo
 * gravado na chave. Ver "FALHA FECHADA" acima: a resposta negativa custa uma
 * senha digitada, a positiva errada entrega a sessao do dono.
 */
export function abaFoiMarcada(): boolean {
  try {
    return window.sessionStorage?.getItem(CHAVE) === VALOR
  } catch {
    return false
  }
}

/**
 * Marca esta aba como dona de uma sessao. Chamada nos DOIS caminhos em que
 * alguem autentica (login da entrada e reautenticacao por cima do aviso de
 * sessao expirada), sempre ANTES de a area logada montar.
 *
 * Devolve `false` se o armazenamento recusou. Quem chama nao muda de rumo por
 * causa disso: a sessao desta aba vale enquanto ela estiver aberta de
 * qualquer jeito, e o preco de nao ter gravado aparece no proximo boot — que
 * vai pedir a senha de novo. Errar para o lado de pedir senha e o lado certo
 * de errar nesta politica.
 */
export function marcarAba(): boolean {
  try {
    const store = window.sessionStorage
    if (!store) return false
    store.setItem(CHAVE, VALOR)
    return true
  } catch {
    return false
  }
}
