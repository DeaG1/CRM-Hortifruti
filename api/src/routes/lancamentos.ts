import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/clientes.ts. Mesma estrutura, mesmos motivos —
// comentarios aqui so cobrem o que e especifico de lancamentos.

/**
 * Categorias do prototipo (design/CRM Hortifruti.dc.html, `LANC_CATS`),
 * repetidas aqui como fonte de verdade da API — a rota GET /categorias
 * abaixo expoe esta mesma lista para o front nao duplicar a constante.
 * Categoria livre corromperia os agrupamentos do relatorio financeiro
 * (que soma por categoria), por isso e validada como enum fechado, nao
 * como texto livre — diferente de `descricao`, que e texto livre mesmo.
 */
export const CATEGORIAS = [
  'Frete', 'Gasolina', 'Manutenção dos Carros', 'Salário', 'Adiantamento de salário',
  'Vale-alimentação', 'Vale-transporte', 'FGTS', 'INSS', 'Simples Nacional',
  'Parcelamento Impostos', 'Pagamento de conta de sócio', 'Outros',
] as const

type Categoria = (typeof CATEGORIAS)[number]

/**
 * `funcionario_id` so faz sentido em Salario e Adiantamento de salario —
 * e o que desconta do "a pagar" daquele funcionario (comentario da
 * migration 009). Nas demais categorias o campo tem que ficar nulo.
 */
const CATEGORIAS_COM_FUNCIONARIO = new Set<string>(['Salário', 'Adiantamento de salário'])

function categoriaValida(v: unknown): v is Categoria {
  return typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v)
}

const CAMPOS = ['data', 'categoria', 'descricao', 'valor', 'funcionario_id'] as const

type Lancamento = {
  data: string
  categoria: string
  descricao: string
  valor: number
  funcionario_id: string | null
}

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (em especial `tenant_id` e `id`, que nunca devem vir do corpo). */
function sanear(corpo: Record<string, unknown>): Partial<Lancamento> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Lancamento>
}

/**
 * `valor` e numeric(12,2) — vem como string do postgres.js, convertido na
 * borda da API igual a `limite`/`prazo` em clientes.ts. `tenant_id` sai do
 * corpo pelo mesmo motivo de clientes.ts.
 *
 * `data` e `date` — o postgres.js devolve isso como `Date` (meia-noite
 * UTC), e sem conversao o JSON exporia um timestamp completo
 * ("2024-03-05T00:00:00.000Z") em vez da data pura que o <input
 * type="date"> do front espera ("2024-03-05"). Como a coluna e `date` (sem
 * hora), o Date que o driver cria fica sempre em meia-noite UTC, entao
 * `toISOString().slice(0,10)` devolve o mesmo dia gravado, independente do
 * fuso horario local do processo que roda a API.
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

/** `valor` e NOT NULL sem default — ausente ou null e sempre invalido,
 * diferente de `limite`/`prazo` em clientes.ts (que tem default 0 e podem
 * ficar de fora do POST). */
function valorAusente(v: unknown): boolean {
  return v === undefined || v === null
}

/**
 * `valor` negativo e dado corrompido (a constraint `lancamentos_valor_check`
 * e a ultima linha de defesa, ver respostaDeErroPg). Esta e a primeira, e a
 * que devolve mensagem especifica.
 */
function erroDeCampoInvalido(dados: Partial<Lancamento>): string | null {
  if (numeroNegativo(dados.valor)) return 'valor nao pode ser negativo'
  return null
}

/** vazio ou so espaco e o mesmo problema que ausente — mesma regra de
 * `nome` em clientes.ts, aplicada aqui a `categoria` (o outro campo de
 * texto obrigatorio desta tabela; `descricao` tem default '' e nao e
 * obrigatoria). */
function categoriaEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

/** vazio ou so espaco e o mesmo problema que ausente — mesma regra de
 * `nome`/`categoria` acima, aplicada a `data`. */
function dataEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

/**
 * Sem isto, uma data fora do formato ("05/03/2024", "ontem") bate direto
 * no `date` do Postgres e estoura "invalid input syntax for type date" sem
 * tratamento especifico — cai no app.onError generico (500 "erro interno"),
 * igual ao cenario do prazo fracionario em clientes.ts, so que sem a
 * mensagem especifica que ajuda a debugar. O <input type="date"> do front
 * ja manda sempre "AAAA-MM-DD"; esta e a validacao do lado da API para
 * qualquer outro chamador.
 */
function dataValida(v: string): boolean {
  return DATA_RE.test(v)
}

const MENSAGENS_CHECK: Record<string, string> = {
  lancamentos_valor_check: 'valor nao pode ser negativo',
}

/**
 * `lancamentos` nao tem constraint unique — nao ha um "nome" natural para
 * duplicar. O mapeamento de 23505 fica aqui por simetria com o molde e
 * para o caso de uma constraint unique ser adicionada no futuro; hoje nao
 * ha como este branch ser alcancado por HTTP (coberto so por teste direto
 * da funcao).
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um lancamento com esses dados' }, status: 409 }
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
 * `funcionarios(id)` e FK, mas checagem de integridade referencial no
 * Postgres roda com o dono da tabela e por isso IGNORA row level security
 * — comprovado ao vivo contra este banco: com RLS fixado no tenant B, um
 * insert em lancamentos referenciando o id de um funcionario do tenant A
 * foi aceito sem erro. Ou seja, sem esta checagem extra, a API deixaria
 * vincular um lancamento de um tenant a um funcionario de outro tenant —
 * furando exatamente o isolamento que RLS + withTenant existem para
 * garantir. A query roda dentro de withTenant, entao "achar" o
 * funcionario aqui ja prova que ele pertence ao tenant da sessao.
 */
async function funcionarioPertenceAoTenant(sql: Sql, tenantId: string, funcionarioId: string): Promise<boolean> {
  const linhas = await withTenant(sql, tenantId, tx =>
    tx`select 1 from funcionarios where id = ${funcionarioId}`)
  return linhas.length > 0
}

export const lancamentos = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Tela de admin no design (financeiro) — colaborador nao enxerga.
lancamentos.use('*', exigirSessao, exigirAdmin)

// Antes de '/:id': sem isto "categorias" seria interpretado como um id
// (e falharia em idValido, 400, nunca chegando aqui).
lancamentos.get('/categorias', (c) => c.json(CATEGORIAS))

lancamentos.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from lancamentos order by data desc, criado_em desc`)
  return c.json(linhas.map(paraJson))
})

lancamentos.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from lancamentos where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

lancamentos.post('/', async (c) => {
  const dados = sanear(await c.req.json())

  if (dataEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)
  if (!dataValida(dados.data as string)) return c.json({ erro: 'data invalida' }, 400)

  if (categoriaEmBranco(dados.categoria)) return c.json({ erro: 'categoria e obrigatoria' }, 400)
  dados.categoria = (dados.categoria as string).trim()
  if (!categoriaValida(dados.categoria)) return c.json({ erro: 'categoria invalida' }, 400)

  if (valorAusente(dados.valor)) return c.json({ erro: 'valor e obrigatorio' }, 400)
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  // Registro novo: a categoria do proprio payload decide se funcionario_id
  // se aplica. Fora de Salario/Adiantamento o valor enviado e ignorado (nao
  // rejeitado) — nao e erro do usuario, e um campo que nao se aplica aquela
  // categoria (ver CATEGORIAS_COM_FUNCIONARIO acima).
  if (!CATEGORIAS_COM_FUNCIONARIO.has(dados.categoria)) dados.funcionario_id = null

  const tenantId = c.get('tenantId')
  const funcionarioId = dados.funcionario_id
  if (funcionarioId) {
    if (typeof funcionarioId !== 'string' || !idValido(funcionarioId)) {
      return c.json({ erro: 'funcionario invalido' }, 400)
    }
    if (!await funcionarioPertenceAoTenant(c.get('sql'), tenantId, funcionarioId)) {
      return c.json({ erro: 'funcionario invalido' }, 400)
    }
  }

  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into lancamentos ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

lancamentos.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)

  if ('data' in dados) {
    if (dataEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)
    if (!dataValida(dados.data as string)) return c.json({ erro: 'data invalida' }, 400)
  }
  if ('categoria' in dados) {
    if (categoriaEmBranco(dados.categoria)) return c.json({ erro: 'categoria e obrigatoria' }, 400)
    dados.categoria = (dados.categoria as string).trim()
    if (!categoriaValida(dados.categoria)) return c.json({ erro: 'categoria invalida' }, 400)
  }
  if ('valor' in dados && valorAusente(dados.valor)) return c.json({ erro: 'valor e obrigatorio' }, 400)
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  const tenantId = c.get('tenantId')
  const sql = c.get('sql')

  // Diferente do POST: aqui a categoria pode nao estar sendo alterada
  // neste request, entao a categoria "efetiva" (a que vale depois do
  // update) pode ser a que ja esta gravada. Sem checar essa efetiva:
  //  - um PUT que so troca a categoria de Salario para, digamos, Frete
  //    deixaria o funcionario_id antigo pendurado no registro, continuando
  //    a contar (errado) no "a pagar" daquele funcionario;
  //  - um PUT que so envia funcionario_id, sem tocar em categoria, correria
  //    o risco de vincular um funcionario a um lancamento cuja categoria
  //    atual nao suporta o campo.
  if ('categoria' in dados) {
    if (!CATEGORIAS_COM_FUNCIONARIO.has(dados.categoria as string)) dados.funcionario_id = null
  } else if ('funcionario_id' in dados && dados.funcionario_id) {
    const [atual] = await withTenant(sql, tenantId, tx =>
      tx`select categoria from lancamentos where id = ${id}`)
    if (!atual || !CATEGORIAS_COM_FUNCIONARIO.has(atual.categoria)) dados.funcionario_id = null
  }

  const funcionarioId = dados.funcionario_id
  if (funcionarioId) {
    if (typeof funcionarioId !== 'string' || !idValido(funcionarioId)) {
      return c.json({ erro: 'funcionario invalido' }, 400)
    }
    if (!await funcionarioPertenceAoTenant(sql, tenantId, funcionarioId)) {
      return c.json({ erro: 'funcionario invalido' }, 400)
    }
  }

  try {
    const [linha] = await withTenant(sql, tenantId, tx =>
      tx`update lancamentos set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

lancamentos.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from lancamentos where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
