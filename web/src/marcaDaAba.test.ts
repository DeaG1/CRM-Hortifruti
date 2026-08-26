import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { abaFoiMarcada, marcarAba } from './marcaDaAba'

/** O `sessionStorage` real do jsdom, para restaurar depois de cada troca.
 * Molde: preferenciaGuia.test.ts, que faz o mesmo com `localStorage`. */
const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!

/** Troca `window.sessionStorage` por outro objeto (ou por um getter que lança). */
function trocarArmazenamento(descritor: PropertyDescriptor) {
  Object.defineProperty(window, 'sessionStorage', { configurable: true, ...descritor })
}

beforeEach(() => {
  trocarArmazenamento(original)
  window.sessionStorage.clear()
  window.localStorage.clear()
})

afterEach(() => {
  trocarArmazenamento(original)
  vi.restoreAllMocks()
})

describe('marcaDaAba — o caminho normal', () => {
  it('aba recem aberta nao tem marca', () => {
    // O estado em que uma aba NOVA nasce: sessionStorage e por aba, entao
    // abrir outra guia comeca daqui — e e isto que faz o boot desconfiar do
    // cookie que veio junto.
    expect(abaFoiMarcada()).toBe(false)
  })

  it('marcar grava, e a marca continua la na releitura seguinte (equivale ao F5)', () => {
    expect(marcarAba()).toBe(true)
    // `abaFoiMarcada()` le o armazenamento a cada chamada — e exatamente o
    // que o App faz ao montar depois de uma recarga. A marca sobreviver a
    // releitura e o que garante que F5 nao desloga.
    expect(abaFoiMarcada()).toBe(true)
  })

  it('marcar duas vezes nao muda nada (o boot e o login podem se cruzar)', () => {
    marcarAba()
    expect(marcarAba()).toBe(true)
    expect(abaFoiMarcada()).toBe(true)
  })

  it('a chave gravada e reconhecivel e nao colide com outra do app', () => {
    marcarAba()
    const chaves = Object.keys(window.sessionStorage)
    expect(chaves).toHaveLength(1)
    expect(chaves[0]).toContain('aba')
  })

  it('a marca vai para o sessionStorage e NAO para o localStorage', () => {
    // O erro que mataria a camada inteira em silencio. `localStorage` e por
    // ORIGEM: a marca sobreviveria a fechar a aba, a fechar o navegador e a
    // reiniciar a maquina, entao ela nunca faltaria e o boot confiaria em
    // qualquer cookie — de volta ao problema que esta camada existe para
    // resolver, so que agora com um arquivo a mais fingindo resolve-lo.
    marcarAba()
    expect(window.sessionStorage.getItem(Object.keys(window.sessionStorage)[0])).toBe('1')
    expect(Object.keys(window.localStorage)).toHaveLength(0)
  })

  it('lixo gravado na chave nao conta como marca', () => {
    // Uma extensao, uma versao antiga do app, alguem mexendo no devtools.
    const chave = (marcarAba(), Object.keys(window.sessionStorage)[0])
    window.sessionStorage.setItem(chave, 'talvez')
    expect(abaFoiMarcada()).toBe(false)
  })

  it('limpar o armazenamento e o mesmo que abrir uma aba nova', () => {
    marcarAba()
    window.sessionStorage.clear()
    expect(abaFoiMarcada()).toBe(false)
  })
})

describe('marcaDaAba — armazenamento indisponivel FALHA FECHADA', () => {
  it('o proprio acesso a window.sessionStorage lancando: le false em vez de estourar', () => {
    // Navegador com armazenamento de sites bloqueado: o getter lanca ANTES
    // de qualquer chamada de metodo. `false` aqui significa "nao ha marca",
    // e nao ha marca significa exigir login — o lado seguro.
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => abaFoiMarcada()).not.toThrow()
    expect(abaFoiMarcada()).toBe(false)
  })

  it('o proprio acesso lancando: marcar devolve false em vez de estourar', () => {
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => marcarAba()).not.toThrow()
    expect(marcarAba()).toBe(false)
  })

  it('window.sessionStorage ausente (undefined): le false e grava false, sem estourar', () => {
    trocarArmazenamento({ value: undefined })
    expect(abaFoiMarcada()).toBe(false)
    expect(marcarAba()).toBe(false)
  })

  it('getItem lancando (modo privado): le false', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sem acesso', 'SecurityError')
    })
    expect(() => abaFoiMarcada()).not.toThrow()
    expect(abaFoiMarcada()).toBe(false)
  })

  it('setItem lancando: marcar devolve false, e a leitura seguinte tambem nao estoura', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError')
    })
    expect(marcarAba()).toBe(false)
    expect(abaFoiMarcada()).toBe(false)
  })

  it('armazenamento que aceita gravar mas nao devolve nada continua sendo "sem marca"', () => {
    // Modo privado de alguns navegadores: setItem nao reclama e getItem
    // devolve null. A politica nao pode se dar por satisfeita com o retorno
    // `true` de um setItem que nao guardou nada.
    trocarArmazenamento({ value: { setItem() {}, getItem: () => null } })
    expect(marcarAba()).toBe(true)
    expect(abaFoiMarcada()).toBe(false)
  })
})
