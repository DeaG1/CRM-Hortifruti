import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

// Perda de deposito (pos-entrada) — sem itens, uma linha por produto/data.
// A perda ocorrida na coleta/transporte fica dentro da propria entrada
// (entradas.perda_kg / entrada_itens.perda_kg, ver routes/entradas.ts); esta
// tabela e so a perda que acontece depois, no deposito.
const CAMPOS = ['data', 'produto_id', 'un', 'qtd', 'motivo', 'obs'] as const

type Perda = Record<(typeof CAMPOS)[number], string | number>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente. */
function sanear(corpo: Record<string, unknown>): Partial<Perda> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Perda>
}

/**
 * numeric vem como string do postgres.js — converter na borda da API.
 * `tenant_id` sai do corpo pelo mesmo motivo do molde (clientes.ts): e
 * identificador interno, RLS ja isola no servidor, ninguem "usa" isso no
 * cliente.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, qtd: Number(linha.qtd ?? 0) }
}

/** true so quando o valor existe e converte pra um numero finito negativo —
 * ausente (undefined) nao e invalido, so significa "nao alterar este campo". */
function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

function campoTextoEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sem isto, um id malformado chega intacto ao `where id = $1` (ou a FK de
 * produto_id) e o Postgres lanca "invalid input syntax for type uuid"
 * tentando o cast — erro que sobe sem tratamento especifico (500 JSON
 * generico via app.onError, nunca o {erro} previsivel que esta API espera).
 */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * `qtd` negativo e dado corrompido (mesmo raciocinio de limite/prazo em
 * clientes.ts — a constraint no banco, perdas_qtd_check, e a ultima linha de
 * defesa). `produto_id`, quando presente, precisa ser um uuid valido — senao
 * o cast pro tipo uuid estoura antes mesmo de chegar na FK.
 */
function erroDeCampoInvalido(dados: Partial<Perda>): string | null {
  if (numeroNegativo(dados.qtd)) return 'qtd nao pode ser negativo'
  if (dados.produto_id !== undefined && !idValido(String(dados.produto_id))) {
    return 'produto_id invalido'
  }
  return null
}

/**
 * `perdas` tem duas CHECK constraints (motivo, qtd), SQLSTATE 23514, e uma
 * FOREIGN KEY composta para produtos — (tenant_id, produto_id) references
 * produtos(tenant_id, id), constraint `perdas_produto_fk` desde a migration
 * 010_fk_com_tenant.sql (antes era uma FK simples so em produto_id; a
 * composta fecha o furo de a checagem de FK rodar com os privilegios do
 * dono da tabela, ignorando RLS). So existe essa unica FK nesta tabela, por
 * isso o 23503 abaixo nao precisa olhar `constraint_name` pra escolher a
 * mensagem. Nao ha nenhuma constraint de unicidade nesta tabela — o 23505
 * abaixo fica sem uso hoje, mantido so pela consistencia estrutural com as
 * outras rotas (clientes/produtos/fornecedores/entradas), caso uma
 * restricao futura precise dele.
 */
const MENSAGENS_CHECK: Record<string, string> = {
  perdas_motivo_check: 'motivo invalido',
  perdas_qtd_check: 'qtd nao pode ser negativo',
}

export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe uma perda equivalente' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  if (e.code === '23503') return { corpo: { erro: 'produto nao encontrado' }, status: 400 }
  return null
}

export const perdas = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Design: perdas (parte da tela de Estoque) e visivel para colaborador (ver
// web/src/telas.ts, ADMIN_ONLY_SCREENS nao inclui 'estoque') — so
// exigirSessao, sem exigirAdmin. Difere de clientes/produtos/fornecedores
// de proposito.
perdas.use('*', exigirSessao)

perdas.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from perdas order by data desc, criado_em desc`)
  return c.json(linhas.map(paraJson))
})

perdas.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from perdas where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

perdas.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (campoTextoEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)
  if (dados.produto_id === undefined || !idValido(String(dados.produto_id))) {
    return c.json({ erro: 'produto_id invalido' }, 400)
  }
  if (dados.qtd === undefined || numeroNegativo(dados.qtd)) {
    return c.json({ erro: 'qtd e obrigatoria e nao pode ser negativa' }, 400)
  }
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into perdas ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

perdas.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  // data/produto_id/qtd so sao validados se vieram no corpo — ausente
  // continua significando "nao alterar este campo", igual ao molde
  // (clientes.ts).
  if ('data' in dados && campoTextoEmBranco(dados.data)) {
    return c.json({ erro: 'data e obrigatoria' }, 400)
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    // perdas nao tem coluna alterado_em (so criado_em, ver migration 009) —
    // diferente do molde, entao o SET nao inclui esse campo.
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update perdas set ${tx(dados)} where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

perdas.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from perdas where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
