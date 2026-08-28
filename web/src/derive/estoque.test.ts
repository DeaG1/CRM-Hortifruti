import { describe, it, expect } from 'vitest'
import {
  ultimaMovimentacao,
  textoMovimentacao,
  agruparMovimentacoes,
  chaveEstoque,
  ROTULO_MOVIMENTACAO,
  TIPOS_MOVIMENTACAO,
  posicaoEstoque,
  avisoSaidasSemData,
  totalEstoqueKg,
  PARAM_POSICAO,
  situacaoSaldo,
  resumoEstoque,
  textoResumoEstoque,
  SELO_SITUACAO,
  AVISO_SITUACAO,
  SITUACOES_SALDO,
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
    qtd: 10, qtd_kg: 10, referencia: 'E-1', total: 1, ...over,
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

// =========================================== posicao num dia passado (corte)

describe('posicaoEstoque', () => {
  const HOJE = '2026-08-27'

  it('hoje e SEM CORTE: a busca sai sem parametro nenhum', () => {
    const p = posicaoEstoque(HOJE, HOJE)
    expect(p.corte).toBeNull()
    expect(p.historica).toBe(false)
    expect(p.query).toBe('')
    expect(p.texto).toBe('hoje')
    expect(p.aviso).toBe('')
  })

  it('data passada vira corte, e a query leva a data escolhida', () => {
    const p = posicaoEstoque('2026-08-15', HOJE)
    expect(p.corte).toBe('2026-08-15')
    expect(p.historica).toBe(true)
    expect(p.query).toBe('?posicao_em=2026-08-15')
  })

  it('o rotulo curto usa dataBrCurta — o ano fica no corte, nao no texto', () => {
    const p = posicaoEstoque('2024-03-09', HOJE)
    expect(p.texto).toBe('09/03')
    expect(p.corte).toBe('2024-03-09')
  })

  it('a vespera de hoje ja e historica (o corte comeca no dia anterior)', () => {
    expect(posicaoEstoque('2026-08-26', HOJE).historica).toBe(true)
  })

  it('data FUTURA vira a posicao atual — amanha nao pode inventar nada', () => {
    const p = posicaoEstoque('2026-08-28', HOJE)
    expect(p.corte).toBeNull()
    expect(p.historica).toBe(false)
    expect(p.query).toBe('')
  })

  it('vazio, nulo ou fora do formato tambem viram a posicao atual, nunca um corte quebrado', () => {
    for (const v of ['', null, undefined, '15/08/2026', '2026-8-1', 'ontem']) {
      const p = posicaoEstoque(v, HOJE)
      expect(p.corte).toBeNull()
      expect(p.query).toBe('')
    }
  })

  it('hojeIso invalido nao declara nada como passado — sem saber que dia e, a resposta e "agora"', () => {
    expect(posicaoEstoque('2020-01-01', 'nao-e-data').historica).toBe(false)
  })

  it('o aviso nomeia a data e diz que NAO e o estoque de agora', () => {
    const p = posicaoEstoque('2026-08-15', HOJE)
    expect(p.aviso).toContain('15/08')
    expect(p.aviso).toMatch(/não é o estoque de agora/i)
  })

  it('a query e montada com o mesmo nome de parametro que a API le', () => {
    expect(posicaoEstoque('2026-01-02', HOJE).query).toBe(`?${PARAM_POSICAO}=2026-01-02`)
    // E NAO e o de/ate do filtro de periodo global: aquele e intervalo, este
    // e ponto no tempo.
    expect(PARAM_POSICAO).not.toBe('de')
    expect(PARAM_POSICAO).not.toBe('ate')
  })
})

describe('avisoSaidasSemData', () => {
  it('sem nenhuma, nao ha aviso — a tela nao explica o que nao aconteceu', () => {
    expect(avisoSaidasSemData(0)).toBe('')
    expect(avisoSaidasSemData(-1)).toBe('')
    expect(avisoSaidasSemData(Number.NaN)).toBe('')
  })

  it('uma saida: singular, e diz que ela conta em todas as datas', () => {
    const texto = avisoSaidasSemData(1)
    expect(texto).toContain('1 saída')
    expect(texto).toMatch(/está descontada/)
    expect(texto).toMatch(/em todas/)
    expect(texto).toMatch(/anteriores ao pedido/)
  })

  it('varias saidas: plural', () => {
    const texto = avisoSaidasSemData(3)
    expect(texto).toContain('3 saídas')
    expect(texto).toMatch(/estão descontadas/)
  })

  it('diz o que fazer a respeito, nao so o que aconteceu', () => {
    expect(avisoSaidasSemData(2)).toMatch(/Preencha a entrega/i)
  })
})


// ============================================== o total ENTRE linhas, em kg

describe('totalEstoqueKg', () => {
  const soma = (saldo: number) => ({ em_kg: { entrou: saldo, perda: 0, saiu: 0, saldo } })
  const fora = () => ({ em_kg: null })

  it('soma as linhas convertiveis em quilos — a unica unidade em que a soma entre linhas fecha', () => {
    const t = totalEstoqueKg([
      { em_kg: { entrou: 100, perda: 15, saiu: 30, saldo: 55 } },
      { em_kg: { entrou: 150, perda: 1, saiu: 0, saldo: 149 } },
    ])
    expect(t.entrou).toBe(250)
    expect(t.perda).toBe(16)
    expect(t.saiu).toBe(30)
    expect(t.saldo).toBe(204)
    expect(t.linhasSomadas).toBe(2)
    expect(t.linhasDeFora).toBe(0)
    expect(t.disponivel).toBe(true)
    // Total completo nao ganha aviso: a tela nao explica o que nao aconteceu.
    expect(t.aviso).toBe('')
  })

  it('linha sem conversao NAO entra como zero: fica de fora, e e contada', () => {
    // Somar como zero seria o mesmo defeito que a tela acabou de deixar de
    // cometer, um andar acima — um total afirmado com confianca que ignora
    // mercadoria real em silencio.
    const t = totalEstoqueKg([soma(55), fora(), soma(20)])
    expect(t.saldo).toBe(75)
    expect(t.linhasSomadas).toBe(2)
    expect(t.linhasDeFora).toBe(1)
    expect(t.disponivel).toBe(true)
    expect(t.aviso).toContain('1 linha de 3')
    expect(t.aviso).toMatch(/continua exata/)
  })

  it('o aviso diz as DUAS metades: quantas ficaram de fora e de quantas', () => {
    const t = totalEstoqueKg([soma(10), fora(), fora(), fora()])
    expect(t.aviso).toContain('3 linhas de 4')
    expect(t.aviso).toMatch(/peso médio/)
  })

  it('nenhuma linha convertivel: nao ha total — disponivel false, e o saldo nao e uma afirmacao', () => {
    // O caso real: quatro linhas em UN, 138 unidades no deposito. A tela usa
    // `disponivel` para imprimir travessao; "0 kg" afirmaria um deposito
    // vazio que ninguem mediu.
    const t = totalEstoqueKg([fora(), fora(), fora(), fora()])
    expect(t.disponivel).toBe(false)
    expect(t.linhasSomadas).toBe(0)
    expect(t.linhasDeFora).toBe(4)
    expect(t.aviso).toMatch(/Nenhuma linha pôde ser somada/)
    expect(t.aviso).toContain('4 linhas')
    expect(t.aviso).toMatch(/continua exata/)
  })

  it('lista vazia: nao ha total nem linhas de fora, e nao ha aviso', () => {
    const t = totalEstoqueKg([])
    expect(t.disponivel).toBe(false)
    expect(t.linhasSomadas).toBe(0)
    expect(t.linhasDeFora).toBe(0)
    expect(t.aviso).toBe('')
  })

  it('uma linha so de fora: singular, sem plural quebrado', () => {
    expect(totalEstoqueKg([fora()]).aviso).toContain('1 linha')
    expect(totalEstoqueKg([fora()]).aviso).not.toContain('1 linhas')
  })

  it('saldo negativo entra normalmente — o total e uma soma, nao um julgamento', () => {
    const t = totalEstoqueKg([soma(-30), soma(50)])
    expect(t.saldo).toBe(20)
    expect(t.linhasSomadas).toBe(2)
  })
})

// ================================== o que o saldo diz, e o que ele alerta

const cls = (over: Partial<{ saldo: number; movimentada: boolean; perda_fora_da_unidade: number }> = {}) => ({
  saldo: 10,
  movimentada: true,
  perda_fora_da_unidade: 0,
  ...over,
})

describe('situacaoSaldo — tres zeros, tres significados diferentes', () => {
  it('positivo: tem mercadoria, nada a sinalizar', () => {
    expect(situacaoSaldo(cls({ saldo: 55 }))).toBe('positivo')
  })

  it('acabou: teve movimentacao e o saldo zerou — o alerta de compra', () => {
    expect(situacaoSaldo(cls({ saldo: 0, movimentada: true }))).toBe('acabou')
  })

  it('nunca_comprado: produto cadastrado sem movimentacao nenhuma', () => {
    // O mesmo numero do caso acima. So a origem da linha os distingue, e por
    // isso ela viaja da API ate aqui em vez de ser deduzida dos numeros.
    expect(situacaoSaldo(cls({ saldo: 0, movimentada: false }))).toBe('nunca_comprado')
  })

  it('negativo: saiu mais do que entrou — dado inconsistente, nao falta de mercadoria', () => {
    expect(situacaoSaldo(cls({ saldo: -15 }))).toBe('negativo')
  })

  it('negativo VENCE a origem da linha: uma linha de cadastro negativa nao vira "nunca comprado"', () => {
    // Impossivel pela query de hoje (linha de cadastro soma zero em tudo), e
    // e exatamente por isso que a ordem esta escrita: se um dia acontecer, a
    // tela nao pode esconder a inconsistencia atras de outro rotulo.
    expect(situacaoSaldo(cls({ saldo: -3, movimentada: false }))).toBe('negativo')
  })

  it('linha que deixa quilos de perda de fora nao e classificada — o saldo dela nao fecha', () => {
    // Mantem a decisao que ja valia para a cor antes desta classificacao: um
    // julgamento sobre numero incompleto por construcao seria arbitrario.
    expect(situacaoSaldo(cls({ saldo: 0, perda_fora_da_unidade: 2 }))).toBe('sem_conta_fechada')
    expect(situacaoSaldo(cls({ saldo: -2, perda_fora_da_unidade: 2 }))).toBe('sem_conta_fechada')
    expect(situacaoSaldo(cls({ saldo: 9, perda_fora_da_unidade: 2 }))).toBe('sem_conta_fechada')
  })

  it('perda_fora_da_unidade ausente conta como zero — a linha e classificada normalmente', () => {
    expect(situacaoSaldo({ saldo: 0, movimentada: true })).toBe('acabou')
  })

  it('toda situacao tem selo e aviso definidos, e so as duas neutras vem vazias', () => {
    // O controle inerte deste bloco: ele nao muda com nenhuma regra de
    // classificacao, e tem de sobreviver a qualquer mexida nela.
    for (const s of SITUACOES_SALDO) {
      expect(typeof SELO_SITUACAO[s]).toBe('string')
      expect(typeof AVISO_SITUACAO[s]).toBe('string')
    }
    expect(SELO_SITUACAO.positivo).toBe('')
    expect(SELO_SITUACAO.sem_conta_fechada).toBe('')
    // As tres que a tela precisa distinguir sao escritas — cor sozinha nao
    // comunica, e "acabou" e "nunca comprado" imprimem o MESMO numero.
    expect(SELO_SITUACAO.acabou).toBeTruthy()
    expect(SELO_SITUACAO.nunca_comprado).toBeTruthy()
    expect(SELO_SITUACAO.negativo).toBeTruthy()
    expect(new Set([
      SELO_SITUACAO.acabou, SELO_SITUACAO.nunca_comprado, SELO_SITUACAO.negativo,
    ]).size).toBe(3)
  })

  it('o aviso do negativo manda CORRIGIR, e o do zero manda COMPRAR — sao acoes opostas', () => {
    expect(AVISO_SITUACAO.acabou).toMatch(/comprar/i)
    expect(AVISO_SITUACAO.negativo).toMatch(/corrigir o lançamento|não comprar/i)
    expect(AVISO_SITUACAO.negativo).toMatch(/não é falta de mercadoria/i)
    expect(AVISO_SITUACAO.nunca_comprado).toMatch(/nunca foi comprado/i)
  })
})

describe('resumoEstoque e textoResumoEstoque — o cartao conta o que o rotulo diz', () => {
  it('conta as linhas, as que tem estoque e as zeradas de cada tipo', () => {
    const r = resumoEstoque([
      cls({ saldo: 55 }),
      cls({ saldo: 0 }),
      cls({ saldo: 0, movimentada: false }),
      cls({ saldo: 0, movimentada: false }),
      cls({ saldo: -8 }),
    ])
    expect(r.linhas).toBe(5)
    expect(r.comEstoque).toBe(1)
    expect(r.acabou).toBe(1)
    expect(r.nuncaComprado).toBe(2)
    expect(r.negativo).toBe(1)
    expect(r.semEstoque).toBe(3)
  })

  it('a linha sem conta fechada nao entra em nenhuma das contagens de falta', () => {
    const r = resumoEstoque([cls({ saldo: 0, perda_fora_da_unidade: 2 })])
    expect(r.linhas).toBe(1)
    expect(r.semEstoque).toBe(0)
    expect(r.negativo).toBe(0)
    expect(r.acabou).toBe(0)
  })

  it('o texto conta LINHAS listadas — nao "itens movimentados"', () => {
    const r = resumoEstoque([cls({ saldo: 55 }), cls({ saldo: 0 }), cls({ saldo: 0, movimentada: false })])
    const t = textoResumoEstoque(r)
    expect(t).toContain('3 linha(s) listada(s)')
    expect(t).toContain('2 sem estoque')
    expect(t).not.toContain('movimentados')
  })

  it('o numero do texto e o MESMO que o resumo conta — nunca dois numeros diferentes', () => {
    const linhas = [cls({ saldo: 1 }), cls({ saldo: 2 }), cls({ saldo: 0 }), cls({ saldo: -1 })]
    const r = resumoEstoque(linhas)
    expect(textoResumoEstoque(r)).toContain(`${linhas.length} linha(s) listada(s)`)
    expect(textoResumoEstoque(r)).toContain('1 com saldo negativo')
  })

  it('omite o que nao aconteceu: sem zerados e sem negativos, so o total', () => {
    expect(textoResumoEstoque(resumoEstoque([cls({ saldo: 5 })]))).toBe('1 linha(s) listada(s)')
  })

  it('na posicao historica a data entra no texto', () => {
    expect(textoResumoEstoque(resumoEstoque([cls({ saldo: 5 })]), '15/08'))
      .toBe('1 linha(s) listada(s) até 15/08')
  })

  it('lista vazia: zero linhas, e nada mais afirmado', () => {
    const r = resumoEstoque([])
    expect(r.linhas).toBe(0)
    expect(r.comEstoque).toBe(0)
    expect(textoResumoEstoque(r)).toBe('0 linha(s) listada(s)')
  })
})
