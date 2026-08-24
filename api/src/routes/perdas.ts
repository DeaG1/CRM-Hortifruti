import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

// Perda de deposito (pos-entrada) — sem itens, uma linha por produto/data.
// A perda ocorrida na coleta/transporte fica dentro da propria entrada
// (entradas.perda_kg / entrada_itens.perda_kg, ver routes/entradas.ts); esta
// tabela e so a perda que acontece depois, no deposito.
//
// AS TRES PERDAS DO SISTEMA NAO ESTAO NA MESMA UNIDADE, e confundi-las e a
// origem de todo defeito de soma que este projeto ja consertou:
//
//   entrada_itens.perda_kg (perda de coleta)  -> KG por contrato -> nao converte
//   saida_itens.perda_kg   (perda na entrega) -> KG por contrato -> nao converte
//   perdas.qtd             (perda de deposito)-> unidade de perdas.un -> CONVERTE
//
// As duas primeiras dizem kg no nome da coluna, no rotulo de ModalEntrada.tsx
// ("Perda na coleta/transporte (kg)") e no total do rodape do mesmo modal,
// para item de QUALQUER unidade — converte-las estragaria um numero que ja
// esta certo. `qtd` desta tabela e o caso oposto: uma quantidade na unidade
// em que a perda foi lancada. Ver o comentario do GET / mais abaixo.
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

/**
 * Para a LISTAGEM (GET /): a mesma conversao numerica de paraJson, mais os
 * dois campos derivados que so a lista tem — `qtd_kg` e
 * `itens_sem_conversao`. Mesma divisao de entradas.ts (paraJson para o
 * registro isolado, paraJsonLista para a listagem agregada); ver o
 * comentario grande no handler do GET / logo abaixo pro porque de a
 * conversao viver so aqui.
 *
 * `qtd_kg` NAO recebe `?? 0`, ao contrario dos numeric acima: null aqui e
 * uma informacao ("esta perda nao e convertivel em quilos"), nao um valor
 * ausente. Zera-la faria a perda desaparecer da soma parecendo uma perda de
 * zero quilo — exatamente o "fator ausente vira 1" que esta regra proibe,
 * so que na direcao oposta. `itens_sem_conversao` (0 ou 1) diz que ela
 * existiu.
 */
function paraJsonLista<T extends Record<string, unknown>>(linha: T) {
  return {
    ...paraJson(linha),
    qtd_kg: linha.qtd_kg == null ? null : Number(linha.qtd_kg),
    itens_sem_conversao: Number(linha.itens_sem_conversao ?? 0),
  }
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

// `qtd_kg`: a MESMA perda em quilos. `perdas.qtd` esta na unidade da propria
// perda (`perdas.un`, que aceita 'KG','CX','UN','DZ','MC' — migration 009), e
// quem consome esta listagem SOMA varias perdas e as compara com numeros que
// ja estao em kg: o indice de perdas do painel (web/src/derive/dashboard.ts,
// indiceDePerdas — perda das entradas em kg + perda de deposito, sobre o kg
// recebido) e o relatorio de perdas (web/src/derive/relatorios.ts,
// derivarRelatorioPerdas — perdaTotalQtd e indicePerdaPct). Ate agora esses
// dois somavam `qtd` cru: 4 CX de alface entravam como "4" ao lado de 296 kg
// de perda de coleta, e o indice saia mais baixo que a realidade — o
// indicador em que "para baixo" e justamente a direcao perigosa, porque
// esconde sangria.
//
// A regra de conversao e a MESMA das quatro ocorrencias que ja existiam
// (entradas.ts/peso_total, saidas.ts/peso, relatorios.ts/produtos e
// estoque.ts/buscarEstoque), nao uma quinta variante: lancamento em 'KG'
// conta `qtd`; em qualquer outra unidade conta `qtd * produtos.peso_medio`
// (peso de UMA embalagem, em kg), e so quando peso_medio > 0.
//
// Aqui a conversao usa `perdas.un` — a unidade da PROPRIA perda —, nunca
// `produtos.un`: o produto pode estar cadastrado em CX e a perda ter sido
// lancada em KG (ou o contrario). Mesma leitura de relatorios.ts e
// estoque.ts, e o oposto das duas colunas `perda_kg` (entrada_itens e
// saida_itens), que sao kg por contrato para item de qualquer unidade e por
// isso NUNCA convertem.
//
// itens_sem_conversao: perda em unidade nao-KG cujo produto tem peso_medio =
// 0 ("nao informado", ver a migration) nao e convertivel e NAO recebe fator
// inventado — uma caixa nao pesa um quilo. O `case` nao tem `else`, entao
// `qtd_kg` vira NULL e a perda fica FORA de qualquer soma em quilos; o
// contador diz que ela existiu, pra a tela marcar o numero em vez de exibi-lo
// como total fechado. Como cada linha desta rota E um lancamento, o contador
// vale 0 ou 1 — e derivavel de `qtd_kg is null`, e existe assim mesmo pra o
// nome e o significado do campo serem os mesmos das outras quatro rotas: quem
// soma perdas soma `qtd_kg` e soma `itens_sem_conversao`, sem aprender uma
// convencao nova por endpoint.
//
// `left join produtos` (nao inner): produto_id e `not null` com FK composta
// (migration 010), entao a linha sempre existe — o left join + coalesce e o
// mesmo cinto de seguranca de entradas.ts, e garante que uma perda nunca
// suma da LISTA por causa da conversao (no maximo sai da SOMA, marcada).
//
// A conversao fica so na listagem, de proposito. GET /:id, POST e PUT
// continuam devolvendo o registro cru (`qtd` + `un`), que e o que o
// formulario de edicao carrega e o que a tabela de Perdas mostra ("4 CX"):
// a verdade de UMA perda e a quantidade na unidade em que ela foi lancada;
// o quilo so aparece quando ela e somada a outras. Mesma divisao de
// entradas.ts, onde peso_total/itens_sem_conversao existem so no GET /.
perdas.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    select pd.*,
      case
        when pd.un = 'KG' then pd.qtd
        when coalesce(pr.peso_medio, 0) > 0 then pd.qtd * pr.peso_medio
      end as qtd_kg,
      case
        when pd.un <> 'KG' and coalesce(pr.peso_medio, 0) = 0 then 1 else 0
      end as itens_sem_conversao
    from perdas pd
    left join produtos pr on pr.id = pd.produto_id
    order by pd.data desc, pd.criado_em desc`)
  return c.json(linhas.map(paraJsonLista))
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
