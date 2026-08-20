import { describe, it, expect } from 'vitest'
import { respostaDeErroPg } from '../src/routes/clientes'

// respostaDeErroPg mapeava todo 23514 (CHECK violado) para a mesma
// mensagem fixa de limite/prazo, mesmo quando a constraint era outra —
// verificado ao vivo: POST {"nome":"x","status":"sei-la"} respondia
// 400 {"erro":"limite e prazo nao podem ser negativos"}, mensagem errada.
// clientes.http.test.ts cobre o mesmo cenario pela camada HTTP; este
// arquivo testa a funcao isolada para cobrir tambem o fallback de
// constraint desconhecida, que nao da pra disparar via HTTP (nao ha
// nenhuma constraint sem entrada no mapa nesta tabela).

function erroPg(code: string, constraint_name?: string) {
  return { code, constraint_name }
}

describe('respostaDeErroPg', () => {
  it('23505 -> 409, nome duplicado', () => {
    expect(respostaDeErroPg(erroPg('23505'))).toEqual({
      corpo: { erro: 'ja existe um cliente com esse nome' },
      status: 409,
    })
  })

  it('23514 clientes_status_check -> 400, mensagem especifica de status', () => {
    expect(respostaDeErroPg(erroPg('23514', 'clientes_status_check'))).toEqual({
      corpo: { erro: 'status invalido' },
      status: 400,
    })
  })

  it('23514 clientes_tend_check -> 400, mensagem especifica de tendencia', () => {
    expect(respostaDeErroPg(erroPg('23514', 'clientes_tend_check'))).toEqual({
      corpo: { erro: 'tendencia invalida' },
      status: 400,
    })
  })

  it('23514 clientes_limite_nao_negativo -> 400, mensagem especifica de limite', () => {
    expect(respostaDeErroPg(erroPg('23514', 'clientes_limite_nao_negativo'))).toEqual({
      corpo: { erro: 'limite nao pode ser negativo' },
      status: 400,
    })
  })

  it('23514 clientes_prazo_nao_negativo -> 400, mensagem especifica de prazo', () => {
    expect(respostaDeErroPg(erroPg('23514', 'clientes_prazo_nao_negativo'))).toEqual({
      corpo: { erro: 'prazo nao pode ser negativo' },
      status: 400,
    })
  })

  it('23514 com constraint desconhecida -> 400, fallback honesto (nao inventa qual campo era)', () => {
    expect(respostaDeErroPg(erroPg('23514', 'alguma_constraint_nova_nao_mapeada'))).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' },
      status: 400,
    })
  })

  it('23514 sem constraint_name -> 400, fallback honesto', () => {
    expect(respostaDeErroPg(erroPg('23514'))).toEqual({
      corpo: { erro: 'dado invalido para um dos campos' },
      status: 400,
    })
  })

  it('codigo desconhecido -> null (chamador deixa a excecao subir)', () => {
    expect(respostaDeErroPg(erroPg('42P01'))).toBeNull()
  })
})
