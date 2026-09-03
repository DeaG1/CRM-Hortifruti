import { describe, it, expect } from 'vitest'
import {
  montarFolhaEntrega, pedidosDoDia, rotuloDoPedido, resumoFolhaEntrega,
  pagamentoDaEntrega, corpoQueCabe, proximoPlano, avisoDeLegibilidade,
  escalaDoCorpo, alturaUtilPx, larguraUtilPx,
  CORPO_CONFORTAVEL, CORPO_ILEGIVEL, CORPO_MINIMO, PASSO_CORPO,
  PLANO_INICIAL, SEM_CLIENTE_ENTREGA,
  type PlanoDaFolha,
} from './folhaEntrega'
import type { LinhaRomaneio, RespostaRomaneio } from './romaneio'

// ------------------------------------------------------------- fixtures

const HOJE = '2026-08-28'

function linha(over: Partial<LinhaRomaneio> = {}): LinhaRomaneio {
  return {
    saida_id: 'p1',
    numero: '#1001',
    status: 'Pendente',
    obs: '',
    rota: 'Sul A',
    cliente_id: 'c1',
    cliente_nome: 'Mercado Boa Safra',
    cliente_endereco: 'Rua das Flores, 120',
    cliente_tel: '(43) 99999-1111',
    cliente_rota: 'Sul A',
    item_id: 'i1',
    produto: 'Alface Hidropônica',
    un: 'UN',
    qtd: 45,
    preco: 2.5,
    pag: 'Pendente',
    venc: null,
    forma_pag: '',
    ...over,
  }
}

function resposta(itens: LinhaRomaneio[], over: Partial<RespostaRomaneio> = {}): RespostaRomaneio {
  return {
    data: '2026-08-28',
    itens,
    sem_data_entrega: { total: 0, numeros: [] },
    ...over,
  }
}

// ================================================== o topo e o cadastro

describe('montarFolhaEntrega — o topo da folha', () => {
  it('traz o cliente, o endereço, o telefone, o número e a data da entrega', () => {
    const folha = montarFolhaEntrega(resposta([linha()]), 'p1', HOJE)!
    expect(folha.cliente).toBe('Mercado Boa Safra')
    expect(folha.endereco).toBe('Rua das Flores, 120')
    expect(folha.telefone).toBe('(43) 99999-1111')
    expect(folha.numero).toBe('#1001')
    expect(folha.dataEntrega).toBe('2026-08-28')
    expect(folha.dataPorExtenso).toBe('sexta-feira, 28/08/2026')
  })

  it('campo em branco no cadastro não vira linha na folha', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ cliente_endereco: '   ', cliente_tel: '' })]), 'p1', HOJE,
    )!
    expect(folha.endereco).toBeNull()
    expect(folha.telefone).toBeNull()
  })

  it('venda órfã (cadastro excluído) sai com nome, não some da folha', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ cliente_id: null, cliente_nome: null })]), 'p1', HOJE,
    )!
    expect(folha.cliente).toBe(SEM_CLIENTE_ENTREGA)
  })

  it('data impossível não vira uma data plausível na folha', () => {
    const folha = montarFolhaEntrega(
      resposta([linha()], { data: '2026-02-30' }), 'p1', HOJE,
    )!
    expect(folha.dataPorExtenso).toBeNull()
    expect(folha.dataEntrega).toBe('2026-02-30')
  })

  it('o resumo do topo conta os itens e nomeia o pedido', () => {
    const um = montarFolhaEntrega(resposta([linha()]), 'p1', HOJE)!
    expect(resumoFolhaEntrega(um)).toBe('1 item · Pedido #1001')
    const dois = montarFolhaEntrega(
      resposta([linha(), linha({ item_id: 'i2' })]), 'p1', HOJE,
    )!
    expect(resumoFolhaEntrega(dois)).toBe('2 itens · Pedido #1001')
  })
})

// ================================================== UM pedido por folha

describe('montarFolhaEntrega — um pedido por folha', () => {
  it('traz só os itens DAQUELE pedido, mesmo com outros no mesmo dia', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ saida_id: 'p1', item_id: 'i1', produto: 'Alface' }),
      linha({ saida_id: 'p2', numero: '#1002', item_id: 'i2', produto: 'Rúcula' }),
      linha({ saida_id: 'p1', item_id: 'i3', produto: 'Tomate' }),
    ]), 'p1', HOJE)!
    expect(folha.itens.map(i => i.produto)).toEqual(['Alface', 'Tomate'])
    expect(folha.numero).toBe('#1001')
  })

  it('traz só os itens do OUTRO pedido quando é ele o escolhido', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ saida_id: 'p1', item_id: 'i1', produto: 'Alface' }),
      linha({
        saida_id: 'p2', numero: '#1002', item_id: 'i2', produto: 'Rúcula',
        cliente_id: 'c2', cliente_nome: 'Hortifruti Zé',
      }),
    ]), 'p2', HOJE)!
    expect(folha.itens.map(i => i.produto)).toEqual(['Rúcula'])
    expect(folha.cliente).toBe('Hortifruti Zé')
  })

  it('PEDIDO SEM ITENS não vira folha: devolve null em vez de uma via em branco', () => {
    expect(montarFolhaEntrega(resposta([]), 'p1', HOJE)).toBeNull()
  })

  it('pedido que não está na resposta devolve null — é o caso do CANCELADO', () => {
    // A consulta (`GET /romaneio/:data`) já exclui 'Cancelado' e 'Devolvido',
    // então um pedido cancelado simplesmente não chega aqui. A folha não
    // existe para ele, e é essa a decisão: um recibo assinado de mercadoria
    // que ninguém entregou é o documento que sustenta a cobrança errada.
    expect(montarFolhaEntrega(resposta([linha()]), 'p-cancelado', HOJE)).toBeNull()
  })

  it('linha corrompida na resposta não derruba a montagem do pedido pedido', () => {
    const bruta = resposta([linha()])
    ;(bruta.itens as unknown[]).unshift(null)
    const folha = montarFolhaEntrega(bruta, 'p1', HOJE)!
    expect(folha.itens).toHaveLength(1)
  })

  it('resposta sem lista de itens não estoura', () => {
    expect(montarFolhaEntrega({ itens: null } as unknown as RespostaRomaneio, 'p1', HOJE))
      .toBeNull()
  })
})

// ================================================== os itens

describe('montarFolhaEntrega — os itens', () => {
  it('a quantidade sai NA UNIDADE LANÇADA, sem conversão para quilos', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ item_id: 'i1', un: 'UN', qtd: 45 }),
      linha({ item_id: 'i2', un: 'CX', qtd: 10 }),
      linha({ item_id: 'i3', un: 'KG', qtd: 30.5 }),
      linha({ item_id: 'i4', un: 'BDJA', qtd: 12 }),
      linha({ item_id: 'i5', un: 'MC', qtd: 6 }),
    ]), 'p1', HOJE)!
    expect(folha.itens.map(i => i.quantidade))
      .toEqual(['45 UN', '10 CX', '30,5 KG', '12 BDJA', '6 MC'])
  })

  it('preço unitário e total do item saem SEMPRE — é o que o cliente reconhece', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ qtd: 10, preco: 4 })]), 'p1', HOJE,
    )!
    expect(folha.itens[0].precoUnitario).toBe('R$ 4,00')
    expect(folha.itens[0].total).toBe('R$ 40,00')
  })

  it('item sem preço registrado sai com travessão, nunca "R$ 0,00"', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ qtd: 10, preco: 0 })]), 'p1', HOJE,
    )!
    expect(folha.itens[0].precoUnitario).toBeNull()
    expect(folha.itens[0].total).toBeNull()
  })

  it('produto sem nome vira travessão, e a linha continua na folha', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ produto: '  ' })]), 'p1', HOJE,
    )!
    expect(folha.itens[0].produto).toBe('—')
    expect(folha.totalItens).toBe(1)
  })

  it('a ordem dos itens é a que veio da API — a folha não reordena nada', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ item_id: 'i1', produto: 'Zimbro' }),
      linha({ item_id: 'i2', produto: 'Abacaxi' }),
      linha({ item_id: 'i3', produto: 'Manga' }),
    ]), 'p1', HOJE)!
    expect(folha.itens.map(i => i.produto)).toEqual(['Zimbro', 'Abacaxi', 'Manga'])
  })
})

// ================================================== o total

describe('montarFolhaEntrega — o total do pedido', () => {
  it('soma os itens', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ item_id: 'i1', qtd: 10, preco: 4 }),
      linha({ item_id: 'i2', qtd: 2, preco: 30 }),
    ]), 'p1', HOJE)!
    expect(folha.totalPedido).toBe('R$ 100,00')
  })

  it('item sem preço não derruba o total dos outros', () => {
    const folha = montarFolhaEntrega(resposta([
      linha({ item_id: 'i1', qtd: 10, preco: 4 }),
      linha({ item_id: 'i2', qtd: 5, preco: 0 }),
    ]), 'p1', HOJE)!
    expect(folha.totalPedido).toBe('R$ 40,00')
    expect(folha.itens[1].total).toBeNull()
  })

  it('pedido em que nenhum item tem preço sai com travessão, não com zero', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ preco: 0 })]), 'p1', HOJE,
    )!
    expect(folha.totalPedido).toBeNull()
  })
})

// ================================================== o pagamento

describe('pagamentoDaEntrega — o que o motorista lê na porta', () => {
  it('pendente com vencimento no futuro: recebe na entrega, e a folha diz quando vence', () => {
    const p = pagamentoDaEntrega('Pendente', '2026-09-07', 'Boleto', HOJE)
    expect(p.situacao).toBe('Pendente')
    expect(p.aviso).toBe('RECEBER NA ENTREGA')
    expect(p.detalhe).toBe('vence em 07/09/2026 · Boleto')
  })

  it('pendente com vencimento passado vira ATRASADO — calculado, não gravado', () => {
    const p = pagamentoDaEntrega('Pendente', '2026-08-01', 'Boleto', HOJE)
    expect(p.situacao).toBe('Atrasado')
    expect(p.detalhe).toBe('venceu em 01/08/2026 · Boleto')
    expect(p.aviso).toBe('RECEBER NA ENTREGA')
  })

  it('vencer HOJE ainda não é atraso', () => {
    expect(pagamentoDaEntrega('Pendente', HOJE, '', HOJE).situacao).toBe('Pendente')
  })

  it('pago não se cobra de novo, e a folha diz a forma', () => {
    const p = pagamentoDaEntrega('Pago', '2026-08-20', 'PIX', HOJE)
    expect(p.situacao).toBe('Pago')
    expect(p.aviso).toBe('JÁ PAGO — NÃO RECEBER NA ENTREGA')
    // Vencimento de coisa já paga não é informação: some.
    expect(p.detalhe).toBe('PIX')
  })

  it('atrasado GRAVADO continua atrasado, com fidelidade ao banco', () => {
    expect(pagamentoDaEntrega('Atrasado', null, '', HOJE).situacao).toBe('Atrasado')
  })

  it('sem vencimento e sem forma, o detalhe é vazio — não se inventa travessão', () => {
    const p = pagamentoDaEntrega('Pendente', null, '', HOJE)
    expect(p.detalhe).toBe('')
    expect(p.aviso).toBe('RECEBER NA ENTREGA')
  })

  it('"—" (não se aplica) nunca manda cobrar', () => {
    expect(pagamentoDaEntrega('—', null, '', HOJE).aviso).toBe('PAGAMENTO NÃO SE APLICA')
  })

  it('pag em branco é tratado como pendente, não como pago', () => {
    expect(pagamentoDaEntrega('', null, '', HOJE).aviso).toBe('RECEBER NA ENTREGA')
  })

  it('vencimento malformado não vaza para a folha', () => {
    expect(pagamentoDaEntrega('Pendente', '07/09/2026', '', HOJE).detalhe).toBe('')
  })

  it('a folha montada carrega o pagamento do cabeçalho do pedido', () => {
    const folha = montarFolhaEntrega(
      resposta([linha({ pag: 'Pago', venc: '2026-09-01', forma_pag: 'Dinheiro' })]),
      'p1', HOJE,
    )!
    expect(folha.pagamento.situacao).toBe('Pago')
    expect(folha.pagamento.detalhe).toBe('Dinheiro')
  })
})

// ================================================== o seletor de pedido

describe('pedidosDoDia — escolher de qual pedido é a folha', () => {
  it('um por pedido, com cliente e contagem de itens', () => {
    const ps = pedidosDoDia(resposta([
      linha({ saida_id: 'p1', numero: '#1001', item_id: 'i1' }),
      linha({ saida_id: 'p1', numero: '#1001', item_id: 'i2' }),
      linha({
        saida_id: 'p2', numero: '#1002', item_id: 'i3',
        cliente_id: 'c2', cliente_nome: 'Hortifruti Zé',
      }),
    ]))
    expect(ps).toHaveLength(2)
    expect(ps[0]).toEqual({
      id: 'p1', numero: '#1001', cliente: 'Mercado Boa Safra', totalItens: 2,
    })
    expect(ps[1].totalItens).toBe(1)
  })

  it('a ordem é a da API — por número de pedido, que é como se procura', () => {
    const ps = pedidosDoDia(resposta([
      linha({ saida_id: 'p1', numero: '#1001', item_id: 'i1' }),
      linha({ saida_id: 'p2', numero: '#1002', item_id: 'i2' }),
      linha({ saida_id: 'p3', numero: '#1003', item_id: 'i3' }),
    ]))
    expect(ps.map(p => p.numero)).toEqual(['#1001', '#1002', '#1003'])
  })

  it('dia sem entrega devolve lista vazia, não estoura', () => {
    expect(pedidosDoDia(resposta([]))).toEqual([])
    expect(pedidosDoDia(null)).toEqual([])
    expect(pedidosDoDia(undefined)).toEqual([])
  })

  it('o rótulo diz número, cliente e quantos itens', () => {
    const ps = pedidosDoDia(resposta([linha()]))
    expect(rotuloDoPedido(ps[0])).toBe('#1001 · Mercado Boa Safra (1 item)')
  })

  it('pedido sem número continua escolhível — some da folha seria pior', () => {
    const ps = pedidosDoDia(resposta([linha({ numero: '' })]))
    expect(ps[0].numero).toBe('sem número')
  })
})

// ================================================== UMA FOLHA SÓ

describe('corpoQueCabe — encolher só o necessário', () => {
  /** Um medidor sintético: altura proporcional ao corpo, com a parte fixa que
   * a medição real tem (bordas que não escalam). */
  const medidor = (porCorpo: number, fixo = 0) => (corpo: number) => fixo + porCorpo * corpo

  it('coube no tamanho confortável: não encolhe nada', () => {
    expect(corpoQueCabe(medidor(50), 1000)).toBe(CORPO_CONFORTAVEL)
  })

  it('coube EXATAMENTE na altura útil: ainda é o tamanho confortável', () => {
    expect(corpoQueCabe(medidor(50), 600)).toBe(CORPO_CONFORTAVEL)
  })

  it('não coube: desce até caber, e não mais que isso', () => {
    // 100px por unidade de corpo: 12 dá 1200, e a página tem 1000.
    const corpo = corpoQueCabe(medidor(100), 1000)
    expect(corpo).toBe(10)
  })

  it('o resultado sempre CABE de verdade, em vários volumes', () => {
    for (const porCorpo of [90, 100, 137, 200, 333, 1000]) {
      const corpo = corpoQueCabe(medidor(porCorpo, 40), 1000)
      expect(40 + porCorpo * corpo).toBeLessThanOrEqual(1000)
    }
  })

  it('o piso é o único limite, e ele é dito: abaixo dele a folha passa de uma página', () => {
    // Conteúdo que nem no menor corpo caberia. O algoritmo não inventa um
    // resultado: ele para no piso, e é isso que `CORPO_MINIMO` documenta.
    const corpo = corpoQueCabe(medidor(5000, 40), 1000)
    expect(corpo).toBe(CORPO_MINIMO)
    expect(40 + 5000 * corpo).toBeGreaterThan(1000)
  })

  it('desce no passo de meio pixel, nunca num valor quebrado', () => {
    for (const porCorpo of [90, 137, 333, 777]) {
      const corpo = corpoQueCabe(medidor(porCorpo), 1000)
      expect((corpo / PASSO_CORPO) % 1).toBe(0)
    }
  })

  it('a parte que NÃO escala (bordas) não faz a busca parar cedo demais', () => {
    // Com 500px fixos, a estimativa linear ingênua erraria para cima; o laço
    // mede de novo e desce até caber de verdade.
    const corpo = corpoQueCabe(medidor(100, 500), 1000)
    expect(500 + 100 * corpo).toBeLessThanOrEqual(1000)
    expect(corpo).toBeGreaterThan(0)
  })

  it('volume absurdo desce até o piso, e o piso é o piso', () => {
    const corpo = corpoQueCabe(() => 1e9, 1000)
    expect(corpo).toBe(CORPO_MINIMO)
  })

  it('ALTURA ZERO não é "cabe": ambiente sem layout não encolhe a folha', () => {
    expect(corpoQueCabe(() => 0, 1000)).toBe(CORPO_CONFORTAVEL)
    expect(corpoQueCabe(() => NaN, 1000)).toBe(CORPO_CONFORTAVEL)
  })

  it('altura útil inválida também não encolhe nada', () => {
    expect(corpoQueCabe(medidor(100), 0)).toBe(CORPO_CONFORTAVEL)
    expect(corpoQueCabe(medidor(100), NaN)).toBe(CORPO_CONFORTAVEL)
  })

  it('medição que some no meio do caminho devolve o último corpo tentado', () => {
    let n = 0
    const corpo = corpoQueCabe(() => (n++ === 0 ? 2000 : 0), 1000)
    expect(corpo).toBeLessThan(CORPO_CONFORTAVEL)
  })
})

describe('a geometria da página', () => {
  it('a altura útil é a A4 retrato menos as margens, com folga', () => {
    // 297 − 10 (topo) − 12 (pé) = 275mm, menos 2mm de folga, em px de CSS.
    expect(alturaUtilPx()).toBeCloseTo(273 * (96 / 25.4), 5)
  })

  it('a largura útil é 190mm — 210 menos 10 de cada lado', () => {
    expect(larguraUtilPx()).toBeCloseTo(190 * (96 / 25.4), 5)
  })

  it('a escala é o corpo sobre o confortável — 1 quando não encolhe', () => {
    expect(escalaDoCorpo(CORPO_CONFORTAVEL)).toBe(1)
    expect(escalaDoCorpo(6)).toBe(0.5)
  })
})

// ================================================== o plano da folha

describe('proximoPlano — uma coluna, duas colunas, e só então a letra', () => {
  it('coube em uma coluna no tamanho confortável: fecha ali mesmo', () => {
    const p = proximoPlano(PLANO_INICIAL, 12)!
    expect(p.duasColunas).toBe(false)
    expect(p.corpo).toBe(12)
    expect(p.decidido).toBe(true)
    // e não muda mais
    expect(proximoPlano(p, 12)).toBeNull()
  })

  it('não coube em uma coluna: EXPERIMENTA DUAS antes de encolher a letra', () => {
    const p = proximoPlano(PLANO_INICIAL, 7)!
    expect(p.duasColunas).toBe(true)
    // volta ao tamanho confortável para a segunda medição ser honesta
    expect(p.corpo).toBe(CORPO_CONFORTAVEL)
    expect(p.corpoUmaColuna).toBe(7)
    expect(p.decidido).toBe(false)
  })

  it('duas colunas melhoraram: fica com elas e com o corpo que elas alcançaram', () => {
    const tentativa = proximoPlano(PLANO_INICIAL, 7)!
    const fim = proximoPlano(tentativa, 11)!
    expect(fim.duasColunas).toBe(true)
    expect(fim.corpo).toBe(11)
    expect(fim.decidido).toBe(true)
    expect(proximoPlano(fim, 11)).toBeNull()
  })

  it('duas colunas PIORARAM (nome quebrando em três linhas): volta para uma', () => {
    const tentativa = proximoPlano(PLANO_INICIAL, 8)!
    const fim = proximoPlano(tentativa, 6)!
    expect(fim.duasColunas).toBe(false)
    expect(fim.corpo).toBe(8)
    expect(fim.decidido).toBe(true)
    // e não volta a experimentar duas colunas: o laço termina
    expect(proximoPlano(fim, 8)).toBeNull()
  })

  it('empate fica com duas colunas — mesma letra, metade da altura de sobra', () => {
    const tentativa = proximoPlano(PLANO_INICIAL, 8)!
    expect(proximoPlano(tentativa, 8)!.duasColunas).toBe(true)
  })

  it('depois de decidido, só o corpo acompanha (as fontes que chegaram depois)', () => {
    const decidido: PlanoDaFolha = {
      duasColunas: true, corpo: 11, corpoUmaColuna: 7, decidido: true,
    }
    const p = proximoPlano(decidido, 9)!
    expect(p.corpo).toBe(9)
    expect(p.duasColunas).toBe(true)
    expect(p.decidido).toBe(true)
  })

  it('o laço termina sempre: de qualquer plano, no máximo três passadas', () => {
    for (const uma of [12, 11, 8, 6, 3, 1]) {
      for (const duas of [12, 11, 8, 6, 3, 1]) {
        let plano = PLANO_INICIAL
        let voltas = 0
        const medidas = [uma, duas, duas]
        while (voltas < 10) {
          const proximo = proximoPlano(plano, medidas[Math.min(voltas, 2)])
          if (!proximo) break
          plano = proximo
          voltas++
        }
        expect(voltas).toBeLessThanOrEqual(3)
        expect(plano.decidido).toBe(true)
      }
    }
  })
})

// ================================================== o aviso ao dono

describe('avisoDeLegibilidade — o número que o dono precisa ter', () => {
  it('folha no tamanho confortável não avisa nada', () => {
    expect(avisoDeLegibilidade(CORPO_CONFORTAVEL, 20)).toBe('')
  })

  it('encolheu e continua legível: informa, sem alarme', () => {
    const aviso = avisoDeLegibilidade(9, 55)
    expect(aviso).toContain('55 itens')
    expect(aviso).toContain('12px')
    expect(aviso).toContain('9px')
    expect(aviso).not.toContain('deixa de ser conferível')
  })

  it('abaixo do piso de legibilidade, DIZ que a folha deixou de servir', () => {
    const aviso = avisoDeLegibilidade(5.5, 100)
    expect(aviso).toContain('100 itens')
    expect(aviso).toContain('5,5px')
    expect(aviso).toContain(`${CORPO_ILEGIVEL}px`)
    expect(aviso).toContain('deixa de ser conferível')
    // e continua obedecendo a instrução do dono
    expect(aviso).toContain('uma página só')
    expect(aviso).toContain('Dividir o pedido')
  })

  it('exatamente no piso ainda é legível — o aviso duro só vem abaixo dele', () => {
    expect(avisoDeLegibilidade(CORPO_ILEGIVEL, 90)).not.toContain('deixa de ser conferível')
    expect(avisoDeLegibilidade(CORPO_ILEGIVEL - PASSO_CORPO, 95))
      .toContain('deixa de ser conferível')
  })

  it('a vírgula decimal sai em português, não em inglês', () => {
    expect(avisoDeLegibilidade(8.5, 60)).toContain('8,5px')
  })

  it('um item só é dito no singular', () => {
    expect(avisoDeLegibilidade(9, 1)).toContain('1 item:')
  })
})
