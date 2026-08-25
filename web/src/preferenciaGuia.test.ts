import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { guiaFoiDispensado, dispensarGuia } from './preferenciaGuia'

/** O `localStorage` real do jsdom, para restaurar depois de cada troca. */
const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!

/** Troca `window.localStorage` por outro objeto (ou por um getter que lança). */
function trocarArmazenamento(descritor: PropertyDescriptor) {
  Object.defineProperty(window, 'localStorage', { configurable: true, ...descritor })
}

beforeEach(() => {
  trocarArmazenamento(original)
  window.localStorage.clear()
})

afterEach(() => {
  trocarArmazenamento(original)
  vi.restoreAllMocks()
})

describe('preferenciaGuia — o caminho normal', () => {
  it('começa não dispensado', () => {
    expect(guiaFoiDispensado()).toBe(false)
  })

  it('dispensar grava e a preferência sobrevive à releitura (equivale ao F5)', () => {
    expect(dispensarGuia()).toBe(true)
    // guiaFoiDispensado() lê o armazenamento a cada chamada — é exatamente o
    // que a tela faz ao remontar depois de uma recarga.
    expect(guiaFoiDispensado()).toBe(true)
  })

  it('a chave gravada é reconhecível e não colide com outra do app', () => {
    dispensarGuia()
    const chaves = Object.keys(window.localStorage)
    expect(chaves).toHaveLength(1)
    expect(chaves[0]).toContain('guia')
  })

  it('lixo gravado na chave não conta como dispensa', () => {
    // Alguém (uma extensão, uma versão antiga) pode deixar outro valor ali.
    const chave = (dispensarGuia(), Object.keys(window.localStorage)[0])
    window.localStorage.setItem(chave, 'talvez')
    expect(guiaFoiDispensado()).toBe(false)
  })

  it('limpar o armazenamento traz o guia de volta', () => {
    dispensarGuia()
    window.localStorage.clear()
    expect(guiaFoiDispensado()).toBe(false)
  })
})

describe('preferenciaGuia — armazenamento indisponível não pode quebrar a tela', () => {
  it('o próprio acesso a window.localStorage lançando: lê false em vez de estourar', () => {
    // Navegador com armazenamento de sites bloqueado — o getter lança antes
    // de qualquer chamada de método.
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => guiaFoiDispensado()).not.toThrow()
    expect(guiaFoiDispensado()).toBe(false)
  })

  it('o próprio acesso lançando: gravar devolve false em vez de estourar', () => {
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => dispensarGuia()).not.toThrow()
    expect(dispensarGuia()).toBe(false)
  })

  it('window.localStorage ausente (undefined): lê false e grava false, sem estourar', () => {
    trocarArmazenamento({ value: undefined })
    expect(guiaFoiDispensado()).toBe(false)
    expect(dispensarGuia()).toBe(false)
  })

  it('getItem lançando (modo privado do Safari): lê false', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sem acesso', 'SecurityError')
    })
    expect(() => guiaFoiDispensado()).not.toThrow()
    expect(guiaFoiDispensado()).toBe(false)
  })

  it('setItem lançando (cota estourada): devolve false, e a leitura seguinte também não estoura', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError')
    })
    expect(dispensarGuia()).toBe(false)
    expect(guiaFoiDispensado()).toBe(false)
  })
})
