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

const DIAS_SESSAO = 7

export async function criarSessao(sql: Sql, usuarioId: string, tenantId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const expira = new Date(Date.now() + DIAS_SESSAO * 86400_000)
  await withTenant(sql, tenantId, tx => tx`
    insert into sessoes (token, usuario_id, tenant_id, expira_em)
    values (${token}, ${usuarioId}, ${tenantId}, ${expira})`)
  return token
}

export async function lerSessao(sql: Sql, token: string) {
  // Sem tenant ainda — por isso passa pela funcao SECURITY DEFINER
  // resolver_sessao() (migration 003), que recebe so o token e devolve
  // no maximo uma linha, em vez de abrir a policy de sessoes.
  const [linha] = await sql<{ usuario_id: string; tenant_id: string; papel: string }[]>`
    select * from resolver_sessao(${token})`
  if (!linha) return null
  return { usuarioId: linha.usuario_id, tenantId: linha.tenant_id, papel: linha.papel }
}
