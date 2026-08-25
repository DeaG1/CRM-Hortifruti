import { describe, it, expect } from 'vitest'
import {
  situacaoExibidaSaida,
  valorSelecionavelPagamento,
  rotuloOpcaoPendente,
  valorEmAbertoCliente,
  avisoLimiteCredito,
  infoPagamento,
  type SaidaParaLimite,
} from './pagamento'

describe('situacaoExibidaSaida', () => {
  it('Pendente com vencimento no passado exibe Atrasado', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-08-01', '2026-08-23')).toBe('Atrasado')
  })

  it('Pendente com vencimento no futuro exibe Pendente', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-09-01', '2026-08-23')).toBe('Pendente')
  })

  it('Pendente com vencimento HOJE ainda nao esta atrasado (so apos o dia virar)', () => {
    expect(situacaoExibidaSaida('Pendente', '2026-08-23', '2026-08-23')).toBe('Pendente')
  })

  it('Pendente sem vencimento (null) exibe Pendente — nao ha data pra calcular atraso', () => {
    expect(situacaoExibidaSaida('Pendente', null, '2026-08-23')).toBe('Pendente')
  })

  it('Pendente sem vencimento (undefined) exibe Pendente', () => {
    expect(situacaoExibidaSaida('Pendente', undefined, '2026-08-23')).toBe('Pendente')
  })

  it('valor gravado Atrasado exibe Atrasado mesmo com vencimento no futuro (fidelidade ao dado legado)', () => {
    expect(situacaoExibidaSaida('Atrasado', '2027-01-01', '2026-08-23')).toBe('Atrasado')
  })

  it('valor gravado Atrasado exibe Atrasado mesmo sem vencimento nenhum', () => {
    expect(situacaoExibidaSaida('Atrasado', null, '2026-08-23')).toBe('Atrasado')
  })

  it('Pago exibe Pago, independente do vencimento', () => {
    expect(situacaoExibidaSaida('Pago', '2026-01-01', '2026-08-23')).toBe('Pago')
  })

  it('— (nao aplicavel) passa direto, sem calculo', () => {
    expect(situacaoExibidaSaida('—', '2026-01-01', '2026-08-23')).toBe('—')
  })
})

describe('valorSelecionavelPagamento', () => {
  it('Pago mapeia para Pago', () => {
    expect(valorSelecionavelPagamento('Pago')).toBe('Pago')
  })
  it('Pendente mapeia para Pendente', () => {
    expect(valorSelecionavelPagamento('Pendente')).toBe('Pendente')
  })
  it('Atrasado (calculado) mapeia para Pendente — e a mesma opcao "ainda nao pago"', () => {
    expect(valorSelecionavelPagamento('Atrasado')).toBe('Pendente')
  })
})

describe('rotuloOpcaoPendente', () => {
  it('situacao Atrasado troca o rotulo da opcao para "Atrasado"', () => {
    expect(rotuloOpcaoPendente('Atrasado')).toBe('Atrasado')
  })
  it('situacao Pendente mantem o rotulo "Pendente"', () => {
    expect(rotuloOpcaoPendente('Pendente')).toBe('Pendente')
  })
  it('situacao Pago nao afeta o rotulo da opcao Pendente (continua "Pendente")', () => {
    expect(rotuloOpcaoPendente('Pago')).toBe('Pendente')
  })
})

const HOJE = '2026-08-23'

function saida(parcial: Partial<SaidaParaLimite> & { id: string }): SaidaParaLimite {
  return { cliente_id: 'cli-1', pag: 'Pendente', venc: null, valor: 0, ...parcial }
}

describe('valorEmAbertoCliente', () => {
  it('soma saidas Pendente e Atrasado do cliente', () => {
    const saidas = [
      saida({ id: 's1', pag: 'Pendente', valor: 100 }),
      saida({ id: 's2', pag: 'Atrasado', valor: 50 }),
    ]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE)).toBe(150)
  })

  it('Pendente com vencimento vencido conta como em aberto (via situacaoExibidaSaida, nao o pag cru)', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', venc: '2026-01-01', valor: 80 })]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE)).toBe(80)
  })

  it('exclui saidas Pago da soma', () => {
    const saidas = [
      saida({ id: 's1', pag: 'Pago', valor: 100 }),
      saida({ id: 's2', pag: 'Pendente', valor: 30 }),
    ]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE)).toBe(30)
  })

  it('exclui saidas "—" (nao aplicavel — cancelada/devolvida) da soma', () => {
    const saidas = [
      saida({ id: 's1', pag: '—', valor: 500 }),
      saida({ id: 's2', pag: 'Pendente', valor: 20 }),
    ]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE)).toBe(20)
  })

  it('ignora saidas de outro cliente', () => {
    const saidas = [
      saida({ id: 's1', cliente_id: 'cli-1', pag: 'Pendente', valor: 100 }),
      saida({ id: 's2', cliente_id: 'cli-2', pag: 'Pendente', valor: 999 }),
    ]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE)).toBe(100)
  })

  it('ignorarId exclui uma saida especifica (caso de edicao)', () => {
    const saidas = [
      saida({ id: 's1', pag: 'Pendente', valor: 100 }),
      saida({ id: 's2', pag: 'Pendente', valor: 40 }),
    ]
    expect(valorEmAbertoCliente(saidas, 'cli-1', HOJE, 's1')).toBe(40)
  })

  it('sem saidas do cliente devolve 0', () => {
    expect(valorEmAbertoCliente([], 'cli-1', HOJE)).toBe(0)
  })
})

describe('avisoLimiteCredito', () => {
  it('sem limite cadastrado (0) nunca avisa, mesmo com saidas em aberto e venda grande', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', valor: 10000 })]
    expect(avisoLimiteCredito(0, saidas, 'cli-1', 5000, HOJE)).toBeNull()
  })

  it('sem limite cadastrado ("") nunca avisa', () => {
    expect(avisoLimiteCredito('', [], 'cli-1', 5000, HOJE)).toBeNull()
  })

  it('sem limite cadastrado (null/undefined) nunca avisa', () => {
    expect(avisoLimiteCredito(null, [], 'cli-1', 5000, HOJE)).toBeNull()
    expect(avisoLimiteCredito(undefined, [], 'cli-1', 5000, HOJE)).toBeNull()
  })

  it('dentro do limite nao avisa', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', valor: 40 })]
    // 40 em aberto + 30 desta venda = 70, limite 100 — nao estoura
    expect(avisoLimiteCredito(100, saidas, 'cli-1', 30, HOJE)).toBeNull()
  })

  it('estoura exatamente no limite (soma == limite) nao avisa', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', valor: 40 })]
    expect(avisoLimiteCredito(100, saidas, 'cli-1', 60, HOJE)).toBeNull()
  })

  it('estoura COM esta venda: avisa com os numeros corretos', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', valor: 80 })]
    const aviso = avisoLimiteCredito(100, saidas, 'cli-1', 30, HOJE)
    expect(aviso).toEqual({ limite: 100, emAberto: 80, estaVenda: 30, excedente: 10 })
  })

  it('cliente ja estourado ANTES desta venda avisa, mesmo com esta venda zerada', () => {
    const saidas = [saida({ id: 's1', pag: 'Pendente', valor: 150 })]
    const aviso = avisoLimiteCredito(100, saidas, 'cli-1', 0, HOJE)
    expect(aviso).toEqual({ limite: 100, emAberto: 150, estaVenda: 0, excedente: 50 })
  })

  it('edicao: ignorarId evita contar a propria saida em edicao duas vezes', () => {
    // saida sendo editada ja esta em `saidas` com o valor GRAVADO (60);
    // `estaVenda` traz o total ATUAL do formulario (100, ja editado).
    const saidas = [
      saida({ id: 'editando', pag: 'Pendente', valor: 60 }),
      saida({ id: 'outra', pag: 'Pendente', valor: 20 }),
    ]
    const aviso = avisoLimiteCredito(100, saidas, 'cli-1', 100, HOJE, 'editando')
    // emAberto so conta 'outra' (20) — 'editando' fica de fora porque seu
    // valor atualizado ja esta em estaVenda (100). 20 + 100 = 120, excedente 20.
    expect(aviso).toEqual({ limite: 100, emAberto: 20, estaVenda: 100, excedente: 20 })
  })
})

describe('infoPagamento — a sub-linha "forma · data" sob o chip', () => {
  it('pago com forma e data: "PIX · 10/06"', () => {
    expect(infoPagamento('Pago', 'PIX', '2026-06-10')).toBe('PIX · 10/06')
    expect(infoPagamento('Pago', 'Boleto', '2026-06-15')).toBe('Boleto · 15/06')
  })

  it('nao pago nao tem sub-linha nenhuma — nem travessao', () => {
    // Ausencia de forma/data num pedido pendente nao e dado faltando: e o
    // pagamento que ainda nao aconteceu, e o chip logo acima ja diz isso.
    expect(infoPagamento('Pendente', 'PIX', '2026-06-10')).toBeNull()
    expect(infoPagamento('Atrasado', 'PIX', '2026-06-10')).toBeNull()
    expect(infoPagamento('—', 'PIX', '2026-06-10')).toBeNull()
  })

  it('pago so com forma, sem data: mostra a forma sozinha, sem separador solto', () => {
    // O prototipo montava "PIX · " aqui (2517) — um separador no fim da
    // linha, resto de concatenacao, nao informacao.
    expect(infoPagamento('Pago', 'PIX', null)).toBe('PIX')
    expect(infoPagamento('Pago', 'PIX', '')).toBe('PIX')
  })

  it('pago so com data, sem forma: mostra a data sozinha', () => {
    expect(infoPagamento('Pago', '', '2026-06-10')).toBe('10/06')
    expect(infoPagamento('Pago', null, '2026-06-10')).toBe('10/06')
    expect(infoPagamento('Pago', '   ', '2026-06-10')).toBe('10/06')
  })

  it('pago sem forma nem data: null — nao ha o que dizer sobre o pagamento', () => {
    expect(infoPagamento('Pago', null, null)).toBeNull()
    expect(infoPagamento('Pago', '', '')).toBeNull()
  })

  it('data fora do formato nao vaza crua nem vira data inventada', () => {
    expect(infoPagamento('Pago', 'PIX', 'ontem')).toBe('PIX')
    expect(infoPagamento('Pago', null, 'ontem')).toBeNull()
  })

  it('data com hora (timestamp da API) usa so o dia', () => {
    expect(infoPagamento('Pago', 'PIX', '2026-06-10T00:00:00Z')).toBe('PIX · 10/06')
  })

  it('mes/dia de um digito saem com zero a esquerda', () => {
    expect(infoPagamento('Pago', 'PIX', '2026-6-1')).toBe('PIX · 01/06')
  })
})
