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

async function requisicao<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(rota, {
    method: metodo,
    credentials: 'include',          // o cookie de sessao precisa viajar
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await resposta.text()
  const dados = texto ? JSON.parse(texto) : null
  if (!resposta.ok) throw new ErroApi(resposta.status, dados)
  return dados as T
}

export const api = {
  get: <T>(rota: string) => requisicao<T>('GET', rota),
  post: <T>(rota: string, corpo?: unknown) => requisicao<T>('POST', rota, corpo),
  put: <T>(rota: string, corpo: unknown) => requisicao<T>('PUT', rota, corpo),
  del: <T>(rota: string) => requisicao<T>('DELETE', rota),
}
