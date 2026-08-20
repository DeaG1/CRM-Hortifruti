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

/**
 * numeric vem como string do postgres.js — converter na borda da API.
 * `tenant_id` sai do corpo: e um identificador interno (RLS ja isola no
 * servidor, ninguem "usa" isso no cliente) que nao precisa vazar pro JSON —
 * esta rota e o molde de mais 7, entao qualquer uso futuro do payload
 * (export, log, cache) nao deveria herdar o campo sem intencao.
 * `criado_em`/`alterado_em` continuam expostos: uteis pra interface.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, limite: Number(linha.limite ?? 0), prazo: Number(linha.prazo ?? 0) }
}

/** true so quando o valor existe e converte pra um numero finito negativo —
 * ausente (undefined) nao e invalido, so significa "nao alterar este campo". */
function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

/** true so quando o valor existe, e finito e nao e inteiro. */
function numeroNaoInteiro(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && !Number.isInteger(n)
}

/**
 * `limite`/`prazo` negativos sao dado corrompido (limite de credito vai virar
 * base de alerta de estouro no roadmap — negativo faz esse calculo virar
 * nonsense). `prazo` fracionario e o mesmo problema por outro angulo: e uma
 * coluna `integer` (dias), e o campo no front e `type="number"` sem `step`
 * dentro de um form `noValidate` — nada impede `1.5` de chegar aqui.
 * Sem esta checagem, `1.5` batia direto no `integer` do Postgres e estourava
 * "invalid input syntax for type integer", sem tratamento (500 texto puro,
 * ver item 7 do relatorio). `min`/`step` no input do front sao so UX; esta
 * e a validacao que qualquer chamador da API tem que passar. A constraint
 * no banco (005_clientes_check_nao_negativo.sql) e a ultima linha de defesa
 * para negativo — ver respostaDeErroPg, que mapeia o 23514 caso essa
 * checagem seja contornada.
 */
function erroDeCampoInvalido(dados: Partial<Cliente>): string | null {
  if (numeroNegativo(dados.limite)) return 'limite nao pode ser negativo'
  if (numeroNegativo(dados.prazo)) return 'prazo nao pode ser negativo'
  if (numeroNaoInteiro(dados.prazo)) return 'prazo deve ser um numero inteiro de dias'
  return null
}

/**
 * nome vazio ou so espaco e o mesmo problema que nome ausente — verificado
 * ao vivo: POST {"nome":"   "} respondia 201 (a checagem antiga so testava
 * truthy, e uma string de espacos e truthy). O front ja faz `.trim()` antes
 * de bloquear o submit (ModalCliente.tsx); esta e a mesma regra do lado da
 * API, que e quem realmente decide se o registro e gravado.
 */
function nomeEmBranco(nome: unknown): boolean {
  return typeof nome !== 'string' || nome.trim() === ''
}

/**
 * `clientes` tem quatro CHECK constraints (status, tend, limite, prazo),
 * todas SQLSTATE 23514 — um unico texto fixo pra todas mapeava qualquer
 * violacao para "limite e prazo nao podem ser negativos", inclusive quando
 * o problema era um `status` invalido (verificado ao vivo:
 * POST {"nome":"x","status":"sei-la"} respondia essa mensagem errada).
 * O nome da constraint (err.constraint_name, exposto pelo postgres.js a
 * partir do campo `n` do ErrorResponse) identifica qual CHECK foi violado
 * sem depender de string matching na mensagem do Postgres.
 */
const MENSAGENS_CHECK: Record<string, string> = {
  clientes_status_check: 'status invalido',
  clientes_tend_check: 'tendencia invalida',
  clientes_limite_nao_negativo: 'limite nao pode ser negativo',
  clientes_prazo_nao_negativo: 'prazo nao pode ser negativo',
}

/**
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis
 * em vez de deixar a excecao subir crua (500, corpo texto puro). 23505 e
 * 23514 sao violacoes que a API ja valida antes do insert/update na maior
 * parte dos casos — a checagem no banco fica como ultima linha de defesa
 * (e a unica linha de defesa para status/tend, que a API nao valida antes).
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um cliente com esse nome' }, status: 409 }
  if (e.code === '23514') {
    // Fallback honesto: uma constraint desconhecida (schema mudou e o mapa
    // nao acompanhou) ainda responde {erro} previsivel, so nao finge saber
    // qual campo era.
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
 * sobe sem tratamento (500, corpo texto puro, quebra o contrato {erro}
 * que toda outra resposta de erro respeita).
 */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
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
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from clientes where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

clientes.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into clientes ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    // Codigos SQLSTATE, nao substring de mensagem: o texto exato do
    // Postgres pode mudar entre versoes/locale, o codigo nao.
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

clientes.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  // nome so e validado se veio no corpo — ausente continua significando
  // "nao alterar este campo", igual aos demais campos do PUT. Antes desta
  // correcao o PUT nao validava nome nenhum: PUT {"nome":""} respondia 200
  // e deixava o registro com nome vazio (verificado ao vivo).
  if ('nome' in dados) {
    if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
    dados.nome = (dados.nome as string).trim()
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update clientes set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

clientes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from clientes where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
