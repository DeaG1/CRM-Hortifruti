import { Hono } from 'hono'
import type postgres from 'postgres'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

const CAMPOS = ['nome', 'regiao', 'contato'] as const

type Fornecedor = Record<(typeof CAMPOS)[number], string>

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente. */
function sanear(corpo: Record<string, unknown>): Partial<Fornecedor> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Fornecedor>
}

/**
 * `tenant_id` sai do corpo pelo mesmo motivo do molde (clientes.ts): e
 * identificador interno, RLS ja isola no servidor, ninguem "usa" isso no
 * cliente.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return resto
}

/**
 * Mesma conversao de paraJson, mas para uma linha de `produtos` embutida na
 * resposta de fornecedores (GET /:id e PUT /:id) — peso_medio tambem vem
 * como string do postgres.js.
 */
function paraJsonProduto(p: Record<string, unknown>) {
  const { tenant_id: _tenantId, ...resto } = p
  return { ...resto, peso_medio: Number(p.peso_medio ?? 0) }
}

/**
 * nome vazio ou so espaco e o mesmo problema que nome ausente — mesma regra
 * do molde (clientes.ts).
 */
function nomeEmBranco(nome: unknown): boolean {
  return typeof nome !== 'string' || nome.trim() === ''
}

/**
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis
 * em vez de deixar a excecao subir crua. `fornecedores` so tem a constraint
 * de unicidade (nome por tenant) — nao ha CHECK (23514) nesta tabela.
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um fornecedor com esse nome' }, status: 409 }
  if (e.code === '23514') {
    return { corpo: { erro: 'dado invalido para um dos campos' }, status: 400 }
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

/** true so quando o valor e uma lista onde todo item e string e uuid valido. */
function listaDeIdsValida(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(item => typeof item === 'string' && idValido(item))
}

/**
 * Busca os produtos vinculados a um fornecedor, dentro da mesma
 * transacao/tenant ja aberta por withTenant — join simples, ordenado por
 * nome para a UI nao precisar reordenar.
 */
async function produtosDoFornecedor(tx: postgres.TransactionSql, fornecedorId: string) {
  return tx`
    select p.id, p.nome, p.un, p.peso_medio, p.criado_em, p.alterado_em
    from fornecedor_produtos fp
    join produtos p on p.id = fp.produto_id
    where fp.fornecedor_id = ${fornecedorId}
    order by p.nome`
}

/**
 * Sincroniza fornecedor_produtos para o conjunto exato de `produtoIds`:
 * apaga os vinculos que saíram, insere os que entraram. Precisa ser
 * chamada dentro do withTenant do chamador — RLS isola por tenant_id tanto
 * no delete quanto no insert, e o `select` contra produtos abaixo so acha
 * ids que pertencem ao tenant da sessao (por isso da pra usar a contagem
 * como validacao de "produto existe e e meu").
 */
async function sincronizarProdutos(
  tx: postgres.TransactionSql,
  tenantId: string,
  fornecedorId: string,
  produtoIds: string[],
): Promise<'ok' | 'produto_invalido'> {
  const idsUnicos = [...new Set(produtoIds)]
  if (idsUnicos.length > 0) {
    const achados = await tx`select id from produtos where id in ${tx(idsUnicos)}`
    if (achados.length !== idsUnicos.length) return 'produto_invalido'
  }
  if (idsUnicos.length === 0) {
    await tx`delete from fornecedor_produtos where fornecedor_id = ${fornecedorId}`
    return 'ok'
  }
  await tx`delete from fornecedor_produtos
            where fornecedor_id = ${fornecedorId} and produto_id not in ${tx(idsUnicos)}`
  await tx`insert into fornecedor_produtos ${
    tx(idsUnicos.map(produtoId => ({ tenant_id: tenantId, fornecedor_id: fornecedorId, produto_id: produtoId })))
  } on conflict (fornecedor_id, produto_id) do nothing`
  return 'ok'
}

export const fornecedores = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

fornecedores.use('*', exigirSessao, exigirAdmin)

fornecedores.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from fornecedores order by nome`)
  return c.json(linhas.map(paraJson))
})

// GET /:id inclui os produtos vinculados (fornecedor_produtos) — e a lista
// que a tela de fornecedores usa pra mostrar/editar "quais produtos este
// fornecedor entrega" sem precisar de uma segunda chamada.
fornecedores.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const resultado = await withTenant(c.get('sql'), c.get('tenantId'), async (tx) => {
    const [linha] = await tx`select * from fornecedores where id = ${id}`
    if (!linha) return null
    const vinculados = await produtosDoFornecedor(tx, id)
    return { linha, vinculados }
  })
  if (!resultado) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json({ ...paraJson(resultado.linha), produtos: resultado.vinculados.map(paraJsonProduto) })
})

fornecedores.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into fornecedores ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

// PUT aceita `produto_ids` alem dos CAMPOS normais — sincroniza a relacao
// fornecedor_produtos pro conjunto exato enviado. `produto_ids` nao passa
// por sanear() (nao e coluna de `fornecedores`), e lido direto do corpo.
fornecedores.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const corpo = await c.req.json()
  const dados = sanear(corpo)
  const produtoIds = (corpo as Record<string, unknown>).produto_ids

  if (produtoIds !== undefined && !listaDeIdsValida(produtoIds)) {
    return c.json({ erro: 'produto_ids deve ser uma lista de ids validos' }, 400)
  }
  if (Object.keys(dados).length === 0 && produtoIds === undefined) {
    return c.json({ erro: 'nada a alterar' }, 400)
  }
  // nome so e validado se veio no corpo — ausente continua significando
  // "nao alterar este campo", igual aos demais campos do PUT.
  if ('nome' in dados) {
    if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
    dados.nome = (dados.nome as string).trim()
  }

  const tenantId = c.get('tenantId')
  try {
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      let linha: Record<string, unknown> | undefined
      if (Object.keys(dados).length > 0) {
        ;[linha] = await tx`update fornecedores set ${tx({ ...dados, alterado_em: new Date() })}
           where id = ${id} returning *`
      } else {
        ;[linha] = await tx`select * from fornecedores where id = ${id}`
      }
      if (!linha) return 'nao_encontrado' as const

      if (produtoIds !== undefined) {
        // Validado logo no inicio do handler (listaDeIdsValida) — aqui ja
        // sabemos que e string[], so o TS nao carrega essa narrowing por
        // dois `if`s separados.
        const sincronizado = await sincronizarProdutos(tx, tenantId, id, produtoIds as string[])
        if (sincronizado === 'produto_invalido') return 'produto_invalido' as const
      }

      const vinculados = await produtosDoFornecedor(tx, id)
      return { linha, vinculados }
    })

    if (resultado === 'nao_encontrado') return c.json({ erro: 'nao encontrado' }, 404)
    if (resultado === 'produto_invalido') return c.json({ erro: 'produto nao encontrado' }, 400)
    return c.json({ ...paraJson(resultado.linha), produtos: resultado.vinculados.map(paraJsonProduto) })
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

fornecedores.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`delete from fornecedores where id = ${id} returning id`)
  return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
})
