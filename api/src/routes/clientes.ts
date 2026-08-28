import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'
import {
  autorDaAlteracao, diferencas, erroDeDeclaracao, registrarHistorico, vaiGravar,
} from '../historico'

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
  Bindings: EnvBanco
  Variables: Vars
}>()

/**
 * Ler, CRIAR e EDITAR cliente exige apenas sessao; EXCLUIR exige admin.
 *
 * A leitura ja era liberada, e continua pelo mesmo motivo: o colaborador
 * lanca vendas e nao existe venda sem escolher para quem — com admin exigido
 * em toda a rota ele abria "Nova saida" e nao conseguia selecionar o cliente.
 *
 * POST e PUT passaram a aceitar colaborador por decisao do dono. Quem atende
 * o estabelecimento na rua e quem descobre que o telefone mudou, que o
 * responsavel e outro, que ha cliente novo para cadastrar; obrigar o admin a
 * redigitar isso depois nao protege nada — so garante que nao seja digitado.
 * `clientes` saiu de ADMIN_ONLY_SCREENS (web/src/telas.ts) junto com esta
 * mudanca: a TELA de cadastro deixou de ser restrita.
 *
 * DELETE continua admin, e a assimetria e deliberada: cadastro errado se
 * corrige editando, cadastro apagado leva junto o vinculo do historico —
 * `saidas.cliente_id` e ON DELETE SET NULL (014_fk_set_null_por_coluna.sql),
 * entao a venda sobrevive orfa e some da carteira daquele cliente para
 * sempre, sem erro nenhum na tela.
 *
 * O QUE ESTA ROTA NAO ESCONDE, de proposito: `limite`, `prazo` e os demais
 * campos de `clientes` saem inteiros no GET, que o colaborador precisa ler
 * para trabalhar. Nao mostrar o limite de credito a ele e decisao da TELA
 * (`podeVerMetricasDeCadastro`, web/src/telas.ts) e vale como apresentacao,
 * nao como permissao. O que a permissao protege de verdade sao as metricas
 * AGREGADAS — faturado, ticket, inadimplencia, markup —, e essas nao passam
 * por aqui: moram em /api/relatorios e /api/lancamentos, admin-only. Se um
 * dia for preciso esconder campo tambem na leitura, o caminho e um endpoint
 * enxuto (id e nome), nao bloquear de novo o que ele precisa para trabalhar.
 */
clientes.use('*', exigirSessao)
clientes.delete('*', exigirAdmin)

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

/**
 * O HISTORICO E ESCRITO AQUI, e nao numa rota propria, por dois motivos que
 * se reforcam (vale igual para produtos.ts e fornecedores.ts):
 *
 *  1. ATOMICIDADE. O insert do cadastro e o insert do historico rodam na
 *     MESMA transacao. Nao existe alteracao gravada sem rastro, nem rastro de
 *     uma alteracao que falhou.
 *  2. NAO HA COMO CONTORNAR. Se o historico fosse um `POST /api/historico`
 *     chamado pelo front, editar sem deixar rastro seria simplesmente nao
 *     chamar a segunda rota.
 *
 * A exigencia de declarar (autor + motivo) e do PAPEL DA SESSAO, resolvido do
 * cookie — nada do que o cliente manda sobre isso e consultado. Ver
 * `erroDeDeclaracao` em src/historico.ts.
 */
clientes.post('/', async (c) => {
  const corpo = await c.req.json() as Record<string, unknown>
  const dados = sanear(corpo)
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)
  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  try {
    const feito = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
      if ('erro' in autor) return { erro: autor.erro } as const
      const [linha] = await tx`insert into clientes ${tx({ ...dados, tenant_id: tenantId })} returning *`
      await registrarHistorico(tx, {
        tenantId,
        entidade: 'cliente',
        registroId: linha.id as string,
        registroNome: linha.nome as string,
        acao: 'criou',
        autor,
        // Vazio de proposito: criar nao tem "de", e o que foi criado E o
        // registro atual. Ver o comentario de `alteracoes` na 017.
        alteracoes: [],
      })
      return { linha } as const
    })
    if ('erro' in feito) return c.json({ erro: feito.erro }, 400)
    return c.json(paraJson(feito.linha), 201)
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
  const corpo = await c.req.json() as Record<string, unknown>
  const dados = sanear(corpo)
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
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)
  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  try {
    const feito = await withTenant(c.get('sql'), tenantId, async (tx) => {
      const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
      if ('erro' in autor) return { erro: autor.erro } as const
      // O `select` do estado ANTERIOR e o que permite gravar de/para em vez
      // de uma copia do registro. Ele roda na mesma transacao do update, com
      // a linha ja travada pelo update seguinte — nao ha janela para outra
      // escrita entrar no meio e o "de" ficar de uma versao que ninguem viu.
      const [antes] = await tx`select * from clientes where id = ${id}`
      if (!antes) return { naoEncontrado: true } as const
      const [linha] = await tx`update clientes set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`
      const alteracoes = diferencas(antes, linha, CAMPOS)
      // PUT que reenvia os mesmos valores nao gera registro — ver `vaiGravar`
      // em src/historico.ts. `alterado_em` fica de fora da comparacao (nao
      // esta em CAMPOS): ela sempre muda, e se contasse como alteracao a
      // regra nunca poderia valer.
      if (vaiGravar('editou', alteracoes)) {
        await registrarHistorico(tx, {
          tenantId,
          entidade: 'cliente',
          registroId: id,
          registroNome: linha.nome as string,
          acao: 'editou',
          autor,
          alteracoes,
        })
      }
      return { linha } as const
    })
    if ('erro' in feito) return c.json({ erro: feito.erro }, 400)
    if ('naoEncontrado' in feito) return c.json({ erro: 'nao encontrado' }, 404)
    return c.json(paraJson(feito.linha))
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

/**
 * A EXCLUSAO TAMBEM ENTRA NO HISTORICO, e e o caso que decidiu a modelagem:
 * `historico_cadastros` NAO tem chave estrangeira para `clientes` (ver 017),
 * entao esta linha de log sobrevive ao registro que ela documenta. O dono
 * consegue perguntar "o que aconteceu com o Mercado Bom Preço?" depois de o
 * cadastro nao existir mais, e a resposta continua la — inclusive o nome, que
 * vai gravado como texto em `registro_nome`.
 *
 * Sem motivo declarado: DELETE e admin (`clientes.delete('*', exigirAdmin)`),
 * e admin nao declara nada. O `papel` e lido da sessao assim mesmo, em vez de
 * fixado em 'admin' aqui: se um dia a exclusao for aberta ao colaborador, a
 * exigencia de declarar passa a valer sozinha, e ele leva 400 ate declarar —
 * fail-closed em vez de um DELETE anonimo por esquecimento.
 */
clientes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // DELETE normalmente vem sem corpo; `.catch` cobre isso sem transformar
  // "sem corpo" em 500.
  const corpo = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const papel = c.get('papel')
  const erroDecl = erroDeDeclaracao(papel, corpo)
  if (erroDecl) return c.json({ erro: erroDecl }, 400)
  const tenantId = c.get('tenantId')
  const usuarioId = c.get('usuarioId')
  const feito = await withTenant(c.get('sql'), tenantId, async (tx) => {
    const autor = await autorDaAlteracao(tx, papel, usuarioId, corpo)
    if ('erro' in autor) return { erro: autor.erro } as const
    const [linha] = await tx`delete from clientes where id = ${id} returning id, nome`
    if (!linha) return { naoEncontrado: true } as const
    await registrarHistorico(tx, {
      tenantId,
      entidade: 'cliente',
      registroId: id,
      registroNome: linha.nome as string,
      acao: 'excluiu',
      autor,
      // Vazio: excluir nao tem "para", e o que se perde esta identificado por
      // `registro_nome`. Gravar o registro inteiro aqui seria a copia que a
      // 017 recusa.
      alteracoes: [],
    })
    return { ok: true } as const
  })
  if ('erro' in feito) return c.json({ erro: feito.erro }, 400)
  if ('naoEncontrado' in feito) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json({ ok: true })
})
