import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ErroApi, mensagemDeBloqueio } from './client'

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

/**
 * mensagemDeBloqueio existe porque o front nao tem como conhecer, de antemao,
 * todas as causas de um bloqueio de exclusao: quem barra e o banco, por uma FK
 * que pode nascer depois do componente ser escrito. Foi assim que o dono do
 * negocio ficou preso — uma FK de uma tabela cuja tela nem existe mais barrava
 * a exclusao, e a unica coisa que ele lia era "Não foi possível excluir. Tente
 * novamente.". Tentar de novo dava o mesmo erro, sempre.
 */
describe('mensagemDeBloqueio — o texto do 409 chega a tela', () => {
  it('409 com {erro} devolve a mensagem para a tela exibir verbatim', () => {
    const texto = 'Este veículo está vinculado a outros registros e não pode ser excluído.'
    expect(mensagemDeBloqueio(new ErroApi(409, { erro: texto }))).toBe(texto)
  })

  it('409 com uma causa desconhecida passa igual — e o ponto de nao ter texto fixo', () => {
    expect(mensagemDeBloqueio(new ErroApi(409, { erro: 'Causa que ainda nao existe.' })))
      .toBe('Causa que ainda nao existe.')
  })

  it('so 409: 500 devolve null (o corpo e `erro interno`, texto de log, nao aviso de tela)', () => {
    expect(mensagemDeBloqueio(new ErroApi(500, { erro: 'erro interno' }))).toBeNull()
  })

  it('so 409: 404 devolve null (`nao encontrado` nao e mensagem escrita para o usuario)', () => {
    expect(mensagemDeBloqueio(new ErroApi(404, { erro: 'nao encontrado' }))).toBeNull()
  })

  it('409 sem corpo JSON (o 500/502 de proxy que vira corpo null) devolve null', () => {
    expect(mensagemDeBloqueio(new ErroApi(409, null))).toBeNull()
  })

  it('409 com {erro} vazio ou so espaco devolve null — alerta em branco na tela e pior que o generico', () => {
    expect(mensagemDeBloqueio(new ErroApi(409, { erro: '' }))).toBeNull()
    expect(mensagemDeBloqueio(new ErroApi(409, { erro: '   ' }))).toBeNull()
  })

  it('409 com `erro` que nao e string devolve null (nao vira "[object Object]" na tela)', () => {
    expect(mensagemDeBloqueio(new ErroApi(409, { erro: { texto: 'x' } }))).toBeNull()
    expect(mensagemDeBloqueio(new ErroApi(409, { outroCampo: 'x' }))).toBeNull()
  })

  it('erro que nao e ErroApi (falha de rede, TypeError) devolve null', () => {
    expect(mensagemDeBloqueio(new Error('Failed to fetch'))).toBeNull()
    expect(mensagemDeBloqueio(undefined)).toBeNull()
  })
})
