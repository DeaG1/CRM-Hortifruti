import { describe, it, expect, afterEach } from 'vitest'
import { medirCorpoQueCabe } from './medicaoDaFolha'
import { CORPO_CONFORTAVEL, alturaUtilPx } from '../derive/folhaEntrega'

/**
 * A PONTE ENTRE A REGRA E O DOM.
 *
 * O jsdom não faz layout: toda altura é zero. Isso já prova uma coisa que
 * importa (altura zero NÃO pode ser lida como "coube"), e o resto se prova
 * trocando `getBoundingClientRect` por um medidor controlado — que é o único
 * ponto em que esta função lê o mundo.
 *
 * O que ela faz com o PAPEL de verdade (se a altura medida corresponde à
 * página impressa) é provado fora daqui, imprimindo em PDF no Chrome: nenhum
 * teste em jsdom pode responder isso, e fingir que pode seria pior que não
 * testar.
 */

const originalGBCR = Element.prototype.getBoundingClientRect

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGBCR
  document.body.innerHTML = ''
})

/** Uma folha no documento, como a tela a renderiza. */
function folhaNoDocumento(): HTMLElement {
  const tela = document.createElement('div')
  tela.className = 'folha-tela'
  tela.innerHTML = '<div class="folha folha-entrega" data-corpo="12">'
    + '<table class="folha-tabela"><tbody><tr class="folha-item">'
    + '<td>Alface Crespa</td><td>10 CX</td></tr></tbody></table></div>'
  document.body.appendChild(tela)
  return tela.querySelector<HTMLElement>('.folha-entrega')!
}

/** Substitui a medição do navegador por uma que devolve `altura` e anota o
 * estado do DOM no momento em que foi chamada. */
function medidorFalso(altura: (zoom: number) => number) {
  const visto: {
    dentroDaCaixa: boolean
    caixaNaoImprime: boolean
    caixaTemFolhaTela: boolean
    zoom: string
  }[] = []
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const caixa = this.closest('.folha-medindo')
    const zoom = (this as HTMLElement).style.zoom
    visto.push({
      dentroDaCaixa: !!caixa,
      caixaNaoImprime: caixa?.getAttribute('data-no-print') === '1',
      caixaTemFolhaTela: caixa?.classList.contains('folha-tela') ?? false,
      zoom,
    })
    return { height: altura(Number(zoom) || 1), width: 0 } as DOMRect
  }
  return visto
}

describe('medirCorpoQueCabe', () => {
  it('sem layout (jsdom), NÃO encolhe: altura zero não é "coube"', () => {
    expect(medirCorpoQueCabe(folhaNoDocumento())).toBe(CORPO_CONFORTAVEL)
  })

  it('a caixa de medição não fica para trás no documento', () => {
    medirCorpoQueCabe(folhaNoDocumento())
    expect(document.querySelectorAll('.folha-medindo')).toHaveLength(0)
  })

  it('a caixa some mesmo quando a medição estoura no meio', () => {
    Element.prototype.getBoundingClientRect = () => { throw new Error('reflow explodiu') }
    expect(() => medirCorpoQueCabe(folhaNoDocumento())).toThrow()
    expect(document.querySelectorAll('.folha-medindo')).toHaveLength(0)
  })

  it('mede um CLONE — a folha na tela não ganha zoom nenhum durante a medição', () => {
    const el = folhaNoDocumento()
    medidorFalso(z => 4000 * z)
    medirCorpoQueCabe(el)
    // `?? ''` porque o jsdom não implementa `zoom`: nunca escrito, ele é
    // `undefined`; escrito, ele volta como a string que a medição pôs.
    expect(el.style.zoom ?? '').toBe('')
    expect(el.getAttribute('data-corpo')).toBe('12')
  })

  it('a medição acontece dentro da caixa com a geometria do papel, e ela não imprime', () => {
    const visto = medidorFalso(z => 4000 * z)
    medirCorpoQueCabe(folhaNoDocumento())
    expect(visto.length).toBeGreaterThan(0)
    for (const v of visto) {
      expect(v.dentroDaCaixa).toBe(true)
      expect(v.caixaNaoImprime).toBe(true)
      // `folha-tela` junto: é ela que declara a família de letra da folha, e
      // medir com outra fonte é medir outra folha.
      expect(v.caixaTemFolhaTela).toBe(true)
    }
  })

  it('a primeira medição é no tamanho confortável — a busca sempre recomeça do topo', () => {
    // O `clone.style.zoom = ''` da ponte existe para o caso em que a folha na
    // tela JÁ está encolhida: sem ele, cada impressão encolheria um pouco mais
    // que a anterior. Isso não é observável no jsdom (ele não implementa
    // `zoom`, então o clone nunca carrega o valor do original); o que dá para
    // afirmar aqui é o que importa em qualquer ambiente — a primeira medição
    // acontece na escala 1.
    const visto = medidorFalso(() => 100)
    medirCorpoQueCabe(folhaNoDocumento())
    expect(visto[0].zoom).toBe('1')
  })

  it('encolhe até caber de verdade na altura útil da página', () => {
    // 4000px no tamanho confortável — mais que o triplo da página.
    medidorFalso(z => 4000 * z)
    const corpo = medirCorpoQueCabe(folhaNoDocumento())
    expect(corpo).toBeLessThan(CORPO_CONFORTAVEL)
    expect(4000 * (corpo / CORPO_CONFORTAVEL)).toBeLessThanOrEqual(alturaUtilPx())
  })

  it('folha que já cabe não encolhe nada', () => {
    medidorFalso(z => 500 * z)
    expect(medirCorpoQueCabe(folhaNoDocumento())).toBe(CORPO_CONFORTAVEL)
  })
})
