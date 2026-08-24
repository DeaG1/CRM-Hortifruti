import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

const CAMPOS = [
  'numero', 'fornecedor_id', 'data', 'perda_kg', 'motivo',
  'pago', 'data_pag', 'forma_pag', 'obs',
] as const

type Entrada = Record<(typeof CAMPOS)[number], string | number | null>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (mass assignment de tenant_id/id, e tambem `itens`: itens tem tratamento
 * proprio, mais abaixo, porque vive numa tabela separada). */
function sanear(corpo: Record<string, unknown>): Partial<Entrada> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  // fornecedor_id e data_pag sao nullable no schema; um <select>/<input date>
  // limpo no front manda '' , que o Postgres rejeita como uuid/date ('invalid
  // input syntax'). '' so faz sentido aqui como "sem fornecedor"/"sem data",
  // entao normaliza pra null antes de chegar perto do banco.
  if (saida.fornecedor_id === '') saida.fornecedor_id = null
  if (saida.data_pag === '') saida.data_pag = null
  return saida as Partial<Entrada>
}

const CAMPOS_DATA = ['data', 'data_pag'] as const

/**
 * `data`/`data_pag` sao colunas `date` — o postgres.js devolve isso como
 * objeto JS `Date`, e o JSON.stringify padrao do Hono serializa `Date` como
 * timestamp ISO completo ("2026-08-20T00:00:00.000Z"), nao a data pura
 * ("2026-08-20") que a API recebeu e que um `<input type="date">` (ou o
 * `data_pag` que alimenta web/src/derive/financeiro.ts) espera. Sem
 * normalizar de volta aqui o round-trip quebra (POST com data:"2026-08-20",
 * GET devolveria "2026-08-20T00:00:00.000Z") — mesmo defeito que
 * api/src/routes/saidas.ts (dataParaTexto/CAMPOS_DATA) ja corrige do lado
 * das saidas; entradas nunca teve um teste comparando a string exata pra
 * revelar isso (descoberto ao escrever o teste do novo PATCH /:id/pago, que
 * PRECISA de `data_pag` correto pra alimentar o ciclo de caixa). `null`
 * passa direto (coluna vazia); `criado_em`/`alterado_em` (timestamptz) NAO
 * entram aqui de proposito — esses devem mesmo continuar com hora.
 */
function dataParaTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v as string)
  return d.toISOString().slice(0, 10)
}

function converterDatas(alvo: Record<string, unknown>, linha: Record<string, unknown>) {
  for (const campo of CAMPOS_DATA) {
    if (campo in linha) alvo[campo] = dataParaTexto(linha[campo])
  }
}

/**
 * numeric vem como string do postgres.js — converter na borda da API.
 * `tenant_id` sai do corpo pelo mesmo motivo do molde (clientes.ts): e
 * identificador interno, RLS ja isola no servidor, ninguem "usa" isso no
 * cliente.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  const convertido: Record<string, unknown> = { ...resto, perda_kg: Number(linha.perda_kg ?? 0) }
  converterDatas(convertido, linha)
  return convertido
}

/** Mesma conversao de paraJson, para uma linha de `entrada_itens`. */
function paraJsonItem<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return {
    ...resto,
    qtd: Number(linha.qtd ?? 0),
    preco: Number(linha.preco ?? 0),
    perda_kg: Number(linha.perda_kg ?? 0),
  }
}

/**
 * Para a listagem (GET /): a linha vem de uma agregacao (sum sobre os
 * itens), entao alem de perda_kg tambem converte valor_total/peso_total e
 * perda_itens_qtd.
 */
function paraJsonLista<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  const convertido: Record<string, unknown> = {
    ...resto,
    perda_kg: Number(linha.perda_kg ?? 0),
    valor_total: Number(linha.valor_total ?? 0),
    peso_total: Number(linha.peso_total ?? 0),
    perda_itens_qtd: Number(linha.perda_itens_qtd ?? 0),
  }
  converterDatas(convertido, linha)
  return convertido
}

/** true so quando o valor existe e converte pra um numero finito negativo —
 * ausente (undefined) nao e invalido, so significa "nao alterar este campo". */
function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

/** true so quando o valor existe, nao e nulo/vazio e converte pra um numero
 * finito negativo ou invalido — diferente de numeroNegativo, aqui ausente
 * TAMBEM e invalido: qtd/preco de um item sao colunas `not null` sem
 * default, entao sempre precisam vir preenchidas. */
function numeroObrigatorioInvalido(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  const n = Number(v)
  return !Number.isFinite(n) || n < 0
}

function campoTextoEmBranco(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
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

/**
 * `perda_kg` negativo e dado corrompido (mesmo raciocinio de limite/prazo em
 * clientes.ts). `fornecedor_id`, quando presente e nao nulo, precisa ser um
 * uuid valido — senao o Postgres lanca no cast antes mesmo de chegar na FK,
 * um 500 cru que este projeto trata como bug (ver idValido acima).
 */
function erroDeCampoInvalido(dados: Partial<Entrada>): string | null {
  if (numeroNegativo(dados.perda_kg)) return 'perda_kg nao pode ser negativo'
  if (dados.fornecedor_id != null && !idValido(String(dados.fornecedor_id))) {
    return 'fornecedor_id invalido'
  }
  return null
}

const CAMPOS_ITEM = ['produto_id', 'un', 'qtd', 'preco', 'perda_kg'] as const
type ItemEntrada = Record<(typeof CAMPOS_ITEM)[number], string | number>

function sanearItem(item: Record<string, unknown>): Partial<ItemEntrada> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS_ITEM) if (campo in item) saida[campo] = item[campo]
  return saida as Partial<ItemEntrada>
}

/** Valida um item ja saneado. produto_id e qtd/preco sao obrigatorios (colunas
 * `not null` sem default); un e perda_kg tem default no banco, por isso
 * ausente e valido (ver itemPronto, que preenche o default do lado da API
 * para o insert em lote ficar com colunas simetricas — ver comentario lá). */
function erroDeItem(item: Partial<ItemEntrada>): string | null {
  if (typeof item.produto_id !== 'string' || !idValido(item.produto_id)) {
    return 'produto_id invalido em um item'
  }
  if (numeroObrigatorioInvalido(item.qtd)) return 'qtd invalida em um item'
  if (numeroObrigatorioInvalido(item.preco)) return 'preco invalido em um item'
  if (numeroNegativo(item.perda_kg)) return 'perda_kg nao pode ser negativo em um item'
  return null
}

type ResultadoItens =
  | { erro: string; itens?: undefined }
  | { itens: Partial<ItemEntrada>[]; erro?: undefined }

/**
 * `itens` e obrigatorio tanto no POST quanto no PUT (no PUT, a estrategia e
 * substituir a lista inteira — ver comentario no handler do PUT). Uma
 * entrada sem nenhum item e um registro sem sentido: quebraria a media de
 * preco/peso que os relatorios de produto calculam em cima de entrada_itens.
 */
function saneiaItens(bruto: unknown): ResultadoItens {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { erro: 'entrada precisa de pelo menos um item' }
  }
  const itens: Partial<ItemEntrada>[] = []
  for (const linhaBruta of bruto) {
    if (typeof linhaBruta !== 'object' || linhaBruta === null) {
      return { erro: 'item invalido' }
    }
    const item = sanearItem(linhaBruta as Record<string, unknown>)
    const erroItem = erroDeItem(item)
    if (erroItem) return { erro: erroItem }
    itens.push(item)
  }
  return { itens }
}

/**
 * Preenche os defaults do banco do lado da API (un='KG', perda_kg=0) antes
 * do insert em lote: `sql(array, ...colunas)` gera um VALUES por linha nas
 * MESMAS colunas para todas — se um item viesse sem `un` e outro com, as
 * linhas ficariam assimetricas. Preencher aqui garante que todo objeto do
 * array tem exatamente as mesmas chaves.
 */
function itemPronto(item: Partial<ItemEntrada>, tenantId: string, entradaId: string) {
  return {
    tenant_id: tenantId,
    entrada_id: entradaId,
    produto_id: item.produto_id,
    un: item.un || 'KG',
    qtd: item.qtd,
    preco: item.preco,
    perda_kg: item.perda_kg ?? 0,
  }
}

/**
 * `entradas`/`entrada_itens` tem CHECK constraints (23514), a unicidade de
 * `numero` por tenant (23505) e FOREIGN KEYs para fornecedores/produtos
 * (23503). Diferente de clientes.ts (sem FK nenhuma), aqui o 23503 e o
 * mecanismo que garante a atomicidade cabecalho+itens exigida pela spec:
 * `withTenant` roda tudo numa unica transacao, e um item com produto_id
 * inexistente derruba o insert de entrada_itens com uma FK violation — o
 * Postgres faz ROLLBACK da transacao inteira sozinho (inclusive do insert/
 * update de `entradas` que rodou antes, na mesma transacao), sem precisar de
 * nenhuma logica extra aqui. So resta mapear o erro pra uma resposta legivel.
 */
const MENSAGENS_CHECK: Record<string, string> = {
  entradas_pago_check: 'pago invalido',
  entradas_perda_kg_check: 'perda_kg nao pode ser negativo',
  entrada_itens_qtd_check: 'qtd nao pode ser negativo em um item',
  entrada_itens_preco_check: 'preco nao pode ser negativo em um item',
  entrada_itens_perda_kg_check: 'perda_kg nao pode ser negativo em um item',
}

// Nomes pos migration 010_fk_com_tenant.sql: as FKs simples (produto_id ->
// produtos(id)) viraram compostas (tenant_id, produto_id) -> produtos
// (tenant_id, id) — a checagem de FK do Postgres roda com os privilegios do
// DONO da tabela referenciada, nao do role da sessao, entao antes da 010 uma
// FK simples nao enxergava tenant nenhum e aceitava referencia pra fora do
// tenant em silencio. Os nomes das constraints mudaram junto (sufixo
// `_fk` em vez do `_fkey` que o Postgres gera sozinho para FK simples).
const MENSAGENS_FK: Record<string, string> = {
  entradas_fornecedor_fk: 'fornecedor nao encontrado',
  entrada_itens_produto_fk: 'produto nao encontrado',
  entrada_itens_entrada_fk: 'entrada nao encontrada',
}

export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe uma entrada com esse numero' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  if (e.code === '23503') {
    const mensagem = (e.constraint_name && MENSAGENS_FK[e.constraint_name])
      ?? 'referencia invalida'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  return null
}

export const entradas = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Design: entradas e visivel para colaborador (ver web/src/telas.ts,
// ADMIN_ONLY_SCREENS nao inclui 'entradas') — so exigirSessao, sem
// exigirAdmin. Difere de clientes/produtos/fornecedores de proposito.
entradas.use('*', exigirSessao)

entradas.get('/', async (c) => {
  // Cabecalhos com totais agregados dos itens, sem trazer os itens em si —
  // a lista tem dezenas de linhas e nao precisa deles (GET /:id traz).
  //
  // perda_itens_qtd (sum(i.perda_kg), separado de e.perda_kg que ja vem em
  // e.*): existe pra quem consome esta listagem poder decidir se o
  // cabecalho da entrada esta trazendo perda NOVA ou so repetindo o que os
  // itens ja mostram, sem precisar buscar os itens a parte. E a mesma
  // pergunta que api/src/routes/estoque.ts (buscarEstoque) resolve por
  // produto — aqui e o mesmo dado, cru, por entrada inteira, pra
  // web/src/derive/relatorios.ts (derivarRelatorioCompras/derivarRelatorio-
  // Perdas) poderem aplicar a mesma regra de "usar o maior, nao somar os
  // dois" nos relatorios que agrupam por fornecedor/motivo (dimensoes do
  // CABECALHO da entrada, no do produto — por isso nao precisam do rateio
  // proporcional que buscarEstoque faz, so do maximo). Ver o comentario
  // grande em buscarEstoque pra o raciocinio completo.
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    select e.*,
      coalesce(sum(i.qtd * i.preco), 0) as valor_total,
      coalesce(sum(i.qtd), 0) as peso_total,
      coalesce(sum(i.perda_kg), 0) as perda_itens_qtd
    from entradas e
    left join entrada_itens i on i.entrada_id = e.id
    group by e.id
    order by e.data desc, e.numero desc`)
  return c.json(linhas.map(paraJsonLista))
})

entradas.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const resultado = await withTenant(c.get('sql'), c.get('tenantId'), async (tx) => {
    const [linha] = await tx`select * from entradas where id = ${id}`
    if (!linha) return null
    const itens = await tx`select * from entrada_itens where entrada_id = ${id} order by id`
    return { linha, itens }
  })
  if (!resultado) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json({ ...paraJson(resultado.linha), itens: resultado.itens.map(paraJsonItem) })
})

entradas.post('/', async (c) => {
  const corpo = await c.req.json()
  const dados = sanear(corpo)

  if (campoTextoEmBranco(dados.numero)) return c.json({ erro: 'numero e obrigatorio' }, 400)
  dados.numero = (dados.numero as string).trim()
  if (campoTextoEmBranco(dados.data)) return c.json({ erro: 'data e obrigatoria' }, 400)

  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  const resultadoItens = saneiaItens((corpo as Record<string, unknown>).itens)
  if (resultadoItens.erro) return c.json({ erro: resultadoItens.erro }, 400)

  const tenantId = c.get('tenantId')
  try {
    // Tudo dentro de um unico withTenant: cabecalho e itens sao a MESMA
    // transacao. Se o insert dos itens falhar (produto_id inexistente,
    // qtd/preco negativos escapando a validacao acima etc.), o Postgres
    // desfaz tambem o insert de `entradas` que rodou linhas atras — nao ha
    // como a entrada ficar gravada sem nenhum item.
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const [entrada] = await tx`insert into entradas ${tx({ ...dados, tenant_id: tenantId })} returning *`
      const prontos = resultadoItens.itens!.map(item => itemPronto(item, tenantId, entrada.id))
      const itensInseridos = await tx`insert into entrada_itens ${
        tx(prontos, 'tenant_id', 'entrada_id', 'produto_id', 'un', 'qtd', 'preco', 'perda_kg')
      } returning *`
      return { entrada, itensInseridos }
    })
    return c.json(
      { ...paraJson(resultado.entrada), itens: resultado.itensInseridos.map(paraJsonItem) },
      201,
    )
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

entradas.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)

  const corpo = await c.req.json()
  const dados = sanear(corpo)

  // numero/data so sao validados se vieram no corpo — ausente continua
  // significando "nao alterar este campo", igual ao molde (clientes.ts).
  if ('numero' in dados) {
    if (campoTextoEmBranco(dados.numero)) return c.json({ erro: 'numero e obrigatorio' }, 400)
    dados.numero = (dados.numero as string).trim()
  }
  if ('data' in dados && campoTextoEmBranco(dados.data)) {
    return c.json({ erro: 'data e obrigatoria' }, 400)
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)

  // itens e obrigatorio em todo PUT, nao so quando algo muda nele: a
  // estrategia escolhida (a mais simples e correta, dado que nao ha como
  // saber so pelo payload quais itens sao "os mesmos de antes") e apagar
  // TODOS os itens da entrada e reinserir a lista enviada, dentro da mesma
  // transacao do update do cabecalho. Por isso nao existe um "PUT parcial"
  // de itens nesta rota — o corpo sempre manda a lista completa e ela
  // sempre substitui a anterior por inteiro.
  const resultadoItens = saneiaItens((corpo as Record<string, unknown>).itens)
  if (resultadoItens.erro) return c.json({ erro: resultadoItens.erro }, 400)

  const tenantId = c.get('tenantId')
  try {
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const [entrada] = await tx`update entradas set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`
      if (!entrada) return null
      // Apaga e reinsere, na mesma transacao do update acima: se o insert
      // falhar (produto_id inexistente etc.), o Postgres desfaz o delete e o
      // update tambem — a entrada nunca fica visivel sem seus itens, nem com
      // itens "meio trocados".
      await tx`delete from entrada_itens where entrada_id = ${id}`
      const prontos = resultadoItens.itens!.map(item => itemPronto(item, tenantId, id))
      const itensInseridos = await tx`insert into entrada_itens ${
        tx(prontos, 'tenant_id', 'entrada_id', 'produto_id', 'un', 'qtd', 'preco', 'perda_kg')
      } returning *`
      return { entrada, itensInseridos }
    })
    if (!resultado) return c.json({ erro: 'nao encontrado' }, 404)
    return c.json({ ...paraJson(resultado.entrada), itens: resultado.itensInseridos.map(paraJsonItem) })
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

/**
 * PATCH /:id/pago — atalho para a acao mais repetida da tela de Entradas:
 * marcar pagamento direto na linha da tabela (chip editavel), sem abrir o
 * modal nem reenviar `itens` (que o PUT completo exige sempre — ver
 * comentario no handler PUT acima). So aceita 'Pago'/'Pendente': 'Atrasado'
 * nao e mais uma escolha por aqui (decisao do dono do produto — ver
 * web/src/derive/pagamento.ts). Um registro ja gravado como 'Atrasado' antes
 * desta mudanca continua saindo assim de GET/GET-lista ate alguem trocar
 * pra Pago/Pendente (por este PATCH ou pelo PUT completo, que ainda aceita
 * os tres valores do CHECK) — nao migramos dado nenhum.
 *
 * Marcar 'Pago' grava `data_pag` = hoje (data do SERVIDOR, nao a que o
 * cliente mandar — o corpo da requisicao nem tem esse campo). Voltar para
 * 'Pendente' LIMPA `data_pag`: um registro pendente com data de pagamento
 * preenchida contaria, sem nunca ter acontecido, no calculo de dias de
 * pagamento ao produtor (web/src/derive/financeiro.ts, diasPagamentoProdutor).
 */
entradas.patch('/:id/pago', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)

  const corpo = await c.req.json()
  const pago = (corpo as Record<string, unknown>).pago
  if (pago !== 'Pago' && pago !== 'Pendente') {
    return c.json({ erro: 'pago deve ser "Pago" ou "Pendente"' }, 400)
  }
  const dataPag = pago === 'Pago' ? new Date().toISOString().slice(0, 10) : null

  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    update entradas set pago = ${pago}, data_pag = ${dataPag}, alterado_em = ${new Date()}
    where id = ${id} returning *`)
  if (!linhas.length) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json(paraJson(linhas[0]))
})

entradas.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // entrada_itens tem `on delete cascade` (migration 009) — apagar a entrada
  // apaga os itens junto, sem precisar de outro passo aqui.
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from entradas where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
