import { alturaUtilPx, corpoQueCabe, escalaDoCorpo } from '../derive/folhaEntrega'

/**
 * A PONTE ENTRE A REGRA E O DOM: mede a folha na geometria do PAPEL e devolve
 * o corpo de letra que a faz caber em uma página.
 *
 * A decisão — quanto encolher a cada volta, quando parar, o que fazer com
 * altura zero — está em `corpoQueCabe` (derive/folhaEntrega.ts), pura e
 * testada sem navegador. O que mora aqui é só o que precisa tocar o DOM, e por
 * isso não está em derive/: clonar, montar a caixa de medição, ler a altura,
 * limpar.
 *
 * ---- POR QUE UM CLONE, E NÃO A FOLHA DE VERDADE ----
 *
 * Medir a folha real exigiria mudar a largura dela para a do papel, ler a
 * altura e devolvê-la ao tamanho da tela — e entre essas três coisas existe
 * um quadro em que o navegador pode pintar. A folha piscaria de largura a cada
 * medição. O clone mede fora da vista e é descartado; a folha na tela nunca
 * sabe que isso aconteceu.
 *
 * ---- POR QUE ESTE ARQUIVO É SEPARADO DO COMPONENTE ----
 *
 * Porque ele é o que a PROVA DE IMPRESSÃO carrega. A folha só cumpre o
 * requisito ("sempre uma página") se a medição feita no navegador de verdade
 * corresponder ao que o Chrome imprime, e isso se verifica gerando um PDF —
 * não rodando o React. Um módulo sem React pode ser empacotado sozinho e
 * executado na página que vira PDF, então o que se prova é ESTA função, e não
 * uma cópia dela escrita à mão no arnês, que é como um arnês passa a provar
 * algo que o produto não faz.
 *
 * Ver `.folha-medindo` em FolhaImpressa.css: é lá que a geometria do papel é
 * declarada, colada às regras de `@media print`, para as duas mudarem juntas.
 */
export function medirCorpoQueCabe(elemento: HTMLElement): number {
  const doc = elemento.ownerDocument
  const caixa = doc.createElement('div')
  // `folha-tela` junto: é ela que declara a família de letra da folha, e medir
  // com outra fonte é medir outra folha. `data-no-print` porque uma caixa de
  // medição que sobrevivesse até a impressão sairia no papel.
  caixa.className = 'folha-tela folha-medindo'
  caixa.setAttribute('data-no-print', '1')
  caixa.setAttribute('aria-hidden', 'true')

  const clone = elemento.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  // O clone vem da folha de verdade, que já pode estar encolhida — a medição
  // recomeça sempre do tamanho confortável, senão cada impressão encolheria um
  // pouco mais que a anterior.
  clone.style.zoom = ''
  caixa.appendChild(clone)
  doc.body.appendChild(caixa)

  try {
    return corpoQueCabe(corpo => {
      clone.style.zoom = String(escalaDoCorpo(corpo))
      return clone.getBoundingClientRect().height
    }, alturaUtilPx())
  } finally {
    caixa.remove()
  }
}
