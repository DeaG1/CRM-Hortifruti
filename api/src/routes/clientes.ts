import { Hono } from 'hono'
import { withTenant } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

const CAMPOS = [
  'nome','resp','cnpj','tel','email','endereco','rota','freq',
  'status','cobranca','forma','limite','prazo','tend','obs',
] as const

type Cliente = Record<(typeof CAMPOS)[number], string | number>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente. */
function sanear(corpo: Record<string, unknown>): Partial<Cliente> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Cliente>
}

/** numeric vem como string do postgres.js — converter na borda da API. */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  return { ...linha, limite: Number(linha.limite ?? 0), prazo: Number(linha.prazo ?? 0) }
}

export const clientes = new Hono<{
  Bindings: { DATABASE_URL: string }
  Variables: Vars
}>()

clientes.use('*', exigirSessao, exigirAdmin)

clientes.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from clientes order by nome`)
  return c.json(linhas.map(paraJson))
})

clientes.get('/:id', async (c) => {
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from clientes where id = ${c.req.param('id')}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

clientes.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (!dados.nome) return c.json({ erro: 'nome e obrigatorio' }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into clientes ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    if (String(err).includes('duplicate key')) {
      return c.json({ erro: 'ja existe um cliente com esse nome' }, 409)
    }
    throw err
  }
})

clientes.put('/:id', async (c) => {
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`update clientes set ${tx({ ...dados, alterado_em: new Date() })}
       where id = ${c.req.param('id')} returning *`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

clientes.delete('/:id', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from clientes where id = ${c.req.param('id')} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
