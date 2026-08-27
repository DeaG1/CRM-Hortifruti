import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/lancamentos.ts (data + valor + vinculo com
// funcionario) — comentarios aqui so cobrem o que e especifico de desconto.
//
// DESCONTO NAO E LANCAMENTO, e por isso esta rota existe em vez de mais uma
// categoria em lancamentos.ts: nenhum dinheiro se move ao registrar uma falta,
// a empresa vai PAGAR MENOS depois. Um `lancamento` de valor positivo seria
// contado como CUSTO pelo Financeiro e ao mesmo tempo abateria o "a pagar" —
// errado nas duas pontas, com sinais opostos. O raciocinio inteiro esta em
// db/migrations/016_descontos_de_salario.sql.

const CAMPOS = ['funcionario_id', 'data', 'motivo', 'valor'] as const

type Desconto = {
  funcionario_id: string
  data: string
  motivo: string
  valor: number
}

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (em especial `tenant_id` e `id`, que nunca devem vir do corpo). */
function sanear(corpo: Record<string, unknown>): Partial<Desconto> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Desconto>
}

/**
 * `valor` e numeric(12,2) — vem como string do postgres.js. `data` e `date`
 * — o driver devolve `Date` (meia-noite UTC) e sem conversao o JSON exporia
 * um timestamp completo em vez da data pura que o `<input type="date">`
 * espera. Mesmo tratamento, pelos mesmos motivos, de lancamentos.ts.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  const data = linha.data
  return {
    ...resto,
    valor: Number(linha.valor ?? 0),
    data: data instanceof Date ? data.toISOString().slice(0, 10) : data,
  }
}

function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

/** `valor` e NOT NULL sem default — ausente ou null e sempre invalido. */
function valorAusente(v: unknown): boolean {
  return v === undefined || v === null
}

function erroDeCampoInvalido(dados: Partial<Desconto>): string | null {
  if (numeroNegativo(dados.valor)) return 'valor nao pode ser negativo'
  return null
}

/** vazio ou so espaco e o mesmo problema que ausente. */
function textoEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Sem isto, uma data fora do formato ("05/03/2024", "ontem") bate direto no
 * `date` do Postgres e estoura "invalid input syntax for type date" sem
 * tratamento — 500 "erro interno" em vez de 400 com mensagem.
 */
function dataValida(v: string): boolean {
  return DATA_RE.test(v)
}

const MENSAGENS_CHECK: Record<string, string> = {
  descontos_valor_check: 'valor nao pode ser negativo',
  descontos_motivo_check: 'motivo e obrigatorio',
}

/**
 * `descontos` nao tem constraint unique — o mesmo funcionario pode ter dois
 * descontos no mesmo dia (chegou atrasado de manha e saiu mais cedo a tarde
 * sao dois registros com motivos diferentes). O mapeamento de 23505 fica aqui
 * por simetria com o molde; hoje nao ha como este branch ser alcancado por
 * HTTP (coberto so por teste direto da funcao).
 *
 * 23503 NAO e mapeado aqui, e a ausencia e deliberada: a unica FK desta
 * tabela e `descontos_funcionario_fk`, e as rotas abaixo ja provam que o
 * funcionario existe NO TENANT DA SESSAO antes de gravar
 * (`funcionarioPertenceAoTenant`), devolvendo 400 com mensagem util. Se
 * mesmo assim o banco recusar (corrida com uma exclusao do funcionario no
 * intervalo entre a checagem e o insert), 23503 sobe e vira o 500 generico do
 * app.onError — que e a resposta honesta para "o funcionario deixou de
 * existir enquanto voce salvava", nao uma regra que o usuario possa
 * entender e resolver lendo. Do outro lado da mesma FK, a exclusao do
 * funcionario nunca e barrada: e `on delete cascade` (016).
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um desconto com esses dados' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sem isto, um id malformado chega intacto ao `where id = $1` e o Postgres
 * lanca "invalid input syntax for type uuid" sem tratamento. */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Mesma funcao (e mesmo motivo) de lancamentos.ts: a checagem de integridade
 * referencial do Postgres roda com o dono da tabela e IGNORA row level
 * security, entao a FK sozinha nao substituiria esta consulta — o que a FK
 * COMPOSTA de 016 garante e que a referencia cruzada seja recusada pelo
 * banco (23503); esta checagem roda antes so para o usuario receber 400 com
 * mensagem util em vez de um erro cru. As duas camadas existem de proposito.
 * A query roda dentro de withTenant, entao "achar" o funcionario aqui ja
 * prova que ele pertence ao tenant da sessao.
 */
async function funcionarioPertenceAoTenant(sql: Sql, tenantId: string, funcionarioId: string): Promise<boolean> {
  const linhas = await withTenant(sql, tenantId, tx =>
    tx`select 1 from funcionarios where id = ${funcionarioId}`)
  return linhas.length > 0
}

/** Valida o `funcionario_id` do corpo: formato + pertence ao tenant. Devolve
 * a mensagem de erro ou null. Usada por POST e PUT com a mesma regra — e um
 * desconto NUNCA fica sem funcionario (coluna `not null`), diferente de
 * `lancamentos.funcionario_id`, que e opcional. */
async function erroDeFuncionario(
  sql: Sql, tenantId: string, funcionarioId: unknown,
): Promise<string | null> {
  if (typeof funcionarioId !== 'string' || !idValido(funcionarioId)) return 'funcionario invalido'
  if (!await funcionarioPertenceAoTenant(sql, tenantId, funcionarioId)) return 'funcionario invalido'
  return null
}

export const descontos = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Mesma exigencia de `funcionarios` e de `lancamentos`: a tela de
// Funcionarios e admin-only ('funcionarios' em ADMIN_ONLY_SCREENS,
// web/src/telas.ts), e desconto e dado de salario — a classe mais sensivel
// do sistema. Nem mais (nao ha sub-rota aberta ao colaborador), nem menos
// (leitura tambem exige admin, porque ler quanto foi descontado de alguem ja
// e ler folha).
descontos.use('*', exigirSessao, exigirAdmin)

descontos.get('/', async (c) => {
  // Ordem espelhando `lancamentos`: mais recente primeiro, com `criado_em` de
  // desempate — a tela mostra o historico do mais novo pro mais antigo.
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from descontos order by data desc, criado_em desc`)
  return c.json(linhas.map(paraJson))
})

descontos.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from descontos where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

descontos.post('/', async (c) => {
  const dados = sanear(await c.req.json())

  if (textoEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)
  if (!dataValida(dados.data as string)) return c.json({ erro: 'data invalida' }, 400)

  // Obrigatorio, e nao "opcional com default" como `perdas.motivo`: descontar
  // do salario de alguem sem dizer por que produz um numero que o funcionario
  // contesta e o dono nao consegue explicar depois.
  if (textoEmBranco(dados.motivo)) return c.json({ erro: 'motivo e obrigatorio' }, 400)
  dados.motivo = (dados.motivo as string).trim()

  if (valorAusente(dados.valor)) return c.json({ erro: 'valor e obrigatorio' }, 400)
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  const tenantId = c.get('tenantId')
  const erroFuncionario = await erroDeFuncionario(c.get('sql'), tenantId, dados.funcionario_id)
  if (erroFuncionario) return c.json({ erro: erroFuncionario }, 400)

  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into descontos ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

descontos.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)

  if ('data' in dados) {
    if (textoEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)
    if (!dataValida(dados.data as string)) return c.json({ erro: 'data invalida' }, 400)
  }
  if ('motivo' in dados) {
    if (textoEmBranco(dados.motivo)) return c.json({ erro: 'motivo e obrigatorio' }, 400)
    dados.motivo = (dados.motivo as string).trim()
  }
  if ('valor' in dados && valorAusente(dados.valor)) return c.json({ erro: 'valor e obrigatorio' }, 400)
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  const tenantId = c.get('tenantId')
  // So valida se o corpo tentou TROCAR o funcionario. Diferente de
  // lancamentos.ts, aqui nao ha categoria que decida se o campo se aplica: o
  // vinculo e obrigatorio e nao pode ser zerado — um PUT que mande
  // `funcionario_id: null` cai em 'funcionario invalido' em vez de gravar
  // null e violar a coluna `not null` no banco.
  if ('funcionario_id' in dados) {
    const erroFuncionario = await erroDeFuncionario(c.get('sql'), tenantId, dados.funcionario_id)
    if (erroFuncionario) return c.json({ erro: erroFuncionario }, 400)
  }

  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`update descontos set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

descontos.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // Nada aponta para `descontos` — nenhuma FK pode barrar esta exclusao, e
  // apagar um desconto nao mexe em nenhum dinheiro ja movimentado (o salario
  // pago continua em `lancamentos`, com o valor que foi pago de fato). O que
  // muda e o "a pagar" dali para frente, que e exatamente a intencao de quem
  // apaga um desconto registrado por engano.
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from descontos where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
