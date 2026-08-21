import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

const CAMPOS = ['nome', 'un', 'peso_medio'] as const

type Produto = Record<(typeof CAMPOS)[number], string | number>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente. */
function sanear(corpo: Record<string, unknown>): Partial<Produto> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Produto>
}

/**
 * numeric vem como string do postgres.js — converter na borda da API.
 * `tenant_id` sai do corpo pelo mesmo motivo do molde (clientes.ts): e
 * identificador interno, RLS ja isola no servidor, ninguem "usa" isso no
 * cliente.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, peso_medio: Number(linha.peso_medio ?? 0) }
}

/** true so quando o valor existe e converte pra um numero finito negativo —
 * ausente (undefined) nao e invalido, so significa "nao alterar este campo". */
function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

/**
 * `peso_medio` negativo e dado corrompido (vira base do calculo de
 * CX -> KG, ver comentario da coluna na migration 009). A constraint no
 * banco (produtos_peso_medio_check) e a ultima linha de defesa — ver
 * respostaDeErroPg, que mapeia o 23514 caso esta checagem seja contornada.
 */
function erroDeCampoInvalido(dados: Partial<Produto>): string | null {
  if (numeroNegativo(dados.peso_medio)) return 'peso medio nao pode ser negativo'
  return null
}

/**
 * nome vazio ou so espaco e o mesmo problema que nome ausente — mesma regra
 * do molde (clientes.ts).
 */
function nomeEmBranco(nome: unknown): boolean {
  return typeof nome !== 'string' || nome.trim() === ''
}

/**
 * `produtos` tem duas CHECK constraints (un, peso_medio), ambas SQLSTATE
 * 23514. O nome da constraint identifica qual foi violada sem depender de
 * string matching na mensagem do Postgres — mesmo raciocinio de
 * MENSAGENS_CHECK em clientes.ts.
 */
const MENSAGENS_CHECK: Record<string, string> = {
  produtos_un_check: 'unidade invalida',
  produtos_peso_medio_check: 'peso medio nao pode ser negativo',
}

/**
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis
 * em vez de deixar a excecao subir crua. Mesmo contrato de clientes.ts.
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um produto com esse nome' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sem isto, um id malformado chega intacto ao `where id = $1` e o Postgres
 * lanca "invalid input syntax for type uuid" tentando o cast — erro que
 * sobe sem tratamento especifico (500 JSON generico via app.onError, nunca
 * o {erro} previsivel que o contrato desta API espera).
 */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

export const produtos = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

produtos.use('*', exigirSessao, exigirAdmin)

produtos.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from produtos order by nome`)
  return c.json(linhas.map(paraJson))
})

produtos.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from produtos where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

produtos.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into produtos ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

produtos.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  // nome so e validado se veio no corpo — ausente continua significando
  // "nao alterar este campo", igual aos demais campos do PUT.
  if ('nome' in dados) {
    if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
    dados.nome = (dados.nome as string).trim()
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update produtos set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

produtos.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from produtos where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
