import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { camposSalvosRomaneio, salvarCamposRomaneio } from './preferenciaRomaneio'
import { CAMPOS_ROMANEIO_PADRAO, type CamposRomaneio } from './derive/romaneio'

/** O `localStorage` real do jsdom, para restaurar depois de cada troca —
 * mesmo arranjo de preferenciaGuia.test.ts. */
const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!

function trocarArmazenamento(descritor: PropertyDescriptor) {
  Object.defineProperty(window, 'localStorage', { configurable: true, ...descritor })
}

function campos(over: Partial<CamposRomaneio> = {}): CamposRomaneio {
  return { ...CAMPOS_ROMANEIO_PADRAO, ...over }
}

beforeEach(() => {
  trocarArmazenamento(original)
  window.localStorage.clear()
})

afterEach(() => {
  trocarArmazenamento(original)
  vi.restoreAllMocks()
})

describe('preferenciaRomaneio — o caminho normal', () => {
  it('sem nada gravado, começa no padrão (com preço desmarcado)', () => {
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
    expect(camposSalvosRomaneio().precoUnitario).toBe(false)
  })

  it('a escolha sobrevive à releitura — é o F5 de quem imprime todo dia', () => {
    const escolha = campos({ precoUnitario: true, telefone: false })
    expect(salvarCamposRomaneio(escolha)).toBe(true)
    // Lê o armazenamento a cada chamada, exatamente como a tela faz ao
    // remontar depois de uma recarga.
    expect(camposSalvosRomaneio()).toEqual(escolha)
  })

  it('gravar duas vezes deixa a última escolha, não as duas', () => {
    salvarCamposRomaneio(campos({ precoUnitario: true }))
    salvarCamposRomaneio(campos({ precoUnitario: false, obs: false }))
    expect(camposSalvosRomaneio()).toEqual(campos({ obs: false }))
    expect(Object.keys(window.localStorage)).toHaveLength(1)
  })

  it('a chave é reconhecível e não colide com a do guia de primeiros passos', () => {
    salvarCamposRomaneio(campos())
    const chaves = Object.keys(window.localStorage)
    expect(chaves).toHaveLength(1)
    expect(chaves[0]).toContain('romaneio')
    expect(chaves[0]).not.toContain('guia')
  })

  it('limpar o armazenamento devolve o padrão', () => {
    salvarCamposRomaneio(campos({ precoUnitario: true }))
    window.localStorage.clear()
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })
})

describe('preferenciaRomaneio — lixo gravado cai do lado seguro', () => {
  function gravarCru(valor: string) {
    salvarCamposRomaneio(campos())
    window.localStorage.setItem(Object.keys(window.localStorage)[0], valor)
  }

  it('string que não é JSON vira o padrão em vez de exceção', () => {
    gravarCru('nao é json {')
    expect(() => camposSalvosRomaneio()).not.toThrow()
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })

  it('JSON válido mas de outro formato (array, número) vira o padrão', () => {
    gravarCru('[1,2,3]')
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
    gravarCru('42')
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })

  it('objeto com chave desconhecida não contamina a escolha', () => {
    gravarCru(JSON.stringify({ endereco: false, cpf: true }))
    const lido = camposSalvosRomaneio() as Record<string, unknown>
    expect(lido.cpf).toBeUndefined()
    expect(lido.endereco).toBe(false)
  })

  it('lixo NUNCA liga um campo de preço — a falha cai sempre do lado seguro', () => {
    for (const cru of ['nao é json {', '"precoUnitario"', JSON.stringify({ precoUnitario: 'sim' })]) {
      gravarCru(cru)
      const lido = camposSalvosRomaneio()
      expect(lido.precoUnitario).toBe(false)
      expect(lido.totalItem).toBe(false)
      expect(lido.totalPedido).toBe(false)
    }
  })
})

describe('preferenciaRomaneio — armazenamento indisponível não pode quebrar a tela', () => {
  it('o próprio acesso a window.localStorage lançando: lê o padrão em vez de estourar', () => {
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => camposSalvosRomaneio()).not.toThrow()
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })

  it('o próprio acesso lançando: gravar devolve false em vez de estourar', () => {
    trocarArmazenamento({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    expect(() => salvarCamposRomaneio(campos())).not.toThrow()
    expect(salvarCamposRomaneio(campos())).toBe(false)
  })

  it('window.localStorage ausente: lê o padrão e grava false, sem estourar', () => {
    trocarArmazenamento({ value: undefined })
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
    expect(salvarCamposRomaneio(campos())).toBe(false)
  })

  it('getItem lançando (modo privado do Safari): lê o padrão', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('sem acesso', 'SecurityError')
    })
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })

  it('setItem lançando (cota estourada): devolve false, e a leitura seguinte também não estoura', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota', 'QuotaExceededError')
    })
    expect(salvarCamposRomaneio(campos({ precoUnitario: true }))).toBe(false)
    expect(camposSalvosRomaneio()).toEqual(CAMPOS_ROMANEIO_PADRAO)
  })
})
