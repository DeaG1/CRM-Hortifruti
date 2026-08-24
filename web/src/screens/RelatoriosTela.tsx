import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarRelatorioClientes, derivarRelatorioInadimplentes, derivarRelatorioPedidos,
  derivarRelatorioCompras, derivarRelatorioProdutos, derivarRelatorioPerdas, derivarRelatorioLedger,
  gerarCsv,
  type SaidaResumo, type EntradaResumo, type PerdaDeposito, type ProdutoAgregado,
} from '../derive/relatorios'
import type { Cliente, StatusCliente, Health } from '../derive/clientes'
import type { Fornecedor } from '../derive/fornecedores'
import type { Lancamento } from '../derive/lancamentos'
import type { Produto } from '../derive/produtos'
import './RelatoriosTela.css'

// Molde: ClientesLista.tsx (os quatro estados, `cancelado` no useEffect,
// ErroApi 401 -> onSessaoExpirada). O filtro de período (De/Até, input
// type="month") segue o padrão já estabelecido em LancamentosLista.tsx — o
// dropdown fixo do protótipo ('Todos'/'Junho 2026'/...) existia só porque a
// massa de dados dele é toda de um mês fixo (seed em 2026-06); aqui o
// intervalo é livre.

type Aba = 'clientes' | 'inadimplentes' | 'pedidos' | 'compras' | 'produtos' | 'perdas' | 'lancamentos'

const ABAS: { key: Aba; label: string }[] = [
  { key: 'clientes', label: 'Clientes' },
  { key: 'inadimplentes', label: 'Inadimplentes' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'compras', label: 'Compras' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'perdas', label: 'Perdas' },
  { key: 'lancamentos', label: 'Lançamentos' },
]

const NOME_RELATORIO: Record<Aba, string> = {
  clientes: 'Relatório de clientes',
  inadimplentes: 'Lista de inadimplentes',
  pedidos: 'Relatório de pedidos',
  compras: 'Relatório de compras',
  produtos: 'Ranking de produtos',
  perdas: 'Relatório de perdas',
  lancamentos: 'Relatório de lançamentos',
}

// ------------------------------------------------------------- cores/tokens

const GREEN = '#3f8f5b'
const AMBER = '#c79320'
const RED = '#c2502f'
const NEUTRO = '#9a9784'
const GBG = '#e7f1e8'
const ABG = '#f6efd8'
const RBG = '#f6e4dc'

const HEALTH_INFO: Record<Health, { cor: string; bg: string; label: string }> = {
  green: { cor: GREEN, bg: GBG, label: 'Saudável' },
  amber: { cor: AMBER, bg: ABG, label: 'Atenção' },
  red: { cor: RED, bg: RBG, label: 'Risco' },
}

const STATUS_CLIENTE_INFO: Record<StatusCliente, { label: string; cor: string }> = {
  ativo: { label: 'Ativo', cor: GREEN },
  negociacao: { label: 'Em negociação', cor: AMBER },
  inadimplente: { label: 'Inadimplente', cor: RED },
  inativo: { label: 'Inativo', cor: NEUTRO },
}

/** Cores por status de pedido — portadas de pStatusColor/pStatusBg do
 * protótipo (design/CRM Hortifruti.dc.html:2105-2106), específicas do
 * relatório "Pedidos por status". */
const STATUS_PEDIDO_INFO: Record<SaidaResumo['status'], { cor: string; bg: string }> = {
  Entregue: { cor: GREEN, bg: GBG },
  'Em rota': { cor: '#2f6fb0', bg: '#e3eef8' },
  Pendente: { cor: AMBER, bg: ABG },
  Devolvido: { cor: RED, bg: RBG },
  Cancelado: { cor: NEUTRO, bg: '#efece2' },
}

function corPerda(pct: number): string {
  return pct <= 10 ? GREEN : (pct <= 15 ? AMBER : RED)
}

function corInad(pct: number): string {
  return pct <= 1 ? GREEN : (pct <= 2 ? AMBER : RED)
}

function corDias(dias: number | null): string {
  if (dias == null) return NEUTRO
  return dias > 30 ? RED : (dias > 7 ? AMBER : GREEN)
}

function corMarkup(pct: number | null): string {
  return pct == null ? NEUTRO : (pct >= 60 ? GREEN : RED)
}

// -------------------------------------------------------------- formatação

/** 'R$ ' + valor arredondado, formatado em pt-BR — mesmo `fmtBR` do protótipo. */
const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
/** Mesmo `money`, mas mostra travessão quando o valor é zero (falso em JS) —
 * para campos onde "R$ 0" seria enganoso (nada aconteceu, não "aconteceu
 * zero"), igual ao protótipo (`x? 'R$ '+fmtBR(x) : '—'`). */
const moneyOuTraco = (n: number) => (n ? money(n) : '—')
/** Preço médio com 2 casas — só este campo usa toFixed(2) no protótipo
 * (`.toFixed(2).replace('.', ',')`), os demais valores em R$ usam fmtBR
 * (arredondado, sem decimais). */
const moneyDetalhado = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',')
const qtd = (n: number) => n.toLocaleString('pt-BR')
const pct1 = (n: number) => n.toFixed(1).replace('.', ',') + '%'
const pctInt = (n: number) => Math.round(n) + '%'

/** 'AAAA-MM-DD' -> 'DD/MM'. Travessão sem data válida — mesmo `_fmtDM` do protótipo. */
function dataBr(iso: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}` : '—'
}

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `_hojeIso()` do protótipo. Fica na tela (não em derive/relatorios.ts)
 * porque toca `new Date()`: a função pura recebe isso como parâmetro. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function rotuloMes(aaaaMm: string): string {
  const [ano, mes] = aaaaMm.split('-')
  return `${MESES[Number(mes) - 1] ?? mes}/${ano}`
}

function rotuloPeriodo(de: string, ate: string): string {
  if (!de && !ate) return 'todos os períodos'
  if (de && ate) return de === ate ? rotuloMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`
  if (de) return `a partir de ${rotuloMes(de)}`
  return `até ${rotuloMes(ate)}`
}

// -------------------------------------------------------- exportar / imprimir

function baixarCsv(nomeArquivo: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 200)
}

// ------------------------------------------------------------- cartão-resumo

function Cartao({ label, valor, sub }: { label: string; valor: string; sub: string }) {
  return (
    <div className="relatorios-cartao">
      <div className="relatorios-cartao-label">{label}</div>
      <div className="relatorios-cartao-valor">{valor}</div>
      <div className="relatorios-cartao-sub">{sub}</div>
    </div>
  )
}

function Cartoes({ itens }: { itens: { label: string; valor: string; sub: string }[] }) {
  return (
    <div className="relatorios-cartoes">
      {itens.map(c => <Cartao key={c.label} {...c} />)}
    </div>
  )
}

interface RelatoriosTelaProps {
  onSessaoExpirada: () => void
}

export function RelatoriosTela({ onSessaoExpirada }: RelatoriosTelaProps) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saidas, setSaidas] = useState<SaidaResumo[]>([])
  const [entradas, setEntradas] = useState<EntradaResumo[]>([])
  const [perdas, setPerdas] = useState<PerdaDeposito[]>([])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [produtosAgregados, setProdutosAgregados] = useState<ProdutoAgregado[]>([])
  const [carregandoProdutos, setCarregandoProdutos] = useState(true)
  const [erroProdutos, setErroProdutos] = useState('')

  const [aba, setAba] = useState<Aba>('clientes')
  const [de, setDe] = useState('') // AAAA-MM, vazio = sem limite inferior
  const [ate, setAte] = useState('') // AAAA-MM, vazio = sem limite superior

  // Carga principal: os seis relatórios que usam só cabeçalho (clientes,
  // saídas, entradas, perdas, lançamentos, fornecedores) + a lista de
  // produtos cadastrados (só para o total "N cadastrados" do card de
  // Produtos). Roda uma vez — o filtro de período é aplicado em memória
  // pelas funções de derive/relatorios.ts.
  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Cliente[]>('/api/clientes'),
      api.get<SaidaResumo[]>('/api/saidas'),
      api.get<EntradaResumo[]>('/api/entradas'),
      api.get<PerdaDeposito[]>('/api/perdas'),
      api.get<Lancamento[]>('/api/lancamentos'),
      api.get<Fornecedor[]>('/api/fornecedores'),
      api.get<Produto[]>('/api/produtos'),
    ])
      .then(([cs, ss, es, ps, ls, fs, prs]) => {
        if (cancelado) return
        setClientes(cs); setSaidas(ss); setEntradas(es); setPerdas(ps)
        setLancamentos(ls); setFornecedores(fs); setProdutos(prs)
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada(); return }
        setErro('Não foi possível carregar os relatórios.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Relatório de produtos (e a aba Perdas, que reaproveita esta mesma soma
  // para "perdas por produto") depende de um endpoint agregado em SQL — ver
  // api/src/routes/relatorios.ts para o porquê (GET /api/saidas e
  // GET /api/entradas não trazem os itens, e buscar item por item seria
  // N+1). Diferente da carga principal, este refaz a busca a cada troca de
  // período: o agregado já sai filtrado do servidor.
  useEffect(() => {
    let cancelado = false
    setCarregandoProdutos(true)
    setErroProdutos('')
    const query = new URLSearchParams()
    if (de) query.set('de', de)
    if (ate) query.set('ate', ate)
    const qs = query.toString()
    api.get<ProdutoAgregado[]>(`/api/relatorios/produtos${qs ? '?' + qs : ''}`)
      .then(rs => { if (!cancelado) setProdutosAgregados(rs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada(); return }
        setErroProdutos('Não foi possível carregar o relatório de produtos.')
      })
      .finally(() => { if (!cancelado) setCarregandoProdutos(false) })
    return () => { cancelado = true }
  }, [de, ate, onSessaoExpirada])

  if (carregando) return <p className="relatorios-estado">Carregando…</p>
  if (erro) return <p className="relatorios-estado relatorios-estado--erro" role="alert">{erro}</p>
  if (clientes.length === 0 && saidas.length === 0 && entradas.length === 0
    && lancamentos.length === 0 && perdas.length === 0) {
    return (
      <div className="estado-vazio relatorios-vazio">
        <div className="relatorios-vazio-titulo">Ainda não há dados para gerar relatórios.</div>
        <div className="relatorios-vazio-sub">
          Cadastre clientes e lance as primeiras vendas, compras e custos — os relatórios aparecem aqui
          automaticamente, sem nenhum passo extra.
        </div>
      </div>
    )
  }

  const hojeIso = hojeIsoLocal()
  const relClientes = derivarRelatorioClientes(clientes, saidas, de, ate)
  const relInad = derivarRelatorioInadimplentes(clientes, saidas, de, ate, hojeIso)
  const relPedidos = derivarRelatorioPedidos(saidas, de, ate)
  const relCompras = derivarRelatorioCompras(fornecedores, entradas, de, ate)
  const relProdutos = derivarRelatorioProdutos(produtosAgregados, produtos.length)
  const relPerdas = derivarRelatorioPerdas(entradas, perdas, relProdutos.linhas, de, ate)
  const relLedger = derivarRelatorioLedger(saidas, entradas, lancamentos, clientes, fornecedores, de, ate)

  const periodLabel = rotuloPeriodo(de, ate)

  function csvAtivo(): { header: string[]; rows: (string | number)[][] } {
    switch (aba) {
      case 'clientes':
        return {
          header: ['Cliente', 'Rota', 'Status', 'Pedidos', 'Faturado', 'Ticket/entrega', '% carteira', 'Inadimplência', 'Saúde'],
          rows: relClientes.linhas.map(l => [
            l.nome, l.rota, STATUS_CLIENTE_INFO[l.status].label, l.pedidos, money(l.faturado),
            moneyOuTraco(l.ticketEntrega), l.participacaoPct + '%', pct1(l.inadimplenciaPct), HEALTH_INFO[l.health].label,
          ]),
        }
      case 'pedidos':
        // Igual ao protótipo: o CSV de "Pedidos" exporta a tabela de
        // desempenho por rota, não o resumo de status.
        return {
          header: ['Rota', 'Pedidos', 'Qtd', 'Faturado', 'Ticket'],
          rows: relPedidos.porRota.map(r => [r.rota, r.pedidos, qtd(r.peso), money(r.faturado), money(r.ticket)]),
        }
      case 'lancamentos':
        return {
          header: ['Data', 'Movimentação', 'Tipo', 'Entrada', 'Saída'],
          rows: relLedger.linhas.map(l => [dataBr(l.data), l.origem, l.tipo, moneyOuTraco(l.entrada), moneyOuTraco(l.saida)]),
        }
      case 'compras':
        return {
          header: ['Fornecedor', 'Coletas', 'Qtd', 'Preço médio', 'Valor', 'Perda', 'Aproveitamento', 'A pagar'],
          rows: relCompras.linhas.map(l => [
            l.fornecedor, l.coletas, qtd(l.qtd), l.precoMedio != null ? moneyDetalhado(l.precoMedio) : '—',
            money(l.valor), pct1(l.perdaPct), pctInt(l.aproveitPct), moneyOuTraco(l.aPagar),
          ]),
        }
      case 'produtos':
        return {
          header: ['Produto', 'Qtd comprada', 'Qtd vendida', 'Faturamento', 'Margem', 'Markup', 'Perda'],
          rows: relProdutos.linhas.map(l => [
            l.nome, qtd(l.compradoQtd), qtd(l.vendidoQtd), money(l.faturamento),
            l.vendidoQtd ? money(l.margem) : '—', l.markupPct != null ? pctInt(l.markupPct) : '—',
            l.perdaPct != null ? pct1(l.perdaPct) : '—',
          ]),
        }
      case 'inadimplentes':
        return {
          header: ['Cliente', 'Responsável', 'Telefone', 'Pedidos em atraso', 'Valor', 'Vencimento mais antigo', 'Dias de atraso', '% do faturamento dele'],
          rows: relInad.linhas.map(l => [
            l.cliente, l.resp, l.tel, l.pedidosAtraso, money(l.valorAtraso), dataBr(l.vencimentoMaisAntigo),
            l.diasAtraso != null ? l.diasAtraso + 'd' : '—', l.pctDoFaturamentoDele != null ? l.pctDoFaturamentoDele + '%' : '—',
          ]),
        }
      case 'perdas':
        // Igual ao protótipo: um único CSV com as duas tabelas da aba,
        // separadas por uma linha em branco e um sub-cabeçalho.
        return {
          header: ['Motivo', 'Quantidade', 'Ocorrências', '% do total'],
          rows: [
            ...relPerdas.porMotivo.map(m => [m.motivo, qtd(m.qtd), m.ocorrencias, pctInt(m.pct)]),
            [],
            ['Produto', 'Qtd comprada', 'Perda %', ''],
            ...relPerdas.porProduto.map(p => [p.nome, qtd(p.compradoQtd), p.perdaPct != null ? pct1(p.perdaPct) : '—', '']),
          ],
        }
    }
  }

  function exportarCsv() {
    const { header, rows } = csvAtivo()
    const conteudo = gerarCsv(header, rows)
    baixarCsv(`${NOME_RELATORIO[aba]} — ${periodLabel}.csv`, conteudo)
  }

  return (
    <div className="relatorios-tela">
      <div className="relatorios-topo">
        <div className="relatorios-abas">
          {ABAS.map(a => (
            <button
              key={a.key}
              type="button"
              className={a.key === aba ? 'relatorios-aba relatorios-aba--ativa' : 'relatorios-aba'}
              onClick={() => setAba(a.key)}
              aria-pressed={a.key === aba}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="relatorios-flex-espaco" />
        <div className="relatorios-acoes" data-no-print="1">
          <label className="relatorios-periodo-rotulo" htmlFor="relatorios-de">De</label>
          <input
            id="relatorios-de" type="month" className="relatorios-periodo-input"
            value={de} onChange={e => setDe(e.target.value)}
          />
          <label className="relatorios-periodo-rotulo" htmlFor="relatorios-ate">Até</label>
          <input
            id="relatorios-ate" type="month" className="relatorios-periodo-input"
            value={ate} onChange={e => setAte(e.target.value)}
          />
          {(de || ate) && (
            <button type="button" className="relatorios-periodo-limpar" onClick={() => { setDe(''); setAte('') }}>
              Limpar período
            </button>
          )}
          <button type="button" className="relatorios-botao-csv" onClick={exportarCsv}>Exportar CSV</button>
          <button type="button" className="relatorios-botao-imprimir" onClick={() => window.print()}>Imprimir / PDF</button>
        </div>
      </div>

      <div className="relatorios-legenda">
        <strong>{NOME_RELATORIO[aba]}</strong> · filtrado por {periodLabel}
      </div>

      {aba === 'clientes' && <AbaClientes dados={relClientes} />}
      {aba === 'inadimplentes' && <AbaInadimplentes dados={relInad} />}
      {aba === 'pedidos' && <AbaPedidos dados={relPedidos} />}
      {aba === 'compras' && <AbaCompras dados={relCompras} />}
      {aba === 'produtos' && (
        carregandoProdutos
          ? <p className="relatorios-estado">Carregando produtos…</p>
          : erroProdutos
            ? <p className="relatorios-estado relatorios-estado--erro" role="alert">{erroProdutos}</p>
            : <AbaProdutos dados={relProdutos} />
      )}
      {aba === 'perdas' && (
        carregandoProdutos
          ? <p className="relatorios-estado">Carregando perdas…</p>
          : erroProdutos
            ? <p className="relatorios-estado relatorios-estado--erro" role="alert">{erroProdutos}</p>
            : <AbaPerdas dados={relPerdas} />
      )}
      {aba === 'lancamentos' && <AbaLancamentos dados={relLedger} />}
    </div>
  )
}

// ============================================================ 1. clientes

function AbaClientes({ dados }: { dados: ReturnType<typeof derivarRelatorioClientes> }) {
  const { linhas, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Clientes ativos', valor: String(totais.clientesAtivos), sub: `${totais.clientesTotal} no total` },
        { label: 'Faturamento do período', valor: money(totais.faturamentoPeriodo), sub: 'no período filtrado' },
        { label: 'Ticket médio/cliente', valor: money(totais.ticketMedioCliente), sub: 'meta 3,5–3,8k' },
        { label: 'Inadimplência média', valor: pct1(totais.inadimplenciaMediaPct), sub: 'meta ≤ 1%' },
      ]}
      />
      <div className="relatorios-tabela">
        <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-clientes">
          <div>CLIENTE</div><div>ROTA</div><div>STATUS</div><div className="relatorios-num">PED.</div>
          <div className="relatorios-num">FATURADO</div><div className="relatorios-num">/ENTREGA</div>
          <div className="relatorios-num">% FAT</div><div className="relatorios-num">INAD.</div>
          <div className="relatorios-num">SAÚDE</div>
        </div>
        {linhas.map(l => {
          const st = STATUS_CLIENTE_INFO[l.status]
          const h = HEALTH_INFO[l.health]
          return (
            <div key={l.id} className="relatorios-linha relatorios-grid-clientes">
              <div className="relatorios-forte relatorios-truncar">{l.nome}</div>
              <div className="relatorios-suave">{l.rota}</div>
              <div className="relatorios-suave">{st.label}</div>
              <div className="relatorios-num relatorios-mono">{l.pedidos}</div>
              <div className="relatorios-num relatorios-mono relatorios-forte">{money(l.faturado)}</div>
              <div className="relatorios-num relatorios-mono relatorios-suave">{moneyOuTraco(l.ticketEntrega)}</div>
              <div className="relatorios-num relatorios-mono">{l.participacaoPct}%</div>
              <div className="relatorios-num relatorios-mono" style={{ color: corInad(l.inadimplenciaPct) }}>{pct1(l.inadimplenciaPct)}</div>
              <div className="relatorios-num">
                <span className="relatorios-selo" style={{ color: h.cor, background: h.bg }}>{h.label}</span>
              </div>
            </div>
          )
        })}
        {linhas.length === 0 && <div className="relatorios-tabela-vazia">Nenhum cliente cadastrado.</div>}
      </div>
      <div className="relatorios-nota">
        Ranking por faturamento no período. Faturado, ticket por entrega e % de participação vêm dos pedidos entregues.
      </div>
    </>
  )
}

// ========================================================= 2. inadimplentes

function AbaInadimplentes({ dados }: { dados: ReturnType<typeof derivarRelatorioInadimplentes> }) {
  const { linhas, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Total em atraso', valor: money(totais.totalEmAtraso), sub: `${totais.pedidosEmAtraso} pedido(s)` },
        { label: 'Clientes inadimplentes', valor: String(totais.clientesInadimplentes), sub: `${totais.clientesTotal} na carteira` },
        { label: '% da receita', valor: pct1(totais.pctDaReceita), sub: 'meta ≤ 1%' },
        { label: 'Maior devedor', valor: totais.maiorDevedor?.cliente ?? '—', sub: totais.maiorDevedor ? money(totais.maiorDevedor.valor) : 'nenhum atraso' },
      ]}
      />
      <div className="relatorios-tabela">
        <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-inad">
          <div>CLIENTE</div><div>CONTATO</div><div className="relatorios-num">PEDIDOS</div>
          <div className="relatorios-num">VALOR</div><div>VENC. MAIS ANTIGO</div>
          <div className="relatorios-num">ATRASO</div><div className="relatorios-num">% DELE</div>
        </div>
        {linhas.map(l => (
          <div key={l.clienteId} className="relatorios-linha relatorios-grid-inad">
            <div className="relatorios-forte">{l.cliente}<div className="relatorios-sub-linha">{l.resp}</div></div>
            <div className="relatorios-mono relatorios-suave">{l.tel}</div>
            <div className="relatorios-num relatorios-mono">{l.pedidosAtraso}</div>
            <div className="relatorios-num relatorios-mono relatorios-forte" style={{ color: RED }}>{money(l.valorAtraso)}</div>
            <div className="relatorios-mono relatorios-suave">{dataBr(l.vencimentoMaisAntigo)}</div>
            <div className="relatorios-num relatorios-mono relatorios-forte" style={{ color: corDias(l.diasAtraso) }}>
              {l.diasAtraso != null ? `${l.diasAtraso}d` : '—'}
            </div>
            <div className="relatorios-num relatorios-mono relatorios-suave">
              {l.pctDoFaturamentoDele != null ? `${l.pctDoFaturamentoDele}%` : '—'}
            </div>
          </div>
        ))}
        {linhas.length === 0 && (
          <div className="relatorios-tabela-vazia">
            <div className="relatorios-tabela-vazia-titulo">Nenhum cliente em atraso</div>
            <div>Todos os pedidos do período estão pagos ou dentro do prazo.</div>
          </div>
        )}
      </div>
      <div className="relatorios-nota"><strong>% dele</strong> = quanto do faturamento daquele cliente está em atraso.</div>
    </>
  )
}

// ============================================================== 3. pedidos

function AbaPedidos({ dados }: { dados: ReturnType<typeof derivarRelatorioPedidos> }) {
  const { totais, porStatus, porRota } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Pedidos no período', valor: String(totais.pedidosNoPeriodo), sub: 'no período filtrado' },
        { label: 'Faturado (entregue)', valor: money(totais.faturadoEntregue), sub: 'pedidos entregues' },
        { label: 'A receber / atrasado', valor: money(totais.aReceber), sub: `${totais.pedidosAtrasados} em atraso` },
        { label: 'Qtd entregue', valor: qtd(totais.qtdEntregueKg), sub: 'no período' },
      ]}
      />
      <div className="relatorios-duas-colunas">
        <div className="relatorios-painel">
          <h3 className="relatorios-painel-titulo">Pedidos por status</h3>
          {porStatus.map(s => {
            const info = STATUS_PEDIDO_INFO[s.status]
            return (
              <div key={s.status} className="relatorios-status-linha">
                <span className="relatorios-selo" style={{ color: info.cor, background: info.bg }}>{s.status}</span>
                <span className="relatorios-status-contagem">{s.quantidade}</span>
                <span className="relatorios-suave relatorios-mono">{money(s.valor)}</span>
              </div>
            )
          })}
          {porStatus.length === 0 && <div className="relatorios-tabela-vazia">Nenhum pedido no período.</div>}
        </div>
        <div className="relatorios-painel">
          <h3 className="relatorios-painel-titulo">Desempenho por rota</h3>
          <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-rotas">
            <div>ROTA</div><div className="relatorios-num">PED.</div><div className="relatorios-num">QTD</div>
            <div className="relatorios-num">FATURADO</div><div className="relatorios-num">TICKET</div>
          </div>
          {porRota.map(r => (
            <div key={r.rota} className="relatorios-linha relatorios-grid-rotas">
              <div className="relatorios-forte">{r.rota}</div>
              <div className="relatorios-num relatorios-mono">{r.pedidos}</div>
              <div className="relatorios-num relatorios-mono relatorios-suave">{qtd(r.peso)}</div>
              <div className="relatorios-num relatorios-mono relatorios-forte">{money(r.faturado)}</div>
              <div className="relatorios-num relatorios-mono relatorios-suave">{money(r.ticket)}</div>
            </div>
          ))}
          {porRota.length === 0 && <div className="relatorios-tabela-vazia">Nenhum pedido no período.</div>}
        </div>
      </div>
      <div className="relatorios-nota">Todos os números respeitam o período selecionado e são somados dos pedidos lançados.</div>
    </>
  )
}

// ============================================================== 4. compras

function AbaCompras({ dados }: { dados: ReturnType<typeof derivarRelatorioCompras> }) {
  const { linhas, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Total comprado', valor: money(totais.totalComprado), sub: `${totais.coletasNoPeriodo} coleta(s)` },
        { label: 'Fornecedores no período', valor: String(totais.fornecedoresNoPeriodo), sub: `${totais.fornecedoresCadastrados} cadastrados` },
        { label: 'Perda na coleta', valor: pct1(totais.perdaNaColetaPct), sub: `${qtd(totais.perdaQtd)} de ${qtd(totais.compradoQtd)}` },
        { label: 'A pagar ao produtor', valor: money(totais.aPagarAoProdutor), sub: totais.aPagarAoProdutor > 0 ? 'compras em aberto' : 'tudo pago' },
      ]}
      />
      <div className="relatorios-tabela">
        <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-compras">
          <div>FORNECEDOR</div><div className="relatorios-num">COLETAS</div><div className="relatorios-num">QTD</div>
          <div className="relatorios-num">PREÇO MÉD.</div><div className="relatorios-num">VALOR</div>
          <div className="relatorios-num">PERDA</div><div className="relatorios-num">APROVEIT.</div>
          <div className="relatorios-num">A PAGAR</div>
        </div>
        {linhas.map(l => (
          <div key={l.fornecedorId ?? '—'} className="relatorios-linha relatorios-grid-compras">
            <div className="relatorios-forte">{l.fornecedor}</div>
            <div className="relatorios-num relatorios-mono">{l.coletas}</div>
            <div className="relatorios-num relatorios-mono">{qtd(l.qtd)}</div>
            <div className="relatorios-num relatorios-mono relatorios-suave">{l.precoMedio != null ? moneyDetalhado(l.precoMedio) : '—'}</div>
            <div className="relatorios-num relatorios-mono relatorios-forte">{money(l.valor)}</div>
            <div className="relatorios-num relatorios-mono" style={{ color: corPerda(l.perdaPct) }}>{pct1(l.perdaPct)}</div>
            <div className="relatorios-num relatorios-mono relatorios-suave">{pctInt(l.aproveitPct)}</div>
            <div className="relatorios-num relatorios-mono" style={{ color: l.aPagar ? RED : NEUTRO }}>{moneyOuTraco(l.aPagar)}</div>
          </div>
        ))}
        {linhas.length === 0 && <div className="relatorios-tabela-vazia">Nenhuma compra no período.</div>}
      </div>
      <div className="relatorios-nota">
        Ordenado por valor comprado. <strong>Aproveitamento</strong> = quanto da carga chegou em condição de venda.
      </div>
    </>
  )
}

// ============================================================= 5. produtos

function AbaProdutos({ dados }: { dados: ReturnType<typeof derivarRelatorioProdutos> }) {
  const { linhas, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Produtos movimentados', valor: String(totais.produtosMovimentados), sub: `${totais.produtosCadastrados} cadastrados` },
        { label: 'Mais fatura', valor: totais.maisFatura?.nome ?? '—', sub: totais.maisFatura ? money(totais.maisFatura.faturamento) : 'sem movimento' },
        { label: 'Maior margem', valor: totais.maiorMargem?.nome ?? '—', sub: totais.maiorMargem ? money(totais.maiorMargem.margem) : '—' },
        { label: 'Maior perda', valor: totais.maiorPerda?.nome ?? '—', sub: totais.maiorPerda ? pct1(totais.maiorPerda.perdaPct) : '—' },
      ]}
      />
      <div className="relatorios-tabela">
        <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-produtos">
          <div>PRODUTO</div><div className="relatorios-num">COMPRADO</div><div className="relatorios-num">VENDIDO</div>
          <div className="relatorios-num">FATURAMENTO</div><div className="relatorios-num">MARGEM</div>
          <div className="relatorios-num">MARKUP</div><div className="relatorios-num">PERDA</div>
        </div>
        {linhas.map(l => (
          <div key={l.produtoId} className="relatorios-linha relatorios-grid-produtos">
            <div className="relatorios-forte">{l.nome}</div>
            <div className="relatorios-num relatorios-mono relatorios-suave">{qtd(l.compradoQtd)}</div>
            <div className="relatorios-num relatorios-mono relatorios-suave">{qtd(l.vendidoQtd)}</div>
            <div className="relatorios-num relatorios-mono relatorios-forte">{money(l.faturamento)}</div>
            <div className="relatorios-num relatorios-mono" style={{ color: '#2f5d3f' }}>{l.vendidoQtd ? money(l.margem) : '—'}</div>
            <div className="relatorios-num relatorios-mono" style={{ color: corMarkup(l.markupPct) }}>
              {l.markupPct != null ? pctInt(l.markupPct) : '—'}
            </div>
            <div className="relatorios-num relatorios-mono" style={{ color: l.perdaPct != null ? corPerda(l.perdaPct) : NEUTRO }}>
              {l.perdaPct != null ? pct1(l.perdaPct) : '—'}
            </div>
          </div>
        ))}
        {linhas.length === 0 && <div className="relatorios-tabela-vazia">Nenhum produto movimentado no período.</div>}
      </div>
      <div className="relatorios-nota">
        Ordenado por faturamento. <strong>Margem</strong> = faturamento menos o custo de compra da quantidade vendida.
      </div>
    </>
  )
}

// =============================================================== 6. perdas

function AbaPerdas({ dados }: { dados: ReturnType<typeof derivarRelatorioPerdas> }) {
  const { porMotivo, porProduto, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Perda total', valor: qtd(totais.perdaTotalQtd), sub: 'somando coleta e depósito' },
        { label: 'Índice de perdas', valor: pct1(totais.indicePerdaPct), sub: 'meta ≤ 10%' },
        { label: 'Principal motivo', valor: totais.principalMotivo ?? '—', sub: totais.principalMotivoPct != null ? `${pctInt(totais.principalMotivoPct)} do total` : 'sem perdas' },
        { label: 'Perdas no depósito', valor: String(totais.perdasNoDeposito), sub: 'lançamentos avulsos' },
      ]}
      />
      <div className="relatorios-duas-colunas">
        <div className="relatorios-painel">
          <h3 className="relatorios-painel-titulo">Perdas por motivo</h3>
          <div className="relatorios-painel-sub">Onde a mercadoria está se perdendo.</div>
          {porMotivo.map(m => (
            <div key={m.motivo} className="relatorios-motivo-linha">
              <div className="relatorios-motivo-cabecalho">
                <div className="relatorios-motivo-nome">{m.motivo}</div>
                <div className="relatorios-suave">{m.ocorrencias} ocorr.</div>
                <div className="relatorios-mono relatorios-forte" style={{ color: '#9a4a2e' }}>{qtd(m.qtd)}</div>
                <div className="relatorios-mono relatorios-suave relatorios-motivo-pct">{pctInt(m.pct)}</div>
              </div>
              <div className="relatorios-barra-fundo">
                <div className="relatorios-barra-preenchida" style={{ width: `${Math.round(m.pct)}%` }} />
              </div>
            </div>
          ))}
          {porMotivo.length === 0 && <div className="relatorios-tabela-vazia">Nenhuma perda registrada no período.</div>}
        </div>
        <div className="relatorios-painel">
          <h3 className="relatorios-painel-titulo">Perdas por produto</h3>
          <div className="relatorios-painel-sub">Perecibilidade varia muito por item — meta ≤ 10%.</div>
          <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-perda-produto">
            <div>PRODUTO</div><div className="relatorios-num">COMPRADO</div><div className="relatorios-num">PERDA</div>
          </div>
          {porProduto.map(p => (
            <div key={p.nome} className="relatorios-linha relatorios-grid-perda-produto">
              <div className="relatorios-forte">{p.nome}</div>
              <div className="relatorios-num relatorios-mono relatorios-suave">{qtd(p.compradoQtd)}</div>
              <div className="relatorios-num relatorios-mono" style={{ color: p.perdaPct != null ? corPerda(p.perdaPct) : NEUTRO }}>
                {p.perdaPct != null ? pct1(p.perdaPct) : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relatorios-nota">
        Soma a perda registrada na <strong>coleta</strong> (dentro de cada entrada) com as perdas lançadas no <strong>depósito</strong>.
      </div>
    </>
  )
}

// ========================================================= 7. lançamentos

function AbaLancamentos({ dados }: { dados: ReturnType<typeof derivarRelatorioLedger> }) {
  const { linhas, totais } = dados
  return (
    <>
      <Cartoes itens={[
        { label: 'Entrou (recebido)', valor: money(totais.entrou), sub: 'vendas pagas' },
        { label: 'Saiu (pago)', valor: money(totais.saiu), sub: 'compras pagas + lançamentos' },
        { label: 'Saldo do período', valor: money(totais.saldo), sub: totais.saldo >= 0 ? 'positivo' : 'negativo' },
        { label: 'Movimentações', valor: String(totais.movimentacoes), sub: 'no período' },
      ]}
      />
      <div className="relatorios-tabela">
        <div className="relatorios-linha relatorios-linha--cabecalho relatorios-grid-lancamentos">
          <div>DATA</div><div>MOVIMENTAÇÃO</div><div>TIPO</div>
          <div className="relatorios-num">ENTRADA</div><div className="relatorios-num">SAÍDA</div>
        </div>
        {linhas.map((l, i) => (
          // Sem id proprio: cada linha vem de uma venda/compra/lancamento
          // diferente, combinados num so array (o ledger do protótipo também
          // não tem chave estável) — índice + data é suficiente aqui.
          <div key={`${l.data}-${i}`} className="relatorios-linha relatorios-grid-lancamentos">
            <div className="relatorios-mono relatorios-suave">{dataBr(l.data)}</div>
            <div className="relatorios-truncar">{l.origem}</div>
            <div>
              <span className="relatorios-selo" style={{ color: l.entrada > 0 ? GREEN : RED, background: l.entrada > 0 ? GBG : RBG }}>
                {l.tipo}
              </span>
            </div>
            <div className="relatorios-num relatorios-mono relatorios-forte" style={{ color: GREEN }}>{moneyOuTraco(l.entrada)}</div>
            <div className="relatorios-num relatorios-mono relatorios-forte" style={{ color: '#9a4a2e' }}>{moneyOuTraco(l.saida)}</div>
          </div>
        ))}
        {linhas.length === 0 && <div className="relatorios-tabela-vazia">Sem movimentações no período.</div>}
      </div>
      <div className="relatorios-nota">
        Conta tudo: <strong>vendas pagas</strong> (entrada de dinheiro), <strong>compras dos fornecedores</strong> e{' '}
        <strong>lançamentos de custos</strong> (saídas).
      </div>
    </>
  )
}
