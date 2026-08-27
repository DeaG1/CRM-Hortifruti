import { describe, it, expect } from 'vitest'
import {
  ultimaMovimentacao,
  textoMovimentacao,
  agruparMovimentacoes,
  chaveEstoque,
  ROTULO_MOVIMENTACAO,
  TIPOS_MOVIMENTACAO,
  type MovimentacaoEstoque,
} from './estoque'

const datas = (over: Partial<{
  ultima_entrada: string | null
  ultima_saida: string | null
  ultima_perda: string | null
}> = {}) => ({
  ultima_entrada: null,
  ultima_saida: null,
  ultima_perda: null,
  ...over,
})

describe('ultimaMovimentacao — qual das tres datas, e de que tipo', () => {
  it('item com entrada e saida mostra a MAIS RECENTE das duas', async () => {
    const so = ultimaMovimentacao(datas({ ultima_entrada: '2026-06-01', ultima_saida: '2026-06-14' }))
    expect(so).toEqual({
      tipo: 'saida', data: '2026-06-14', rotulo: 'Saída', texto: 'Saída · 14/06',
    })
  })

  it('e a mais recente pode ser a ENTRADA — nao ha tipo privilegiado fora do empate', () => {
    const so = ultimaMovimentacao(datas({ ultima_entrada: '2026-06-20', ultima_saida: '2026-06-14' }))
    expect(so!.tipo).toBe('entrada')
    expect(so!.texto).toBe('Entrada · 20/06')
  })

  it('item so com entrada mostra a entrada', () => {
    expect(ultimaMovimentacao(datas({ ultima_entrada: '2026-05-04' }))).toEqual({
      tipo: 'entrada', data: '2026-05-04', rotulo: 'Entrada', texto: 'Entrada · 04/05',
    })
  })

  it('item so com perda mostra a PERDA, rotulada como perda', () => {
    const so = ultimaMovimentacao(datas({ ultima_perda: '2026-05-19' }))
    expect(so!.tipo).toBe('perda')
    expect(so!.rotulo).toBe('Perda')
    // O ponto da decisao: perda entra no rastreamento, mas nao se disfarca.
    expect(so!.texto).toBe('Perda · 19/05')
    expect(so!.texto).not.toContain('Saída')
  })

  it('perda mais recente que entrada e saida ganha — perda E movimentacao', () => {
    const so = ultimaMovimentacao(datas({
      ultima_entrada: '2026-06-01', ultima_saida: '2026-06-05', ultima_perda: '2026-06-09',
    }))
    expect(so!.tipo).toBe('perda')
    expect(so!.data).toBe('2026-06-09')
  })

  it('item SEM movimentacao nenhuma devolve null — nunca hoje, nunca a epoch', () => {
    const so = ultimaMovimentacao(datas())
    expect(so).toBeNull()
    // O travessao e da tela; aqui o contrato e "nao ha o que dizer".
    expect(so).not.toEqual(expect.objectContaining({ data: expect.any(String) }))
  })

  it('data vazia nao conta como movimentacao (o mesmo que ausente)', () => {
    expect(ultimaMovimentacao(datas({ ultima_saida: '' }))).toBeNull()
  })

  it('empate entre saida e entrada: a saida vence, e sempre a mesma', () => {
    const so = ultimaMovimentacao(datas({ ultima_entrada: '2026-07-10', ultima_saida: '2026-07-10' }))
    expect(so!.tipo).toBe('saida')
    // Determinismo: os mesmos dados sempre dao o mesmo rotulo, senao a linha
    // alternaria entre "Entrada · 10/07" e "Saída · 10/07" entre recargas.
    expect(ultimaMovimentacao(datas({ ultima_saida: '2026-07-10', ultima_entrada: '2026-07-10' })))
      .toEqual(so)
  })

  it('empate entre perda e entrada: a perda vence', () => {
    const so = ultimaMovimentacao(datas({ ultima_entrada: '2026-07-10', ultima_perda: '2026-07-10' }))
    expect(so!.tipo).toBe('perda')
  })

  it('empate entre saida e perda: a saida vence', () => {
    const so = ultimaMovimentacao(datas({ ultima_saida: '2026-07-10', ultima_perda: '2026-07-10' }))
    expect(so!.tipo).toBe('saida')
  })

  it('empate triplo resolve para saida, deterministicamente', () => {
    const so = ultimaMovimentacao(datas({
      ultima_entrada: '2026-07-10', ultima_saida: '2026-07-10', ultima_perda: '2026-07-10',
    }))
    expect(so!.tipo).toBe('saida')
  })

  it('a comparacao e cronologica mesmo virando o ano (lexicografica em AAAA-MM-DD)', () => {
    const so = ultimaMovimentacao(datas({ ultima_entrada: '2027-01-02', ultima_saida: '2026-12-31' }))
    expect(so!.tipo).toBe('entrada')
    expect(so!.data).toBe('2027-01-02')
  })

  it('a data ISO completa continua disponivel — o formato curto nao mostra o ano', () => {
    const so = ultimaMovimentacao(datas({ ultima_saida: '2024-03-09' }))
    // Estoque nao segue o filtro de periodo: a ultima movimentacao pode ser
    // de anos atras, e '09/03' sozinho nao diria de quando.
    expect(so!.data).toBe('2024-03-09')
    expect(so!.texto).toBe('Saída · 09/03')
  })
})

describe('textoMovimentacao e rotulos', () => {
  it('imprime rotulo e data curta, nessa ordem', () => {
    expect(textoMovimentacao('entrada', '2026-08-01')).toBe('Entrada · 01/08')
    expect(textoMovimentacao('saida', '2026-08-01')).toBe('Saída · 01/08')
    expect(textoMovimentacao('perda', '2026-08-01')).toBe('Perda · 01/08')
  })

  it('os tres rotulos sao distintos entre si', () => {
    const rotulos = TIPOS_MOVIMENTACAO.map(t => ROTULO_MOVIMENTACAO[t])
    expect(new Set(rotulos).size).toBe(TIPOS_MOVIMENTACAO.length)
  })

  it('data fora do formato volta crua em vez de sumir (a movimentacao aconteceu)', () => {
    expect(textoMovimentacao('saida', 'sem-data')).toBe('Saída · sem-data')
  })
})

describe('agruparMovimentacoes', () => {
  const mov = (over: Partial<MovimentacaoEstoque> = {}): MovimentacaoEstoque => ({
    produto_id: 'p-1', un: 'KG', tipo: 'entrada', data: '2026-08-01',
    qtd_kg: 10, referencia: 'E-1', total: 1, ...over,
  })

  it('agrupa por produto E unidade — CX e KG do mesmo produto sao historicos separados', () => {
    const grupos = agruparMovimentacoes([
      mov({ un: 'KG', referencia: 'E-1' }),
      mov({ un: 'CX', referencia: 'E-2' }),
      mov({ un: 'KG', referencia: 'E-3' }),
    ])
    expect(grupos.get(chaveEstoque('p-1', 'KG'))!.map(m => m.referencia)).toEqual(['E-1', 'E-3'])
    expect(grupos.get(chaveEstoque('p-1', 'CX'))!.map(m => m.referencia)).toEqual(['E-2'])
  })

  it('separa produtos diferentes', () => {
    const grupos = agruparMovimentacoes([mov({ produto_id: 'p-1' }), mov({ produto_id: 'p-2' })])
    expect(grupos.size).toBe(2)
  })

  it('PRESERVA a ordem recebida dentro do grupo — nao reordena', () => {
    // A API ja ordenou E truncou nas mais recentes segundo essa ordem;
    // reordenar aqui produziria uma lista que discorda do proprio corte.
    const grupos = agruparMovimentacoes([
      mov({ data: '2026-08-09', referencia: 'S-9' }),
      mov({ data: '2026-08-09', referencia: 'S-8' }),
      mov({ data: '2026-08-01', referencia: 'E-1' }),
    ])
    expect(grupos.get(chaveEstoque('p-1', 'KG'))!.map(m => m.referencia)).toEqual(['S-9', 'S-8', 'E-1'])
  })

  it('lista vazia vira mapa vazio (nao null)', () => {
    expect(agruparMovimentacoes([]).size).toBe(0)
  })

  it('chaveEstoque distingue unidades do mesmo produto', () => {
    expect(chaveEstoque('p-1', 'KG')).not.toBe(chaveEstoque('p-1', 'CX'))
  })
})
