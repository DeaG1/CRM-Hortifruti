import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/clientes.ts (sanear/paraJson/validacao/erros).
//
// ESTA ROTA ENCOLHEU. Ela tinha, alem do CRUD, tres endpoints do controle de
// uso: POST /:id/pegar, POST /:id/devolver e GET /:id/historico (quem esta
// com qual carro). O dono do negocio usou e concluiu que nao serve — o que
// ele quer registrar no carro e o CUSTO dele, nao a posse. Os tres sairam,
// junto com o agregado de uso aberto no GET /, o `paraJsonUso` e as
// mensagens de erro que so aquelas rotas alcancavam.
//
// A tabela `veiculo_usos` continua no banco, com as linhas que ja tinha, e
// nao e escrita nem lida por ninguem — ver db/migrations/013_lancamentos_veiculo.sql
// para o que ficou orfa e o que seria preciso para remove-la.
//
// O gasto de cada veiculo NAO e servido daqui: e derivado no front a partir
// de GET /api/lancamentos (`veiculo_id`, migration 013), do mesmo jeito que
// a folha de cada funcionario. Um agregado proprio aqui duplicaria a conta
// que ja existe em outro lugar e teria de repetir o recorte de periodo.

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
 * Mapeia SQLSTATEs conhecidos do Postgres para respostas {erro} previsiveis
 * em vez de deixar a excecao subir crua. Mesmo contrato de
 * clientes.ts/produtos.ts.
 *
 * 23505 tem uma origem so: `veiculos_placa_unica` (011). A tabela nao tem
 * outra constraint unique alcancavel — `veiculos_tenant_id_uk` e a chave
 * candidata que a FK composta exige e so seria violada por um `id` duplicado,
 * que a PK ja impede. (Este mapa tinha DUAS entradas ate a remocao do
 * controle de uso: `veiculo_usos_aberto_unico` era a outra. Com aquela rota
 * fora, a distincao por nome de constraint deixou de ter o que distinguir.)
 *
 * 23514 nao aparece aqui porque `veiculos` nao tem nenhuma CHECK — a unica
 * que este arquivo tratava era `veiculo_usos_volta_apos_saida`, de uma
 * tabela que este arquivo nao escreve mais.
 *
 * 23503 NAO TEM MAIS ORIGEM CONHECIDA, e o tratamento fica assim mesmo.
 *
 * Ele nasceu apontando para uma so: `veiculo_usos_veiculo_fk` era
 * `on delete restrict` (011), entao um carro com linha de uso do tempo do
 * check-in/check-out ficava barrado na exclusao. So que a tela que alimentava
 * `veiculo_usos` foi removida (7b841b1) e o dono nao tinha como limpar
 * aquelas linhas por lugar nenhum — o bloqueio virou permanente na pratica. A
 * 015 passou as duas FKs de `veiculo_usos` para `cascade`: os registros de uso
 * saem junto com o veiculo, e hoje NENHUMA FK barra a exclusao de um veiculo
 * (`lancamentos_veiculo_fk` e `set null` desde a 013, de proposito).
 *
 * O mapeamento continua porque ele nao e sobre `veiculo_usos` — e a rede da
 * rota para a proxima FK, a que ainda nao foi escrita. Sem ele, o dia em que
 * alguem adicionar uma tabela apontando para `veiculos` com `restrict`, a
 * exclusao volta a estourar 500 "erro interno" e o dono volta a nao saber o
 * que houve. Foi exatamente esse buraco que deixou funcionarios quebrado
 * (nem try/catch a rota de la tinha).
 *
 * Por isso a mensagem e generica quanto a CAUSA e especifica quanto a SAIDA:
 * a rota nao pode traduzir o nome de uma constraint que ainda nao existe, mas
 * a saida e sempre a mesma — `ativo = false` aposenta o carro, tira dos
 * seletores e preserva o que ja foi registrado.
 *
 * O texto vai ACENTUADO, ao contrario do resto das mensagens desta API. Nao e
 * descuido: esta e exibida VERBATIM na tela (ModalVeiculo.tsx mostra o corpo
 * do 409 em vez de um texto fixo, justamente para servir a FKs que o front
 * nao conhece). Mensagem lida pelo usuario se escreve como se le.
 */
export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um veiculo com essa placa' }, status: 409 }
  if (e.code === '23503') {
    return {
      corpo: {
        erro: 'Este veículo está vinculado a outros registros e não pode ser excluído. '
          + 'Desative-o (deixe de marcar "Ativo") para tirá-lo da frota sem perder o histórico.',
      },
      status: 409,
    }
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sem isto, um id malformado chega intacto ao `where id = $1` e o Postgres
 * lanca "invalid input syntax for type uuid". */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

export const veiculos = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

/**
 * ADMIN EM TUDO, inclusive na leitura — e isso MUDOU com esta entrega.
 *
 * Enquanto a tela era check-in/check-out, ler a lista e pegar/devolver eram
 * abertos ao colaborador: e ele quem pega o carro no dia a dia, e uma acao
 * que dependesse do admin estar por perto nao seria registrada por ninguem.
 * Essa acao deixou de existir. O que a tela de Veiculos mostra agora e
 * quanto cada carro custou no periodo — que sai de GET /api/lancamentos,
 * admin-only desde sempre (dado financeiro, mesma classe de Financeiro e da
 * folha em Funcionarios).
 *
 * Manter a leitura aberta deixaria o colaborador com uma tela que so lista
 * placas, sem nenhuma acao e sem o numero que e o motivo dela existir — e,
 * pior, uma tela que dispararia um 403 garantido no proprio carregamento. A
 * tela acompanha: 'veiculos' entrou em ADMIN_ONLY_SCREENS (web/src/telas.ts),
 * entao o item some do menu do colaborador em vez de abrir e falhar.
 *
 * `exigirAdmin` volta a ser aplicado em '*' (como clientes.ts e
 * lancamentos.ts) agora que nao ha rota excecao — era por causa de
 * '/:id/pegar' e '/:id/devolver' que ele precisava ser declarado rota a
 * rota.
 */
veiculos.use('*', exigirSessao, exigirAdmin)

veiculos.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from veiculos order by placa`)
  return c.json(linhas.map(paraJson))
})

veiculos.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from veiculos where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
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
  // O QUE ACONTECE COM O QUE APONTA PARA O VEICULO:
  //
  //  - LANCAMENTOS (gasolina, multa, manutencao): ficam. `lancamentos_veiculo_fk`
  //    e `on delete set null (veiculo_id)` (013) — a despesa aconteceu, o
  //    dinheiro saiu, e o registro financeiro continua valido sem saber de qual
  //    carro foi. O total de custos do periodo nao pode mudar porque alguem
  //    arrumou o cadastro da frota.
  //  - REGISTROS DE USO legados: saem junto. `veiculo_usos_veiculo_fk` e
  //    `on delete cascade` desde a 015. Era `restrict`, e como a tela que
  //    alimentava `veiculo_usos` foi removida (7b841b1), linhas esquecidas la
  //    barravam a exclusao para sempre. Ver 015_veiculo_usos_cascade.sql.
  //
  // O try/catch fica: com a 015 nenhuma FK barra mais esta exclusao, mas ele e
  // a rede para a proxima — ver respostaDeErroPg acima.
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
