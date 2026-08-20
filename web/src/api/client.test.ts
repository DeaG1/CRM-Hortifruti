import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ErroApi } from './client'

// requisicao() fazia JSON.parse(texto) incondicional. Um 500 com corpo
// texto puro ("Internal Server Error", o default do runtime quando a API
// nao trata a excecao) lancava SyntaxError ali dentro, antes do
// `throw new ErroApi(...)` — o componente nunca recebia um ErroApi, so
// via a mensagem generica do catch-all, sem pista nenhuma do motivo real.
// Estes testes mockam `fetch` diretamente (sem servidor real) para provar
// que qualquer corpo nao-JSON em erro ainda vira ErroApi com o status certo.

function mockFetch(status: number, corpoTexto: string, ok = status >= 200 && status < 300) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(corpoTexto),
  } as Response)
}

const originalFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = originalFetch })

describe('client — parse defensivo de erro', () => {
  it('500 com corpo texto puro (nao-JSON) ainda lanca ErroApi com o status correto', async () => {
    globalThis.fetch = mockFetch(500, 'Internal Server Error')
    await expect(api.get('/api/qualquer')).rejects.toBeInstanceOf(ErroApi)
    globalThis.fetch = mockFetch(500, 'Internal Server Error')
    await expect(api.get('/api/qualquer')).rejects.toMatchObject({ status: 500, corpo: null })
  })

  it('502/504 de proxy (corpo HTML/texto de gateway) tambem vira ErroApi, nao SyntaxError', async () => {
    globalThis.fetch = mockFetch(502, '<html><body>Bad Gateway</body></html>')
    await expect(api.get('/api/qualquer')).rejects.toBeInstanceOf(ErroApi)
  })

  it('corpo vazio em erro vira ErroApi com corpo null', async () => {
    globalThis.fetch = mockFetch(500, '')
    await expect(api.get('/api/qualquer')).rejects.toMatchObject({ status: 500, corpo: null })
  })

  it('corpo JSON valido em erro continua decodificado normalmente (nao regride)', async () => {
    globalThis.fetch = mockFetch(409, JSON.stringify({ erro: 'ja existe um cliente com esse nome' }))
    await expect(api.get('/api/qualquer')).rejects.toMatchObject({
      status: 409,
      corpo: { erro: 'ja existe um cliente com esse nome' },
    })
  })

  it('sucesso com corpo JSON valido continua decodificando normalmente', async () => {
    globalThis.fetch = mockFetch(200, JSON.stringify({ ok: true }))
    await expect(api.get('/api/qualquer')).resolves.toEqual({ ok: true })
  })
})
