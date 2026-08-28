import type postgres from 'postgres'
import type { Vars } from './middleware/sessao'

/**
 * O motor do historico de alteracoes dos cadastros (cliente, produto,
 * fornecedor). O raciocinio de modelagem inteiro esta em
 * db/migrations/017_historico_cadastros.sql — aqui fica so o que o codigo
 * precisa fazer, com os comentarios que nao cabem la.
 *
 * As tres rotas de cadastro chamam este modulo; ele nao chama nenhuma delas.
 * E de proposito que o historico seja uma dependencia das rotas e nao o
 * contrario: nao existe caminho de escrita no historico que nao passe por uma
 * alteracao de cadastro real.
 */

export type EntidadeHistorico = 'cliente' | 'produto' | 'fornecedor'

/** Espelha o CHECK `historico_entidade_check` (017). Lista fechada nos dois
 * lados: a rota de leitura recusa qualquer outra antes de ir ao banco. */
export const ENTIDADES_HISTORICO = ['cliente', 'produto', 'fornecedor'] as const

export type AcaoHistorico = 'criou' | 'editou' | 'excluiu'

/** Um campo que mudou, com de/para. Nunca o registro inteiro — ver 017. */
export interface Alteracao {
  campo: string
  de: string
  para: string
}

/**
 * Quem assinou a alteracao, ja resolvido: o que vai gravado nas quatro
 * colunas de autoria. `origem` e a coluna que impede a tela de chamar
 * declaracao de prova (ver 017).
 */
export interface AutorHistorico {
  origem: 'declarado' | 'login'
  nome: string
  funcionarioId: string | null
  motivo: string
}

/**
 * Valor de um campo virado texto, para comparar e para gravar em de/para.
 *
 * TUDO VIRA STRING, inclusive numero. Nao e preguica: os dois lados da
 * comparacao vem da MESMA fonte (uma linha do Postgres antes e outra depois
 * do update), entao `numeric` chega como a mesma string normalizada dos dois
 * lados — '5000.00' antes e '5000.00' depois. Comparar `Number()` dos dois
 * daria o mesmo resultado nesses casos e resultado ERRADO em outros: um
 * `limite` que vai de '5000.00' para '5000.000' seria "mudou" pelo texto e
 * "igual" pelo numero, e e o texto que o dono vai ler no log.
 *
 * `null`/`undefined` viram '' (string vazia), nao 'null' nem '0': campo em
 * branco e campo em branco. Quem transforma '' em travessao na tela e a
 * camada de exibicao (web/src/derive/historico.ts) — travessao nunca vira
 * zero, e zero nunca vira travessao.
 */
export function textoDoValor(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/**
 * Os campos que REALMENTE mudaram entre duas versoes da mesma linha.
 *
 * `campos` e a lista de colunas de negocio da entidade (o mesmo `CAMPOS` que
 * a rota ja usa para sanear o corpo) — `criado_em`, `alterado_em` e
 * `tenant_id` ficam de fora porque nao sao alteracao, sao contabilidade da
 * linha. Sem esse recorte, TODO PUT geraria pelo menos uma "alteracao"
 * (`alterado_em` sempre muda) e a regra "PUT que nao muda nada nao gera
 * registro" nunca poderia valer.
 *
 * Pura e testada a parte: e a funcao que decide o conteudo do log, e um erro
 * aqui e um log que mente em silencio.
 */
export function diferencas(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  campos: readonly string[],
): Alteracao[] {
  const saida: Alteracao[] = []
  for (const campo of campos) {
    const de = textoDoValor(antes[campo])
    const para = textoDoValor(depois[campo])
    if (de !== para) saida.push({ campo, de, para })
  }
  return saida
}

// ------------------------------------------------------- a declaracao

/**
 * A EXIGENCIA VALE NO SERVIDOR, E ESTA E A METADE PURA DELA.
 *
 * Quem decide se autor e motivo sao obrigatorios e o PAPEL DA SESSAO, que so
 * o servidor conhece (`c.get('papel')`, resolvido do cookie em
 * middleware/sessao.ts). NADA que o cliente mande sobre isso e consultado:
 * nao ha campo "sou admin" no corpo, e se houvesse seria ignorado por
 * `sanear` como qualquer outro extra.
 *
 * Esconder os dois campos no formulario sem exigi-los aqui seria teatro:
 * bastaria chamar `PUT /api/clientes/:id` direto — com curl, com o console do
 * navegador, com qualquer coisa — para editar sem deixar rastro. O
 * formulario faz a mesma checagem porque erro na hora e melhor que erro
 * depois, nao porque ele proteja alguma coisa.
 *
 * ADMIN NAO DECLARA NADA, e a rota nem olha o que ele mandou: o login dele e
 * individual, o sistema ja sabe quem e. Se um admin enviasse
 * `declarado_por`, aceitar seria pior que inutil — deixaria o dono atribuir
 * uma alteracao dele a um funcionario qualquer, que e exatamente o tipo de
 * registro que este historico existe para nao produzir.
 *
 * Devolve a mensagem de erro (400) ou null.
 */
export function erroDeDeclaracao(
  papel: Vars['papel'],
  corpo: Record<string, unknown>,
): string | null {
  if (papel === 'admin') return null
  const declaradoPor = corpo.declarado_por
  if (typeof declaradoPor !== 'string' || !declaradoPor.trim()) {
    return 'informe quem esta fazendo esta alteracao'
  }
  const motivo = corpo.motivo
  if (typeof motivo !== 'string' || !motivo.trim()) {
    return 'informe o motivo da alteracao'
  }
  return null
}

/**
 * SO PARA A CRIACAO DE PRODUTO (routes/produtos.ts, POST): decide se ha
 * autoria para resolver nesta escrita, agora que declarar deixou de ser
 * OBRIGATORIO ali — pedido do dono (28/08/2026): "na hora de cadastrar um
 * produto exclusivamente nao precisa dessa questao de falar quem foi o
 * usuario que criou — exclusivamente para criacao do produto". PUT continua
 * chamando `erroDeDeclaracao` do jeito de sempre, e clientes/fornecedores
 * nao chamam esta funcao em rota nenhuma — o relaxamento e so deste caso.
 *
 * O PORQUE DE FUNDO, E NAO SO O PEDIDO: nao existe "alteracao" a atribuir
 * quando o registro esta nascendo. Nao ha valor anterior, nao ha de/para,
 * nao ha o que auditar alem do fato de ter sido criado — a mesma logica que
 * ja faz `vaiGravar` recusar registrar um PUT que nao mudou nada, aplicada
 * do outro lado: aqui nao e "nada mudou", e "nao ha ninguem para apontar".
 *
 * ADMIN: sempre `true`. O login e individual, o autor ('login') sempre
 * existe, e a criacao continua indo para o historico exatamente como antes
 * desta mudanca — nada no comportamento do admin foi alterado.
 *
 * COLABORADOR: `true` so quando ele MANDOU um `declarado_por` nao-vazio
 * (mesma checagem que `erroDeDeclaracao` faz quando a declaracao e
 * obrigatoria) — quem QUER se declarar ao criar continua podendo, e a
 * declaracao continua validada por `autorDaAlteracao` (funcionario desta
 * empresa, lista fechada, nunca texto livre). Sem `declarado_por`, `false`:
 * a rota grava o produto e NAO chama `autorDaAlteracao` nem
 * `registrarHistorico` — nao ha valor HONESTO para gravar em
 * `autor_origem`/`autor_nome` quando ninguem declarou e a sessao nao e
 * individual (migration 017: as duas colunas sao `not null`, e
 * `autor_origem` so aceita 'declarado' ou 'login' por CHECK — usar
 * qualquer um dos dois aqui seria mentir sobre o que o sistema sabe, o
 * problema exato que aquela coluna existe para evitar). A data de criacao
 * nao se perde: `produtos.criado_em` ja a registra, no proprio cadastro,
 * independente do historico.
 */
export function tentouDeclarar(papel: Vars['papel'], corpo: Record<string, unknown>): boolean {
  if (papel === 'admin') return true
  const declaradoPor = corpo.declarado_por
  return typeof declaradoPor === 'string' && declaradoPor.trim() !== ''
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A metade que precisa do banco: transforma a declaracao (ou o login do
 * admin) no autor que vai gravado.
 *
 * Roda DENTRO da transacao da propria alteracao — o historico e a mudanca que
 * ele descreve sao atomicos. Uma alteracao gravada sem historico, ou um
 * historico apontando para uma alteracao que falhou, seriam os dois piores
 * resultados possiveis para um log de auditoria.
 *
 * COLABORADOR: o `declarado_por` tem que ser um funcionario DESTA empresa. A
 * consulta roda dentro do withTenant do chamador, entao "achar" ja prova que
 * pertence ao tenant da sessao — mesmo argumento de
 * `funcionarioPertenceAoTenant` em routes/descontos.ts. E aqui a checagem faz
 * um trabalho a mais que la: ela e o que garante que o autor venha de uma
 * LISTA FECHADA. Aceitar texto livre produziria "joão", "Joao" e "jão" na
 * mesma semana, com o rastro de uma pessoa fragmentado em tres nomes que
 * nenhuma consulta junta depois.
 *
 * Nao se exige `ativo = true`: o seletor da tela so oferece ativos (ver
 * GET /api/funcionarios/opcoes), mas desativar alguem depois nao pode
 * invalidar uma declaracao que ja foi feita, e recusar aqui so criaria uma
 * corrida entre o dono desativando e o colaborador salvando.
 *
 * ADMIN: o nome vem de `usuarios`, a conta autenticada. E uma consulta a mais
 * por escrita de admin, e o preco e conhecido — a alternativa seria carregar
 * o nome em toda sessao (mexendo em `resolver_sessao`, migrations 003/006/012
 * e no middleware) para servi-lo nas tres rotas que precisam dele. O nome
 * gravado e um snapshot: renomear a conta depois nao reescreve o log.
 */
export async function autorDaAlteracao(
  tx: postgres.TransactionSql,
  papel: Vars['papel'],
  usuarioId: string,
  corpo: Record<string, unknown>,
): Promise<AutorHistorico | { erro: string }> {
  if (papel === 'admin') {
    const [usuario] = await tx<{ nome: string }[]>`
      select nome from usuarios where id = ${usuarioId}`
    return {
      origem: 'login',
      // Fallback nomeado: `autor_nome` tem CHECK de nao-vazio (017) e uma
      // conta sem nome (ou uma linha que a RLS nao devolveu) nao pode
      // derrubar a gravacao do cadastro. 'Administrador' e menos informativo
      // e mais honesto do que gravar '' ou perder o registro inteiro.
      nome: usuario?.nome?.trim() || 'Administrador',
      // Nulo de proposito: admin e conta de `usuarios`, nao linha de
      // `funcionarios` — nao ha ponteiro valido a gravar.
      funcionarioId: null,
      // Admin nao declara motivo. '' e o valor honesto: nao e "motivo
      // vazio esquecido", e "esta origem nao pede motivo".
      motivo: '',
    }
  }

  const declaradoPor = String(corpo.declarado_por ?? '')
  if (!UUID_RE.test(declaradoPor)) {
    // Sem isto o id malformado chega ao `where id = $1` e o Postgres lanca
    // "invalid input syntax for type uuid" — 500 em vez do 400 previsivel.
    return { erro: 'quem esta alterando deve ser um funcionario cadastrado' }
  }
  const [funcionario] = await tx<{ nome: string }[]>`
    select nome from funcionarios where id = ${declaradoPor}`
  if (!funcionario) {
    return { erro: 'quem esta alterando deve ser um funcionario cadastrado' }
  }
  return {
    origem: 'declarado',
    nome: funcionario.nome,
    funcionarioId: declaradoPor,
    motivo: String(corpo.motivo ?? '').trim(),
  }
}

// ------------------------------------------------------------ a escrita

/**
 * Grava uma linha de historico. INSERT e so — nao existe update nem delete
 * desta tabela em lugar nenhum do codigo, e e isso (mais a ausencia de rota,
 * provada em teste) que a torna imutavel. Ver 017.
 *
 * `alteracoes` vai por `tx.json(...)`, e NAO por `JSON.stringify(...)::jsonb`.
 * A diferenca foi medida contra o banco, nao presumida: o postgres.js le o
 * sufixo `::jsonb` do proprio SQL e aplica o serializador daquele tipo ao
 * parametro — entao uma string ja serializada e serializada DE NOVO e grava
 * um jsonb ESCALAR (a string "[{...}]") em vez do array. A leitura depois
 * devolvia texto onde a tela espera lista, e nada no caminho reclamava.
 *
 * `registroNome` e um SNAPSHOT do nome no momento do evento, nao um join —
 * e o que sobrevive a exclusao do cadastro.
 */
export async function registrarHistorico(
  tx: postgres.TransactionSql,
  args: {
    tenantId: string
    entidade: EntidadeHistorico
    registroId: string
    registroNome: string
    acao: AcaoHistorico
    autor: AutorHistorico
    alteracoes: Alteracao[]
  },
): Promise<void> {
  await tx`
    insert into historico_cadastros
      (tenant_id, entidade, registro_id, registro_nome, acao,
       autor_origem, autor_nome, autor_funcionario_id, motivo, alteracoes)
    values
      (${args.tenantId}, ${args.entidade}, ${args.registroId}, ${args.registroNome}, ${args.acao},
       ${args.autor.origem}, ${args.autor.nome}, ${args.autor.funcionarioId},
       ${args.autor.motivo}, ${tx.json(args.alteracoes as unknown as postgres.JSONValue)})`
}

/**
 * O caso "PUT que reenvia os mesmos valores": nenhum campo mudou, entao NAO
 * se grava historico.
 *
 * Um log que registra "fulano editou" quando nada foi editado nao e um log
 * mais completo, e um log mais barulhento — e um historico barulhento e um
 * historico que ninguem le. Salvar o formulario sem mexer em nada e algo que
 * acontece o tempo todo (abriu para conferir, clicou em Salvar por reflexo).
 *
 * A EXIGENCIA DE DECLARAR CONTINUA VALENDO nesse caso, e a assimetria e
 * deliberada: o colaborador ainda leva 400 sem autor e motivo num PUT que
 * nao muda nada. O servidor so descobre que nada mudou DEPOIS de comparar as
 * duas versoes; recusar antes e a regra simples de enunciar e a unica que
 * nao depende do resultado da comparacao.
 */
export function vaiGravar(acao: AcaoHistorico, alteracoes: Alteracao[]): boolean {
  return acao !== 'editou' || alteracoes.length > 0
}
