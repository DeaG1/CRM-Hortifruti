import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  calcularResultado,
  calcularCicloCaixa,
  periodoDe,
  type SaidaFin,
  type EntradaFin,
  type Resultado,
  type CicloCaixa,
} from '../derive/financeiro'
import type { Lancamento } from '../derive/lancamentos'
import { LancamentosLista } from './LancamentosLista'
import './FinanceiroTela.css'

// Molde: ClientesLista.tsx (os quatro estados, cancelado no useEffect,
// ErroApi 401 -> onSessaoExpirada). Financeiro não guarda dado próprio
// (App.tsx, comentário em Conteudo()): tudo aqui vem de /api/saidas,
// /api/entradas e /api/lancamentos — os cálculos em si moram em
// derive/financeiro.ts (puros, testados à parte). A lista de lançamentos
// reaproveita LancamentosLista.tsx inteira (não duplica sua lógica); esta
// tela só busca os mesmos dados de novo para alimentar o resultado e o
// ciclo de caixa, que não fazem parte do que LancamentosLista calcula.

const RED = '#c2502f'
const AMBER = '#c79320'
const GREEN = '#3f8f5b'

const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** 'AAAA-MM' -> 'Junho/2026'. 'all' -> 'Todo o período'. */
function rotuloPeriodo(periodo: string): string {
  if (periodo === 'all') return 'Todo o período'
  const [ano, mes] = periodo.split('-')
  const nome = MESES[Number(mes) - 1] ?? mes
  return `${nome}/${ano}`
}

/** Meses (AAAA-MM) com pelo menos um dado (venda, compra ou lançamento),
 * mais recente primeiro — só oferece no seletor um período que existe. */
function periodosDisponiveis(saidas: SaidaFin[], entradas: EntradaFin[], lancamentos: Lancamento[]): string[] {
  const vistos = new Set<string>()
  for (const s of saidas) { const p = periodoDe(s.entrega); if (p) vistos.add(p) }
  for (const e of entradas) { const p = periodoDe(e.data); if (p) vistos.add(p) }
  for (const l of lancamentos) { const p = periodoDe(l.data); if (p) vistos.add(p) }
  return [...vistos].sort().reverse()
}

/** dias ou travessão — nunca "0" fabricado para um componente não calculável. */
function diasTxt(n: number | null): string {
  return n === null ? '—' : `${n}${n === 1 ? ' dia' : ' dias'}`
}

interface FinanceiroTelaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada: () => void
}

export function FinanceiroTela({ onSessaoExpirada }: FinanceiroTelaProps) {
  const [saidas, setSaidas] = useState<SaidaFin[]>([])
  const [entradas, setEntradas] = useState<EntradaFin[]>([])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [periodo, setPeriodo] = useState('all')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<SaidaFin[]>('/api/saidas'),
      api.get<EntradaFin[]>('/api/entradas'),
      api.get<Lancamento[]>('/api/lancamentos'),
    ])
      .then(([ss, es, ls]) => {
        if (cancelado) return
        setSaidas(ss)
        setEntradas(es)
        setLancamentos(ls)
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada()
          return
        }
        setErro('Não foi possível carregar os dados financeiros.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  if (carregando) return <p className="financeiro-estado">Carregando…</p>
  if (erro) return <p className="financeiro-estado financeiro-estado--erro" role="alert">{erro}</p>

  if (saidas.length === 0 && entradas.length === 0 && lancamentos.length === 0) {
    return (
      <div className="financeiro-vazio">
        <div className="financeiro-vazio-titulo">Ainda não há dado suficiente para calcular o financeiro.</div>
        <div className="financeiro-vazio-sub">
          Financeiro não guarda dado próprio: o resultado, o ciclo de caixa e os lançamentos aparecem aqui assim
          que houver saídas, entradas ou lançamentos cadastrados.
        </div>
      </div>
    )
  }

  const periodos = periodosDisponiveis(saidas, entradas, lancamentos)
  const resultado = calcularResultado(saidas, entradas, lancamentos, periodo)
  const ciclo = calcularCicloCaixa(entradas, saidas, periodo)
  const label = rotuloPeriodo(periodo)

  return (
    <div className="financeiro-tela">
      <div className="financeiro-periodo">
        <label className="financeiro-periodo-rotulo" htmlFor="financeiro-periodo-select">Período</label>
        <select
          id="financeiro-periodo-select"
          className="financeiro-periodo-select"
          value={periodo}
          onChange={e => setPeriodo(e.target.value)}
        >
          <option value="all">Todo o período</option>
          {periodos.map(p => <option key={p} value={p}>{rotuloPeriodo(p)}</option>)}
        </select>
      </div>

      <div className="financeiro-grid">
        <ResultadoCard resultado={resultado} label={label} />
        <div className="financeiro-coluna-direita">
          <CicloCaixaCard ciclo={ciclo} />
          <LucroDestaque resultado={resultado} label={label} />
        </div>
      </div>

      <div className="financeiro-lancamentos">
        <h3 className="financeiro-secao-titulo">Lançamentos</h3>
        <LancamentosLista onSessaoExpirada={onSessaoExpirada} />
      </div>
    </div>
  )
}

function ResultadoCard({ resultado, label }: { resultado: Resultado; label: string }) {
  const corLucro = resultado.lucroLiquido < 0 ? RED : GREEN
  const pctTxt = `${resultado.pctLucro.toFixed(1).replace('.', ',')}% s/ receita`
  return (
    <div className="financeiro-card">
      <h3 className="financeiro-card-titulo">Resultado — {label}</h3>
      <div className="financeiro-card-legenda">
        Receita vem das saídas entregues; a compra, das entradas; os demais custos são os lançamentos, por categoria.
      </div>

      <div className="financeiro-linha financeiro-linha--receita">
        <span className="financeiro-linha-rotulo financeiro-linha-rotulo--forte">Receita bruta</span>
        <span className="financeiro-mono financeiro-valor-forte">{money(resultado.receitaBruta)}</span>
      </div>

      {resultado.custos.map(c => (
        <div className="financeiro-linha" key={c.categoria}>
          <span className="financeiro-linha-rotulo">(–) {c.categoria}</span>
          <span className="financeiro-mono financeiro-valor-custo">({money(c.valor)})</span>
        </div>
      ))}

      <div className="financeiro-linha financeiro-linha--total">
        <span className="financeiro-linha-rotulo financeiro-linha-rotulo--sutil">= Total de custos</span>
        <span className="financeiro-mono">{money(resultado.custoTotal)}</span>
      </div>

      <div className="financeiro-destaque-lucro">
        <div>
          <div className="financeiro-destaque-lucro-titulo">Lucro líquido</div>
          <div className="financeiro-destaque-lucro-pct">{pctTxt}</div>
        </div>
        <span className="financeiro-mono financeiro-destaque-lucro-valor" style={{ color: corLucro }}>
          {money(resultado.lucroLiquido)}
        </span>
      </div>
    </div>
  )
}

function LucroDestaque({ resultado, label }: { resultado: Resultado; label: string }) {
  const corLucro = resultado.lucroLiquido < 0 ? '#f0a58a' : '#a5d66f'
  const pctTxt = `${resultado.pctLucro.toFixed(1).replace('.', ',')}% s/ receita`
  return (
    <div className="financeiro-lucro-escuro">
      <div className="financeiro-lucro-escuro-rotulo">Lucro líquido operacional · {label}</div>
      <div className="financeiro-lucro-escuro-valor" style={{ color: corLucro }}>{money(resultado.lucroLiquido)}</div>
      <div className="financeiro-lucro-escuro-sub">{pctTxt} · calculado das saídas e custos lançados</div>
    </div>
  )
}

/**
 * Ciclo de caixa completo — item do To Do do cliente (ver
 * derive/financeiro.ts, calcularCicloCaixa, para a fórmula documentada em
 * detalhe). A tela sempre lista os três componentes por nome e valor
 * (pagamento ao produtor, giro de estoque, recebimento): o dono do negócio
 * precisa ver de onde o número veio, não só o total. Quando um componente
 * não é calculável no período, aparece "—" com o motivo — nunca 0 embutido
 * silenciosamente na soma.
 */
function CicloCaixaCard({ ciclo }: { ciclo: CicloCaixa }) {
  const componentes: { chave: keyof CicloCaixa; rotulo: string; cor: string; motivo: string }[] = [
    {
      chave: 'pagamentoProdutor', rotulo: 'Pagamento ao produtor', cor: '#5a7d3a',
      motivo: 'Nenhuma entrada paga (com data de pagamento) no período selecionado.',
    },
    {
      chave: 'estoque', rotulo: 'Giro de estoque', cor: '#7cb342',
      motivo: 'Nenhuma saída registrada para estimar o ritmo de venda.',
    },
    {
      chave: 'recebimento', rotulo: 'Recebimento', cor: AMBER,
      motivo: 'Nenhuma venda entregue e paga (com as duas datas) no período selecionado.',
    },
  ]

  return (
    <div className="financeiro-card">
      <div className="financeiro-ciclo-cabecalho">
        <h3 className="financeiro-card-titulo">Ciclo de caixa</h3>
        <span className="financeiro-mono financeiro-ciclo-total">{diasTxt(ciclo.total)}</span>
      </div>
      <div className="financeiro-card-legenda">
        Soma dos três trechos em que o dinheiro fica fora do caixa: quanto se leva para pagar o produtor, quanto
        tempo a mercadoria fica em estoque, e quanto se leva para receber do cliente.
      </div>

      <div className="financeiro-ciclo-componentes">
        {componentes.map(c => {
          const valor = ciclo[c.chave] as number | null
          return (
            <div className="financeiro-ciclo-item" key={c.chave}>
              <span className="financeiro-ciclo-dot" style={{ background: c.cor }} />
              <div className="financeiro-ciclo-item-corpo">
                <div className="financeiro-ciclo-item-rotulo">{c.rotulo}</div>
                {valor === null && <div className="financeiro-ciclo-item-motivo">{c.motivo}</div>}
              </div>
              <span className="financeiro-mono financeiro-ciclo-item-valor">{diasTxt(valor)}</span>
            </div>
          )
        })}
      </div>

      {ciclo.total !== null && (
        <div className="financeiro-ciclo-barra">
          {componentes.map(c => {
            const valor = ciclo[c.chave] as number
            const largura = (valor / (ciclo.total as number)) * 100
            return (
              <div
                key={c.chave}
                className="financeiro-ciclo-barra-segmento"
                style={{ width: `${largura}%`, background: c.cor }}
              >
                {valor}d
              </div>
            )
          })}
        </div>
      )}

      <div className="financeiro-ciclo-formula">
        Ciclo de caixa = pagamento ao produtor + giro de estoque + recebimento (soma dos três — item do To Do do
        cliente). Sem meta definida para esta fórmula ainda: a meta "≤ 13 dias" do protótipo valia para o cálculo
        antigo, que só considerava recebimento e subtraía um prazo fixo de pagamento ao produtor.
      </div>
    </div>
  )
}
