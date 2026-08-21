import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/clientes.ts. Mesma estrutura, mesmos motivos —
// comentarios aqui so cobrem o que e especifico de funcionarios.

const CAMPOS = ['nome', 'cargo', 'tel', 'salario', 'dia_pag', 'ativo'] as const

type Funcionario = {
  nome: string
  cargo: string
  tel: string
  salario: number
  dia_pag: number
  ativo: boolean
}

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (em especial `tenant_id` e `id`, que nunca devem vir do corpo). */
function sanear(corpo: Record<string, unknown>): Partial<Funcionario> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Funcionario>
}

/**
 * `salario` e numeric(12,2) — vem como string do postgres.js, convertida
 * na borda da API igual a `limite`/`prazo` em clientes.ts. `dia_pag` e
 * `integer` (o driver ja devolve number), mas passa pelo mesmo `Number()`
 * por simetria com o resto do molde. `tenant_id` sai do corpo pelo mesmo
 * motivo de clientes.ts: identificador interno que nao precisa vazar pro
 * JSON.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, salario: Number(linha.salario ?? 0), dia_pag: Number(linha.dia_pag ?? 0) }
}

function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

function numeroNaoInteiro(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && !Number.isInteger(n)
}

/** true so quando o valor existe, e um inteiro finito e cai fora de 1..28. */
function diaPagForaDoIntervalo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && Number.isInteger(n) && (n < 1 || n > 28)
}

/**
 * `salario` negativo e `dia_pag` fora de 1..28 (ou fracionario) sao dado
 * corrompido — `dia_pag` alimenta o calculo de "proxima data de pagamento
 * / atrasado" (comentario da migration 009), entao um valor fora do mes
 * ou fracionario quebra essa conta antes mesmo de chegar no banco. As
 * constraints `funcionarios_salario_check` e `funcionarios_dia_pag_check`
 * sao a ultima linha de defesa (ver respostaDeErroPg), esta checagem e a
 * primeira, e a que devolve mensagem especifica por campo.
 */
function erroDeCampoInvalido(dados: Partial<Funcionario>): string | null {
  if (numeroNegativo(dados.salario)) return 'salario nao pode ser negativo'
  if (numeroNaoInteiro(dados.dia_pag)) return 'dia_pag deve ser um numero inteiro'
  if (diaPagForaDoIntervalo(dados.dia_pag)) return 'dia_pag deve estar entre 1 e 28'
  return null
}

/** nome vazio ou so espaco e o mesmo problema que nome ausente — mesma
 * regra de clientes.ts (nome e o unico campo de texto obrigatorio aqui;
 * `cargo`/`tel` tem default '' no banco e nao sao obrigatorios). */
function nomeEmBranco(nome: unknown): boolean {
  return typeof nome !== 'string' || nome.trim() === ''
}

/**
 * `funcionarios` nao tem constraint unique (ao contrario de `clientes`,
 * que tem `unique (tenant_id, lower(nome))`) — dois funcionarios podem ter
 * o mesmo nome no mesmo tenant (dois "Joao" na equipe e um cenario real).
 * O mapeamento de 23505 fica aqui por simetria com o molde e para o caso
 * de uma constraint unique ser adicionada no futuro; hoje nao ha como
 * este branch ser alcancado por HTTP (coberto so por teste direto da
 * funcao).
 */
const MENSAGENS_CHECK: Record<string, string> = {
  funcionarios_salario_check: 'salario nao pode ser negativo',
  funcionarios_dia_pag_check: 'dia_pag deve estar entre 1 e 28',
}

export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um funcionario com esse nome' }, status: 409 }
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

export const funcionarios = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Tela de admin no design (cadastro de equipe/folha) — colaborador nao
// enxerga.
funcionarios.use('*', exigirSessao, exigirAdmin)

funcionarios.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from funcionarios order by nome`)
  return c.json(linhas.map(paraJson))
})

funcionarios.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from funcionarios where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

funcionarios.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into funcionarios ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

funcionarios.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  if ('nome' in dados) {
    if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
    dados.nome = (dados.nome as string).trim()
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update funcionarios set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

funcionarios.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // FK de lancamentos.funcionario_id e `on delete set null` (migration
  // 009): apagar um funcionario com lancamentos historicos nao apaga nem
  // bloqueia os lancamentos, so desvincula. Nenhum tratamento extra
  // necessario aqui.
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from funcionarios where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
