/** Erro de resposta HTTP nao-2xx da API. `corpo` e o JSON decodificado (ex.: `{ erro: '...' }`). */
export class ErroApi extends Error {
  status: number
  corpo: unknown

  constructor(status: number, corpo: unknown) {
    super(`API ${status}`)
    this.status = status
    this.corpo = corpo
  }
}

/**
 * Extrai a mensagem que a API mandou junto de um 409, para a tela exibir
 * VERBATIM. Devolve null quando nao ha mensagem exibivel — e ai quem chamou
 * usa o proprio texto generico.
 *
 * POR QUE ISTO EXISTE. Ate agora todo componente traduzia o erro por status,
 * com texto fixo escrito aqui no front ("Já existe um veículo com essa
 * placa."). Isso funciona enquanto o front sabe, de antemao, TODAS as causas
 * possiveis. Para exclusao ele nao sabe e nao tem como saber: quem barra e o
 * banco, por uma chave estrangeira que pode ser criada depois deste arquivo
 * ser escrito. Foi assim que o dono ficou preso — uma FK de uma tabela cuja
 * tela nem existe mais barrava a exclusao, e a unica coisa que ele lia era
 * "Não foi possível excluir. Tente novamente.", que nao diz o motivo e ainda
 * sugere que insistir resolve. Nao resolvia: tentar de novo dava o mesmo erro
 * para sempre.
 *
 * SO 409, de proposito. 409 e o status que esta API usa para "recusei por uma
 * REGRA" — e as mensagens de 409 sao escritas para serem lidas por gente. Os
 * outros nao: 404 devolve `nao encontrado`, 500 devolve `erro interno`
 * (app.onError em api/src/index.ts), textos internos, sem acento, que como
 * aviso na tela seriam piores que o generico. 401 nem chega aqui — cada
 * chamador trata sessao expirada antes.
 *
 * O `trim()` + `|| null` cobre `{ erro: '' }` e `{ erro: '   ' }`: uma
 * mensagem vazia da API nao pode virar um alerta em branco na tela, onde o
 * usuario ve que algo falhou e nao ve nada escrito.
 */
export function mensagemDeBloqueio(err: unknown): string | null {
  if (!(err instanceof ErroApi) || err.status !== 409) return null
  const corpo = err.corpo as { erro?: unknown } | null
  if (typeof corpo?.erro !== 'string') return null
  return corpo.erro.trim() || null
}

async function requisicao<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(rota, {
    method: metodo,
    credentials: 'include',          // o cookie de sessao precisa viajar
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await resposta.text()
  // JSON.parse incondicional quebrava em silencio: um 500 com corpo texto
  // puro ("Internal Server Error", o 500 padrao do runtime quando a API
  // nao trata a excecao) lancava SyntaxError aqui dentro — antes de chegar
  // ao `throw new ErroApi(...)` abaixo — entao o componente nunca recebia
  // um ErroApi, so via a mensagem generica de catch. A API agora sempre
  // devolve JSON em erro (app.onError em api/src/index.ts), mas o client
  // nao pode depender disso: parse defensivo aqui, corpo nao-JSON vira
  // `null` e o ErroApi sai do mesmo jeito, com o status HTTP correto.
  let dados: unknown = null
  if (texto) {
    try { dados = JSON.parse(texto) } catch { dados = null }
  }
  if (!resposta.ok) throw new ErroApi(resposta.status, dados)
  return dados as T
}

export const api = {
  get: <T>(rota: string) => requisicao<T>('GET', rota),
  post: <T>(rota: string, corpo?: unknown) => requisicao<T>('POST', rota, corpo),
  put: <T>(rota: string, corpo: unknown) => requisicao<T>('PUT', rota, corpo),
  patch: <T>(rota: string, corpo: unknown) => requisicao<T>('PATCH', rota, corpo),
  del: <T>(rota: string) => requisicao<T>('DELETE', rota),
}
