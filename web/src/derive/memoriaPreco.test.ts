import { describe, it, expect } from 'vitest'
import {
  MEMORIA_VAZIA,
  aplicarMemoriaNaLinha,
  aplicarMemoriaNasLinhas,
  chaveProdutoUn,
  montarMemoriaPreco,
  notaUltimoPreco,
  type LinhaComPreco,
  type PrecoLembrado,
} from './memoriaPreco'

const lembrado = (
  produto: string, un: string, preco: number, data: string, numero: string,
): PrecoLembrado => ({ produto_id: produto, un, preco, data, numero })

const linha = (parcial: Partial<LinhaComPreco> = {}): LinhaComPreco => ({
  produto_id: 'p1', un: 'KG', preco: '', precoAutomatico: false, ...parcial,
})

describe('montarMemoriaPreco', () => {
  it('indexa por (produto, unidade) — o mesmo produto em KG e em CX sao duas memorias', () => {
    const m = montarMemoriaPreco([
      lembrado('p1', 'KG', 4.2, '2026-08-12', 'S-2'),
      lembrado('p1', 'CX', 80, '2026-08-12', 'S-2'),
    ])
    expect(m.porProdutoEUn.get(chaveProdutoUn('p1', 'KG'))?.preco).toBe(4.2)
    expect(m.porProdutoEUn.get(chaveProdutoUn('p1', 'CX'))?.preco).toBe(80)
  })

  it('porProduto guarda a venda mais RECENTE do produto, seja qual for a unidade', () => {
    const m = montarMemoriaPreco([
      lembrado('p1', 'KG', 4.2, '2026-05-01', 'S-1'),
      lembrado('p1', 'CX', 80, '2026-08-12', 'S-9'),
    ])
    expect(m.porProduto.get('p1')).toEqual(lembrado('p1', 'CX', 80, '2026-08-12', 'S-9'))
  })

  it('nao depende da ordem em que as linhas chegaram', () => {
    const linhas = [
      lembrado('p1', 'CX', 80, '2026-08-12', 'S-9'),
      lembrado('p1', 'KG', 4.2, '2026-05-01', 'S-1'),
    ]
    const direto = montarMemoriaPreco(linhas)
    const invertido = montarMemoriaPreco([...linhas].reverse())
    expect(direto.porProduto.get('p1')).toEqual(invertido.porProduto.get('p1'))
  })

  it('empate de data desempata pelo numero da saida (maior vence), como a consulta faz', () => {
    // Duas vendas no mesmo dia sao comuns; sem desempate explicito o
    // resultado passaria a depender da ordem do array. Mesma regra do
    // `order by` da API — se as duas divergissem, a nota exibida falaria de
    // uma venda e o preenchimento usaria outra.
    const m = montarMemoriaPreco([
      lembrado('p1', 'KG', 7, '2026-08-20', 'S-10'),
      lembrado('p1', 'CX', 9, '2026-08-20', 'S-11'),
    ])
    expect(m.porProduto.get('p1')?.numero).toBe('S-11')

    const invertido = montarMemoriaPreco([
      lembrado('p1', 'CX', 9, '2026-08-20', 'S-11'),
      lembrado('p1', 'KG', 7, '2026-08-20', 'S-10'),
    ])
    expect(invertido.porProduto.get('p1')?.numero).toBe('S-11')
  })

  it('lista vazia gera memoria vazia (cliente sem nenhuma compra)', () => {
    const m = montarMemoriaPreco([])
    expect(m.porProdutoEUn.size).toBe(0)
    expect(m.porProduto.size).toBe(0)
  })
})

describe('aplicarMemoriaNaLinha — preenche o que esta livre', () => {
  const memoria = montarMemoriaPreco([lembrado('p1', 'KG', 4.2, '2026-08-12', 'S-2')])

  it('campo vazio com memoria da unidade: preenche e marca como automatico', () => {
    expect(aplicarMemoriaNaLinha(linha(), memoria)).toEqual(
      linha({ preco: 4.2, precoAutomatico: true }),
    )
  })

  it('produto sem historico: campo continua VAZIO — nunca preco de outro produto nem media', () => {
    expect(aplicarMemoriaNaLinha(linha({ produto_id: 'p9' }), memoria)).toEqual(
      linha({ produto_id: 'p9' }),
    )
  })

  it('linha ainda sem produto escolhido nao ganha preco nenhum', () => {
    expect(aplicarMemoriaNaLinha(linha({ produto_id: '' }), memoria).preco).toBe('')
  })

  it('unidade diferente da lembrada NAO preenche — preco de caixa nao vale por quilo', () => {
    // A memoria tem p1 em KG a R$ 4,20. Numa linha em CX, escrever 4,20
    // afirmaria que a caixa custa R$ 4,20.
    expect(aplicarMemoriaNaLinha(linha({ un: 'CX' }), memoria).preco).toBe('')
  })

  it('memoria vazia (nao carregou / falhou / cliente novo) nao preenche nada', () => {
    expect(aplicarMemoriaNaLinha(linha(), MEMORIA_VAZIA).preco).toBe('')
  })
})

describe('aplicarMemoriaNaLinha — nunca sobrescreve o que foi digitado', () => {
  const memoria = montarMemoriaPreco([lembrado('p1', 'KG', 4.2, '2026-08-12', 'S-2')])

  it('preco digitado a mao fica intacto, mesmo havendo memoria para aquele produto', () => {
    const digitado = linha({ preco: '9.90', precoAutomatico: false })
    expect(aplicarMemoriaNaLinha(digitado, memoria)).toBe(digitado)
  })

  it('preco 0 gravado (item vindo de uma saida salva) nao e tratado como campo vazio', () => {
    const doBanco = linha({ preco: 0, precoAutomatico: false })
    expect(aplicarMemoriaNaLinha(doBanco, memoria)).toBe(doBanco)
  })

  it('preco que a PROPRIA memoria escreveu pode ser trocado por outro', () => {
    const outra = montarMemoriaPreco([lembrado('p1', 'KG', 5.5, '2026-08-20', 'S-3')])
    const automatico = linha({ preco: 4.2, precoAutomatico: true })
    expect(aplicarMemoriaNaLinha(automatico, outra)).toEqual(
      linha({ preco: 5.5, precoAutomatico: true }),
    )
  })

  it('preco automatico e APAGADO quando a nova memoria nao tem aquele produto', () => {
    // O caso da troca de cliente: deixar o valor seria mostrar, sob o nome do
    // cliente novo, um preco que nunca foi cobrado dele.
    const automatico = linha({ preco: 4.2, precoAutomatico: true })
    expect(aplicarMemoriaNaLinha(automatico, MEMORIA_VAZIA)).toEqual(linha())
  })

  it('preco automatico e apagado ao trocar a unidade para uma sem memoria', () => {
    const automatico = linha({ un: 'CX', preco: 4.2, precoAutomatico: true })
    expect(aplicarMemoriaNaLinha(automatico, memoria)).toEqual(linha({ un: 'CX' }))
  })

  it('reaplicar a mesma memoria nao troca a linha por outra igual', () => {
    const jaPreenchida = linha({ preco: 4.2, precoAutomatico: true })
    expect(aplicarMemoriaNaLinha(jaPreenchida, memoria)).toBe(jaPreenchida)
  })
})

describe('aplicarMemoriaNasLinhas', () => {
  it('preenche so as livres e deixa as digitadas exatamente como estavam', () => {
    const memoria = montarMemoriaPreco([
      lembrado('p1', 'KG', 4.2, '2026-08-12', 'S-2'),
      lembrado('p2', 'KG', 1.8, '2026-08-12', 'S-2'),
    ])
    const linhas = [
      linha({ produto_id: 'p1' }),                                   // vazia -> preenche
      linha({ produto_id: 'p2', preco: '9.90' }),                    // digitada -> intacta
      linha({ produto_id: 'p9' }),                                   // sem historico -> vazia
      linha({ produto_id: 'p1', preco: 3, precoAutomatico: true }),   // automatica -> atualiza
    ]
    expect(aplicarMemoriaNasLinhas(linhas, memoria)).toEqual([
      linha({ produto_id: 'p1', preco: 4.2, precoAutomatico: true }),
      linha({ produto_id: 'p2', preco: '9.90' }),
      linha({ produto_id: 'p9' }),
      linha({ produto_id: 'p1', preco: 4.2, precoAutomatico: true }),
    ])
  })

  it('lista vazia continua vazia', () => {
    expect(aplicarMemoriaNasLinhas([], MEMORIA_VAZIA)).toEqual([])
  })
})

describe('notaUltimoPreco', () => {
  it('diz o valor, a unidade e a data — "último: R$ 4,20/KG em 12/08"', () => {
    expect(notaUltimoPreco(lembrado('p1', 'KG', 4.2, '2026-08-12', 'S-2')))
      .toBe('último: R$ 4,20/KG em 12/08')
  })

  it('a unidade entra sempre — "R$ 30,00" sem ela nao diz se e o quilo ou a caixa', () => {
    expect(notaUltimoPreco(lembrado('p1', 'CX', 30, '2026-08-12', 'S-2')))
      .toBe('último: R$ 30,00/CX em 12/08')
  })

  it('sem memoria nao ha nota — a tela nao desenha nada (nem travessao)', () => {
    expect(notaUltimoPreco(null)).toBeNull()
    expect(notaUltimoPreco(undefined)).toBeNull()
  })

  it('data fora do formato nao vira data inventada: a nota sai so com o preco', () => {
    expect(notaUltimoPreco(lembrado('p1', 'KG', 4.2, '', 'S-2'))).toBe('último: R$ 4,20/KG')
  })
})
