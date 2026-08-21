import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import type { Cliente, Health } from '../derive/clientes'
import type { Lancamento } from '../derive/lancamentos'
import {
  METAS_DASHBOARD,
  receitaBruta,
  custoTotal,
  lucroLiquido,
  percentualLucro,
  indiceDePerdas,
  ticketMedioPorEntrega,
  ticketMedioPorMinimercado,
  inadimplenciaGeral,
  clientesAtivos,
  markupMedio,
  giroDeEstoque,
  cicloDeCaixa,
  cicloRecebimentoDias,
  statusIndiceDePerdas,
  statusMarkup,
  statusClientesAtivosKpi,
  statusEquilibrioClientes,
  statusTicketMes,
  statusTicketEntrega,
  statusInadimplencia,
  statusGiroDeEstoque,
  statusCicloDeCaixa,
  statusLucro,
  concentracaoDeCarteira,
  cenariosDeResultado,
  type Indicador,
  type Saida,
  type Entrada,
  type Perda,
} from '../derive/dashboard'
import './DashboardTela.css'

const CORES: Record<Health, string> = { green: '#3f8f5b', amber: '#c79320', red: '#c2502f' }
const NEUTRO = '#6a685c'

const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const pct1 = (n: number) => n.toFixed(1).replace('.', ',') + '%'

/** Texto do card quando o indicador nao esta disponivel: nunca "0", sempre
 * "—" com o motivo — o ponto central desta tela (ver derive/dashboard.ts). */
function valorOuTracejado(ind: Indicador, formatar: (v: number) => string): string {
  return ind.disponivel ? formatar(ind.valor) : '—'
}

interface CartaoKpi {
  rotulo: string
  valorTexto: string
  metaTexto: string
  tagTexto: string
  cor: string
  barraPct: number
}

/** Monta um card de KPI a partir de um indicador (que pode estar
 * indisponivel) + sua funcao de classificacao (semaforo). `metaBase` e o
 * denominador usado so pra desenhar a barra de progresso (0-100%). */
function cartaoDeIndicador(
  rotulo: string,
  ind: Indicador,
  formatar: (v: number) => string,
  metaTexto: string,
  classificar: (v: number) => Health,
  metaBase: number,
): CartaoKpi {
  if (!ind.disponivel) {
    return { rotulo, valorTexto: '—', metaTexto: ind.motivo, tagTexto: 'sem dado', cor: NEUTRO, barraPct: 0 }
  }
  const cor = classificar(ind.valor)
  const bateAMeta = cor === 'green'
  return {
    rotulo,
    valorTexto: formatar(ind.valor),
    metaTexto,
    tagTexto: bateAMeta ? 'na meta' : cor === 'amber' ? 'atenção' : 'fora da meta',
    cor: CORES[cor],
    barraPct: Math.min(100, Math.round((ind.valor / metaBase) * 100)),
  }
}

interface DashboardTelaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada: () => void
}

export function DashboardTela({ onSessaoExpirada }: DashboardTelaProps) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saidas, setSaidas] = useState<Saida[]>([])
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [perdas, setPerdas] = useState<Perda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Cliente[]>('/api/clientes'),
      api.get<Saida[]>('/api/saidas'),
      api.get<Entrada[]>('/api/entradas'),
      api.get<Lancamento[]>('/api/lancamentos'),
      api.get<Perda[]>('/api/perdas'),
    ])
      .then(([cs, ss, es, ls, ps]) => {
        if (cancelado) return
        setClientes(cs); setSaidas(ss); setEntradas(es); setLancamentos(ls); setPerdas(ps)
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada()
          return
        }
        setErro('Não foi possível carregar os dados do painel.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  if (carregando) return <p className="dashboard-estado">Carregando…</p>
  if (erro) return <p className="dashboard-estado dashboard-estado--erro" role="alert">{erro}</p>
  if (clientes.length === 0) {
    return (
      <div className="dashboard-vazio">
        <div className="dashboard-vazio-titulo">Nenhum cliente cadastrado ainda.</div>
        <div className="dashboard-vazio-sub">
          Cadastre os minimercados que você atende para começar a acompanhar a saúde do negócio — os
          indicadores desta tela dependem da carteira de clientes.
        </div>
      </div>
    )
  }

  // ---- financeiro base ----
  const receita = receitaBruta(saidas)
  const custo = custoTotal(entradas, lancamentos)
  const lucro = lucroLiquido(receita, custo)
  const pctLucro = percentualLucro(receita, lucro)
  const nAtivos = clientesAtivos(clientes)
  const giro = giroDeEstoque(entradas, saidas)
  const recebimento = cicloRecebimentoDias(saidas)
  const ciclo = cicloDeCaixa(giro, recebimento)

  const entreguesCount = saidas.filter(s => s.status === 'Entregue').length

  // ---- cartoes do topo ----
  const equilibrioDiff = nAtivos - METAS_DASHBOARD.clientesAtivosEquilibrio

  // ---- KPIs (painel de indicadores) ----
  const perdas1 = indiceDePerdas(entradas, perdas)
  const markup = markupMedio(entradas, saidas)
  const ticketMes = ticketMedioPorMinimercado(saidas)
  const ticketEntrega = ticketMedioPorEntrega(saidas)
  const inad = inadimplenciaGeral(saidas)

  const kpis: CartaoKpi[] = [
    cartaoDeIndicador('Índice de perdas (%)', perdas1, pct1, '≤ 10%', statusIndiceDePerdas, METAS_DASHBOARD.perdaMetaPct),
    cartaoDeIndicador('Markup médio (venda/compra)', markup, v => Math.round(v) + '%', '≥ 60%', statusMarkup, METAS_DASHBOARD.markupMetaPct),
    {
      rotulo: 'Nº de minimercados ativos', valorTexto: String(nAtivos), metaTexto: '~35',
      tagTexto: statusClientesAtivosKpi(nAtivos) === 'green' ? 'na meta' : statusClientesAtivosKpi(nAtivos) === 'amber' ? 'atenção' : 'fora da meta',
      cor: CORES[statusClientesAtivosKpi(nAtivos)],
      barraPct: Math.min(100, Math.round((nAtivos / METAS_DASHBOARD.clientesAtivosMeta) * 100)),
    },
    cartaoDeIndicador('Ticket médio / minimercado', ticketMes, money, '3,5–3,8k', statusTicketMes, METAS_DASHBOARD.ticketMesMetaAlto),
    cartaoDeIndicador('Ticket médio por entrega', ticketEntrega, money, '≥ R$ 430', statusTicketEntrega, METAS_DASHBOARD.ticketEntregaMeta),
    cartaoDeIndicador('Inadimplência por cliente', inad, pct1, '≤ 1%', statusInadimplencia, METAS_DASHBOARD.inadimplenciaMetaPct),
    cartaoDeIndicador('Giro de estoque (dias)', giro, v => String(Math.round(v)), '≤ 4 d', statusGiroDeEstoque, METAS_DASHBOARD.giroEstoqueMetaDias),
    cartaoDeIndicador('Ciclo de caixa (dias)', ciclo, v => String(Math.round(v)), '≤ 13 d', statusCicloDeCaixa, METAS_DASHBOARD.cicloCaixaMetaDias),
  ]

  const carteira = concentracaoDeCarteira(clientes, saidas)
  const cenarios = cenariosDeResultado(receita, custo)

  return (
    <div className="dashboard-tela">
      {/* ---- cartoes do topo ---- */}
      <div className="dashboard-cards-topo">
        <div className="dashboard-card-topo">
          <div className="dashboard-card-topo-rotulo">Receita bruta</div>
          <div className="dashboard-card-topo-valor">{valorOuTracejado(receita, money)}</div>
          <div className="dashboard-card-topo-delta" style={{ color: receita.disponivel ? CORES.green : NEUTRO }}>
            {receita.disponivel ? `${entreguesCount} pedido(s) entregue(s)` : receita.motivo}
          </div>
        </div>
        <div className="dashboard-card-topo">
          <div className="dashboard-card-topo-rotulo">Lucro líquido op.</div>
          <div className="dashboard-card-topo-valor">{valorOuTracejado(lucro, money)}</div>
          <div
            className="dashboard-card-topo-delta"
            style={{ color: lucro.disponivel ? CORES[statusLucro(lucro.valor)] : NEUTRO }}
          >
            {lucro.disponivel && pctLucro.disponivel ? `${pct1(pctLucro.valor)} s/ receita` : lucro.disponivel ? '' : lucro.motivo}
          </div>
        </div>
        <div className="dashboard-card-topo">
          <div className="dashboard-card-topo-rotulo">Ciclo de caixa</div>
          <div className="dashboard-card-topo-valor">{valorOuTracejado(ciclo, v => `${Math.round(v)} ${Math.round(v) === 1 ? 'dia' : 'dias'}`)}</div>
          <div
            className="dashboard-card-topo-delta"
            style={{ color: ciclo.disponivel ? CORES[statusCicloDeCaixa(ciclo.valor)] : NEUTRO }}
          >
            {ciclo.disponivel ? 'meta ≤ 13 dias' : ciclo.motivo}
          </div>
        </div>
        <div className="dashboard-card-topo">
          <div className="dashboard-card-topo-rotulo">Minimercados ativos</div>
          <div className="dashboard-card-topo-valor">{nAtivos}</div>
          <div className="dashboard-card-topo-delta" style={{ color: CORES[statusEquilibrioClientes(nAtivos)] }}>
            {equilibrioDiff >= 0 ? `+${equilibrioDiff}` : equilibrioDiff} vs. equilíbrio (20)
          </div>
        </div>
      </div>

      {/* ---- painel de indicadores ---- */}
      <div className="dashboard-kpis">
        <div className="dashboard-kpis-cabecalho">
          <h2 className="dashboard-kpis-titulo">Painel de indicadores</h2>
          <span className="dashboard-kpis-contagem">{kpis.length} KPIs do estudo · meta vs. realizado</span>
          <div className="dashboard-kpis-legenda">
            <span className="dashboard-legenda-item"><span className="dashboard-legenda-dot" style={{ background: CORES.green }} />Na meta</span>
            <span className="dashboard-legenda-item"><span className="dashboard-legenda-dot" style={{ background: CORES.amber }} />Atenção</span>
            <span className="dashboard-legenda-item"><span className="dashboard-legenda-dot" style={{ background: CORES.red }} />Fora da meta</span>
          </div>
        </div>
        <div className="dashboard-kpis-grid">
          {kpis.map(k => (
            <div key={k.rotulo} className="dashboard-kpi-card" style={{ borderTopColor: k.cor }}>
              <div className="dashboard-kpi-rotulo">{k.rotulo}</div>
              <div className="dashboard-kpi-valor" style={{ color: k.cor }}>{k.valorTexto}</div>
              <div className="dashboard-kpi-barra-trilha">
                <div className="dashboard-kpi-barra-preenchimento" style={{ width: `${k.barraPct}%`, background: k.cor }} />
              </div>
              <div className="dashboard-kpi-rodape">
                <span className="dashboard-kpi-meta">{k.metaTexto}</span>
                <span className="dashboard-kpi-tag" style={{ color: k.cor }}>{k.tagTexto}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- concentracao de carteira ---- */}
      <div className="dashboard-secao">
        <div className="dashboard-secao-cabecalho">
          <h3 className="dashboard-secao-titulo">Concentração de carteira</h3>
          {carteira.disponivel && <span className="dashboard-secao-destaque">Top 5 = {carteira.top5TextoPct}% do faturamento</span>}
        </div>
        <div className="dashboard-secao-sub">Risco de dependência — alvo: nenhum cliente acima de 15%.</div>
        {!carteira.disponivel && <p className="dashboard-secao-vazia">Sem dado suficiente: {carteira.motivo}.</p>}
        {carteira.disponivel && (
          <div className="dashboard-carteira-lista">
            {carteira.itens.map(item => (
              <div key={item.nome} className="dashboard-carteira-linha">
                <div className="dashboard-carteira-nome">{item.nome}</div>
                <div className="dashboard-carteira-barra-trilha">
                  <div
                    className="dashboard-carteira-barra-preenchimento"
                    style={{
                      width: `${item.larguraBarraPct}%`,
                      background: item.agregado ? '#c8c2ad' : item.destaque ? CORES.red : '#5a7d3a',
                    }}
                  />
                </div>
                <div className="dashboard-carteira-pct">{item.percentual}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- cenario realizado vs projecoes ---- */}
      <div className="dashboard-secao">
        <h3 className="dashboard-secao-titulo">Cenário realizado vs. projeções</h3>
        <div className="dashboard-secao-sub">Lucro líquido operacional — onde a operação está performando.</div>
        {!cenarios.disponivel && <p className="dashboard-secao-vazia">Sem dado suficiente: {cenarios.motivo}.</p>}
        {cenarios.disponivel && (
          <>
            <div className="dashboard-cenarios-lista">
              {cenarios.cenarios.map(c => (
                <div key={c.nome} className="dashboard-cenario-linha">
                  <div className={`dashboard-cenario-nome dashboard-cenario-nome--${c.nome.toLowerCase()}`}>{c.nome}</div>
                  <div className="dashboard-cenario-barra-trilha">
                    <div
                      className={`dashboard-cenario-barra-preenchimento dashboard-cenario-barra-preenchimento--${c.nome.toLowerCase()}`}
                      style={{ width: `${Math.max(0, c.larguraBarraPct)}%` }}
                    />
                  </div>
                  <div className={`dashboard-cenario-valor dashboard-cenario-valor--${c.nome.toLowerCase()}`}>{money(c.valor)}</div>
                </div>
              ))}
            </div>
            <div className="dashboard-cenarios-realizado">
              ● Realizado (lucro líquido) — {money(cenarios.lucro)} ({pct1(cenarios.percentualLucro)} s/ receita).
            </div>
          </>
        )}
      </div>
    </div>
  )
}
