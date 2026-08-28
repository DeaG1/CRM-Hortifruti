import { Hono } from 'hono'
import type postgres from 'postgres'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'
import {
  autorDaAlteracao, diferencas, erroDeDeclaracao, registrarHistorico, vaiGravar,
} from '../historico'

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

/**
 * Ler, CRIAR e EDITAR fornecedor exige apenas sessao; EXCLUIR exige admin.
 *
 * A leitura ja era liberada, e continua pelo mesmo motivo: o colaborador
 * lanca entradas e o modal de entrada precisa do seletor de fornecedor — com
 * admin exigido em tudo ele nao conseguia escolher de quem comprou.
 *
 * POST e PUT passaram a aceitar colaborador por decisao do dono. Quem vai a
 * feira e quem volta com produtor novo, com o contato certo e com a lista do
 * que aquele produtor realmente entrega (o `produto_ids` do PUT abaixo);
 * anotar isso num papel para o admin digitar depois e como perder a
 * informacao. `fornecedores` saiu de ADMIN_ONLY_SCREENS (web/src/telas.ts).
 *
 * DELETE continua admin: `entradas.fornecedor_id` e ON DELETE SET NULL
 * (014_fk_set_null_por_coluna.sql), entao apagar um fornecedor nao dá erro
 * nenhum — so desliga silenciosamente todas as coletas dele do preco medio e
 * da variacao que o dono usa para decidir de quem comprar.
 *
 * O QUE ESTA ROTA NAO ENTREGA: nome, regiao, contato e os produtos
 * vinculados. Preco medio de compra, variacao, aproveitamento e ultima coleta
 * nao vem daqui — sao derivados de GET /api/entradas, e quem os esconde do
 * colaborador e a TELA (`podeVerMetricasDeCadastro`, web/src/telas.ts), nao
 * esta rota. Ver o relatorio dessa decisao: /api/entradas ja e acessivel a
 * ele porque Entradas e tela dele.
 */
fornecedores.use('*', exigirSessao)
fornecedores.delete('*', exigirAdmin)

/**
 * A lista traz os produtos vinculados junto, agregados em SQL.
 *
 * Sem isso, a tela precisa buscar `GET /:id` de cada fornecedor para saber o
 * que ele entrega — com 30 fornecedores, 31 requisicoes. Cada ida ao banco
 * custa cerca de 116ms quando o Worker roda longe do Postgres (medido em
 * producao), entao o N+1 sairia de meio segundo para quase quatro.
 *
 * O `left join` preserva fornecedor sem nenhum produto vinculado, e o
 * `filter (where ...)` faz esse caso devolver lista vazia em vez de um array
 * com um elemento nulo dentro.
 */
fornecedores.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select f.*,
              coalesce(
                json_agg(
                  json_build_object('id', p.id, 'nome', p.nome, 'un', p.un)
                  order by p.nome
                ) filter (where p.id is not null),
                '[]'
              ) as produtos
         from fornecedores f
         left join fornecedor_produtos fp
           on fp.fornecedor_id = f.id and fp.tenant_id = f.tenant_id
         left join produtos p
           on p.id = fp.produto_id and p.tenant_id = f.tenant_id
        group by f.id
        order by f.nome`)
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

/**
 * Nome dos produtos vinculados, em uma linha, para o de/para do historico.
 *
 * A relacao `fornecedor_produtos` E cadastro editavel pelo colaborador (o
 * `produto_ids` do PUT), entao deixa-la fora do rastro abriria um buraco do
 * tamanho da feature: daria para trocar tudo que um produtor entrega sem
 * nenhum registro. Vai como NOME, nao como lista de uuid, porque o log e
 * lido por gente — "Batata, Cebola" -> "Batata, Tomate" responde a pergunta;
 * dois blocos de uuid nao respondem.
 *
 * A consulta ja devolve ordenado por nome (produtosDoFornecedor), entao
 * reordenar os mesmos produtos nao aparece como alteracao — o que mudou e o
 * CONJUNTO, nao a ordem em que o formulario os enviou.
 */
function nomesDosProdutos(linhas: readonly Record<string, unknown>[]): string {
  return linhas.map(p => String(p.nome ?? '')).join(', ')
}

// Historico: mesma mecanica e mesmos motivos de clientes.ts. O que e proprio
// daqui e o campo sintetico `produtos` no de/para do PUT — ver
// `nomesDosProdutos` acima.
fornecedores.post('/', async (c) => {
  const corpo = await c.req.json() as Record<string, unknown>
  const dados = sanear(corpo)
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)
  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  try {
    const feito = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
      if ('erro' in autor) return { erro: autor.erro } as const
      const [linha] = await tx`insert into fornecedores ${tx({ ...dados, tenant_id: tenantId })} returning *`
      await registrarHistorico(tx, {
        tenantId,
        entidade: 'fornecedor',
        registroId: linha.id as string,
        registroNome: linha.nome as string,
        acao: 'criou',
        autor,
        alteracoes: [],
      })
      return { linha } as const
    })
    if ('erro' in feito) return c.json({ erro: feito.erro }, 400)
    return c.json(paraJson(feito.linha), 201)
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
  const corpo = await c.req.json() as Record<string, unknown>
  const dados = sanear(corpo)
  const produtoIds = corpo.produto_ids

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
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)

  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  try {
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
      if ('erro' in autor) return { erroDeclaracao: autor.erro } as const

      const [antes] = await tx`select * from fornecedores where id = ${id}`
      if (!antes) return 'nao_encontrado' as const
      const vinculadosAntes = await produtosDoFornecedor(tx, id)

      // A SINCRONIZACAO VEM ANTES DO UPDATE, e a ordem foi trocada de
      // proposito. Antes o update dos campos rodava primeiro e um
      // `produto_ids` invalido devolvia 400 DEPOIS de a transacao ja ter
      // gravado o nome/regiao/contato novos — e commitava assim mesmo. Isso
      // era escrita parcial silenciosa antes de existir historico; com
      // historico passaria a ser pior: a alteracao entrava e o registro dela
      // nao, porque o `return` acontece antes do `registrarHistorico`. Ou
      // seja, um caminho para editar sem deixar rastro, aberto por qualquer
      // um que mandasse um uuid inexistente em `produto_ids` junto.
      //
      // `sincronizarProdutos` valida a lista inteira antes de escrever
      // qualquer coisa, entao aqui o `produto_invalido` sai com zero linhas
      // tocadas.
      if (produtoIds !== undefined) {
        // Validado logo no inicio do handler (listaDeIdsValida) — aqui ja
        // sabemos que e string[], so o TS nao carrega essa narrowing por
        // dois `if`s separados.
        const sincronizado = await sincronizarProdutos(tx, tenantId, id, produtoIds as string[])
        if (sincronizado === 'produto_invalido') return 'produto_invalido' as const
      }

      let linha: Record<string, unknown> = antes
      if (Object.keys(dados).length > 0) {
        ;[linha] = await tx`update fornecedores set ${tx({ ...dados, alterado_em: new Date() })}
           where id = ${id} returning *`
      }

      const vinculados = await produtosDoFornecedor(tx, id)
      const alteracoes = diferencas(antes, linha, CAMPOS)
      const produtosDe = nomesDosProdutos(vinculadosAntes)
      const produtosPara = nomesDosProdutos(vinculados)
      if (produtosDe !== produtosPara) {
        alteracoes.push({ campo: 'produtos', de: produtosDe, para: produtosPara })
      }
      if (vaiGravar('editou', alteracoes)) {
        await registrarHistorico(tx, {
          tenantId,
          entidade: 'fornecedor',
          registroId: id,
          registroNome: linha.nome as string,
          acao: 'editou',
          autor,
          alteracoes,
        })
      }
      return { linha, vinculados }
    })

    if (resultado === 'nao_encontrado') return c.json({ erro: 'nao encontrado' }, 404)
    if (resultado === 'produto_invalido') return c.json({ erro: 'produto nao encontrado' }, 400)
    if ('erroDeclaracao' in resultado) return c.json({ erro: resultado.erroDeclaracao }, 400)
    return c.json({ ...paraJson(resultado.linha), produtos: resultado.vinculados.map(paraJsonProduto) })
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

// Exclusao entra no historico pelo mesmo motivo de clientes.ts: o rastro
// sobrevive ao registro que documenta.
fornecedores.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const corpo = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)
  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  const feito = await withTenant(c.get('sql'), tenantId, async (tx) => {
    const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
    if ('erro' in autor) return { erro: autor.erro } as const
    const [linha] = await tx`delete from fornecedores where id = ${id} returning id, nome`
    if (!linha) return { naoEncontrado: true } as const
    await registrarHistorico(tx, {
      tenantId,
      entidade: 'fornecedor',
      registroId: id,
      registroNome: linha.nome as string,
      acao: 'excluiu',
      autor,
      alteracoes: [],
    })
    return { ok: true } as const
  })
  if ('erro' in feito) return c.json({ erro: feito.erro }, 400)
  if ('naoEncontrado' in feito) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json({ ok: true })
})
