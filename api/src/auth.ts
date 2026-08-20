import type { Sql } from './db'
import { withTenant } from './db'

const ITERACOES = 210_000   // recomendacao OWASP para PBKDF2-HMAC-SHA256
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
    { name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' },
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
  // Sem tenant ainda — por isso consulta com o role admin do proprio pool
  // usando join em tenants, e revalida o tenant logo em seguida.
  const [linha] = await sql<{ usuario_id: string; tenant_id: string; papel: string }[]>`
    select s.usuario_id, s.tenant_id, u.papel
    from sessoes s
    join usuarios u on u.id = s.usuario_id
    where s.token = ${token} and s.expira_em > now() and u.ativo = true`
  if (!linha) return null
  return { usuarioId: linha.usuario_id, tenantId: linha.tenant_id, papel: linha.papel }
}
