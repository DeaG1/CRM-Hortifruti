import { describe, it, expect } from 'vitest'
import {
  montarRomaneio, resumoRomaneio, quantidadeRomaneio, dinheiroRomaneio,
  dataPorExtensoRomaneio, avisoSemDataEntrega, normalizarCampos, diaVizinho,
  CAMPOS_ROMANEIO, CAMPOS_ROMANEIO_PADRAO, SEM_CLIENTE,
  type CamposRomaneio, type LinhaRomaneio, type RespostaRomaneio,
} from './romaneio'

// ------------------------------------------------------------- fixtures

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

/** A escolha padrão, com os ajustes do teste — sempre um objeto novo, para
 * nenhum teste sujar o padrão congelado do módulo. */
function campos(over: Partial<CamposRomaneio> = {}): CamposRomaneio {
  return { ...CAMPOS_ROMANEIO_PADRAO, ...over }
}

// =========================================== a data que define o romaneio

describe('dataPorExtensoRomaneio — a data grande da folha', () => {
  it('sai com dia da semana, dia, mês e ano', () => {
    // 28/08/2026 é uma sexta-feira.
    expect(dataPorExtensoRomaneio('2026-08-28')).toBe('sexta-feira, 28/08/2026')
  })

  it('acerta o dia da semana ao longo de uma semana inteira', () => {
    const esperado = [
      ['2026-08-24', 'segunda-feira'], ['2026-08-25', 'terça-feira'],
      ['2026-08-26', 'quarta-feira'], ['2026-08-27', 'quinta-feira'],
      ['2026-08-28', 'sexta-feira'], ['2026-08-29', 'sábado'],
      ['2026-08-30', 'domingo'],
    ]
    for (const [iso, dia] of esperado) {
      expect(dataPorExtensoRomaneio(iso)).toBe(`${dia}, ${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`)
    }
  })

  it('o ano aparece — a folha vira papel e pode ser arquivada', () => {
    expect(dataPorExtensoRomaneio('2025-08-28')).toContain('/2025')
    expect(dataPorExtensoRomaneio('2026-08-28')).toContain('/2026')
    expect(dataPorExtensoRomaneio('2025-08-28')).not.toBe(dataPorExtensoRomaneio('2026-08-28'))
  })

  it('data ausente, vazia ou fora do formato vira null — nunca uma data inventada', () => {
    expect(dataPorExtensoRomaneio(null)).toBeNull()
    expect(dataPorExtensoRomaneio(undefined)).toBeNull()
    expect(dataPorExtensoRomaneio('')).toBeNull()
    expect(dataPorExtensoRomaneio('28/08/2026')).toBeNull()
  })

  it('data impossível (30/02, mês 13) vira null em vez de escorregar para outro dia', () => {
    expect(dataPorExtensoRomaneio('2026-02-30')).toBeNull()
    expect(dataPorExtensoRomaneio('2026-13-01')).toBeNull()
  })

  it('29/02 de ano bissexto é data válida', () => {
    expect(dataPorExtensoRomaneio('2028-02-29')).toBe('terça-feira, 29/02/2028')
    expect(dataPorExtensoRomaneio('2026-02-29')).toBeNull()
  })
})

describe('diaVizinho — percorrer o histórico sem digitar data', () => {
  it('anda um dia para trás e para a frente', () => {
    expect(diaVizinho('2026-08-28', -1)).toBe('2026-08-27')
    expect(diaVizinho('2026-08-28', 1)).toBe('2026-08-29')
  })

  it('atravessa fim de mês e virada de ano', () => {
    expect(diaVizinho('2026-09-01', -1)).toBe('2026-08-31')
    expect(diaVizinho('2026-08-31', 1)).toBe('2026-09-01')
    expect(diaVizinho('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('atravessa 29 de fevereiro em ano bissexto', () => {
    expect(diaVizinho('2028-02-28', 1)).toBe('2028-02-29')
    expect(diaVizinho('2028-03-01', -1)).toBe('2028-02-29')
    expect(diaVizinho('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('data inválida volta intacta — navegar a partir de lixo não inventa dia', () => {
    expect(diaVizinho('', -1)).toBe('')
    expect(diaVizinho('quinta', 1)).toBe('quinta')
    expect(diaVizinho(null, 1)).toBe('')
  })
})

// =========================== venda sem data de entrega: não some em silêncio

describe('avisoSemDataEntrega — a venda que não pertence a dia nenhum', () => {
  it('sem nenhuma, não diz nada (não se avisa sobre o que não aconteceu)', () => {
    expect(avisoSemDataEntrega({ total: 0, numeros: [] })).toBe('')
    expect(avisoSemDataEntrega(null)).toBe('')
    expect(avisoSemDataEntrega(undefined)).toBe('')
  })

  it('uma venda: diz quantas, que não sai em romaneio NENHUM, e onde corrigir', () => {
    const aviso = avisoSemDataEntrega({ total: 1, numeros: ['#1042'] })
    expect(aviso).toContain('1 venda')
    expect(aviso).toContain('#1042')
    expect(aviso).toContain('romaneio nenhum')
    expect(aviso).toContain('Saídas')
    expect(aviso).toContain('data de entrega')
  })

  it('várias vendas: plural e todos os números', () => {
    const aviso = avisoSemDataEntrega({ total: 3, numeros: ['#1', '#2', '#3'] })
    expect(aviso).toContain('3 vendas')
    expect(aviso).toContain('#1, #2, #3')
    expect(aviso).not.toContain('e mais')
  })

  it('com a lista truncada, o TOTAL continua exato e o resto é dito como "e mais N"', () => {
    const aviso = avisoSemDataEntrega({ total: 60, numeros: ['#1', '#2'] })
    expect(aviso).toContain('60 vendas')
    expect(aviso).toContain('e mais 58')
  })

  it('total sem números ainda avisa — o número do pedido é bônus, o alerta não é', () => {
    const aviso = avisoSemDataEntrega({ total: 2, numeros: [] })
    expect(aviso).toContain('2 vendas')
    expect(aviso).toContain('romaneio nenhum')
  })
})

// ================================================== formatação de número

describe('quantidadeRomaneio — na unidade lançada, com a unidade colada', () => {
  it('mostra a unidade em que o item foi lançado, não quilos convertidos', () => {
    expect(quantidadeRomaneio(45, 'UN')).toBe('45 UN')
    expect(quantidadeRomaneio(10, 'CX')).toBe('10 CX')
    expect(quantidadeRomaneio(30, 'KG')).toBe('30 KG')
    expect(quantidadeRomaneio(6, 'BDJA')).toBe('6 BDJA')
    expect(quantidadeRomaneio(12, 'MC')).toBe('12 MC')
  })

  it('o mesmo número em unidades diferentes produz textos diferentes', () => {
    expect(quantidadeRomaneio(10, 'CX')).not.toBe(quantidadeRomaneio(10, 'KG'))
  })

  it('casas decimais só quando existem', () => {
    expect(quantidadeRomaneio(45, 'UN')).toBe('45 UN')
    expect(quantidadeRomaneio(10.5, 'KG')).toBe('10,5 KG')
    expect(quantidadeRomaneio(1.25, 'KG')).toBe('1,25 KG')
  })

  it('zero medido continua zero — é medição, não ausência', () => {
    expect(quantidadeRomaneio(0, 'CX')).toBe('0 CX')
  })

  it('quantidade não finita vira travessão, nunca zero', () => {
    expect(quantidadeRomaneio(Number.NaN, 'UN')).toBe('—')
    expect(quantidadeRomaneio(Number.POSITIVE_INFINITY, 'UN')).toBe('—')
  })
})

describe('dinheiroRomaneio', () => {
  it('sempre duas casas', () => {
    expect(dinheiroRomaneio(12.5)).toBe('R$ 12,50')
    expect(dinheiroRomaneio(3)).toBe('R$ 3,00')
  })

  it('zero e negativo viram null — "ninguém preencheu" não é "vendido de graça"', () => {
    expect(dinheiroRomaneio(0)).toBeNull()
    expect(dinheiroRomaneio(-1)).toBeNull()
  })

  it('não finito vira null', () => {
    expect(dinheiroRomaneio(Number.NaN)).toBeNull()
  })
})

// ================================================== a escolha de campos

describe('normalizarCampos — a preferência gravada é território hostil', () => {
  it('objeto válido passa inteiro', () => {
    const c = normalizarCampos({ ...CAMPOS_ROMANEIO_PADRAO, precoUnitario: true })
    expect(c.precoUnitario).toBe(true)
    expect(c.endereco).toBe(true)
  })

  it('null, número, string e array caem no padrão', () => {
    for (const lixo of [null, 7, 'sim', ['endereco'], undefined]) {
      expect(normalizarCampos(lixo)).toEqual(CAMPOS_ROMANEIO_PADRAO)
    }
  })

  it('chave desconhecida é descartada', () => {
    const c = normalizarCampos({ cpfDoCliente: true }) as Record<string, unknown>
    expect(c.cpfDoCliente).toBeUndefined()
    expect(Object.keys(c).sort()).toEqual(CAMPOS_ROMANEIO.map(d => d.chave).sort())
  })

  it('campo faltando (preferência de uma versão anterior) entra com o padrão dele', () => {
    const c = normalizarCampos({ endereco: false })
    expect(c.endereco).toBe(false)
    expect(c.telefone).toBe(true)
    expect(c.precoUnitario).toBe(false)
  })

  it('valor não-booleano não LIGA campo nenhum — inclusive nenhum de preço', () => {
    const c = normalizarCampos({ precoUnitario: 'true', totalItem: 1, totalPedido: {} })
    expect(c.precoUnitario).toBe(false)
    expect(c.totalItem).toBe(false)
    expect(c.totalPedido).toBe(false)
  })

  it('só um true BOOLEANO liga preço — é a assimetria que impede vazamento por lixo', () => {
    expect(normalizarCampos({ precoUnitario: true }).precoUnitario).toBe(true)
  })
})

describe('CAMPOS_ROMANEIO — o padrão sensato', () => {
  it('os três campos de preço vêm DESMARCADOS', () => {
    for (const chave of ['precoUnitario', 'totalItem', 'totalPedido'] as const) {
      expect(CAMPOS_ROMANEIO_PADRAO[chave]).toBe(false)
    }
  })

  it('o que ajuda a entregar vem marcado', () => {
    for (const chave of ['endereco', 'telefone', 'rota', 'numero', 'obs'] as const) {
      expect(CAMPOS_ROMANEIO_PADRAO[chave]).toBe(true)
    }
  })

  it('todo campo oferecido tem rótulo, grupo e explicação', () => {
    for (const c of CAMPOS_ROMANEIO) {
      expect(c.rotulo.trim()).not.toBe('')
      expect(c.ajuda.trim()).not.toBe('')
      expect(['Cliente', 'Pedido', 'Preços']).toContain(c.grupo)
    }
  })
})

// ================================================== o agrupamento da folha

describe('montarRomaneio — agrupamento por cliente', () => {
  it('junta os itens de um cliente num bloco só, na ordem em que vieram', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', produto: 'Alface', un: 'UN', qtd: 45 }),
      linha({ item_id: 'i2', produto: 'Rúcula', un: 'MC', qtd: 30 }),
      linha({ item_id: 'i3', produto: 'Batata', un: 'KG', qtd: 12 }),
    ]), campos())

    expect(r.grupos).toHaveLength(1)
    expect(r.grupos[0].cliente).toBe('Mercado Boa Safra')
    expect(r.grupos[0].pedidos).toHaveLength(1)
    expect(r.grupos[0].pedidos[0].itens.map(i => i.produto)).toEqual(['Alface', 'Rúcula', 'Batata'])
    expect(r.grupos[0].totalItens).toBe(3)
  })

  it('dois pedidos do MESMO cliente ficam no mesmo bloco, identificados à parte', () => {
    const r = montarRomaneio(resposta([
      linha({ saida_id: 'p1', numero: '#1001', item_id: 'i1' }),
      linha({ saida_id: 'p2', numero: '#1002', item_id: 'i2', produto: 'Tomate' }),
    ]), campos())

    expect(r.grupos).toHaveLength(1)
    expect(r.grupos[0].pedidos.map(p => p.numero)).toEqual(['#1001', '#1002'])
    expect(r.totalPedidos).toBe(2)
    expect(r.totalClientes).toBe(1)
  })

  it('clientes diferentes viram blocos diferentes', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_id: 'c1', cliente_nome: 'Boa Safra', rota: 'Sul A' }),
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Hortifruti Zé', rota: 'Sul A' }),
    ]), campos())

    expect(r.grupos.map(g => g.cliente)).toEqual(['Boa Safra', 'Hortifruti Zé'])
    expect(r.totalClientes).toBe(2)
  })

  it('a ordem dos blocos é a do caminhão: por rota, depois por nome', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_id: 'c1', cliente_nome: 'Zeta', rota: 'Norte' }),
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Alfa', rota: 'Sul' }),
      linha({ saida_id: 'p3', item_id: 'i3', cliente_id: 'c3', cliente_nome: 'Beta', rota: 'Norte' }),
    ]), campos())

    expect(r.grupos.map(g => `${g.rota}/${g.cliente}`))
      .toEqual(['Norte/Beta', 'Norte/Zeta', 'Sul/Alfa'])
  })

  it('a ordem NÃO muda quando o campo Rota é desmarcado — o caminhão é o mesmo', () => {
    const linhas = [
      linha({ cliente_id: 'c1', cliente_nome: 'Zeta', rota: 'Norte' }),
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Alfa', rota: 'Sul' }),
    ]
    const com = montarRomaneio(resposta(linhas), campos({ rota: true }))
    const sem = montarRomaneio(resposta(linhas), campos({ rota: false }))
    expect(sem.grupos.map(g => g.cliente)).toEqual(com.grupos.map(g => g.cliente))
    expect(sem.grupos[0].rota).toBeNull()
  })

  it('cliente sem rota vai para o fim — não se sabe onde encaixá-lo', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_id: 'c1', cliente_nome: 'Sem rota', rota: '', cliente_rota: '' }),
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Com rota', rota: 'Sul' }),
    ]), campos())
    expect(r.grupos.map(g => g.cliente)).toEqual(['Com rota', 'Sem rota'])
  })

  it('nome acentuado ordena como em português (Á antes de B)', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_id: 'c1', cliente_nome: 'Boa Safra', rota: 'Sul' }),
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: 'c2', cliente_nome: 'Ávila', rota: 'Sul' }),
    ]), campos())
    expect(r.grupos.map(g => g.cliente)).toEqual(['Ávila', 'Boa Safra'])
  })

  it('venda órfã (cadastro do cliente excluído) aparece nomeada, e por último', () => {
    const r = montarRomaneio(resposta([
      linha({ saida_id: 'p2', item_id: 'i2', cliente_id: null, cliente_nome: null, rota: 'Aaa' }),
      linha({ cliente_id: 'c1', cliente_nome: 'Boa Safra', rota: 'Zzz' }),
    ]), campos())
    expect(r.grupos.map(g => g.cliente)).toEqual(['Boa Safra', SEM_CLIENTE])
    expect(r.grupos[1].clienteId).toBeNull()
  })

  it('a rota do PEDIDO vence a do cadastro; sem as duas, nada é inventado', () => {
    const comPedido = montarRomaneio(resposta([
      linha({ rota: 'Rota do dia', cliente_rota: 'Rota do cadastro' }),
    ]), campos())
    expect(comPedido.grupos[0].rota).toBe('Rota do dia')

    const soCadastro = montarRomaneio(resposta([
      linha({ rota: '', cliente_rota: 'Rota do cadastro' }),
    ]), campos())
    expect(soCadastro.grupos[0].rota).toBe('Rota do cadastro')

    const nenhuma = montarRomaneio(resposta([linha({ rota: '', cliente_rota: '' })]), campos())
    expect(nenhuma.grupos[0].rota).toBeNull()
  })

  it('campo em branco no cadastro não vira linha vazia na folha', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_endereco: '', cliente_tel: '   ' }),
    ]), campos())
    expect(r.grupos[0].endereco).toBeNull()
    expect(r.grupos[0].telefone).toBeNull()
  })

  it('dia sem entrega nenhuma monta uma folha vazia, não um erro', () => {
    const r = montarRomaneio(resposta([]), campos())
    expect(r.grupos).toEqual([])
    expect(r.totalClientes).toBe(0)
    expect(r.totalPedidos).toBe(0)
    expect(r.totalItens).toBe(0)
    expect(r.dataPorExtenso).toBe('sexta-feira, 28/08/2026')
  })

  it('a data pedida atravessa a montagem intacta e por extenso', () => {
    const r = montarRomaneio(resposta([linha()], { data: '2026-08-24' }), campos())
    expect(r.data).toBe('2026-08-24')
    expect(r.dataPorExtenso).toBe('segunda-feira, 24/08/2026')
  })

  it('o aviso de vendas sem data viaja junto da folha', () => {
    const r = montarRomaneio(
      resposta([linha()], { sem_data_entrega: { total: 2, numeros: ['#9', '#8'] } }),
      campos(),
    )
    expect(r.avisoSemData).toContain('2 vendas')
    expect(r.avisoSemData).toContain('#9')
  })
})

describe('montarRomaneio — quantidade na unidade lançada', () => {
  it('cada item sai na unidade em que foi lançado, sem conversão para quilos', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', produto: 'Alface', un: 'UN', qtd: 45 }),
      linha({ item_id: 'i2', produto: 'Melancia', un: 'CX', qtd: 10 }),
      linha({ item_id: 'i3', produto: 'Batata', un: 'KG', qtd: 30 }),
    ]), campos())

    expect(r.grupos[0].pedidos[0].itens.map(i => i.quantidade))
      .toEqual(['45 UN', '10 CX', '30 KG'])
  })

  it('o caso real das 138 unidades: nada vira zero nem quilo', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', produto: 'Alface Hidro', un: 'UN', qtd: 45 }),
      linha({ item_id: 'i2', produto: 'Alface Roxa', un: 'UN', qtd: 45 }),
      linha({ item_id: 'i3', produto: 'Escarola', un: 'UN', qtd: 18 }),
      linha({ item_id: 'i4', produto: 'Rúcula', un: 'UN', qtd: 30 }),
    ]), campos())

    const qtds = r.grupos[0].pedidos[0].itens.map(i => i.quantidade)
    expect(qtds).toEqual(['45 UN', '45 UN', '18 UN', '30 UN'])
    expect(qtds.join(' ')).not.toContain('kg')
    expect(qtds.join(' ')).not.toContain('0 UN,')
  })
})

describe('montarRomaneio — a escolha de campos altera o que sai', () => {
  const linhas = [linha({ obs: 'Entregar pelos fundos', qtd: 10, preco: 4 })]

  it('com o padrão: endereço, telefone, rota, número e observação saem; preço não', () => {
    const r = montarRomaneio(resposta(linhas), campos())
    const g = r.grupos[0]
    expect(g.endereco).toBe('Rua das Flores, 120')
    expect(g.telefone).toBe('(43) 99999-1111')
    expect(g.rota).toBe('Sul A')
    expect(g.pedidos[0].numero).toBe('#1001')
    expect(g.pedidos[0].obs).toBe('Entregar pelos fundos')
    expect(g.pedidos[0].itens[0].precoUnitario).toBeNull()
    expect(g.pedidos[0].itens[0].total).toBeNull()
    expect(g.pedidos[0].total).toBeNull()
  })

  it('desmarcar endereço tira o endereço e deixa o resto', () => {
    const r = montarRomaneio(resposta(linhas), campos({ endereco: false }))
    expect(r.grupos[0].endereco).toBeNull()
    expect(r.grupos[0].telefone).toBe('(43) 99999-1111')
  })

  it('desmarcar telefone tira só o telefone', () => {
    const r = montarRomaneio(resposta(linhas), campos({ telefone: false }))
    expect(r.grupos[0].telefone).toBeNull()
    expect(r.grupos[0].endereco).toBe('Rua das Flores, 120')
  })

  it('desmarcar número e observação tira os dois do pedido', () => {
    const r = montarRomaneio(resposta(linhas), campos({ numero: false, obs: false }))
    expect(r.grupos[0].pedidos[0].numero).toBeNull()
    expect(r.grupos[0].pedidos[0].obs).toBeNull()
  })

  it('marcar preço unitário faz o preço aparecer', () => {
    const r = montarRomaneio(resposta(linhas), campos({ precoUnitario: true }))
    expect(r.grupos[0].pedidos[0].itens[0].precoUnitario).toBe('R$ 4,00')
    // e os outros dois campos de preço continuam independentes
    expect(r.grupos[0].pedidos[0].itens[0].total).toBeNull()
    expect(r.grupos[0].pedidos[0].total).toBeNull()
  })

  it('marcar total do item faz qtd × preço aparecer, sem o preço unitário', () => {
    const r = montarRomaneio(resposta(linhas), campos({ totalItem: true }))
    expect(r.grupos[0].pedidos[0].itens[0].total).toBe('R$ 40,00')
    expect(r.grupos[0].pedidos[0].itens[0].precoUnitario).toBeNull()
  })

  it('marcar total do pedido soma os itens daquele pedido', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', qtd: 10, preco: 4 }),
      linha({ item_id: 'i2', qtd: 2, preco: 5.5 }),
    ]), campos({ totalPedido: true }))
    expect(r.grupos[0].pedidos[0].total).toBe('R$ 51,00')
  })

  it('cada pedido soma o seu, nunca o do vizinho', () => {
    const r = montarRomaneio(resposta([
      linha({ saida_id: 'p1', item_id: 'i1', qtd: 10, preco: 4 }),
      linha({ saida_id: 'p2', numero: '#1002', item_id: 'i2', qtd: 1, preco: 7 }),
    ]), campos({ totalPedido: true }))
    expect(r.grupos[0].pedidos.map(p => p.total)).toEqual(['R$ 40,00', 'R$ 7,00'])
  })

  it('pedido em que nenhum item tem preço sai com travessão, nunca R$ 0,00', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', qtd: 10, preco: 0 }),
    ]), campos({ totalPedido: true, precoUnitario: true, totalItem: true }))
    expect(r.grupos[0].pedidos[0].total).toBeNull()
    expect(r.grupos[0].pedidos[0].itens[0].precoUnitario).toBeNull()
    expect(r.grupos[0].pedidos[0].itens[0].total).toBeNull()
  })

  it('item sem preço não derruba o total do pedido que tem outros itens com preço', () => {
    const r = montarRomaneio(resposta([
      linha({ item_id: 'i1', qtd: 10, preco: 0 }),
      linha({ item_id: 'i2', qtd: 2, preco: 5 }),
    ]), campos({ totalPedido: true }))
    expect(r.grupos[0].pedidos[0].total).toBe('R$ 10,00')
  })

  it('produto e quantidade saem sempre, com qualquer escolha de campos', () => {
    const tudoDesligado = Object.fromEntries(
      CAMPOS_ROMANEIO.map(c => [c.chave, false]),
    ) as CamposRomaneio
    const r = montarRomaneio(resposta([linha({ produto: 'Alface', un: 'UN', qtd: 45 })]), tudoDesligado)
    expect(r.grupos[0].cliente).toBe('Mercado Boa Safra')
    expect(r.grupos[0].pedidos[0].itens[0].produto).toBe('Alface')
    expect(r.grupos[0].pedidos[0].itens[0].quantidade).toBe('45 UN')
  })

  it('a escolha em vigor viaja na folha, para as colunas virem da mesma fonte', () => {
    const escolha = campos({ precoUnitario: true })
    expect(montarRomaneio(resposta([linha()]), escolha).campos).toEqual(escolha)
  })
})

describe('resumoRomaneio — a conferência de topo', () => {
  it('conta clientes, pedidos e itens', () => {
    const r = montarRomaneio(resposta([
      linha({ cliente_id: 'c1', saida_id: 'p1', item_id: 'i1' }),
      linha({ cliente_id: 'c1', saida_id: 'p1', item_id: 'i2' }),
      linha({ cliente_id: 'c2', cliente_nome: 'Outro', saida_id: 'p2', item_id: 'i3' }),
    ]), campos())
    expect(resumoRomaneio(r)).toBe('2 clientes · 2 pedidos · 3 itens')
  })

  it('singular escrito por extenso, sem "(s)"', () => {
    const r = montarRomaneio(resposta([linha()]), campos())
    expect(resumoRomaneio(r)).toBe('1 cliente · 1 pedido · 1 item')
  })
})
