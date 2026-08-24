import { describe, it, expect, afterEach } from 'vitest'
import { instalarGuardaDeScrollNumerico } from './campoNumerico'

/**
 * O comportamento protegido aqui e traicoeiro: o navegador altera
 * `<input type="number">` quando a roda gira sobre ele focado. O jsdom NAO
 * implementa esse incremento, entao um teste que so verificasse "o valor nao
 * mudou" passaria mesmo sem a correcao — teste decorativo.
 *
 * Por isso a verificacao e sobre o mecanismo que impede a mudanca: o campo
 * perde o foco ao rolar. Se perdeu o foco, o navegador real nao tem como
 * alterar o valor.
 */
describe('guarda de scroll em campo numerico', () => {
  let desinstalar: (() => void) | null = null

  afterEach(() => {
    desinstalar?.()
    desinstalar = null
    document.body.innerHTML = ''
  })

  function campo(type: string) {
    const el = document.createElement('input')
    el.type = type
    document.body.appendChild(el)
    el.focus()
    return el
  }

  function rolarSobre(el: HTMLElement) {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
  }

  it('tira o foco de um campo numerico quando a roda gira sobre ele', () => {
    desinstalar = instalarGuardaDeScrollNumerico()
    const preco = campo('number')
    expect(document.activeElement).toBe(preco)

    rolarSobre(preco)

    expect(document.activeElement).not.toBe(preco)
  })

  it('nao interfere em campo de texto', () => {
    desinstalar = instalarGuardaDeScrollNumerico()
    const nome = campo('text')

    rolarSobre(nome)

    // Rolar dentro de um campo de texto longo e legitimo — o foco fica.
    expect(document.activeElement).toBe(nome)
  })

  it('nao interfere em campo numerico que nao esta focado', () => {
    desinstalar = instalarGuardaDeScrollNumerico()
    const focado = campo('number')
    const outro = document.createElement('input')
    outro.type = 'number'
    document.body.appendChild(outro)
    focado.focus()

    // Roda gira sobre o campo NAO focado: o navegador tambem nao alteraria
    // esse campo, entao nao ha nada a impedir — e roubar o foco de quem esta
    // digitando seria pior que o problema original.
    rolarSobre(outro)

    expect(document.activeElement).toBe(focado)
  })

  it('para de agir depois de desinstalado', () => {
    const parar = instalarGuardaDeScrollNumerico()
    parar()
    const preco = campo('number')

    rolarSobre(preco)

    expect(document.activeElement).toBe(preco)
  })
})
