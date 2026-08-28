import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

// Molde: api/src/routes/clientes.ts. Mesma estrutura, mesmos motivos —
// comentarios aqui so cobrem o que e especifico de funcionarios.

const CAMPOS = ['nome', 'cargo', 'tel', 'salario', 'dia_pag', 'ativo'] as const

type Funcionario = {
  nome: string
  cargo: string
  tel: string
  salario: number
  dia_pag: number
  ativo: boolean
}

/** Mantem so os campos conhecidos — ignora qualquer extra vindo do cliente
 * (em especial `tenant_id` e `id`, que nunca devem vir do corpo). */
function sanear(corpo: Record<string, unknown>): Partial<Funcionario> {
  const saida: Record<string, unknown> = {}
  for (const campo of CAMPOS) if (campo in corpo) saida[campo] = corpo[campo]
  return saida as Partial<Funcionario>
}

/**
 * `salario` e numeric(12,2) — vem como string do postgres.js, convertida
 * na borda da API igual a `limite`/`prazo` em clientes.ts. `dia_pag` e
 * `integer` (o driver ja devolve number), mas passa pelo mesmo `Number()`
 * por simetria com o resto do molde. `tenant_id` sai do corpo pelo mesmo
 * motivo de clientes.ts: identificador interno que nao precisa vazar pro
 * JSON.
 */
function paraJson<T extends Record<string, unknown>>(linha: T) {
  const { tenant_id: _tenantId, ...resto } = linha
  return { ...resto, salario: Number(linha.salario ?? 0), dia_pag: Number(linha.dia_pag ?? 0) }
}

function numeroNegativo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n < 0
}

function numeroNaoInteiro(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && !Number.isInteger(n)
}

/** true so quando o valor existe, e um inteiro finito e cai fora de 1..28. */
function diaPagForaDoIntervalo(v: unknown): boolean {
  if (v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && Number.isInteger(n) && (n < 1 || n > 28)
}

/**
 * `salario` negativo e `dia_pag` fora de 1..28 (ou fracionario) sao dado
 * corrompido — `dia_pag` alimenta o calculo de "proxima data de pagamento
 * / atrasado" (comentario da migration 009), entao um valor fora do mes
 * ou fracionario quebra essa conta antes mesmo de chegar no banco. As
 * constraints `funcionarios_salario_check` e `funcionarios_dia_pag_check`
 * sao a ultima linha de defesa (ver respostaDeErroPg), esta checagem e a
 * primeira, e a que devolve mensagem especifica por campo.
 */
function erroDeCampoInvalido(dados: Partial<Funcionario>): string | null {
  if (numeroNegativo(dados.salario)) return 'salario nao pode ser negativo'
  if (numeroNaoInteiro(dados.dia_pag)) return 'dia_pag deve ser um numero inteiro'
  if (diaPagForaDoIntervalo(dados.dia_pag)) return 'dia_pag deve estar entre 1 e 28'
  return null
}

/** nome vazio ou so espaco e o mesmo problema que nome ausente — mesma
 * regra de clientes.ts (nome e o unico campo de texto obrigatorio aqui;
 * `cargo`/`tel` tem default '' no banco e nao sao obrigatorios). */
function nomeEmBranco(nome: unknown): boolean {
  return typeof nome !== 'string' || nome.trim() === ''
}

/**
 * `funcionarios` nao tem constraint unique (ao contrario de `clientes`,
 * que tem `unique (tenant_id, lower(nome))`) — dois funcionarios podem ter
 * o mesmo nome no mesmo tenant (dois "Joao" na equipe e um cenario real).
 * O mapeamento de 23505 fica aqui por simetria com o molde e para o caso
 * de uma constraint unique ser adicionada no futuro; hoje nao ha como
 * este branch ser alcancado por HTTP (coberto so por teste direto da
 * funcao).
 */
const MENSAGENS_CHECK: Record<string, string> = {
  funcionarios_salario_check: 'salario nao pode ser negativo',
  funcionarios_dia_pag_check: 'dia_pag deve estar entre 1 e 28',
}

export function respostaDeErroPg(err: unknown): { corpo: { erro: string }; status: 409 | 400 } | null {
  const e = err as { code?: string; constraint_name?: string }
  if (e.code === '23505') return { corpo: { erro: 'ja existe um funcionario com esse nome' }, status: 409 }
  if (e.code === '23514') {
    const mensagem = (e.constraint_name && MENSAGENS_CHECK[e.constraint_name])
      ?? 'dado invalido para um dos campos'
    return { corpo: { erro: mensagem }, status: 400 }
  }
  // 23503 = violacao de chave estrangeira. Mesma rede que produtos.ts tem: se
  // alguma FK barrar a exclusao de um funcionario, o dono precisa LER o motivo
  // e o caminho, nao levar 500 "erro interno".
  //
  // Isto faltava, e custou caro. `veiculo_usos_funcionario_fk` era
  // `on delete restrict` (011) sobre uma tabela cuja tela foi removida
  // (7b841b1): duas linhas esquecidas ali travaram a exclusao do funcionario
  // em producao, permanentemente, e a unica pista que o dono recebia era a
  // mensagem generica do front. Aquele bloqueio especifico acabou — a 015
  // passou as duas FKs de `veiculo_usos` para `cascade` — mas o tratamento
  // fica, e de proposito NAO fala de `veiculo_usos`: ele existe para a
  // proxima FK, a que ainda nao foi escrita.
  //
  // Por isso a mensagem e generica quanto a CAUSA e especifica quanto a
  // SAIDA. A rota nao tem como traduzir o nome de uma constraint que ainda
  // nao existe, mas a saida e sempre a mesma e e a que o dono precisa
  // conhecer: desativar (`ativo = false`) aposenta o funcionario, tira dos
  // seletores e preserva tudo que ja foi registrado. Excluir e outra coisa.
  //
  // O texto vai ACENTUADO, ao contrario do resto das mensagens desta API.
  // Nao e descuido: esta e exibida VERBATIM na tela (ModalFuncionario.tsx
  // mostra o corpo do 409 em vez de um texto fixo, justamente para servir a
  // FKs que o front nao conhece). Mensagem lida pelo usuario se escreve como
  // se le. As outras sao traduzidas no front por status e podem seguir em
  // ASCII.
  if (e.code === '23503') {
    return {
      corpo: {
        erro: 'Este funcionário está vinculado a outros registros e não pode ser excluído. '
          + 'Desative-o (deixe de marcar "Ativo") para tirá-lo da equipe sem perder o histórico.',
      },
      status: 409,
    }
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sem isto, um id malformado chega intacto ao `where id = $1` e o Postgres
 * lanca "invalid input syntax for type uuid" sem tratamento. */
function idValido(id: string): boolean {
  return UUID_RE.test(id)
}

export const funcionarios = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Tela de admin no design (cadastro de equipe/folha, com salario) —
// colaborador nao enxerga. `exigirAdmin` volta a ser declarado ROTA A ROTA
// (e nao em '*') porque '/opcoes' abaixo e a excecao, de novo.
funcionarios.use('*', exigirSessao)

/**
 * GET /opcoes — id e nome dos funcionarios ativos. Nada mais.
 *
 * ESTA ROTA JA EXISTIU E FOI REMOVIDA (7b841b1), com um motivo bom: ela
 * servia ao seletor "Quem esta pegando o carro?", aquela tela acabou, e o
 * que sobrava era superficie de leitura aberta sobre a tabela mais sensivel
 * do sistema, mantida "por precaucao". A precaucao acabou; o consumidor
 * voltou, e agora tem nome e endereco: o campo "Quem esta fazendo esta
 * alteracao?" do historico de cadastros (web/src/components/
 * DeclaracaoDeAutoria.tsx). Sem ele o colaborador nao consegue declarar, e
 * sem declarar ele nao consegue salvar — o POST/PUT das tres rotas de
 * cadastro responde 400.
 *
 * O QUE ELA DEVOLVE, E POR QUE EXATAMENTE ISSO:
 *
 *   id    — porque a escolha precisa vir de uma LISTA FECHADA. Texto livre
 *           produz "joão", "Joao" e "jão" na mesma semana e fragmenta em
 *           tres o rastro de uma pessoa. O id e o que torna o log
 *           agrupavel.
 *   nome  — porque e o que a pessoa reconhece na lista, e e o que o dono le
 *           no historico depois.
 *
 * O QUE ELA NAO DEVOLVE, E POR QUE: `salario`, `tel`, `dia_pag`, `cargo`,
 * `ativo`, `criado_em`. Nomes de colegas nao sao segredo entre quem trabalha
 * junto — o colaborador ja convive com essas pessoas o dia inteiro, e a
 * lista nao lhe conta nada que ele nao saiba. SALARIO E OUTRA COISA: um
 * colaborador ver quanto os colegas ganham e vazamento real, nao detalhe de
 * apresentacao, e e o motivo de `GET /` continuar admin-only logo abaixo.
 * Telefone e dia de pagamento entram na mesma classe por precaucao barata:
 * o seletor nao precisa deles, entao nao ha por que trafega-los.
 *
 * A escolha e um `select` explicito de duas colunas, nao um `select *`
 * filtrado depois no TypeScript. A diferenca importa: com `select *`, uma
 * coluna sensivel acrescentada a `funcionarios` no futuro entraria nesta
 * resposta automaticamente e em silencio.
 *
 * `ativo = true`: o seletor oferece quem trabalha aqui hoje. Quem saiu da
 * empresa nao esta fazendo alteracao nenhuma. (A checagem do lado da escrita
 * NAO exige `ativo` — ver `autorDaAlteracao` em src/historico.ts: desativar
 * alguem depois nao pode invalidar uma declaracao ja feita.)
 *
 * ACESSIVEL A QUALQUER SESSAO — e ai esta a diferenca honesta em relacao ao
 * resto do arquivo. Registrada ANTES de GET /:id e sem `exigirAdmin`, porque
 * '/opcoes' e segmento estatico e '/:id' so deveria capturar id de fato.
 */
funcionarios.get('/opcoes', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select id, nome from funcionarios where ativo = true order by nome`)
  return c.json(linhas)
})

// A partir daqui, tudo e admin. Declarado por rota porque '/opcoes' acima e
// a excecao — um `use('*', exigirAdmin)` depois dela funcionaria por acidente
// (o handler de /opcoes responde sem chamar next), e "funciona por acidente"
// nao e como se escreve a linha que separa quem ve salario de quem nao ve.
funcionarios.get('/', exigirAdmin)
funcionarios.get('/:id', exigirAdmin)
funcionarios.post('/', exigirAdmin)
funcionarios.put('/:id', exigirAdmin)
funcionarios.delete('/:id', exigirAdmin)

funcionarios.get('/', async (c) => {
  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from funcionarios order by nome`)
  return c.json(linhas.map(paraJson))
})

funcionarios.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
    tx`select * from funcionarios where id = ${id}`)
  return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
})

funcionarios.post('/', async (c) => {
  const dados = sanear(await c.req.json())
  if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
  dados.nome = (dados.nome as string).trim()
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  const tenantId = c.get('tenantId')
  try {
    const [linha] = await withTenant(c.get('sql'), tenantId, tx =>
      tx`insert into funcionarios ${tx({ ...dados, tenant_id: tenantId })} returning *`)
    return c.json(paraJson(linha), 201)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

funcionarios.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  const dados = sanear(await c.req.json())
  if (Object.keys(dados).length === 0) return c.json({ erro: 'nada a alterar' }, 400)
  if ('nome' in dados) {
    if (nomeEmBranco(dados.nome)) return c.json({ erro: 'nome e obrigatorio' }, 400)
    dados.nome = (dados.nome as string).trim()
  }
  const erroCampo = erroDeCampoInvalido(dados)
  if (erroCampo) return c.json({ erro: erroCampo }, 400)
  try {
    const [linha] = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`update funcionarios set ${tx({ ...dados, alterado_em: new Date() })}
         where id = ${id} returning *`)
    return linha ? c.json(paraJson(linha)) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})

funcionarios.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!idValido(id)) return c.json({ erro: 'id invalido' }, 400)
  // O QUE ACONTECE COM O QUE APONTA PARA O FUNCIONARIO:
  //
  //  - LANCAMENTOS (salario, adiantamento): ficam. `lancamentos_funcionario_fk`
  //    e `on delete set null (funcionario_id)` (009/010, corrigida em 014) —
  //    a despesa aconteceu, o dinheiro saiu, o registro financeiro continua
  //    valido sem saber de quem era. Perde-se a atribuicao; o valor fica.
  //  - REGISTROS DE USO DE VEICULO: saem junto. `veiculo_usos_funcionario_fk`
  //    e `on delete cascade` desde a 015. Era `restrict`, e como a tela que
  //    alimentava `veiculo_usos` foi removida (7b841b1), linhas esquecidas la
  //    barravam a exclusao para sempre, sem nenhum caminho pelo produto para
  //    limpa-las. Ver 015_veiculo_usos_cascade.sql.
  //  - DESCONTOS DE SALARIO (faltas): saem junto tambem.
  //    `descontos_funcionario_fk` e `on delete cascade` (016) — e a coluna e
  //    `not null`, entao nao havia como fazer `set null`. Um desconto sem
  //    funcionario nao e registro de coisa nenhuma: nenhum dinheiro se moveu
  //    por causa dele (por isso nao e um `lancamento`), ele so reduzia o "a
  //    pagar" de alguem que nao esta mais no cadastro. O salario que chegou a
  //    ser PAGO, esse sim, continua em `lancamentos`, com o valor liquido que
  //    saiu de fato. `restrict` aqui repetiria o bloqueio da 015: as unicas
  //    linhas capazes de barrar a exclusao so sao alcancaveis pela tela do
  //    proprio funcionario que se quer excluir.
  //
  // O try/catch NAO E SOBRA depois da 015. Ele nao estava aqui, e por isso o
  // bloqueio acima chegava ao dono como 500 "erro interno". Qualquer FK
  // futura que barre esta exclusao passa a virar 409 com mensagem legivel em
  // vez de 500 — ver respostaDeErroPg acima.
  try {
    const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx =>
      tx`delete from funcionarios where id = ${id} returning id`)
    return linhas.length ? c.json({ ok: true }) : c.json({ erro: 'nao encontrado' }, 404)
  } catch (err) {
    const mapeado = respostaDeErroPg(err)
    if (mapeado) return c.json(mapeado.corpo, mapeado.status)
    throw err
  }
})
