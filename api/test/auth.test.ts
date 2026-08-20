import { describe, it, expect } from 'vitest'
import { hashSenha, verificarSenha } from '../src/auth'

describe('hash de senha', () => {
  it('aceita a senha correta', async () => {
    const hash = await hashSenha('segredo123')
    expect(await verificarSenha('segredo123', hash)).toBe(true)
  })

  it('rejeita a senha errada', async () => {
    const hash = await hashSenha('segredo123')
    expect(await verificarSenha('segredo124', hash)).toBe(false)
  })

  it('gera hashes diferentes para a mesma senha (salt)', async () => {
    expect(await hashSenha('igual')).not.toBe(await hashSenha('igual'))
  })

  it('rejeita hash malformado sem lancar', async () => {
    expect(await verificarSenha('x', 'lixo')).toBe(false)
  })
})
