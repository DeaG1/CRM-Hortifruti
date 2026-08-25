import type { Sql } from './db'
import { withTenant } from './db'

/**
 * 100.000 e o TETO do runtime, nao uma escolha.
 *
 * O valor aqui era 210.000 (recomendacao OWASP para PBKDF2-HMAC-SHA256; a
 * revisao de 2023 pede 600.000). Mas a WebCrypto do Cloudflare Workers recusa
 * qualquer valor acima de 100.000:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000
 *   are not supported (requested 210000)
 *
 * O Node aceita 210.000 sem reclamar, entao a suite de testes passava inteira
 * e o erro so apareceu no primeiro login contra o Worker publicado. Vale como
 * aviso: testes rodando em Node nao provam comportamento em workerd.
 *
 * Consequencia de seguranca, dita sem maquiagem: 100.000 iteracoes e menos
 * resistente a ataque de forca bruta offline do que o recomendado. Se a tabela
 * `usuarios` vazar, quebrar as senhas custa ~2x menos esforco do que custaria
 * com 210.000, e ~6x menos do que a recomendacao atual do OWASP.
 *
 * Mitigacoes que valem mais que iteracoes extras neste contexto, e que estao
 * pendentes: limite de tentativas de login por IP e por conta, e exigencia de
 * senha forte no cadastro de usuario. Ambas entram na Fase 5 (governanca).
 *
 * Se um dia a seguranca da senha precisar ser maior que o teto do Workers, as
 * saidas sao mover a verificacao para fora do Worker ou trocar o esquema por
 * um com fator de trabalho em memoria. O formato do hash ja carrega o numero
 * de iteracoes, entao migrar nao invalida as senhas existentes.
 */
export const ITERACOES = 100_000
const TAM_SAL = 16
const TAM_CHAVE = 32

/**
 * PBKDF2 via WebCrypto. bcrypt e scrypt nao rodam em Cloudflare Workers;
 * WebCrypto e nativo tanto em Workers quanto em Node 18+.
 * Formato: pbkdf2$<iteracoes>$<sal_b64>$<chave_b64>
 */
export async function hashSenha(senha: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(TAM_SAL))
  const chave = await derivar(senha, sal, ITERACOES)
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(chave)}`
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  if (typeof hash !== 'string') return false
  const partes = hash.split('$')
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false
  const iteracoes = Number(partes[1])
  if (!Number.isInteger(iteracoes) || iteracoes < 1) return false
  let sal: Uint8Array, esperado: Uint8Array
  try { sal = deB64(partes[2]); esperado = deB64(partes[3]) } catch { return false }
  const obtido = await derivar(senha, sal, iteracoes)
  return comparaConstante(obtido, esperado)
}

async function derivar(senha: string, sal: Uint8Array, iteracoes: number) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    // `as BufferSource`: puramente de tipos — TS 7 endureceu Uint8Array
    // generico (Uint8Array<ArrayBufferLike> x ArrayBufferView<ArrayBuffer>)
    // de um jeito que nao bate com o BufferSource de @cloudflare/workers-types
    // sem essa anotacao; em runtime um Uint8Array sempre foi um BufferSource
    // valido, isto nao muda nada em execucao.
    { name: 'PBKDF2', salt: sal as BufferSource, iterations: iteracoes, hash: 'SHA-256' },
    material, TAM_CHAVE * 8,
  )
  return new Uint8Array(bits)
}

/** Comparacao em tempo constante — nao vaza informacao por timing. */
function comparaConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i]
  return dif === 0
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const deB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/**
 * JANELA DE INATIVIDADE — 30 minutos, deslizante.
 *
 * A constante anterior se chamava DIAS_SESSAO e valia 7. Nao foi so o numero
 * que mudou: mudou a UNIDADE e mudou o significado. `DIAS_SESSAO = 7` era um
 * prazo FIXO contado do login ("esta sessao morre daqui a uma semana, faca o
 * usuario o que fizer"). Isto aqui e uma janela de INATIVIDADE que anda para
 * frente a cada requisicao autenticada: enquanto houver uso, a sessao nao
 * vence; parou de haver uso, ela vence em 30 minutos.
 *
 * O nome carrega a unidade de proposito. Uma constante chamada DIAS_SESSAO
 * valendo 30 minutos e como se reintroduz bug de unidade — e este projeto
 * acabou de sair de uma familia inteira deles (perda em KG x perda em itens,
 * ver 7a16a20 e e2ce7d5). Quem ler `MINUTOS_DE_INATIVIDADE * 60_000` sabe na
 * hora se a conta esta certa; quem lia `DIAS_SESSAO * 86400_000` tinha que
 * confiar no nome.
 *
 * POR QUE 30 MINUTOS: admin e funcionarios usam o MESMO computador. O risco
 * concreto nao e um atacante remoto, e o funcionario que senta na maquina
 * que o dono deixou aberta e ve Financeiro, salarios e margem.
 */
export const MINUTOS_DE_INATIVIDADE = 30

/**
 * LIMIAR DE RENOVACAO — renova a sessao so quando restarem menos de 25 dos
 * 30 minutos, ou seja, no maximo UMA escrita a cada 5 minutos por sessao.
 *
 * Sem limiar, "janela deslizante" viraria um UPDATE por requisicao. Uma tela
 * do CRM dispara varias chamadas ao abrir (a lista, o badge de saldo, o
 * detalhe), e cada clique repete isso: o custo seria dezenas de escritas por
 * minuto por usuario, todas gravando praticamente o mesmo `expira_em`.
 *
 * Isso pesa mais aqui do que pesaria num servidor comum. Este projeto roda em
 * Cloudflare Workers, onde cada ida ao banco e uma subrequisicao contada
 * contra um teto por invocacao — o mesmo teto que ja matou o acesso direto ao
 * Supabase e obrigou a usar Hyperdrive (ver criarPoolDoEnv em db.ts). Escrita
 * por requisicao seria gastar orcamento de subrequisicao para reescrever um
 * timestamp que ninguem leu.
 *
 * O PRECO DA ECONOMIA, dito sem maquiagem: entre duas renovacoes a sessao
 * "envelhece" sem que o uso conte. No pior caso a sessao morre ~25 minutos
 * depois da ultima interacao real, nao 30 — a ultima atividade pode cair logo
 * depois de uma renovacao que nao aconteceu porque ainda faltava muito. Para
 * o objetivo (a maquina compartilhada nao ficar aberta no almoco) 25 ou 30 da
 * no mesmo; para o funcionario digitando um pedido longo, quem segura a
 * sessao viva e o sinal de presenca do front (web/src/presenca.ts), nao a
 * folga deste limiar.
 */
export const MINUTOS_RESTANTES_PARA_RENOVAR = 25

/**
 * Vale a pena renovar agora? Funcao pura, exportada, testada sem banco —
 * a regra do limiar e a unica parte desta politica que da para provar em
 * Node, e ela e justamente a que decide se havera escrita.
 */
export function precisaRenovar(segundosRestantes: number): boolean {
  return segundosRestantes < MINUTOS_RESTANTES_PARA_RENOVAR * 60
}

export async function criarSessao(sql: Sql, usuarioId: string, tenantId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  // `now()` do BANCO, nao `Date.now()` do Worker. Quem decide se a sessao
  // venceu e o `expira_em > now()` dentro de resolver_sessao, e quem a renova
  // e renovar_sessao — os dois no relogio do Postgres. Misturar os relogios
  // (gravar com um, comparar com o outro) faria a janela de 30 minutos valer
  // 30 minutos mais ou menos a diferenca entre as duas maquinas.
  await withTenant(sql, tenantId, tx => tx`
    insert into sessoes (token, usuario_id, tenant_id, expira_em)
    values (${token}, ${usuarioId}, ${tenantId},
            now() + make_interval(mins => ${MINUTOS_DE_INATIVIDADE}::int))`)
  return token
}

export async function lerSessao(sql: Sql, token: string) {
  // Sem tenant ainda — por isso passa pela funcao SECURITY DEFINER
  // resolver_sessao() (migration 003, corrigida na 006 e ampliada na 012),
  // que recebe so o token e devolve no maximo uma linha, em vez de abrir a
  // policy de sessoes.
  //
  // `segundos_restantes` vem junto na MESMA linha de proposito: e o que o
  // middleware usa para decidir se renova, e pedir isso numa segunda consulta
  // custaria uma ida ao banco por requisicao — exatamente o que o limiar
  // existe para evitar.
  const [linha] = await sql<{
    usuario_id: string; tenant_id: string; papel: string; segundos_restantes: number
  }[]>`
    select * from resolver_sessao(${token})`
  if (!linha) return null
  return {
    usuarioId: linha.usuario_id,
    tenantId: linha.tenant_id,
    papel: linha.papel,
    // A funcao devolve double precision (float8) justamente para chegar aqui
    // como number. Se fosse `numeric`, o postgres.js entregaria uma STRING e
    // `'1500' < 1500` compararia lexicograficamente — o tipo de comparacao
    // que passa despercebida ate a sessao renovar na hora errada.
    segundosRestantes: linha.segundos_restantes,
  }
}

/**
 * Empurra o vencimento da sessao para agora + a janela inteira.
 *
 * Chama uma funcao SECURITY DEFINER (migration 012) em vez de fazer o UPDATE
 * por withTenant. Dois motivos, nesta ordem:
 *
 *   1. CUSTO. withTenant abre transacao: BEGIN, set_config, UPDATE, COMMIT —
 *      quatro idas ao banco (~116ms cada em producao, ver a nota no fim de
 *      db.ts) e quatro subrequisicoes do Worker. A funcao e uma so.
 *   2. RLS. `sessoes` tem FORCE ROW LEVEL SECURITY. Um UPDATE que esqueca o
 *      withTenant nao explode: ele afeta zero linhas EM SILENCIO, a rota
 *      responde 200 e a sessao expira no meio do expediente sem nada nos
 *      logs. Este projeto ja teve esse tipo de bloqueio silencioso duas vezes
 *      (a busca de usuarios no login e a policy de tenants da migration 007,
 *      esta ultima confirmada em producao). SECURITY DEFINER tira a
 *      renovacao dessa classe de erro.
 *
 * `${MINUTOS_DE_INATIVIDADE}` viaja como parametro em vez de estar fixo no
 * SQL: a janela tem UM dono, a constante acima. Fixar 30 dentro da funcao
 * criaria um segundo lugar para mudar, e o segundo lugar e sempre o que
 * alguem esquece.
 */
export async function renovarSessao(sql: Sql, token: string) {
  await sql`select renovar_sessao(${token}, ${MINUTOS_DE_INATIVIDADE}::int)`
}
