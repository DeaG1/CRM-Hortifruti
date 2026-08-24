import { describe, it, expect } from 'vitest'
import {
  noPeriodo,
  gerarCsv,
  derivarRelatorioClientes,
  derivarRelatorioInadimplentes,
  derivarRelatorioPedidos,
  derivarRelatorioCompras,
  derivarRelatorioProdutos,
  derivarRelatorioPerdas,
  derivarRelatorioLedger,
  perdaColetaEfetiva,
  type SaidaResumo,
  type EntradaResumo,
  type PerdaDeposito,
  type ProdutoAgregado,
} from './relatorios'
import type { Cliente } from './clientes'
import type { Fornecedor } from './fornecedores'
import type { Lancamento } from './lancamentos'

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: '1', nome: 'Mercado A', resp: 'Sônia', tel: '(41) 90000-0000', rota: 'Sul A', freq: '2x/sem',
  status: 'ativo', tend: '→', limite: 5000, prazo: 14, ...over,
})

const saida = (over: Partial<SaidaResumo> = {}): SaidaResumo => ({
  numero: '#1', cliente_id: '1', rota: 'Sul A', entrega: '2026-06-10',
  status: 'Entregue', pag: 'Pago', venc: null, data_pag: '2026-06-12',
  perda_kg: 0, valor: 1000, peso: 100, ...over,
})

const entrada = (over: Partial<EntradaResumo> = {}): EntradaResumo => ({
  numero: 'C-1', fornecedor_id: 'f1', data: '2026-06-08', perda_kg: 0, perda_itens_qtd: 0,
  motivo: 'transporte', pago: 'Pago', data_pag: '2026-06-10',
  valor_total: 4000, peso_total: 2000, ...over,
})

const fornecedor = (over: Partial<Fornecedor> = {}): Fornecedor => ({
  id: 'f1', nome: 'Fazenda Boa Terra', regiao: 'Norte do PR', contato: '(43) 90000-0000', ...over,
})

const lancamento = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-08', categoria: 'Frete', descricao: 'Coleta Norte',
  valor: 1280, funcionario_id: null, ...over,
})

const perda = (over: Partial<PerdaDeposito> = {}): PerdaDeposito => ({
  data: '2026-06-19', produto_id: 'p1', qtd: 4, motivo: 'vencimento', ...over,
})

const produtoAgregado = (over: Partial<ProdutoAgregado> = {}): ProdutoAgregado => ({
  produto_id: 'p1', nome: 'Batata', un: 'KG',
  compra_qtd: 0, compra_valor: 0, perda_coleta_qtd: 0,
  venda_qtd: 0, venda_valor: 0, perda_deposito_qtd: 0,
  ...over,
})

// ---------------------------------------------------------------- noPeriodo

describe('noPeriodo', () => {
  it('sem filtro (de/ate vazios), tudo passa — inclusive data ausente', () => {
    expect(noPeriodo('2026-06-10', '', '')).toBe(true)
    expect(noPeriodo(null, '', '')).toBe(true)
    expect(noPeriodo(undefined, '', '')).toBe(true)
  })

  it('respeita o limite inferior (de)', () => {
    expect(noPeriodo('2026-05-31', '2026-06', '')).toBe(false)
    expect(noPeriodo('2026-06-01', '2026-06', '')).toBe(true)
  })

  it('respeita o limite superior (ate)', () => {
    expect(noPeriodo('2026-07-01', '', '2026-06')).toBe(false)
    expect(noPeriodo('2026-06-30', '', '2026-06')).toBe(true)
  })

  it('data ausente fica fora quando ha filtro ativo', () => {
    expect(noPeriodo(null, '2026-06', '2026-06')).toBe(false)
  })

  it('intervalo cruzando anos', () => {
    expect(noPeriodo('2025-12-15', '2025-11', '2026-01')).toBe(true)
    expect(noPeriodo('2026-02-01', '2025-11', '2026-01')).toBe(false)
  })
})

// ------------------------------------------------------------------ gerarCsv

describe('gerarCsv', () => {
  it('usa ponto e virgula como separador (Excel pt-BR), nao virgula', () => {
    const csv = gerarCsv(['A', 'B'], [['1', '2']])
    expect(csv).toContain('A;B')
    expect(csv).toContain('1;2')
  })

  it('comeca com o BOM UTF-8, para o Excel abrir acentos corretamente', () => {
    const csv = gerarCsv(['Cabecalho'], [])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
  })

  it('usa quebra de linha CRLF entre as linhas', () => {
    const csv = gerarCsv(['A'], [['1'], ['2']])
    expect(csv).toContain('A\r\n1\r\n2')
  })

  it('escapa campo com ponto e virgula entre aspas', () => {
    const csv = gerarCsv(['Nome'], [['Mercado; Bom Preço']])
    expect(csv).toContain('"Mercado; Bom Preço"')
  })

  it('escapa aspas internas duplicando-as', () => {
    const csv = gerarCsv(['Obs'], [['Disse "tudo bem" ontem']])
    expect(csv).toContain('"Disse ""tudo bem"" ontem"')
  })

  it('escapa quebra de linha interna ao campo', () => {
    const csv = gerarCsv(['Obs'], [['linha1\nlinha2']])
    expect(csv).toContain('"linha1\nlinha2"')
  })

  it('campo sem caractere especial nao ganha aspas', () => {
    const csv = gerarCsv(['Nome'], [['Mercado Central']])
    expect(csv).not.toContain('"Mercado Central"')
    expect(csv).toContain('Mercado Central')
  })

  it('valor nulo/undefined vira campo vazio, nao a string "null"', () => {
    const csv = gerarCsv(['A', 'B'], [['x', null as unknown as string]])
    const linhas = csv.slice(1).split('\r\n')
    expect(linhas[1]).toBe('x;')
  })

  it('numeros entram como estao (a tela ja formata em pt-BR antes de montar a linha)', () => {
    const csv = gerarCsv(['Qtd'], [[1234]])
    expect(csv).toContain('1234')
  })
})

// -------------------------------------------------------- 1. relatório de clientes

describe('derivarRelatorioClientes', () => {
  it('agrega faturado, pedidos, participacao e inadimplencia por cliente', () => {
    const clientes = [cliente({ id: '1', nome: 'A' }), cliente({ id: '2', nome: 'B' })]
    const saidas = [
      saida({ cliente_id: '1', valor: 750, status: 'Entregue' }),
      saida({ cliente_id: '2', valor: 250, status: 'Entregue' }),
    ]
    const { linhas, totais } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    expect(linhas.find(l => l.nome === 'A')!.participacaoPct).toBe(75)
    expect(linhas.find(l => l.nome === 'B')!.participacaoPct).toBe(25)
    expect(totais.faturamentoPeriodo).toBe(1000)
  })

  it('ordena por faturado, do maior para o menor', () => {
    const clientes = [cliente({ id: '1', nome: 'Menor' }), cliente({ id: '2', nome: 'Maior' })]
    const saidas = [
      saida({ cliente_id: '1', valor: 100 }),
      saida({ cliente_id: '2', valor: 900 }),
    ]
    const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    expect(linhas.map(l => l.nome)).toEqual(['Maior', 'Menor'])
  })

  it('so conta pedidos Entregues no faturado; Cancelado nao entra', () => {
    const clientes = [cliente()]
    const saidas = [
      saida({ valor: 500, status: 'Entregue' }),
      saida({ valor: 9999, status: 'Cancelado' }),
    ]
    const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    expect(linhas[0].faturado).toBe(500)
  })

  it('inadimplencia por cliente e a fracao do faturado dele em atraso', () => {
    const clientes = [cliente()]
    const saidas = [
      saida({ valor: 1000, status: 'Entregue', pag: 'Pago' }),
      saida({ valor: 1000, status: 'Entregue', pag: 'Atrasado' }),
    ]
    const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    // faturado = 2000 (ambos Entregue); atrasado = 1000 => 50%
    expect(linhas[0].inadimplenciaPct).toBeCloseTo(50)
  })

  it('filtra por periodo (De/Ate) usando a data de entrega', () => {
    const clientes = [cliente()]
    const saidas = [
      saida({ entrega: '2026-06-10', valor: 1000 }),
      saida({ entrega: '2026-05-10', valor: 9999 }),
    ]
    const { linhas } = derivarRelatorioClientes(clientes, saidas, '2026-06', '2026-06', '2026-06-15')
    expect(linhas[0].faturado).toBe(1000)
  })

  it('ticket/entrega arredondado alimenta o health score (nao so a exibicao)', () => {
    // ticket = 149 (arredondado) -> health vermelho, mesmo com inadimplencia zero
    const clientes = [cliente({ status: 'ativo', tend: '→' })]
    const saidas = [saida({ valor: 149, status: 'Entregue', pag: 'Pago' })]
    const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    expect(linhas[0].ticketEntrega).toBe(149)
    expect(linhas[0].health).toBe('red')
  })

  it('cliente inadimplente cadastrado e sempre vermelho, mesmo sem pedido no periodo', () => {
    const clientes = [cliente({ status: 'inadimplente' })]
    const { linhas } = derivarRelatorioClientes(clientes, [], '', '', '2026-06-15')
    expect(linhas[0].health).toBe('red')
    expect(linhas[0].faturado).toBe(0)
  })

  it('clientes ativos conta do cadastro inteiro, nao so quem faturou no periodo', () => {
    const clientes = [
      cliente({ id: '1', status: 'ativo' }),
      cliente({ id: '2', status: 'inativo' }),
    ]
    const { totais } = derivarRelatorioClientes(clientes, [], '', '', '2026-06-15')
    expect(totais.clientesAtivos).toBe(1)
    expect(totais.clientesTotal).toBe(2)
  })

  it('ticket medio/cliente e a receita dividida pelos clientes distintos atendidos', () => {
    const clientes = [cliente({ id: '1' }), cliente({ id: '2', nome: 'B' })]
    const saidas = [
      saida({ cliente_id: '1', valor: 600, status: 'Entregue' }),
      saida({ cliente_id: '1', valor: 400, status: 'Entregue' }), // mesmo cliente, 2 entregas
      saida({ cliente_id: '2', valor: 1000, status: 'Entregue' }),
    ]
    const { totais } = derivarRelatorioClientes(clientes, saidas, '', '', '2026-06-15')
    // receita 2000, 2 clientes distintos atendidos => 1000
    expect(totais.ticketMedioCliente).toBe(1000)
  })

  it('sem receita no periodo, inadimplencia media e ticket medio ficam zerados (sem dividir por zero)', () => {
    const { totais } = derivarRelatorioClientes([cliente()], [], '', '', '2026-06-15')
    expect(totais.inadimplenciaMediaPct).toBe(0)
    expect(totais.ticketMedioCliente).toBe(0)
  })

  // ---- quantidade incompleta (itens sem peso medio cadastrado) ----
  //
  // `peso` chega da API ja em kg, com cada item convertido pela unidade dele.
  // Item em unidade nao-KG cujo produto nao tem peso_medio nao e convertivel:
  // a API o deixa FORA do peso e conta quantos foram em `itens_sem_conversao`,
  // em vez de inventar fator 1. A contagem tem que chegar na linha da rota e
  // no total dos entregues, para a tela poder marcar a quantidade em vez de
  // exibi-la como numero fechado.

  it('sem itens fora da conversao, os contadores sao 0 (nada a sinalizar)', () => {
    const { porRota, totais } = derivarRelatorioPedidos([saida({ peso: 100 })], '', '', '2026-06-15')
    expect(porRota[0].itensSemConversao).toBe(0)
    expect(totais.itensSemConversao).toBe(0)
    expect(totais.qtdEntregueKg).toBe(100)
  })

  it('pedido com item sem peso medio: o contador chega na rota e no total entregue', () => {
    const saidas = [saida({ rota: 'Sul A', peso: 100, itens_sem_conversao: 2 })]
    const { porRota, totais } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(porRota[0].itensSemConversao).toBe(2)
    expect(totais.itensSemConversao).toBe(2)
    // A quantidade continua saindo — mas incompleta, e por isso a tela a marca.
    expect(totais.qtdEntregueKg).toBe(100)
  })

  it('soma o contador de varios pedidos da mesma rota', () => {
    const saidas = [
      saida({ rota: 'Sul A', itens_sem_conversao: 1 }),
      saida({ rota: 'Sul A', itens_sem_conversao: 3 }),
      saida({ rota: 'Sul A' }),
    ]
    const { porRota } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(porRota[0].itensSemConversao).toBe(4)
  })

  it('o contador e por rota: uma marcada nao contamina a outra', () => {
    const saidas = [
      saida({ rota: 'Sul A', itens_sem_conversao: 1 }),
      saida({ rota: 'Norte C' }),
    ]
    const { porRota } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(porRota.find(r => r.rota === 'Sul A')!.itensSemConversao).toBe(1)
    expect(porRota.find(r => r.rota === 'Norte C')!.itensSemConversao).toBe(0)
  })

  it('o total conta so os ENTREGUES — o mesmo conjunto de qtdEntregueKg', () => {
    const saidas = [
      saida({ status: 'Entregue', peso: 100, itens_sem_conversao: 1 }),
      saida({ status: 'Em rota', peso: 999, itens_sem_conversao: 5 }),
    ]
    const { porRota, totais } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(totais.qtdEntregueKg).toBe(100)
    expect(totais.itensSemConversao).toBe(1)
    // A tabela por rota descreve TODOS os pedidos do periodo, entao o contador
    // dela e o conjunto maior — cada numero qualificado pelo proprio conjunto.
    expect(porRota[0].itensSemConversao).toBe(6)
  })

  it('so conta itens de pedidos DENTRO do periodo', () => {
    const saidas = [
      saida({ entrega: '2026-06-10', itens_sem_conversao: 1 }),
      saida({ entrega: '2026-05-10', itens_sem_conversao: 5 }),
    ]
    const { totais } = derivarRelatorioPedidos(saidas, '2026-06', '2026-06', '2026-06-15')
    expect(totais.itensSemConversao).toBe(1)
  })

  // DEFEITO CORRIGIDO: a UI parou de gravar 'Atrasado' (SaidasLista/ModalSaida
  // so oferecem Pendente/Pago — ver derive/pagamento.ts); 'Atrasado' passou a
  // ser CALCULADO a partir de pag='Pendente' + venc vencido. Antes desta
  // correcao, a inadimplencia por cliente filtrava so o `pag` gravado e
  // caminhava pra zero conforme os registros antigos fossem substituidos por
  // vendas novas — mesmo com divida real se acumulando.
  describe('deriva "atrasado" via situacaoExibidaSaida (nao so o pag gravado)', () => {
    const HOJE = '2026-06-15'

    it('pendente com vencimento passado conta como atrasada', () => {
      const clientes = [cliente()]
      const saidas = [saida({ status: 'Entregue', pag: 'Pendente', venc: '2026-06-01', valor: 1000 })]
      const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', HOJE)
      expect(linhas[0].inadimplenciaPct).toBe(100)
    })

    it('pendente com vencimento futuro NAO conta', () => {
      const clientes = [cliente()]
      const saidas = [saida({ status: 'Entregue', pag: 'Pendente', venc: '2026-07-01', valor: 1000 })]
      const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', HOJE)
      expect(linhas[0].inadimplenciaPct).toBe(0)
    })

    it('pendente sem vencimento NAO conta (nao inventa data default)', () => {
      const clientes = [cliente()]
      const saidas = [saida({ status: 'Entregue', pag: 'Pendente', venc: null, valor: 1000 })]
      const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', HOJE)
      expect(linhas[0].inadimplenciaPct).toBe(0)
    })

    it('paga nunca conta, mesmo com vencimento passado', () => {
      const clientes = [cliente()]
      const saidas = [saida({ status: 'Entregue', pag: 'Pago', venc: '2026-01-01', valor: 1000 })]
      const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', HOJE)
      expect(linhas[0].inadimplenciaPct).toBe(0)
    })

    it('registro gravado como Atrasado (dado antigo) continua contando', () => {
      const clientes = [cliente()]
      const saidas = [saida({ status: 'Entregue', pag: 'Atrasado', venc: null, valor: 1000 })]
      const { linhas } = derivarRelatorioClientes(clientes, saidas, '', '', HOJE)
      expect(linhas[0].inadimplenciaPct).toBe(100)
    })
  })
})

// --------------------------------------------------- 2. lista de inadimplentes

describe('derivarRelatorioInadimplentes', () => {
  const clientes = [cliente({ id: '1', nome: 'Mercado A', resp: 'Sônia', tel: '(41) 90000-0000' })]

  it('agrega pedidos em atraso por cliente: contagem e valor', () => {
    const saidas = [
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 300, venc: '2026-06-01' }),
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 200, venc: '2026-06-10' }),
      saida({ cliente_id: '1', pag: 'Pago', valor: 1000 }),
    ]
    const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', '2026-06-15')
    expect(linhas).toHaveLength(1)
    expect(linhas[0].pedidosAtraso).toBe(2)
    expect(linhas[0].valorAtraso).toBe(500)
  })

  it('vencimento mais antigo e o menor entre os pedidos em atraso', () => {
    const saidas = [
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, venc: '2026-06-20' }),
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, venc: '2026-06-05' }),
    ]
    const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', '2026-06-25')
    expect(linhas[0].vencimentoMaisAntigo).toBe('2026-06-05')
  })

  it('dias de atraso conta a partir do vencimento mais antigo ate hoje', () => {
    const saidas = [saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, venc: '2026-06-01' })]
    const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', '2026-06-11')
    expect(linhas[0].diasAtraso).toBe(10)
  })

  it('sem venc, usa a data de entrega como referencia', () => {
    const saidas = [saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, venc: null, entrega: '2026-06-01' })]
    const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', '2026-06-11')
    expect(linhas[0].vencimentoMaisAntigo).toBe('2026-06-01')
    expect(linhas[0].diasAtraso).toBe(10)
  })

  it('pct do faturamento dele: fracao do faturado do cliente que esta em atraso', () => {
    const saidas = [
      saida({ cliente_id: '1', status: 'Entregue', pag: 'Pago', valor: 800 }),
      saida({ cliente_id: '1', status: 'Entregue', pag: 'Atrasado', valor: 200, venc: '2026-06-01' }),
    ]
    const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', '2026-06-15')
    // faturado do cliente = 1000 (800+200, ambos Entregue); atrasado = 200 => 20%
    expect(linhas[0].pctDoFaturamentoDele).toBe(20)
  })

  it('sem clientes em atraso, lista fica vazia e maior devedor null', () => {
    const { linhas, totais } = derivarRelatorioInadimplentes(clientes, [saida({ pag: 'Pago' })], '', '', '2026-06-15')
    expect(linhas).toHaveLength(0)
    expect(totais.maiorDevedor).toBeNull()
  })

  it('ordena por valor em atraso, do maior devedor para o menor', () => {
    const doisClientes = [
      cliente({ id: '1', nome: 'Devedor Pequeno' }),
      cliente({ id: '2', nome: 'Devedor Grande' }),
    ]
    const saidas = [
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, venc: '2026-06-01' }),
      saida({ cliente_id: '2', pag: 'Atrasado', valor: 900, venc: '2026-06-01' }),
    ]
    const { linhas, totais } = derivarRelatorioInadimplentes(doisClientes, saidas, '', '', '2026-06-15')
    expect(linhas.map(l => l.cliente)).toEqual(['Devedor Grande', 'Devedor Pequeno'])
    expect(totais.maiorDevedor).toEqual({ cliente: 'Devedor Grande', valor: 900 })
  })

  it('filtra por periodo', () => {
    const saidas = [
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 100, entrega: '2026-05-01', venc: '2026-05-01' }),
      saida({ cliente_id: '1', pag: 'Atrasado', valor: 200, entrega: '2026-06-01', venc: '2026-06-01' }),
    ]
    const { totais } = derivarRelatorioInadimplentes(clientes, saidas, '2026-06', '2026-06', '2026-06-15')
    expect(totais.totalEmAtraso).toBe(200)
  })

  // DEFEITO CORRIGIDO: a UI parou de gravar 'Atrasado' (SaidasLista/ModalSaida
  // so oferecem Pendente/Pago — ver derive/pagamento.ts); 'Atrasado' passou a
  // ser CALCULADO a partir de pag='Pendente' + venc vencido. Antes desta
  // correcao, o relatorio de inadimplentes so agrupava `pag === 'Atrasado'`
  // cru e esvaziaria aos poucos conforme vendas antigas fossem substituidas
  // por vendas novas — o oposto do que uma lista de inadimplentes deveria
  // fazer conforme a divida cresce.
  describe('deriva "atrasado" via situacaoExibidaSaida (nao so o pag gravado)', () => {
    const HOJE = '2026-06-15'

    it('pendente com vencimento passado conta como atrasada', () => {
      const saidas = [saida({ cliente_id: '1', pag: 'Pendente', venc: '2026-06-01', valor: 500 })]
      const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', HOJE)
      expect(linhas).toHaveLength(1)
      expect(linhas[0].valorAtraso).toBe(500)
    })

    it('pendente com vencimento futuro NAO conta', () => {
      const saidas = [saida({ cliente_id: '1', pag: 'Pendente', venc: '2026-07-01', valor: 500 })]
      const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', HOJE)
      expect(linhas).toHaveLength(0)
    })

    it('pendente sem vencimento NAO conta (nao inventa data default)', () => {
      const saidas = [saida({ cliente_id: '1', pag: 'Pendente', venc: null, valor: 500 })]
      const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', HOJE)
      expect(linhas).toHaveLength(0)
    })

    it('paga nunca conta, mesmo com vencimento passado', () => {
      const saidas = [saida({ cliente_id: '1', pag: 'Pago', venc: '2026-01-01', valor: 500 })]
      const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', HOJE)
      expect(linhas).toHaveLength(0)
    })

    it('registro gravado como Atrasado (dado antigo) continua contando', () => {
      const saidas = [saida({ cliente_id: '1', pag: 'Atrasado', venc: null, valor: 500 })]
      const { linhas } = derivarRelatorioInadimplentes(clientes, saidas, '', '', HOJE)
      expect(linhas).toHaveLength(1)
      expect(linhas[0].valorAtraso).toBe(500)
    })
  })
})

// ------------------------------------------------------------ 3. relatório de pedidos

describe('derivarRelatorioPedidos', () => {
  it('totais: pedidos no periodo, faturado entregue, a receber e atrasados', () => {
    const saidas = [
      saida({ status: 'Entregue', pag: 'Pago', valor: 1000, peso: 100 }),
      saida({ status: 'Em rota', pag: 'Pendente', valor: 500, peso: 50 }),
      saida({ status: 'Entregue', pag: 'Atrasado', valor: 300, peso: 30 }),
    ]
    const { totais } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(totais.pedidosNoPeriodo).toBe(3)
    expect(totais.faturadoEntregue).toBe(1300) // so os Entregue: 1000+300
    expect(totais.aReceber).toBe(800) // Pendente + Atrasado: 500+300
    expect(totais.pedidosAtrasados).toBe(1)
    expect(totais.qtdEntregueKg).toBe(130)
  })

  it('por status: so entram status com pelo menos 1 pedido, ordem fixa', () => {
    const saidas = [
      saida({ status: 'Entregue', valor: 100 }),
      saida({ status: 'Cancelado', valor: 50 }),
    ]
    const { porStatus } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    expect(porStatus.map(s => s.status)).toEqual(['Entregue', 'Cancelado'])
    expect(porStatus.every(s => s.quantidade > 0)).toBe(true)
  })

  it('por rota: agrega pedidos, peso e faturado; ticket = faturado/pedidos', () => {
    const saidas = [
      saida({ rota: 'Sul A', valor: 1000, peso: 100 }),
      saida({ rota: 'Sul A', valor: 500, peso: 50 }),
      saida({ rota: 'Norte C', valor: 300, peso: 30 }),
    ]
    const { porRota } = derivarRelatorioPedidos(saidas, '', '', '2026-06-15')
    const sul = porRota.find(r => r.rota === 'Sul A')!
    expect(sul.pedidos).toBe(2)
    expect(sul.peso).toBe(150)
    expect(sul.faturado).toBe(1500)
    expect(sul.ticket).toBe(750)
  })

  it('rota ausente vira "—"', () => {
    const { porRota } = derivarRelatorioPedidos([saida({ rota: '' })], '', '', '2026-06-15')
    expect(porRota[0].rota).toBe('—')
  })

  it('filtra por periodo', () => {
    const saidas = [
      saida({ entrega: '2026-06-10', valor: 1000, status: 'Entregue' }),
      saida({ entrega: '2026-05-10', valor: 500, status: 'Entregue' }),
    ]
    const { totais } = derivarRelatorioPedidos(saidas, '2026-06', '2026-06', '2026-06-15')
    expect(totais.faturadoEntregue).toBe(1000)
  })

  // DEFEITO CORRIGIDO: a UI parou de gravar 'Atrasado' (SaidasLista/ModalSaida
  // so oferecem Pendente/Pago — ver derive/pagamento.ts); 'Atrasado' passou a
  // ser CALCULADO a partir de pag='Pendente' + venc vencido. `pedidosAtrasados`
  // contava so `pag === 'Atrasado'` cru e subcontaria pedidos 'Pendente' com
  // vencimento ja vencido.
  describe('pedidosAtrasados deriva "atrasado" via situacaoExibidaSaida (nao so o pag gravado)', () => {
    const HOJE = '2026-06-15'

    it('pendente com vencimento passado conta como atrasada', () => {
      const { totais } = derivarRelatorioPedidos([saida({ pag: 'Pendente', venc: '2026-06-01' })], '', '', HOJE)
      expect(totais.pedidosAtrasados).toBe(1)
    })

    it('pendente com vencimento futuro NAO conta', () => {
      const { totais } = derivarRelatorioPedidos([saida({ pag: 'Pendente', venc: '2026-07-01' })], '', '', HOJE)
      expect(totais.pedidosAtrasados).toBe(0)
    })

    it('pendente sem vencimento NAO conta (nao inventa data default)', () => {
      const { totais } = derivarRelatorioPedidos([saida({ pag: 'Pendente', venc: null })], '', '', HOJE)
      expect(totais.pedidosAtrasados).toBe(0)
    })

    it('paga nunca conta, mesmo com vencimento passado', () => {
      const { totais } = derivarRelatorioPedidos([saida({ pag: 'Pago', venc: '2026-01-01' })], '', '', HOJE)
      expect(totais.pedidosAtrasados).toBe(0)
    })

    it('registro gravado como Atrasado (dado antigo) continua contando', () => {
      const { totais } = derivarRelatorioPedidos([saida({ pag: 'Atrasado', venc: null })], '', '', HOJE)
      expect(totais.pedidosAtrasados).toBe(1)
    })
  })
})

// ---------------------------------------------------- perdaColetaEfetiva

describe('perdaColetaEfetiva', () => {
  it('cabecalho igual a soma dos itens: o maximo e o proprio valor (nao dobra)', () => {
    expect(perdaColetaEfetiva({ perda_kg: 140, perda_itens_qtd: 140 })).toBe(140)
  })

  it('cabecalho maior que a soma dos itens: usa o cabecalho', () => {
    expect(perdaColetaEfetiva({ perda_kg: 150, perda_itens_qtd: 140 })).toBe(150)
  })

  it('soma dos itens maior que o cabecalho (cabecalho=0, caso mais comum): usa a soma dos itens', () => {
    expect(perdaColetaEfetiva({ perda_kg: 0, perda_itens_qtd: 12 })).toBe(12)
  })

  it('os dois zerados: zero', () => {
    expect(perdaColetaEfetiva({ perda_kg: 0, perda_itens_qtd: 0 })).toBe(0)
  })
})

// ------------------------------------------------------------- 4. relatório de compras

describe('derivarRelatorioCompras', () => {
  const fornecedores = [fornecedor({ id: 'f1', nome: 'Fazenda Boa Terra' })]

  it('agrega coletas, qtd, valor e perda por fornecedor', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000, perda_kg: 50 }),
      entrada({ fornecedor_id: 'f1', peso_total: 500, valor_total: 1000, perda_kg: 25 }),
    ]
    const { linhas } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].coletas).toBe(2)
    expect(linhas[0].qtd).toBe(1500)
    expect(linhas[0].valor).toBe(3000)
    expect(linhas[0].precoMedio).toBe(2)
    expect(linhas[0].perdaPct).toBeCloseTo(5) // 75/1500*100
    expect(linhas[0].aproveitPct).toBeCloseTo(95)
  })

  it('dupla contagem: cabecalho e soma dos itens da MESMA entrada nao se somam (usa o maior)', () => {
    const entradas = [
      // cabecalho (perda_kg=140) == soma dos itens (perda_itens_qtd=140):
      // o mesmo evento de perda, duas granularidades — nao pode virar 280.
      entrada({ fornecedor_id: 'f1', peso_total: 1000, perda_kg: 140, perda_itens_qtd: 140 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(totais.perdaQtd).toBe(140)
  })

  it('cabecalho=0 mas itens somam perda (caso comum: so o item foi preenchido): conta pela soma dos itens', () => {
    // Sem isto, o relatorio de compras mostraria perda 0 pra uma entrada que
    // realmente perdeu 12kg na coleta (so nao foi detalhado no campo do
    // cabecalho) — o mesmo numero que a tela de Estoque ja mostra corretamente.
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, perda_kg: 0, perda_itens_qtd: 12 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(totais.perdaQtd).toBe(12)
  })

  it('cabecalho maior que a soma dos itens da entrada: usa o cabecalho, nao soma os dois', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, perda_kg: 150, perda_itens_qtd: 140 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(totais.perdaQtd).toBe(150)
  })

  it('a pagar soma so entradas nao pagas (pago !== "Pago")', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', valor_total: 1000, pago: 'Pago' }),
      entrada({ fornecedor_id: 'f1', valor_total: 500, pago: 'Pendente' }),
      entrada({ fornecedor_id: 'f1', valor_total: 300, pago: 'Atrasado' }),
    ]
    const { linhas, totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].aPagar).toBe(800)
    expect(totais.aPagarAoProdutor).toBe(800)
  })

  it('ordena por valor comprado, do maior para o menor', () => {
    const doisFornecedores = [
      fornecedor({ id: 'f1', nome: 'Pequeno' }),
      fornecedor({ id: 'f2', nome: 'Grande' }),
    ]
    const entradas = [
      entrada({ fornecedor_id: 'f1', valor_total: 100 }),
      entrada({ fornecedor_id: 'f2', valor_total: 900 }),
    ]
    const { linhas } = derivarRelatorioCompras(doisFornecedores, entradas, '', '')
    expect(linhas.map(l => l.fornecedor)).toEqual(['Grande', 'Pequeno'])
  })

  it('fornecedor sem cadastro (id nao encontrado) mostra travessao', () => {
    const entradas = [entrada({ fornecedor_id: 'inexistente' })]
    const { linhas } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].fornecedor).toBe('—')
  })

  it('totais: comprado, coletas, fornecedores no periodo vs cadastrados, perda na coleta', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000, perda_kg: 100 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(totais.totalComprado).toBe(2000)
    expect(totais.coletasNoPeriodo).toBe(1)
    expect(totais.fornecedoresNoPeriodo).toBe(1)
    expect(totais.fornecedoresCadastrados).toBe(1)
    expect(totais.perdaNaColetaPct).toBeCloseTo(10)
  })

  it('sem entradas no periodo, precoMedio e null (sem dividir por zero)', () => {
    const { linhas } = derivarRelatorioCompras(fornecedores, [], '', '')
    expect(linhas).toHaveLength(0)
  })

  it('filtra por periodo pela data da entrada', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', data: '2026-06-08', valor_total: 1000 }),
      entrada({ fornecedor_id: 'f1', data: '2026-05-08', valor_total: 500 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '2026-06', '2026-06')
    expect(totais.totalComprado).toBe(1000)
  })

  // ---- quantidade incompleta (itens sem peso medio cadastrado) ----
  //
  // `peso_total` chega da API ja em kg, com cada item convertido pela
  // unidade dele. Item em unidade nao-KG cujo produto nao tem peso_medio
  // nao e convertivel: a API o deixa FORA do peso e conta quantos foram em
  // `itens_sem_conversao`, em vez de inventar fator 1. Como o valor desses
  // itens continua inteiro em `valor_total`, o precoMedio (valor/qtd) sai
  // para cima — por isso a contagem tem que chegar ate a linha do
  // fornecedor, para a tela poder marcar a celula.

  it('sem itens fora da conversao, o contador e 0 (nada a sinalizar)', () => {
    const entradas = [entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000 })]
    const { linhas, totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].itensSemConversao).toBe(0)
    expect(totais.itensSemConversao).toBe(0)
    expect(linhas[0].precoMedio).toBe(2)
  })

  it('entrada com item sem peso medio: o contador chega na linha do fornecedor e no total', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000, itens_sem_conversao: 2 }),
    ]
    const { linhas, totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].itensSemConversao).toBe(2)
    expect(totais.itensSemConversao).toBe(2)
    // O preco medio continua saindo — mas sobre uma qtd incompleta, e por
    // isso a tela o marca em vez de exibi-lo limpo.
    expect(linhas[0].precoMedio).toBe(2)
  })

  it('soma o contador de varias entradas do mesmo fornecedor', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000, itens_sem_conversao: 1 }),
      entrada({ fornecedor_id: 'f1', peso_total: 500, valor_total: 1000, itens_sem_conversao: 3 }),
      entrada({ fornecedor_id: 'f1', peso_total: 500, valor_total: 1000 }),
    ]
    const { linhas, totais } = derivarRelatorioCompras(fornecedores, entradas, '', '')
    expect(linhas[0].itensSemConversao).toBe(4)
    expect(totais.itensSemConversao).toBe(4)
  })

  it('o contador e por fornecedor: um marcado nao contamina o outro', () => {
    const doisFornecedores = [
      fornecedor({ id: 'f1', nome: 'Com caixa sem peso' }),
      fornecedor({ id: 'f2', nome: 'So quilo' }),
    ]
    const entradas = [
      entrada({ fornecedor_id: 'f1', peso_total: 1000, valor_total: 2000, itens_sem_conversao: 1 }),
      entrada({ fornecedor_id: 'f2', peso_total: 1000, valor_total: 3000 }),
    ]
    const { linhas } = derivarRelatorioCompras(doisFornecedores, entradas, '', '')
    const f1 = linhas.find(l => l.fornecedorId === 'f1')!
    const f2 = linhas.find(l => l.fornecedorId === 'f2')!
    expect(f1.itensSemConversao).toBe(1)
    expect(f2.itensSemConversao).toBe(0)
  })

  it('so conta itens de entradas DENTRO do periodo', () => {
    const entradas = [
      entrada({ fornecedor_id: 'f1', data: '2026-06-08', itens_sem_conversao: 1 }),
      entrada({ fornecedor_id: 'f1', data: '2026-05-08', itens_sem_conversao: 5 }),
    ]
    const { totais } = derivarRelatorioCompras(fornecedores, entradas, '2026-06', '2026-06')
    expect(totais.itensSemConversao).toBe(1)
  })
})

// ------------------------------------------------------------ 5. ranking de produtos

describe('derivarRelatorioProdutos', () => {
  it('calcula preco medio de compra/venda, markup e margem em R$', () => {
    const agregados = [
      produtoAgregado({
        nome: 'Batata', compra_qtd: 100, compra_valor: 200, // cm = 2
        venda_qtd: 80, venda_valor: 320, // vm = 4
      }),
    ]
    const { linhas } = derivarRelatorioProdutos(agregados, 5)
    expect(linhas[0].markupPct).toBeCloseTo(100) // (4-2)/2*100
    expect(linhas[0].margem).toBeCloseTo(320 - 80 * 2) // vendaValor - vendaQtd*custoMedio = 160
  })

  it('markup e null sem preco de compra OU de venda no periodo', () => {
    const semCompra = produtoAgregado({ compra_qtd: 0, venda_qtd: 10, venda_valor: 100 })
    const semVenda = produtoAgregado({ compra_qtd: 10, compra_valor: 100, venda_qtd: 0 })
    expect(derivarRelatorioProdutos([semCompra], 1).linhas[0].markupPct).toBeNull()
    expect(derivarRelatorioProdutos([semVenda], 1).linhas[0].markupPct).toBeNull()
  })

  it('perda % soma perda de coleta e de deposito, sobre a quantidade comprada', () => {
    const agregados = [
      produtoAgregado({ compra_qtd: 100, perda_coleta_qtd: 5, perda_deposito_qtd: 5 }),
    ]
    const { linhas } = derivarRelatorioProdutos(agregados, 1)
    expect(linhas[0].perdaPct).toBeCloseTo(10)
  })

  it('perda % e null sem quantidade comprada (nao 0) — evita "0%" enganoso', () => {
    const agregados = [produtoAgregado({ compra_qtd: 0, perda_deposito_qtd: 3 })]
    const { linhas } = derivarRelatorioProdutos(agregados, 1)
    expect(linhas[0].perdaPct).toBeNull()
  })

  it('margem e sempre um numero (nunca null), mesmo sem venda no periodo', () => {
    const agregados = [produtoAgregado({ venda_qtd: 0, venda_valor: 0 })]
    const { linhas } = derivarRelatorioProdutos(agregados, 1)
    expect(linhas[0].margem).toBe(0)
  })

  it('ordena por faturamento (venda_valor), do maior para o menor', () => {
    const agregados = [
      produtoAgregado({ produto_id: 'p1', nome: 'Menor', venda_valor: 100 }),
      produtoAgregado({ produto_id: 'p2', nome: 'Maior', venda_valor: 900 }),
    ]
    const { linhas, totais } = derivarRelatorioProdutos(agregados, 2)
    expect(linhas.map(l => l.nome)).toEqual(['Maior', 'Menor'])
    expect(totais.maisFatura).toEqual({ nome: 'Maior', faturamento: 900 })
  })

  it('maior margem escolhe entre TODOS os produtos, sem filtrar os sem venda (fiel ao original)', () => {
    const agregados = [
      produtoAgregado({ produto_id: 'p1', nome: 'Com venda negativa', venda_qtd: 10, venda_valor: 10, compra_qtd: 10, compra_valor: 200 }), // margem = 10 - 10*20 = -190
      produtoAgregado({ produto_id: 'p2', nome: 'Sem venda', venda_qtd: 0, venda_valor: 0 }), // margem = 0, vence o negativo
    ]
    const { totais } = derivarRelatorioProdutos(agregados, 2)
    expect(totais.maiorMargem).toEqual({ nome: 'Sem venda', margem: 0 })
  })

  it('maior perda so considera produtos com perdaPct nao-nulo (com compra no periodo)', () => {
    const agregados = [
      produtoAgregado({ produto_id: 'p1', nome: 'Sem compra', compra_qtd: 0, perda_deposito_qtd: 999 }),
      produtoAgregado({ produto_id: 'p2', nome: 'Com compra', compra_qtd: 100, perda_coleta_qtd: 20 }),
    ]
    const { totais } = derivarRelatorioProdutos(agregados, 2)
    expect(totais.maiorPerda).toEqual({ nome: 'Com compra', perdaPct: 20 })
  })

  it('produtosMovimentados conta so os que tiveram alguma atividade; produtosCadastrados vem por fora', () => {
    const { totais } = derivarRelatorioProdutos([produtoAgregado()], 6)
    expect(totais.produtosMovimentados).toBe(1)
    expect(totais.produtosCadastrados).toBe(6)
  })

  it('sem nenhum produto movimentado, totais ficam null/zero sem quebrar', () => {
    const { linhas, totais } = derivarRelatorioProdutos([], 3)
    expect(linhas).toHaveLength(0)
    expect(totais.maisFatura).toBeNull()
    expect(totais.maiorMargem).toBeNull()
    expect(totais.maiorPerda).toBeNull()
  })

  // ---- quantidade incompleta (lancamentos sem peso medio cadastrado) ----
  //
  // As tres quantidades do agregado chegam da API em kg, com cada lancamento
  // convertido pela unidade dele. Lancamento em unidade nao-KG cujo produto
  // nao tem peso_medio nao e convertivel: a API o deixa FORA e conta quantos
  // foram em `itens_sem_conversao`. Como o valor em reais desses lancamentos
  // continua inteiro, a compra media (valor/qtd) sai para cima — por isso a
  // contagem tem que chegar na linha do produto, que e onde as duas telas
  // (Relatorios/aba Produtos e Produtos) marcam as celulas.

  it('sem lancamentos fora da conversao, o contador e 0 (nada a sinalizar)', () => {
    const agregados = [produtoAgregado({ compra_qtd: 100, compra_valor: 200 })]
    const { linhas, totais } = derivarRelatorioProdutos(agregados, 1)
    expect(linhas[0].itensSemConversao).toBe(0)
    expect(totais.itensSemConversao).toBe(0)
  })

  it('agregado com lancamento sem peso medio: o contador chega na linha e no total', () => {
    const agregados = [
      produtoAgregado({ compra_qtd: 100, compra_valor: 200, venda_qtd: 80, venda_valor: 320, itens_sem_conversao: 2 }),
    ]
    const { linhas, totais } = derivarRelatorioProdutos(agregados, 1)
    expect(linhas[0].itensSemConversao).toBe(2)
    expect(totais.itensSemConversao).toBe(2)
    // As metricas continuam saindo — mas sobre quantidade incompleta, e por
    // isso a tela as marca em vez de exibi-las limpas.
    expect(linhas[0].markupPct).toBeCloseTo(100)
  })

  it('o contador e por produto: um marcado nao contamina o outro', () => {
    const agregados = [
      produtoAgregado({ produto_id: 'p1', nome: 'Com caixa sem peso', venda_valor: 900, itens_sem_conversao: 3 }),
      produtoAgregado({ produto_id: 'p2', nome: 'So quilo', venda_valor: 100 }),
    ]
    const { linhas, totais } = derivarRelatorioProdutos(agregados, 2)
    expect(linhas.find(l => l.produtoId === 'p1')!.itensSemConversao).toBe(3)
    expect(linhas.find(l => l.produtoId === 'p2')!.itensSemConversao).toBe(0)
    // O total soma todas as linhas — e o que decide se a nota de rodape sai.
    expect(totais.itensSemConversao).toBe(3)
  })

  it('agregado sem o campo (fixture parcial) equivale a 0, nao a undefined', () => {
    const { linhas, totais } = derivarRelatorioProdutos([produtoAgregado()], 1)
    expect(linhas[0].itensSemConversao).toBe(0)
    expect(totais.itensSemConversao).toBe(0)
  })

  it('sem produto nenhum, o total e 0 (a nota nao aparece)', () => {
    expect(derivarRelatorioProdutos([], 3).totais.itensSemConversao).toBe(0)
  })
})

// ------------------------------------------------------------- 6. relatório de perdas

describe('derivarRelatorioPerdas', () => {
  it('agrega por motivo somando perda de coleta (cabecalho da entrada) e de deposito', () => {
    const entradas = [
      entrada({ motivo: 'transporte', perda_kg: 10 }),
      entrada({ motivo: 'transporte', perda_kg: 5 }),
    ]
    const perdas = [perda({ motivo: 'vencimento', qtd: 4 })]
    const { porMotivo, totais } = derivarRelatorioPerdas(entradas, perdas, [], '', '')
    const transporte = porMotivo.find(m => m.motivo === 'transporte')!
    expect(transporte.qtd).toBe(15)
    expect(transporte.ocorrencias).toBe(2)
    expect(totais.perdaTotalQtd).toBe(19)
  })

  it('dupla contagem: cabecalho e soma dos itens da MESMA entrada nao se somam (usa o maior)', () => {
    const entradas = [
      entrada({ motivo: 'transporte', perda_kg: 140, perda_itens_qtd: 140 }),
    ]
    const { porMotivo, totais } = derivarRelatorioPerdas(entradas, [], [], '', '')
    expect(porMotivo.find(m => m.motivo === 'transporte')!.qtd).toBe(140)
    expect(totais.perdaTotalQtd).toBe(140)
  })

  it('cabecalho=0 mas itens somam perda (caso comum: colaborador so preenche o item): conta pela soma dos itens', () => {
    const entradas = [
      entrada({ motivo: 'transporte', perda_kg: 0, perda_itens_qtd: 12 }),
    ]
    const { porMotivo, totais } = derivarRelatorioPerdas(entradas, [], [], '', '')
    const transporte = porMotivo.find(m => m.motivo === 'transporte')!
    expect(transporte.qtd).toBe(12)
    expect(transporte.ocorrencias).toBe(1) // perda > 0 mesmo com cabecalho zerado
    expect(totais.perdaTotalQtd).toBe(12)
  })

  it('motivo ausente ou "—" na entrada vira "não informado"', () => {
    const entradas = [entrada({ motivo: '', perda_kg: 3 })]
    const { porMotivo } = derivarRelatorioPerdas(entradas, [], [], '', '')
    expect(porMotivo[0].motivo).toBe('não informado')
  })

  it('entrada sem perda (perda_kg=0) aparece no motivo mas nao conta como ocorrencia', () => {
    // Fiel ao original: toda entrada do periodo cria/atualiza o agregado do
    // motivo dela (mesmo sem perda), só o contador de OCORRENCIAS exige
    // perda_kg>0 — motAgg[m].qtd+=... roda sempre, motAgg[m].ocor++ é condicional.
    const entradas = [entrada({ motivo: 'transporte', perda_kg: 0 })]
    const { porMotivo } = derivarRelatorioPerdas(entradas, [], [], '', '')
    expect(porMotivo).toHaveLength(1)
    expect(porMotivo[0].qtd).toBe(0)
    expect(porMotivo[0].ocorrencias).toBe(0)
  })

  it('pct de cada motivo e a fatia do total', () => {
    const entradas = [entrada({ motivo: 'transporte', perda_kg: 25 })]
    const perdas = [perda({ motivo: 'vencimento', qtd: 75 })]
    const { porMotivo } = derivarRelatorioPerdas(entradas, perdas, [], '', '')
    expect(porMotivo.find(m => m.motivo === 'transporte')!.pct).toBeCloseTo(25)
    expect(porMotivo.find(m => m.motivo === 'vencimento')!.pct).toBeCloseTo(75)
  })

  it('por produto reaproveita a view de produtos ja calculada, filtrando perdaPct null', () => {
    const produtosView = [
      { produtoId: 'p1', nome: 'Com perda', compradoQtd: 100, vendidoQtd: 10, faturamento: 10, itensSemConversao: 0, margem: 0, markupPct: null, perdaPct: 20 },
      { produtoId: 'p2', nome: 'Sem compra', compradoQtd: 0, vendidoQtd: 0, faturamento: 0, itensSemConversao: 0, margem: 0, markupPct: null, perdaPct: null },
    ]
    const { porProduto } = derivarRelatorioPerdas([], [], produtosView, '', '')
    expect(porProduto).toHaveLength(1)
    expect(porProduto[0].nome).toBe('Com perda')
  })

  it('indice de perda = perda total sobre o total comprado (peso_total das entradas)', () => {
    const entradas = [entrada({ peso_total: 1000, perda_kg: 50 })]
    const perdas = [perda({ qtd: 50 })]
    const { totais } = derivarRelatorioPerdas(entradas, perdas, [], '', '')
    expect(totais.indicePerdaPct).toBeCloseTo(10) // (50+50)/1000*100
  })

  it('filtra por periodo tanto entradas quanto perdas de deposito', () => {
    const entradas = [
      entrada({ data: '2026-06-01', motivo: 'transporte', perda_kg: 10 }),
      entrada({ data: '2026-05-01', motivo: 'transporte', perda_kg: 100 }),
    ]
    const perdas = [
      perda({ data: '2026-06-01', qtd: 5 }),
      perda({ data: '2026-05-01', qtd: 500 }),
    ]
    const { totais } = derivarRelatorioPerdas(entradas, perdas, [], '2026-06', '2026-06')
    expect(totais.perdaTotalQtd).toBe(15)
  })

  it('sem nenhuma perda, principal motivo fica null', () => {
    const { totais } = derivarRelatorioPerdas([], [], [], '', '')
    expect(totais.principalMotivo).toBeNull()
    expect(totais.perdaTotalQtd).toBe(0)
  })
})

// -------------------------------------------------------- 7. livro-caixa (lançamentos)

describe('derivarRelatorioLedger', () => {
  const clientes = [cliente({ id: '1', nome: 'Mercado A' })]
  const fornecedores = [fornecedor({ id: 'f1', nome: 'Fazenda Boa Terra' })]

  it('venda paga vira Entrada, com nome do cliente resolvido', () => {
    const saidas = [saida({ numero: '#2041', cliente_id: '1', pag: 'Pago', valor: 1000, data_pag: '2026-06-12' })]
    const { linhas } = derivarRelatorioLedger(saidas, [], [], clientes, fornecedores, '', '')
    expect(linhas).toHaveLength(1)
    expect(linhas[0].tipo).toBe('Entrada')
    expect(linhas[0].entrada).toBe(1000)
    expect(linhas[0].origem).toBe('Venda #2041 — Mercado A')
  })

  it('venda nao paga nao entra no livro-caixa', () => {
    const saidas = [saida({ pag: 'Pendente' })]
    const { linhas } = derivarRelatorioLedger(saidas, [], [], clientes, fornecedores, '', '')
    expect(linhas).toHaveLength(0)
  })

  it('compra paga vira Saida, com nome do fornecedor resolvido', () => {
    const entradas = [entrada({ numero: 'C-1040', fornecedor_id: 'f1', pago: 'Pago', valor_total: 4350 })]
    const { linhas } = derivarRelatorioLedger([], entradas, [], clientes, fornecedores, '', '')
    expect(linhas[0].tipo).toBe('Saída')
    expect(linhas[0].saida).toBe(4350)
    expect(linhas[0].origem).toBe('Compra C-1040 — Fazenda Boa Terra')
  })

  it('lancamento de custo sempre vira Saida (sem filtro de status de pagamento)', () => {
    const lancamentos = [lancamento({ categoria: 'Frete', descricao: 'Coleta Norte', valor: 1280 })]
    const { linhas } = derivarRelatorioLedger([], [], lancamentos, clientes, fornecedores, '', '')
    expect(linhas[0].tipo).toBe('Saída')
    expect(linhas[0].origem).toBe('Frete — Coleta Norte')
  })

  it('lancamento sem descricao nao deixa " — " pendurado na origem', () => {
    const lancamentos = [lancamento({ categoria: 'Gasolina', descricao: '' })]
    const { linhas } = derivarRelatorioLedger([], [], lancamentos, clientes, fornecedores, '', '')
    expect(linhas[0].origem).toBe('Gasolina')
  })

  it('ordena por data, mais recente primeiro', () => {
    const lancamentos = [
      lancamento({ id: 'l1', data: '2026-06-01', categoria: 'Frete' }),
      lancamento({ id: 'l2', data: '2026-06-20', categoria: 'Gasolina' }),
    ]
    const { linhas } = derivarRelatorioLedger([], [], lancamentos, clientes, fornecedores, '', '')
    expect(linhas.map(l => l.data)).toEqual(['2026-06-20', '2026-06-01'])
  })

  it('totais: entrou, saiu e saldo do periodo', () => {
    const saidas = [saida({ pag: 'Pago', valor: 1000 })]
    const entradas = [entrada({ pago: 'Pago', valor_total: 300 })]
    const lancamentos = [lancamento({ valor: 200 })]
    const { totais } = derivarRelatorioLedger(saidas, entradas, lancamentos, clientes, fornecedores, '', '')
    expect(totais.entrou).toBe(1000)
    expect(totais.saiu).toBe(500)
    expect(totais.saldo).toBe(500)
    expect(totais.movimentacoes).toBe(3)
  })

  it('filtra os tres tipos de movimentacao pelo mesmo periodo', () => {
    const saidas = [saida({ entrega: '2026-05-01', pag: 'Pago', valor: 999 })]
    const entradas = [entrada({ data: '2026-05-01', pago: 'Pago', valor_total: 999 })]
    const lancamentos = [lancamento({ data: '2026-05-01', valor: 999 })]
    const { linhas } = derivarRelatorioLedger(saidas, entradas, lancamentos, clientes, fornecedores, '2026-06', '2026-06')
    expect(linhas).toHaveLength(0)
  })
})
