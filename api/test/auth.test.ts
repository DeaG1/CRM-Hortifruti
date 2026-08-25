import { describe, it, expect } from 'vitest'
import {
  hashSenha, verificarSenha, precisaRenovar,
  MINUTOS_DE_INATIVIDADE, MINUTOS_RESTANTES_PARA_RENOVAR,
} from '../src/auth'

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

  it('rejeita hash nao-string sem lancar (null, undefined, numero)', async () => {
    expect(await verificarSenha('x', null as unknown as string)).toBe(false)
    expect(await verificarSenha('x', undefined as unknown as string)).toBe(false)
    expect(await verificarSenha('x', 123 as unknown as string)).toBe(false)
  })
})

// ================================================== janela de inatividade
//
// A politica inteira (cookie de sessao + 30 minutos de inatividade) precisa
// do Postgres para ser exercitada de ponta a ponta — isso esta em
// test/janela_sessao.test.ts. O que cabe aqui, sem banco nenhum, e a REGRA DO
// LIMIAR: a decisao de gravar ou nao gravar. Ela e a unica parte desta
// mudanca que e uma funcao pura, e e justamente a que separa "janela
// deslizante" de "um UPDATE por requisicao".

describe('janela de inatividade — as constantes dizem a unidade', () => {
  it('a janela e de 30 minutos', () => {
    expect(MINUTOS_DE_INATIVIDADE).toBe(30)
  })

  it('o limiar cabe dentro da janela', () => {
    // Limiar >= janela renovaria em TODA requisicao (sempre "falta menos que
    // o limiar"); limiar 0 nunca renovaria e a sessao morreria em 30 minutos
    // mesmo em uso continuo. Os dois erros sao invisiveis em producao ate
    // alguem reclamar.
    expect(MINUTOS_RESTANTES_PARA_RENOVAR).toBeGreaterThan(0)
    expect(MINUTOS_RESTANTES_PARA_RENOVAR).toBeLessThan(MINUTOS_DE_INATIVIDADE)
  })

  it('entre uma escrita e outra passam ao menos alguns minutos', () => {
    // O intervalo minimo entre duas gravacoes da mesma sessao. Se cair para
    // perto de zero, "janela deslizante" virou "escrita por requisicao" — e
    // cada escrita e uma subrequisicao do Worker (ver o comentario do limiar
    // em src/auth.ts).
    const minutosEntreEscritas = MINUTOS_DE_INATIVIDADE - MINUTOS_RESTANTES_PARA_RENOVAR
    expect(minutosEntreEscritas).toBeGreaterThanOrEqual(5)
  })
})

describe('precisaRenovar', () => {
  it('sessao recem-criada (30 minutos pela frente) NAO renova', () => {
    // Este e o caso que impede a escrita por requisicao: abrir uma tela
    // dispara varias chamadas seguidas, e nenhuma delas pode gravar.
    expect(precisaRenovar(MINUTOS_DE_INATIVIDADE * 60)).toBe(false)
  })

  it('logo acima do limiar ainda NAO renova', () => {
    expect(precisaRenovar(MINUTOS_RESTANTES_PARA_RENOVAR * 60 + 1)).toBe(false)
  })

  it('exatamente no limiar ainda NAO renova', () => {
    expect(precisaRenovar(MINUTOS_RESTANTES_PARA_RENOVAR * 60)).toBe(false)
  })

  it('logo abaixo do limiar renova', () => {
    expect(precisaRenovar(MINUTOS_RESTANTES_PARA_RENOVAR * 60 - 1)).toBe(true)
  })

  it('sessao quase vencendo renova', () => {
    expect(precisaRenovar(10)).toBe(true)
  })

  it('sessao ja vencida (restante negativo) renova — quem barra e o resolver', () => {
    // Nao e contradicao: se o resolver deixou passar, a sessao ainda valia no
    // instante da leitura. O predicado `expira_em > now()` dentro de
    // renovar_sessao (migration 012) e que decide no instante da escrita.
    expect(precisaRenovar(-1)).toBe(true)
  })
})
