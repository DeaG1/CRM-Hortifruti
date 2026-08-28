import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'
import { ENTIDADES_HISTORICO, type EntidadeHistorico } from '../historico'

/**
 * LEITURA do historico de alteracoes de um cadastro. So isso.
 *
 * ESTA ROTA NAO ESCREVE, e a ausencia e a feature. Quem grava sao as proprias
 * rotas de cadastro (clientes, produtos, fornecedores), dentro da mesma
 * transacao da alteracao que o registro descreve — nao ha um
 * `POST /api/historico` que um cliente pudesse chamar para inventar linha, e
 * nao ha PUT nem DELETE que permitisse corrigir o que ja foi gravado.
 * Historico corrigivel depois nao serve de prova. A ausencia e testada
 * (api/test/historico.http.test.ts bate PUT, PATCH e DELETE aqui e exige
 * 404), porque "eu nao escrevi essa rota" nao e uma garantia que sobreviva ao
 * proximo commit sozinha.
 *
 * SO O ADMIN LE. Decisao do dono, e ela se sustenta sozinha: o log responde
 * "quem mexeu nisto e por que", uma pergunta de supervisao. Aberto a quem e
 * supervisionado, ele viraria a lista de quem declarou o que — util para
 * combinar versao, nao para conferir.
 *
 * `exigirAdmin` em '*', inclusive na leitura, e a leitura e tudo que existe
 * aqui.
 */
export const historico = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

historico.use('*', exigirSessao, exigirAdmin)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sem isto, um id malformado chega intacto ao `where registro_id = $1` e o
 * Postgres lanca "invalid input syntax for type uuid" — 500 generico em vez
 * do {erro} previsivel que o contrato desta API respeita. */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

function entidadeValida(v: string): v is EntidadeHistorico {
  return (ENTIDADES_HISTORICO as readonly string[]).includes(v)
}

/**
 * O historico de UM registro, do mais recente para o mais antigo.
 *
 * A URL e `/:entidade/:id` e nao `/:id` sozinho porque `registro_id` nao tem
 * chave estrangeira (ver 017): o par (entidade, registro_id) e o que
 * identifica de quem e o log. Sem a entidade no filtro, um uuid que por
 * acaso existisse como cliente E como produto misturaria dois historicos.
 *
 * `criado_em` sai como TEXTO ja no fuso de Sao Paulo, formatado pelo
 * Postgres. Mesmo motivo do `to_char` em routes/estoque.ts: o postgres.js
 * entrega `timestamptz` como `Date`, o Hono serializa em UTC, e um evento das
 * 21h de sexta apareceria na tela como sabado de madrugada — num log de
 * auditoria, a data errada nao e cosmetica. Formatar no banco tambem evita um
 * segundo formatador de data no TypeScript.
 *
 * `at time zone 'America/Sao_Paulo'`: o banco conhece as regras do fuso; um
 * `-3` fixo no codigo seria uma regra de fuso escrita a mao, que envelhece.
 */
historico.get('/:entidade/:id', async (c) => {
  const entidade = c.req.param('entidade')
  if (!entidadeValida(entidade)) return c.json({ erro: 'entidade invalida' }, 400)
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)

  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select h.id, h.entidade, h.registro_id, h.registro_nome, h.acao,
              h.autor_origem, h.autor_nome, h.autor_funcionario_id, h.motivo, h.alteracoes,
              to_char(h.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') as criado_em
         from historico_cadastros h
        where h.entidade = ${entidade} and h.registro_id = ${id}
        -- h.criado_em QUALIFICADO, e nao criado_em solto: o ORDER BY do
        -- Postgres resolve nome nu contra a lista de saida primeiro, e ali
        -- criado_em e o TEXTO do to_char, com precisao de minuto. Duas
        -- alteracoes no mesmo minuto sairiam empatadas e desempatadas por um
        -- uuid aleatorio — ordem errada num log e o tipo de erro que so
        -- aparece no dia em que alguem precisa da sequencia dos fatos.
        order by h.criado_em desc, h.id desc`)
  return c.json(linhas)
})
