import { describe, it, expect } from 'vitest'
import { criarPool } from '../src/db'

// criarPool nunca chega a abrir conexao nestes casos (host inexistente /
// nao usado) — o teste so inspeciona as opcoes resolvidas pelo postgres.js
// (sql.options), sem precisar de rede.

describe('criarPool — TLS', () => {
  it('nao forca TLS para o Postgres local do Docker (sem certificado)', () => {
    const sql = criarPool('postgres://app_crm:senha@localhost:5433/crm_dev')
    expect(sql.options.ssl).toBe(false)
    sql.end({ timeout: 0 })
  })

  it('nao forca TLS para 127.0.0.1', () => {
    const sql = criarPool('postgres://app_crm:senha@127.0.0.1:5433/crm_dev')
    expect(sql.options.ssl).toBe(false)
    sql.end({ timeout: 0 })
  })

  it('exige TLS para qualquer host remoto, mesmo sem ?sslmode= na URL', () => {
    // Reproduz exatamente o buraco: a URL do .dev.vars.example nao trazia
    // ?sslmode=require. Mesmo assim, criarPool tem que forcar TLS — nao
    // pode depender de quem monta a URL lembrar do parametro.
    const sql = criarPool('postgres://postgres.ref:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres')
    expect(sql.options.ssl).toBe('require')
    sql.end({ timeout: 0 })
  })

  it('URL remota com ?sslmode= nao muda o resultado — o codigo exige TLS de qualquer jeito', () => {
    const sql = criarPool('postgres://postgres.ref:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require')
    expect(sql.options.ssl).toBe('require')
    sql.end({ timeout: 0 })
  })
})
