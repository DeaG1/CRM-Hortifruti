import { describe, it, expect } from 'vitest'
import {
  periodoDe,
  receitaBrutaPeriodo,
  saidasDaReceita,
  compraMercadoriaPeriodo,
  custosPorCategoria,
  calcularResultado,
  diasRecebimento,
  diasRecebimentoSaida,
  diasPagamentoProdutor,
  diasEstoque,
  calcularCicloCaixa,
} from './financeiro'
import type { SaidaFin, EntradaFin } from './financeiro'
import type { Lancamento } from './lancamentos'

const saida = (over: Partial<SaidaFin> = {}): SaidaFin => ({
  id: 's1', entrega: '2026-06-10', status: 'Entregue', data_pag: '2026-06-15',
  valor: 1000, peso: 100, ...over,
})

const entrada = (over: Partial<EntradaFin> = {}): EntradaFin => ({
  id: 'e1', data: '2026-06-01', pago: 'Pago', data_pag: '2026-06-04',
  perda_kg: 0, valor_total: 500, peso_total: 100, ...over,
})

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-05', categoria: 'Frete', descricao: '', valor: 100,
  funcionario_id: null, ...over,
})

describe('periodoDe', () => {
  it('devolve AAAA-MM de uma data ISO', () => {
    expect(periodoDe('2026-06-10')).toBe('2026-06')
  })
  it('nao confunde o mesmo mes em anos diferentes (diferente de mesDe em clientes.ts)', () => {
    expect(periodoDe('2025-06-10')).not.toBe(periodoDe('2026-06-10'))
  })
  it('devolve vazio para data invalida ou ausente', () => {
    expect(periodoDe(null)).toBe('')
    expect(periodoDe('lixo')).toBe('')
  })
})

describe('receitaBrutaPeriodo', () => {
  it('soma so vendas com status Entregue', () => {
    const saidas = [
      saida({ valor: 1000, status: 'Entregue' }),
      saida({ valor: 500, status: 'Em rota' }),
      saida({ valor: 300, status: 'Cancelado' }),
      saida({ valor: 200, status: 'Devolvido' }),
    ]
    expect(receitaBrutaPeriodo(saidas, 'all')).toBe(1000)
  })

  it('filtra pelo mes/ano de entrega', () => {
    const saidas = [
      saida({ valor: 1000, entrega: '2026-06-10' }),
      saida({ valor: 999, entrega: '2025-06-10' }), // mesmo mes, ano anterior
      saida({ valor: 250, entrega: '2026-07-01' }),
    ]
    expect(receitaBrutaPeriodo(saidas, '2026-06')).toBe(1000)
  })

  it('e zero sem vendas entregues', () => {
    expect(receitaBrutaPeriodo([], 'all')).toBe(0)
  })
})

describe('compraMercadoriaPeriodo', () => {
  it('soma valor_total de todas as entradas do periodo, pagas ou nao', () => {
    const entradas = [
      entrada({ valor_total: 500, pago: 'Pago' }),
      entrada({ valor_total: 300, pago: 'Pendente' }),
    ]
    expect(compraMercadoriaPeriodo(entradas, 'all')).toBe(800)
  })

  it('filtra pelo mes/ano de data', () => {
    const entradas = [
      entrada({ valor_total: 500, data: '2026-06-01' }),
      entrada({ valor_total: 999, data: '2026-07-01' }),
    ]
    expect(compraMercadoriaPeriodo(entradas, '2026-06')).toBe(500)
  })
})

describe('custosPorCategoria', () => {
  it('agrupa lancamentos por categoria, somando o valor', () => {
    const lancs = [
      lancamento({ categoria: 'Frete', valor: 100 }),
      lancamento({ categoria: 'Frete', valor: 50 }),
      lancamento({ categoria: 'Gasolina', valor: 80 }),
    ]
    expect(custosPorCategoria(lancs, 'all')).toEqual([
      { categoria: 'Frete', valor: 150 },
      { categoria: 'Gasolina', valor: 80 },
    ])
  })

  it('ordena por maior valor primeiro', () => {
    const lancs = [
      lancamento({ categoria: 'Gasolina', valor: 10 }),
      lancamento({ categoria: 'Frete', valor: 500 }),
    ]
    const resultado = custosPorCategoria(lancs, 'all')
    expect(resultado[0].categoria).toBe('Frete')
    expect(resultado[1].categoria).toBe('Gasolina')
  })

  it('respeita o periodo', () => {
    const lancs = [
      lancamento({ categoria: 'Frete', valor: 100, data: '2026-06-01' }),
      lancamento({ categoria: 'Frete', valor: 999, data: '2026-07-01' }),
    ]
    expect(custosPorCategoria(lancs, '2026-06')).toEqual([{ categoria: 'Frete', valor: 100 }])
  })

  it('lista vazia sem lancamentos', () => {
    expect(custosPorCategoria([], 'all')).toEqual([])
  })
})

describe('calcularResultado', () => {
  it('lucro = receita - (compra de mercadoria + lancamentos)', () => {
    const saidas = [saida({ valor: 2000, status: 'Entregue' })]
    const entradas = [entrada({ valor_total: 600 })]
    const lancs = [lancamento({ categoria: 'Frete', valor: 400 })]
    const resultado = calcularResultado(saidas, entradas, lancs, 'all')
    expect(resultado.receitaBruta).toBe(2000)
    expect(resultado.custoTotal).toBe(1000)
    expect(resultado.lucroLiquido).toBe(1000)
    expect(resultado.pctLucro).toBeCloseTo(50)
  })

  it('lucro negativo quando custos superam a receita', () => {
    const saidas = [saida({ valor: 500, status: 'Entregue' })]
    const entradas = [entrada({ valor_total: 600 })]
    const lancs = [lancamento({ categoria: 'Frete', valor: 400 })]
    const resultado = calcularResultado(saidas, entradas, lancs, 'all')
    expect(resultado.lucroLiquido).toBe(-500)
    expect(resultado.lucroLiquido).toBeLessThan(0)
  })

  it('"Compra de mercadoria" e sempre a primeira linha de custo', () => {
    const resultado = calcularResultado(
      [], [entrada({ valor_total: 300 })], [lancamento({ categoria: 'Frete', valor: 50 })], 'all',
    )
    expect(resultado.custos[0]).toEqual({ categoria: 'Compra de mercadoria', valor: 300 })
  })

  it('pctLucro e zero quando nao ha receita (evita divisao por zero)', () => {
    const resultado = calcularResultado([], [], [], 'all')
    expect(resultado.pctLucro).toBe(0)
    expect(resultado.receitaBruta).toBe(0)
  })
})

describe('diasRecebimento', () => {
  it('media de dias entre entrega e pagamento, so Entregues com as duas datas', () => {
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-11', status: 'Entregue' }), // 10 dias
      saida({ entrega: '2026-06-01', data_pag: '2026-06-06', status: 'Entregue' }), // 5 dias
    ]
    expect(diasRecebimento(saidas, 'all')).toBe(8) // media 7.5 arredonda p/ 8
  })

  it('ignora saidas nao pagas (sem data_pag)', () => {
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-11', status: 'Entregue' }),
      saida({ entrega: '2026-06-01', data_pag: null, status: 'Entregue' }),
    ]
    expect(diasRecebimento(saidas, 'all')).toBe(10)
  })

  it('ignora saidas nao entregues', () => {
    const saidas = [saida({ entrega: '2026-06-01', data_pag: '2026-06-11', status: 'Em rota' })]
    expect(diasRecebimento(saidas, 'all')).toBeNull()
  })

  it('e null (nao zero) quando nao ha dado suficiente no periodo', () => {
    expect(diasRecebimento([], 'all')).toBeNull()
  })

  // DEFEITO 2 (corrigido): o protótipo excluía `recebDias > 0` da média — ou
  // seja, descartava justamente o recebimento no MESMO DIA da entrega (os
  // clientes que pagam à vista, os melhores). Efeito: quanto mais gente
  // pagava rápido, pior ficava o indicador. As duas provas abaixo:
  it('inclui recebimento no mesmo dia da entrega (0 dias) na media — defeito corrigido', () => {
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-01', status: 'Entregue' }), // 0 dias, deve ENTRAR
      saida({ entrega: '2026-06-01', data_pag: '2026-06-11', status: 'Entregue' }), // 10 dias
    ]
    // media (0+10)/2 = 5. Com o defeito antigo (filtro `> 0`), o 0 seria
    // descartado e a media seria so 10 — um indicador pior mostrado como
    // "melhor" (mais dias) exatamente porque um cliente pagou na hora.
    expect(diasRecebimento(saidas, 'all')).toBe(5)
  })

  it('nao confunde pagamento no mesmo dia (0) com ausencia de data de pagamento (null)', () => {
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-01', status: 'Entregue' }), // 0 dias, entra
      saida({ entrega: '2026-06-01', data_pag: null, status: 'Entregue' }), // sem data, fica de fora
    ]
    // so o primeiro entra na media (0); o segundo (sem data_pag) nao vira
    // um zero disfarcado — se virasse, o resultado tambem seria 0 aqui por
    // coincidencia, mas o teste de "ignora saidas nao pagas" acima ja prova
    // que um segundo registro SEM data nao afeta a media quando ha outros
    // valores reais somados a ele.
    expect(diasRecebimento(saidas, 'all')).toBe(0)
  })
})

describe('diasRecebimentoSaida — o valor por linha da coluna RECEB. de Saidas', () => {
  it('devolve os dias entre a entrega e o pagamento', () => {
    expect(diasRecebimentoSaida(saida({ entrega: '2026-06-01', data_pag: '2026-06-04' }))).toBe(3)
  })

  it('pago no mesmo dia da entrega e 0 — resultado valido, nao ausencia', () => {
    expect(diasRecebimentoSaida(saida({ entrega: '2026-06-01', data_pag: '2026-06-01' }))).toBe(0)
  })

  it('pedido ainda nao entregue nao tem prazo a exibir (null)', () => {
    expect(diasRecebimentoSaida(saida({ status: 'Em rota', data_pag: '2026-06-04' }))).toBeNull()
    expect(diasRecebimentoSaida(saida({ status: 'Cancelado', data_pag: '2026-06-04' }))).toBeNull()
  })

  it('sem data de pagamento (ainda nao pago) e null, nunca 0', () => {
    expect(diasRecebimentoSaida(saida({ data_pag: null }))).toBeNull()
  })

  it('sem data de entrega e null', () => {
    expect(diasRecebimentoSaida(saida({ entrega: null }))).toBeNull()
  })

  it('data invalida e null, sem NaN vazando pra tela', () => {
    expect(diasRecebimentoSaida(saida({ entrega: 'ontem', data_pag: '2026-06-04' }))).toBeNull()
  })

  it('diferenca negativa (pagamento antes da entrega) e erro de digitacao: null', () => {
    expect(diasRecebimentoSaida(saida({ entrega: '2026-06-10', data_pag: '2026-06-04' }))).toBeNull()
  })

  it('e o mesmo insumo que diasRecebimento promedia', () => {
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-11' }),
      saida({ entrega: '2026-06-01', data_pag: '2026-06-06' }),
    ]
    const porLinha = saidas.map(diasRecebimentoSaida)
    expect(porLinha).toEqual([10, 5])
    expect(diasRecebimento(saidas, 'all')).toBe(8)
  })
})

describe('diasPagamentoProdutor', () => {
  it('media de dias entre a entrada e o pagamento ao produtor, so entradas Pagas', () => {
    const entradas = [
      entrada({ data: '2026-06-01', data_pag: '2026-06-06', pago: 'Pago' }), // 5 dias
      entrada({ data: '2026-06-01', data_pag: '2026-06-04', pago: 'Pago' }), // 3 dias
    ]
    expect(diasPagamentoProdutor(entradas, 'all')).toBe(4)
  })

  it('aceita pagamento no mesmo dia (0 dias), diferente de diasRecebimento', () => {
    const entradas = [entrada({ data: '2026-06-01', data_pag: '2026-06-01', pago: 'Pago' })]
    expect(diasPagamentoProdutor(entradas, 'all')).toBe(0)
  })

  it('ignora entradas nao pagas', () => {
    const entradas = [entrada({ data: '2026-06-01', data_pag: null, pago: 'Pendente' })]
    expect(diasPagamentoProdutor(entradas, 'all')).toBeNull()
  })

  it('e null quando nao ha entrada paga no periodo', () => {
    expect(diasPagamentoProdutor([], 'all')).toBeNull()
  })
})

describe('diasEstoque', () => {
  it('calcula os dias que o saldo do periodo duraria no ritmo de saida, usando os dias do mes civil', () => {
    // periodo '2026-06' (junho, 30 dias): qEnt=1000, qPer=0, qSai=300 ->
    // (1000-300)/(300/30) = 700/10 = 70
    const entradas = [entrada({ data: '2026-06-01', peso_total: 1000, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-06-10', peso: 300, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(70)
  })

  it('desconta perda_kg do cabecalho da entrada', () => {
    // qEnt=1000, qPer=100, qSai=300 -> (900-300)/10 = 60
    const entradas = [entrada({ data: '2026-06-01', peso_total: 1000, perda_kg: 100 })]
    const saidas = [saida({ entrega: '2026-06-10', peso: 300, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(60)
  })

  it('ignora saidas canceladas/devolvidas no calculo de qSai', () => {
    const entradas = [entrada({ data: '2026-06-01', peso_total: 1000, perda_kg: 0 })]
    const saidas = [
      saida({ entrega: '2026-06-10', peso: 300, status: 'Entregue' }),
      saida({ entrega: '2026-06-10', peso: 999, status: 'Cancelado' }),
      saida({ entrega: '2026-06-10', peso: 999, status: 'Devolvido' }),
    ]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(70)
  })

  it('nunca desce abaixo de 1 dia', () => {
    const entradas = [entrada({ data: '2026-06-01', peso_total: 10, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-06-10', peso: 10_000, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(1)
  })

  it('e null (nao zero) sem nenhuma saida para estimar o ritmo', () => {
    expect(diasEstoque([entrada()], [], 'all')).toBeNull()
  })

  // ---- unidade: os dois lados da subtracao estao em kg ----
  //
  // `qEnt - qPer - qSai` so significa alguma coisa com os tres termos na
  // mesma unidade. peso_total (GET /api/entradas) e peso (GET /api/saidas)
  // vem os dois convertidos em kg pela API (item em 'KG' conta a qtd, em
  // outra unidade conta qtd * produtos.peso_medio); perda_kg sempre foi kg.
  // Enquanto as duas somas eram `sum(qtd)` cru, os dois lados erravam JUNTOS.
  // Quando so as entradas foram corrigidas, a subtracao passou a misturar kg
  // com "caixas mais quilos" e o saldo inflou — giro de estoque e ciclo de
  // caixa do Dashboard maiores que a realidade.

  it('com os dois lados em kg, a mesma carga em caixas da o saldo fisico certo', () => {
    // Um mes com um produto vendido em caixa de 20 kg: entraram 20 CX
    // (400 kg), sairam 15 CX (300 kg), sobraram 5 CX (100 kg). No ritmo de
    // 300 kg em 30 dias (10 kg/dia), 100 kg duram 10 dias.
    const entradas = [entrada({ data: '2026-06-01', peso_total: 400, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-06-10', peso: 300, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(10)
  })

  it('com so um lado convertido (o estado intermediario), o saldo inflava — prova do defeito', () => {
    // Mesma carga fisica, mas com a saida ainda somando `qtd` cru: 15
    // "caixas" subtraidas de 400 kg. O saldo vira 385 de nada e o giro salta
    // de 10 para 770 dias — exatamente o erro que aparecia no Dashboard entre
    // a correcao das entradas e esta.
    const entradas = [entrada({ data: '2026-06-01', peso_total: 400, perda_kg: 0 })]
    const saidaCrua = [saida({ entrega: '2026-06-10', peso: 15, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidaCrua, '2026-06')).toBe(770)
  })

  it('so KG dos dois lados: o numero e o mesmo de antes da conversao existir', () => {
    // Quem lanca tudo em quilo nao pode ver numero nenhum mudar — a conversao
    // e no-op nesse caso, nas duas rotas.
    const entradas = [entrada({ data: '2026-06-01', peso_total: 1000, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-06-10', peso: 300, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-06')).toBe(70)
  })

  // DEFEITO 3 (corrigido): a versao anterior usava o volume acumulado de
  // TODO o historico cadastrado, dividido por 30 fixo — com o passar dos
  // meses o numero deixa de significar "ritmo recente" e encolhe sozinho,
  // sem nada ter mudado no negocio. As provas abaixo:

  it('usa os dias REAIS do mes selecionado, nao 30 fixo — julho tem 31 dias', () => {
    // periodo '2026-07' (julho, 31 dias): qEnt=1000, qPer=0, qSai=310 ->
    // (1000-310)/(310/31) = 690/10 = 69. Com 30 fixo (o defeito antigo)
    // daria (1000-310)/(310/30) = 690/10.33... = 66.77 -> arredonda 67,
    // um numero diferente e sem relacao com o calendario real do periodo.
    const entradas = [entrada({ data: '2026-07-01', peso_total: 1000, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-07-15', peso: 310, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, '2026-07')).toBe(69)
  })

  it('periodo "all" usa o intervalo real de datas do historico, nao 30 fixo', () => {
    // entrada em 2026-01-01, saida em 2026-03-31: intervalo real = 90 dias
    // (89 dias entre as datas + 1). giro = (1000-300)/(300/90) = 700/3.33 = 210.
    // Com o defeito antigo (fixo /30): (1000-300)/(300/30) = 70 — o bug
    // subestimava o giro em 3x conforme o historico crescia (o numerador
    // some pouco, o "/30" ficava cada vez mais errado quanto mais historico
    // acumulado existisse fora de uma janela recente real).
    const entradas = [entrada({ data: '2026-01-01', peso_total: 1000, perda_kg: 0 })]
    const saidas = [saida({ entrega: '2026-03-31', peso: 300, status: 'Entregue' })]
    expect(diasEstoque(entradas, saidas, 'all')).toBe(210)
  })

  it('nao soma historico de fora do periodo selecionado (isola por periodo, nao acumula tudo)', () => {
    // Tres meses de dado: abril, maio e junho. Selecionando so junho, o
    // resultado deve ser IDENTICO ao de calcular so com os dados de junho —
    // abril/maio (fora do periodo) nao podem influenciar o numero de junho.
    // Isso e exatamente o que o defeito antigo quebrava (ele somava tudo,
    // de todo o historico, independente do periodo pedido).
    const entradasTodas = [
      entrada({ id: 'e-abr', data: '2026-04-05', peso_total: 5000, perda_kg: 0 }),
      entrada({ id: 'e-mai', data: '2026-05-05', peso_total: 5000, perda_kg: 0 }),
      entrada({ id: 'e-jun', data: '2026-06-01', peso_total: 1000, perda_kg: 0 }),
    ]
    const saidasTodas = [
      saida({ id: 's-abr', entrega: '2026-04-20', peso: 2000, status: 'Entregue' }),
      saida({ id: 's-mai', entrega: '2026-05-20', peso: 2000, status: 'Entregue' }),
      saida({ id: 's-jun', entrega: '2026-06-10', peso: 300, status: 'Entregue' }),
    ]
    const soJunho = diasEstoque([entradasTodas[2]], [saidasTodas[2]], '2026-06')
    const comHistoricoExtra = diasEstoque(entradasTodas, saidasTodas, '2026-06')
    expect(comHistoricoExtra).toBe(soJunho)
    expect(comHistoricoExtra).toBe(70) // (1000-300)/(300/30)
  })
})

describe('calcularCicloCaixa — CCC padrao (subtrai pagamentoProdutor, defeito corrigido)', () => {
  it('estoque + recebimento - pagamentoProdutor, quando os tres sao calculaveis', () => {
    const entradas = [
      entrada({ data: '2026-05-01', data_pag: '2026-05-04', pago: 'Pago', peso_total: 1000, perda_kg: 0 }),
    ]
    const saidas = [
      saida({ entrega: '2026-05-30', data_pag: '2026-06-11', status: 'Entregue', peso: 300 }),
    ]
    const ciclo = calcularCicloCaixa(entradas, saidas, 'all')
    // pagamentoProdutor = 3 (entrada->pagamento). estoque = (1000-300)/(300/30)
    // = 70 (30 dias = intervalo real entre a entrada mais antiga e a saida
    // mais recente, periodo 'all'). recebimento = 12 (entrega->pagamento).
    expect(ciclo.pagamentoProdutor).toBe(3)
    expect(ciclo.estoque).toBe(70)
    expect(ciclo.recebimento).toBe(12)
    // DEFEITO 1 (corrigido): total = 70 + 12 - 3 = 79 (CCC padrao, subtrai o
    // prazo do produtor porque ele financia o caixa). A formula antiga
    // (fiel ao texto do To Do, "somar os tres") daria 70+12+3 = 85 — o
    // numero ERRADO que a versao anterior deste arquivo produzia.
    expect(ciclo.total).toBe(79)
  })

  it('total e null quando falta qualquer componente (nao assume zero)', () => {
    // sem nenhuma entrada paga -> pagamentoProdutor null -> total null,
    // mesmo com estoque e recebimento calculaveis
    const entradas = [entrada({ pago: 'Pendente', data_pag: null, peso_total: 1000, perda_kg: 0 })]
    const saidas = [
      saida({ entrega: '2026-06-01', data_pag: '2026-06-13', status: 'Entregue', peso: 300 }),
    ]
    const ciclo = calcularCicloCaixa(entradas, saidas, 'all')
    expect(ciclo.pagamentoProdutor).toBeNull()
    expect(ciclo.estoque).not.toBeNull()
    expect(ciclo.recebimento).not.toBeNull()
    expect(ciclo.total).toBeNull()
  })

  it('total e null quando nao ha dado nenhum (todos os tres null)', () => {
    const ciclo = calcularCicloCaixa([], [], 'all')
    expect(ciclo).toEqual({ pagamentoProdutor: null, estoque: null, recebimento: null, total: null })
  })
})

// ---- rastreabilidade da receita bruta (achado FI-1)

describe('saidasDaReceita / entregasNaReceita', () => {
  it('devolve exatamente as saidas que compoem a receita do periodo', () => {
    const saidas = [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-06-20', valor: 500 }),
      saida({ id: 's3', entrega: '2026-07-01', valor: 900 }),
      saida({ id: 's4', entrega: '2026-06-25', valor: 700, status: 'Em rota' }),
    ]
    expect(saidasDaReceita(saidas, '2026-06').map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('a contagem do resultado bate com a soma: mesma lista, um filtro so', () => {
    const saidas = [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-06-20', valor: 500 }),
      saida({ id: 's3', entrega: '2026-06-25', valor: 700, status: 'Cancelado' }),
    ]
    const r = calcularResultado(saidas, [], [], '2026-06')
    expect(r.receitaBruta).toBe(1500)
    expect(r.entregasNaReceita).toBe(2)
  })

  it('receitaBrutaPeriodo e a soma da MESMA lista — as duas nao podem divergir', () => {
    const saidas = [
      saida({ id: 's1', entrega: '2026-06-10', valor: 1000 }),
      saida({ id: 's2', entrega: '2026-05-10', valor: 400 }),
    ]
    for (const periodo of ['all', '2026-06', '2026-05', '2026-01']) {
      const daLista = saidasDaReceita(saidas, periodo)
      expect(receitaBrutaPeriodo(saidas, periodo)).toBe(daLista.reduce((s, x) => s + (x.valor || 0), 0))
      expect(calcularResultado(saidas, [], [], periodo).entregasNaReceita).toBe(daLista.length)
    }
  })

  it('periodo sem entrega: receita 0 e 0 pedidos — zero MEDIDO nos dois', () => {
    const r = calcularResultado([saida({ entrega: '2026-06-10' })], [], [], '2026-08')
    expect(r.receitaBruta).toBe(0)
    expect(r.entregasNaReceita).toBe(0)
  })

  it('sem saida nenhuma (lista vazia) tambem conta zero, sem quebrar', () => {
    expect(calcularResultado([], [], [], 'all').entregasNaReceita).toBe(0)
  })
})
