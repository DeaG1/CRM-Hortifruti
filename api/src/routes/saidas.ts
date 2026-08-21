import { Hono } from 'hono'
import postgres from 'postgres'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

// Saidas e o molde de clientes.ts aplicado a uma entidade com tabela filha
// (itens) e uma regra de calculo automatico. sanear(), paraJson(), a
// validacao de uuid e o mapeamento de SQLSTATE sao copiados literalmente do
// padrao de clientes.ts — comentarios que so repetem essa justificativa nao
// sao duplicados aqui, ver clientes.ts para o raciocinio original.

const CAMPOS = [
  'numero', 'cliente_id', 'rota', 'data_pedido', 'entrega', 'status', 'pag',
  'venc', 'data_pag', 'forma_pag', 'perda_kg', 'motivo', 'obs',
] as const

// string | number | null (nunca `unknown`): postgres.js precisa resolver o
// overload de `tx({...})` (insert/update por objeto) em tempo de
// compilacao a partir do tipo dos valores — com `unknown` a inferencia de
// overload falha e o TypeScript tenta casar o objeto contra o overload de
// tagged template (o outro uso de `tx`), erro confuso e sem relacao com a
// causa real. Os campos sao mesmo so texto, numero ou null (datas chegam
// como string 'AAAA-MM-DD' do JSON, nunca Date).
type Saida = Record<(typeof CAMPOS)[number], string | number | null>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (mass assignment), inclusive tenant_id/id. `itens` fica de fora de
 * proposito: e tratado por validarItens(), nunca passa por aqui. */
function sanear(corpo: Record<string, unknown>): Partial<Saida> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Saida>
}

const CAMPOS_DATA = ['data_pedido', 'entrega', 'venc', 'data_pag'] as const

/** data_pedido/entrega/venc/data_pag sao colunas `date` — o postgres.js
 * devolve isso como objeto JS `Date`, e o JSON.stringify padrao do Hono
 * serializa Date como timestamp ISO completo ("2026-08-20T00:00:00.000Z"),
 * nao como a data pura que a API recebeu ("2026-08-20"). Sem normalizar de
 * volta pra "AAAA-MM-DD" aqui, o valor que volta pro cliente nem bate mais
 * com o formato que erroDeDataInvalida exige na entrada — round-trip
 * quebrado (POST com venc:"2026-08-20", GET devolveria
 * "2026-08-20T00:00:00.000Z"). null passa direto (coluna nao preenchida).
 */
function dataParaTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v as string)
  return d.toISOString().slice(0, 10)
}

/**
 * numeric vem como string do postgres.js — converter na borda da API.
 * tenant_id sai do corpo pelo mesmo motivo de clientes.ts (RLS ja isola no
 * servidor, ninguem "usa" isso no cliente). `valor`/`peso` so aparecem nas
 * linhas agregadas de GET / (sum(qtd*preco) e sum(qtd), vindos do join com
 * saida_itens) — convertidos so quando presentes, porque POST/PUT/GET /:id
 * nao os incluem.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  const convertido: Record<string, unknown> = { ...resto, perda_kg: Number(linha.perda_kg ?? 0) }
  for (const campo of CAMPOS_DATA) {
    if (campo in linha) convertido[campo] = dataParaTexto(linha[campo])
  }
  if ('valor' in linha) convertido.valor = Number(linha.valor ?? 0)
  if ('peso' in linha) convertido.peso = Number(linha.peso ?? 0)
  return convertido
}

/** Mesma conversao para linhas de saida_itens — qtd/preco/perda_kg tambem
 * sao numeric e tambem vem como string do driver. */
function paraJsonItem<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return {
    ...resto,
    qtd: Number(linha.qtd ?? 0),
    preco: Number(linha.preco ?? 0),
    perda_kg: Number(linha.perda_kg ?? 0),
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sem isto, um id malformado chega intacto a um `where id = $1` e o
 * Postgres lanca "invalid input syntax for type uuid" sem tratamento (500
 * texto puro). Mesma funcao de clientes.ts, reaplicada aqui porque tambem
 * valida cliente_id e produto_id, nao so o :id da rota. */
function idValido(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

/** Mesma logica do idValido, para os quatro campos `date` do cabecalho: sem
 * isto um valor mal formado (ex.: "25/08/2026") chega intacto ao insert e o
 * Postgres lanca "invalid input syntax for type date" sem tratamento. */
function erroDeDataInvalida(dados: Partial<Saida>): string | null {
  for (const campo of CAMPOS_DATA) {
    const v = dados[campo]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' || !DATA_RE.test(v)) return `${campo} invalida (use AAAA-MM-DD)`
  }
  return null
}

function textoEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

/**
 * `saidas` tem tres CHECK constraints (status, pag, perda_kg) e `saida_itens`
 * mais tres (qtd, preco, perda_kg), todas SQLSTATE 23514 — o nome da
 * constraint identifica qual foi violada sem depender de string matching na
 * mensagem do Postgres. Mesma tecnica de clientes.ts (MENSAGENS_CHECK).
 */
const MENSAGENS_CHECK: Record<string, string> = {
  saidas_status_check: 'status invalido',
  saidas_pag_check: 'situacao de pagamento invalida',
  saidas_perda_kg_check: 'perda_kg nao pode ser negativa',
  saida_itens_qtd_check: 'qtd de um item nao pode ser negativa',
  saida_itens_preco_check: 'preco de um item nao pode ser negativo',
  saida_itens_perda_kg_check: 'perda_kg de um item nao pode ser negativa',
}

/**
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis
 * em vez de deixar a excecao subir crua. 23505 e o unico indice unico da
 * tabela (tenant_id, numero); 23514 cobre as seis CHECK constraints de
 * saidas + saida_itens listadas acima.
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe uma saida com esse numero' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  return null
}

type ItemEntrada = { produto_id: string; un: string; qtd: number; preco: number; perda_kg: number }

/**
 * Sanitiza o array `itens` do corpo — mesmo espirito de sanear(): nunca
 * aceitar tenant_id/id/saida_id vindos do cliente para os itens tambem.
 * `un` e `perda_kg` tem default no banco ('KG' e 0); ausentes nao sao erro.
 * `qtd`/`preco` negativos NAO sao barrados aqui de proposito — ficam para o
 * CHECK do banco (saida_itens_qtd_check/preco_check), mapeado acima, que e
 * a mesma defesa que a tabela ja tem e evita duplicar a regra em dois
 * lugares.
 */
function validarItens(bruto: unknown): { erro: string } | { itens: ItemEntrada[] } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { erro: 'pelo menos um item e obrigatorio' }
  }
  const itens: ItemEntrada[] = []
  for (let i = 0; i < bruto.length; i++) {
    const item = bruto[i]
    if (typeof item !== 'object' || item === null) return { erro: `item ${i}: formato invalido` }
    const { produto_id, un, qtd, preco, perda_kg } = item as Record<string, unknown>
    if (!idValido(produto_id)) return { erro: `item ${i}: produto_id invalido` }
    if (typeof qtd !== 'number' || !Number.isFinite(qtd)) return { erro: `item ${i}: qtd e obrigatoria` }
    if (typeof preco !== 'number' || !Number.isFinite(preco)) return { erro: `item ${i}: preco e obrigatorio` }
    if (perda_kg !== undefined && (typeof perda_kg !== 'number' || !Number.isFinite(perda_kg))) {
      return { erro: `item ${i}: perda_kg invalida` }
    }
    itens.push({
      produto_id,
      un: typeof un === 'string' && un.trim() !== '' ? un : 'KG',
      qtd,
      preco,
      perda_kg: perda_kg ?? 0,
    })
  }
  return { itens }
}

/**
 * Regra de negocio pedida explicitamente no To Do do cliente (item P1):
 * "vencimento = data de entrega + prazo de pagamento do cliente. Hoje e
 * digitado a mao e pode divergir do cadastro."
 *
 * So calcula quando `venc` NAO veio no corpo (chave ausente) — a mesma
 * semantica de "ausente = deixar a API decidir" que sanear()/PUT ja usam
 * para todo o resto. Se `venc` veio explicito, mesmo vazio/null, o valor
 * enviado e respeitado sem recalculo: o usuario pode ter negociado outro
 * prazo naquela venda especifica, e a API nao deve sobrescrever uma decisao
 * humana explicita com um valor derivado do cadastro.
 *
 * A consulta ao prazo do cliente roda dentro da mesma transacao
 * (withTenant) do insert/update — nao ha porque abrir uma segunda conexao
 * so para isso, e mantem a leitura sujeita a mesma RLS.
 */
async function calcularVencAutomatico(
  tx: postgres.TransactionSql,
  clienteId: string,
  entrega: string,
): Promise<string | null> {
  const [cliente] = await tx<{ prazo: number }[]>`select prazo from clientes where id = ${clienteId}`
  if (!cliente) return null
  const base = new Date(`${entrega}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + Number(cliente.prazo))
  return base.toISOString().slice(0, 10)
}

export const saidas = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Sem exigirAdmin: saidas (pedidos) nao esta em ADMIN_ONLY_SCREENS
// (web/src/telas.ts) — colaborador acessa esta tela no design do produto,
// diferente de clientes.
saidas.use('*', exigirSessao)

// GET / devolve so os cabecalhos, com totais agregados de itens (valor e
// peso), sem a lista de itens em si — a lista nao precisa deles, e trazer
// os itens de toda saida numa listagem seria N+1 de dado que ninguem le
// nessa tela. group by s.id funciona porque id e a chave primaria de
// saidas: Postgres permite selecionar as demais colunas de s sem agrega-las
// quando o group by cobre a PK inteira (dependencia funcional).
saidas.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    select s.*,
           coalesce(sum(i.qtd * i.preco), 0) as valor,
           coalesce(sum(i.qtd), 0) as peso
    from saidas s
    left join saida_itens i on i.saida_id = s.id
    group by s.id
    order by s.data_pedido desc, s.numero`)
  return c.json(linhas.map(paraJson))
})

// GET /:id devolve o cabecalho COM os itens — ao contrario de GET /, aqui a
// tela de ficha/edicao precisa da lista completa para poder editar.
saidas.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const resultado = await withTenant(c.get('sql'), c.get('tenantId'), async (tx) => {
    const [cabecalho] = await tx`select * from saidas where id = ${id}`
    if (!cabecalho) return null
    const itens = await tx`select * from saida_itens where saida_id = ${id} order by id`
    return { cabecalho, itens }
  })
  if (!resultado) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json({ ...paraJson(resultado.cabecalho), itens: resultado.itens.map(paraJsonItem) })
})

saidas.post('/', async (c) => {
  const corpo = await c.req.json()
  const dados = sanear(corpo)

  if (textoEmBranco(dados.numero)) return c.json({ erro: 'numero e obrigatorio' }, 400)
  if (textoEmBranco(dados.data_pedido)) return c.json({ erro: 'data_pedido e obrigatoria' }, 400)
  if ('cliente_id' in dados && dados.cliente_id !== null && !idValido(dados.cliente_id)) {
    return c.json({ erro: 'cliente_id invalido' }, 400)
  }
  const erroData = erroDeDataInvalida(dados)
  if (erroData) return c.json({ erro: erroData }, 400)

  const itensValidados = validarItens((corpo as Record<string, unknown>).itens)
  if ('erro' in itensValidados) return c.json({ erro: itensValidados.erro }, 400)

  const tenantId = c.get('tenantId')
  try {
    // Cabecalho + itens gravados num unico withTenant: se o insert dos
    // itens falhar (CHECK ou FK), o insert do cabecalho tem que voltar
    // junto — sql.begin() (por baixo de withTenant) faz ROLLBACK
    // automatico em qualquer excecao lancada dentro do callback.
    const linha = await withTenant(c.get('sql'), tenantId, async (tx) => {
      // venc so e calculado quando ausente no corpo — ver calcularVencAutomatico.
      if (!('venc' in dados) && typeof dados.cliente_id === 'string' && typeof dados.entrega === 'string') {
        const vencCalculado = await calcularVencAutomatico(tx, dados.cliente_id, dados.entrega)
        if (vencCalculado) dados.venc = vencCalculado
      }

      const [cabecalho] = await tx`
        insert into saidas ${tx({ ...dados, tenant_id: tenantId })} returning *`

      const linhasItens = itensValidados.itens.map(item => ({
        tenant_id: tenantId,
        saida_id: cabecalho.id,
        ...item,
      }))
      const itensGravados = await tx`
        insert into saida_itens ${tx(linhasItens)} returning *`

      return { ...paraJson(cabecalho), itens: itensGravados.map(paraJsonItem) }
    })
    return c.json(linha, 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

saidas.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const corpo = await c.req.json()
  const dados = sanear(corpo)

  // numero/data_pedido so sao validados se vieram no corpo — ausente
  // continua significando "nao alterar", igual ao resto do PUT (mesma
  // regra de clientes.ts para nome).
  if ('numero' in dados && textoEmBranco(dados.numero)) {
    return c.json({ erro: 'numero e obrigatorio' }, 400)
  }
  if ('data_pedido' in dados && textoEmBranco(dados.data_pedido)) {
    return c.json({ erro: 'data_pedido e obrigatoria' }, 400)
  }
  if ('cliente_id' in dados && dados.cliente_id !== null && !idValido(dados.cliente_id)) {
    return c.json({ erro: 'cliente_id invalido' }, 400)
  }
  const erroData = erroDeDataInvalida(dados)
  if (erroData) return c.json({ erro: erroData }, 400)

  const itensValidados = validarItens((corpo as Record<string, unknown>).itens)
  if ('erro' in itensValidados) return c.json({ erro: itensValidados.erro }, 400)

  const tenantId = c.get('tenantId')
  try {
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const [existente] = await tx`select cliente_id, entrega from saidas where id = ${id}`
      if (!existente) return null

      // venc so e recalculado quando ausente no corpo. cliente_id/entrega
      // "efetivos" sao os que vieram no corpo, ou — se o campo nao veio —
      // os que ja estao gravados: mudar so a entrega (sem reenviar
      // cliente_id) ainda deve recalcular o vencimento contra o cliente ja
      // cadastrado na saida, e vice-versa.
      if (!('venc' in dados)) {
        const clienteIdEfetivo = 'cliente_id' in dados ? dados.cliente_id : existente.cliente_id
        const entregaEfetiva = 'entrega' in dados
          ? dados.entrega
          : (existente.entrega ? new Date(existente.entrega).toISOString().slice(0, 10) : null)
        if (typeof clienteIdEfetivo === 'string' && typeof entregaEfetiva === 'string') {
          const vencCalculado = await calcularVencAutomatico(tx, clienteIdEfetivo, entregaEfetiva)
          if (vencCalculado) dados.venc = vencCalculado
        }
      }

      const [cabecalho] = await tx`
        update saidas set ${tx({ ...dados, alterado_em: new Date() })}
        where id = ${id} returning *`

      // PUT apaga todos os itens existentes e reinsere os enviados, em vez
      // de fazer diff/merge por item: e a mesma transacao do cabecalho (se
      // o reinsert falhar, o delete tambem volta), e o corpo do PUT ja
      // exige a lista completa de itens (validarItens), entao "substituir
      // tudo" e exatamente o que o cliente da API pediu — nao ha um
      // subconjunto "so os itens que mudaram" para preservar.
      await tx`delete from saida_itens where saida_id = ${id}`
      const linhasItens = itensValidados.itens.map(item => ({
        tenant_id: tenantId,
        saida_id: id,
        ...item,
      }))
      const itensGravados = await tx`
        insert into saida_itens ${tx(linhasItens)} returning *`

      return { ...paraJson(cabecalho), itens: itensGravados.map(paraJsonItem) }
    })
    return resultado ? c.json(resultado) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

saidas.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from saidas where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
