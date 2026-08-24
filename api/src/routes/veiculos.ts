import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/clientes.ts (sanear/paraJson/validacao/erros) e
// api/src/routes/produtos.ts (leitura liberada pro colaborador, escrita so
// admin). Especifico desta rota: as duas acoes operacionais (pegar/devolver)
// tambem sao liberadas pro colaborador — ver bloco de permissoes abaixo.

const CAMPOS = ['placa', 'modelo', 'marca', 'ano', 'ativo', 'obs'] as const

type Veiculo = {
  placa: string
  modelo: string
  marca: string
  ano: number | null
  ativo: boolean
  obs: string
}

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (em especial `tenant_id` e `id`, que nunca devem vir do corpo). */
function sanear(corpo: Record<string, unknown>): Partial<Veiculo> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  // `ano` e nullable no schema; um <input type="number"> limpo no front manda
  // '' , que o Postgres rejeita como integer ('invalid input syntax'). ''
  // so faz sentido aqui como "ano nao informado", entao normaliza pra null
  // antes de chegar perto do banco — mesmo padrao de fornecedor_id/data_pag
  // em entradas.ts.
  if (saida.ano === '') saida.ano = null
  return saida as Partial<Veiculo>
}

/**
 * `tenant_id` sai do corpo pelo mesmo motivo do molde (clientes.ts): e
 * identificador interno, RLS ja isola no servidor. `ano` e `integer` — o
 * driver ja devolve number nativamente (so `numeric` vem como string), mas
 * passa por `Number()` por simetria e para normalizar `null` explicitamente.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, ano: linha.ano == null ? null : Number(linha.ano) }
}

/**
 * GET / traz, para cada veiculo, o uso em aberto se houver — agregado numa
 * unica query (left join), nunca um por carro: com 10 carros seriam 11
 * requisicoes, e cada ida ao banco custa ~116ms medidos em producao (ver
 * comentario em api/src/db.ts). O indice parcial `veiculo_usos_aberto_unico`
 * garante no maximo 1 uso aberto por veiculo, entao o left join nunca
 * duplica uma linha de veiculo.
 */
interface LinhaVeiculoComUso {
  [campo: string]: unknown
  uso_id: string | null
  uso_funcionario_id: string | null
  uso_funcionario_nome: string | null
  uso_saida_em: Date | string | null
}

function paraJsonComUso(linha: LinhaVeiculoComUso) {
  const { uso_id, uso_funcionario_id, uso_funcionario_nome, uso_saida_em, ...resto } = linha
  return {
    ...paraJson(resto),
    uso_aberto: uso_id
      ? {
          id: uso_id,
          funcionario_id: uso_funcionario_id,
          funcionario_nome: uso_funcionario_nome,
          desde: uso_saida_em,
        }
      : null,
  }
}

/** `tenant_id` sai do corpo pelo mesmo motivo de paraJson acima. */
function paraJsonUso<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return resto
}

function numeroNaoInteiro(v: unknown): boolean {
  if (v === undefined || v === null) return false
  const n = Number(v)
  return Number.isFinite(n) && !Number.isInteger(n)
}

/**
 * `ano`, quando informado, precisa ser um inteiro — mesmo raciocinio de
 * `dia_pag` em funcionarios.ts: sem esta checagem, "2020.5" batia direto no
 * `integer` do Postgres e estourava "invalid input syntax", sem tratamento.
 * Nao ha CHECK de intervalo no banco (nenhum limite de "ano razoavel" foi
 * pedido no design) — so o tipo importa.
 */
function erroDeCampoInvalido(dados: Partial<Veiculo>): string | null {
  if (numeroNaoInteiro(dados.ano)) return 'ano deve ser um numero inteiro'
  return null
}

/** placa vazia ou so espaco e o mesmo problema que placa ausente — mesma
 * regra de nomeEmBranco em clientes.ts. */
function placaEmBranco(placa: unknown): boolean {
  return typeof placa !== 'string' || placa.trim() === ''
}

/**
 * `veiculos` tem uma unica constraint unique (placa por tenant, ver
 * veiculos_placa_unica na migration); `veiculo_usos` tem outra
 * (veiculo_usos_aberto_unico, a regra central desta feature). As duas sao
 * 23505 — o nome da constraint (nao o texto da mensagem do Postgres, que
 * pode mudar entre versoes/locale) e o que distingue qual foi violada.
 */
const MENSAGENS_UNICO: Record<string, string> = {
  veiculos_placa_unica: 'ja existe um veiculo com essa placa',
  veiculo_usos_aberto_unico: 'este veiculo ja esta em uso',
}

const MENSAGENS_CHECK: Record<string, string> = {
  veiculo_usos_volta_apos_saida: 'volta nao pode ser antes da saida',
}

const MENSAGENS_FK: Record<string, string> = {
  veiculo_usos_veiculo_fk: 'veiculo nao encontrado',
  veiculo_usos_funcionario_fk: 'funcionario nao encontrado',
}

/**
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis.
 * Mesmo contrato de clientes.ts/produtos.ts — a diferenca aqui e que 23505
 * pode vir de DUAS constraints diferentes (placa duplicada vs. checkin
 * duplicado), entao o fallback so aparece se uma terceira, desconhecida,
 * aparecer no futuro.
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') {
    const mensagem = (e.constraint_name && MENSAGENS_UNICO[e.constraint_name]) ?? 'registro duplicado'
    return { corpo: { erro: mensagem }, status: 409 }
  }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  if (e.code === '23503') {
    const mensagem = (e.constraint_name && MENSAGENS_FK[e.constraint_name]) ?? 'referencia invalida'
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

export const veiculos = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

/**
 * Ler veiculos (lista, ficha e historico) e pegar/devolver exigem so sessao;
 * cadastrar, editar e excluir o CADASTRO do veiculo exige admin.
 *
 * A tela de Veiculos e visivel para o colaborador (web/src/telas.ts nao
 * inclui 'veiculos' em ADMIN_ONLY_SCREENS) — e ele quem de fato pega e
 * devolve o carro no dia a dia; se essa acao dependesse do admin estar por
 * perto pra clicar, ninguem registraria nada (o problema que a feature
 * inteira existe pra resolver). Cadastrar/editar/excluir o carro em si
 * continua restrito ao admin, mesmo racional de clientes.ts/produtos.ts:
 * a permissao e sobre GERENCIAR o cadastro, nao sobre USAR o carro.
 *
 * `exigirAdmin` e aplicado so em '/', '/:id' com POST/PUT/DELETE — nao em
 * '*' como em clientes.ts/produtos.ts — porque '*' tambem bateria em
 * '/:id/pegar' e '/:id/devolver' (POST), que precisam continuar abertos
 * pro colaborador.
 *
 * "Encerrar uso de outra pessoa" (o caso do esquecimento, decisao do dono
 * do negocio) usa o MESMO endpoint de devolver: /:id/devolver fecha
 * qualquer uso aberto daquele carro, nao so o do proprio usuario logado —
 * nao ha vinculo entre "quem esta devolvendo" (a sessao) e "quem pegou"
 * (funcionario_id do uso). Isso e deliberado: exigir que fosse a mesma
 * pessoa impediria justamente o cenario que a decisao do dono cobre (o
 * admin fechando um uso que outro funcionario esqueceu aberto).
 */
veiculos.use('*', exigirSessao)
veiculos.post('/', exigirAdmin)
veiculos.put('/:id', exigirAdmin)
veiculos.delete('/:id', exigirAdmin)

veiculos.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx<LinhaVeiculoComUso[]>`
    select
      v.*,
      u.id as uso_id,
      u.funcionario_id as uso_funcionario_id,
      f.nome as uso_funcionario_nome,
      u.saida_em as uso_saida_em
    from veiculos v
    left join veiculo_usos u on u.veiculo_id = v.id and u.volta_em is null
    left join funcionarios f on f.id = u.funcionario_id
    order by v.placa`)
  return c.json(linhas.map(paraJsonComUso))
})

veiculos.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from veiculos where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

/**
 * Historico completo de usos do veiculo (abertos e fechados), do mais
 * recente pro mais antigo, com o nome do funcionario ja resolvido — mesmo
 * motivo de GET / trazer o uso aberto agregado: uma tela de historico nao
 * deveria disparar uma requisicao por linha so pra saber o nome de quem
 * pegou.
 */
veiculos.get('/:id/historico', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const resultado = await withTenant(c.get('sql'), c.get('tenantId'), async (tx) => {
    const [veiculo] = await tx`select id from veiculos where id = ${id}`
    if (!veiculo) return null
    return tx`
      select u.*, f.nome as funcionario_nome
      from veiculo_usos u
      join funcionarios f on f.id = u.funcionario_id
      where u.veiculo_id = ${id}
      order by u.saida_em desc`
  })
  if (!resultado) return c.json({ erro: 'nao encontrado' }, 404)
  return c.json(resultado.map(paraJsonUso))
})

veiculos.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (placaEmBranco(dados.placa)) return c.json({ erro: 'placa e obrigatoria' }, 400)
  // Normaliza pra maiuscula ao gravar — mesmo valor que o indice unico
  // (`upper(placa)`) usa pra comparar, entao "abc-1234" e "ABC-1234"
  // colidem tanto na tela (mesma grafia sempre) quanto no banco.
  dados.placa = (dados.placa as string).trim().toUpperCase()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into veiculos ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

veiculos.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  if ('placa' in dados) {
    if (placaEmBranco(dados.placa)) return c.json({ erro: 'placa e obrigatoria' }, 400)
    dados.placa = (dados.placa as string).trim().toUpperCase()
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update veiculos set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

veiculos.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // veiculo_usos_veiculo_fk e `on delete restrict` (migration 011): excluir
  // um veiculo com historico de uso (aberto ou fechado) e barrado pelo
  // banco — perder esse historico apagaria justamente o dado que a feature
  // existe pra guardar. `ativo=false` (PUT) e o caminho pra aposentar um
  // carro sem apagar o historico.
  try {
    const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`delete from veiculos where id = ${id} returning id`)
    return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

/**
 * Abre um uso: registra que `funcionario_id` pegou este veiculo agora. O
 * indice parcial `veiculo_usos_aberto_unico` e quem de fato impede dois usos
 * abertos do mesmo carro — aqui so validamos o formato do corpo e traduzimos
 * a violacao (23505) em 409 com mensagem clara.
 *
 * O mesmo funcionario pode ter dois carros em aberto ao mesmo tempo — decisao
 * do dono do negocio (deixa um na oficina, pega outro) — por isso NAO ha
 * nenhuma checagem de "este funcionario ja esta com um carro" aqui.
 */
veiculos.post('/:id/pegar', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const corpo = await c.req.json()
  const funcionarioId = (corpo as Record<string, unknown>).funcionario_id
  if (typeof funcionarioId !== 'string' || !idValido(funcionarioId)) {
    return c.json({ erro: 'funcionario_id invalido' }, 400)
  }
  const obsBruta = (corpo as Record<string, unknown>).obs
  const obs = typeof obsBruta === 'string' ? obsBruta : ''
  const tenantId = c.get('tenantId')
  try {
    const resultado = await withTenant(c.get('sql'), tenantId, async (tx) => {
      // Confirma que o veiculo existe neste tenant antes do insert: sem
      // isso, um id de veiculo inexistente (ou de outro tenant) cairia na
      // FK composta e viraria 23503 — "referencia invalida" e uma mensagem
      // pior que "veiculo nao encontrado" pra esse caso, e o id ja veio pela
      // URL (nao pelo corpo), entao merece o mesmo tratamento de GET/PUT/DELETE.
      const [veiculo] = await tx`select id from veiculos where id = ${id}`
      if (!veiculo) return null
      const [uso] = await tx`insert into veiculo_usos ${
        tx({ tenant_id: tenantId, veiculo_id: id, funcionario_id: funcionarioId, obs })
      } returning *`
      return uso
    })
    if (!resultado) return c.json({ erro: 'veiculo nao encontrado' }, 404)
    return c.json(paraJsonUso(resultado), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

/**
 * Fecha o uso em aberto deste veiculo (`volta_em = now()`). Nao verifica
 * quem esta devolvendo contra quem pegou — ver comentario do bloco de
 * permissoes acima: e o MESMO endpoint que cobre tanto "o colaborador
 * devolveu o carro que ele mesmo pegou" quanto "o admin encerrou um uso que
 * outra pessoa esqueceu aberto" (a lista destaca esses casos, ha mais de
 * 12h, mas nao fecha sozinha — ver web/src/screens/VeiculosLista.tsx).
 */
veiculos.post('/:id/devolver', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [uso] = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    update veiculo_usos set volta_em = now()
    where veiculo_id = ${id} and volta_em is null
    returning *`)
  return uso ? c.json(paraJsonUso(uso)) : c.json({ erro: 'nao ha uso em aberto para este veiculo' }, 404)
})
