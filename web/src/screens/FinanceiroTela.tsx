import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  calcularResultado,
  calcularCicloCaixa,
  type SaidaFin,
  type EntradaFin,
  type Resultado,
  type CicloCaixa,
} from '../derive/financeiro'
import { rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import { METAS_DASHBOARD, statusCicloDeCaixa } from '../derive/dashboard'
import type { Health } from '../derive/clientes'
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
const NEUTRO = '#6a685c'

/** Mesmas cores do semáforo do Painel de Indicadores (DashboardTela) — os
 * valores em si (verde/âmbar/vermelho) não são repetidos ali nem aqui além
 * desta constante; `Health` (derive/clientes.ts) é o mesmo tipo usado lá. */
const CORES_SEMAFORO: Record<Health, string> = { green: GREEN, amber: AMBER, red: RED }

const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

/** dias ou travessão — nunca "0" fabricado para um componente não calculável. */
function diasTxt(n: number | null): string {
  return n === null ? '—' : `${n}${n === 1 ? ' dia' : ' dias'}`
}

interface FinanceiroTelaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). ESTA TELA PERDEU O
   * SELETOR PRÓPRIO: ele fazia exatamente o mesmo recorte, na mesma
   * convenção ('all' | 'AAAA-MM'), e conviver com o global significaria dois
   * controles de período visíveis ao mesmo tempo podendo discordar — o
   * resultado do mês no cartão e o do cabeçalho apontando meses diferentes é
   * pior do que não ter filtro nenhum. O rótulo do período continua impresso
   * em "Resultado — Junho/2026" e no destaque de lucro, então o recorte
   * segue visível na tela, só não é mais escolhido aqui.
   */
  periodo?: Periodo
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada: () => void
}

export function FinanceiroTela({ periodo = PERIODO_TODOS, onSessaoExpirada }: FinanceiroTelaProps) {
  const [saidas, setSaidas] = useState<SaidaFin[]>([])
  const [entradas, setEntradas] = useState<EntradaFin[]>([])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
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
      <div className="estado-vazio financeiro-vazio">
        <div className="financeiro-vazio-titulo">Ainda não há dado suficiente para calcular o financeiro.</div>
        <div className="financeiro-vazio-sub">
          Financeiro não guarda dado próprio: o resultado, o ciclo de caixa e os lançamentos aparecem aqui assim
          que houver saídas, entradas ou lançamentos cadastrados.
        </div>
      </div>
    )
  }

  const resultado = calcularResultado(saidas, entradas, lancamentos, periodo)
  const ciclo = calcularCicloCaixa(entradas, saidas, periodo)
  const label = rotuloPeriodo(periodo)

  return (
    <div className="financeiro-tela">

      <div className="financeiro-grid">
        <ResultadoCard resultado={resultado} label={label} />
        <div className="financeiro-coluna-direita">
          <CicloCaixaCard ciclo={ciclo} />
          <LucroDestaque resultado={resultado} label={label} />
        </div>
      </div>

      <div className="financeiro-lancamentos">
        {/* Título e dica do protótipo (852-853), achado FI-2. "do período"
            sem o nome do mês de propósito: o De/Até da lista embutida abre no
            período global mas o usuário pode alargá-lo ali mesmo, e um título
            fixo em "Junho/2026" passaria a mentir no instante seguinte. A
            linha é clicável desde sempre e nada dizia isso. */}
        <div className="financeiro-secao-cabecalho">
          <h3 className="financeiro-secao-titulo">Lançamentos do período</h3>
          <span className="financeiro-secao-dica">clique num lançamento para editar</span>
        </div>
        {/* O período global ALIMENTA o De/Até da lista embutida: ela abre no
            mesmo mês do resultado acima, e o De/Até continua lá para quem
            quiser um intervalo mais largo ou mais estreito (ver
            LancamentosLista.tsx). */}
        <LancamentosLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
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
      {/* De quantas entregas essa receita veio (achado FI-1, protótipo
          `finReceitaSub` ~2896). A contagem sai da MESMA lista filtrada que
          somou o valor (derive/financeiro.ts, `saidasDaReceita`), não de um
          segundo filtro escrito aqui. Zero é medido: mês sem entrega tem
          receita R$ 0 e 0 pedidos, e as duas coisas são verdade — não é caso
          de travessão. */}
      <div className="financeiro-receita-sub">
        {resultado.entregasNaReceita === 1
          ? '1 pedido entregue no período'
          : `${resultado.entregasNaReceita.toLocaleString('pt-BR')} pedidos entregues no período`}
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
 * silenciosamente no total.
 *
 * SEMÁFORO RESTAURADO (defeito 1 corrigido, autorizado pelo dono do
 * negócio): esta tela chegou a mostrar o total sem cor e sem meta, com uma
 * nota explicando que "a meta ≤13 dias valia para o cálculo antigo" — isso
 * porque, na época, a fórmula ainda somava pagamentoProdutor em vez de
 * subtrair (ver calcularCicloCaixa em derive/financeiro.ts), e a meta do
 * estudo (METAS_DASHBOARD.cicloCaixaMetaDias, calibrada para a SUBTRAÇÃO,
 * o CCC padrão) não fazia sentido pra soma. Com a fórmula corrigida, a meta
 * volta a se aplicar e o semáforo (statusCicloDeCaixa, mesma classificação
 * do Painel de Indicadores) volta a colorir o total — em vez de reimportar
 * as METAS/status daqui como números soltos, que é exatamente o tipo de
 * duplicação que o comentário de METAS_DASHBOARD (dashboard.ts) pede pra
 * evitar.
 *
 * A antiga barra empilhada (proporção de cada componente sobre o total) foi
 * removida: ela só fazia sentido quando os três valores eram somados (a
 * largura de cada segmento, em % do total, sempre batia 100%). Sob
 * subtração, pagamentoProdutor REDUZ o total em vez de compor com ele —
 * uma barra "empilhada" desenharia esse componente como se estivesse
 * somando, o oposto do que a fórmula faz. Os três valores continuam
 * visíveis, com nome e dias, na lista de componentes abaixo — o que o dono
 * do negócio pediu (ver de onde o número vem) não depende dessa barra.
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

  const status = ciclo.total !== null ? statusCicloDeCaixa(ciclo.total) : null
  const corTotal = status ? CORES_SEMAFORO[status] : NEUTRO
  const tagTexto = status === 'green' ? 'na meta' : status === 'amber' ? 'atenção' : status === 'red' ? 'fora da meta' : null

  return (
    <div className="financeiro-card">
      <div className="financeiro-ciclo-cabecalho">
        <h3 className="financeiro-card-titulo">Ciclo de caixa</h3>
        <span className="financeiro-mono financeiro-ciclo-total" style={{ color: corTotal }}>
          {diasTxt(ciclo.total)}
        </span>
      </div>
      <div className="financeiro-card-legenda">
        Giro de estoque + recebimento − pagamento ao produtor: o prazo que o produtor concede trabalha a favor do
        caixa, por isso é subtraído (Ciclo de Conversão de Caixa padrão), não somado.
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

      {tagTexto && (
        <div className="financeiro-ciclo-tag" style={{ color: corTotal }}>
          {tagTexto} · meta ≤ {METAS_DASHBOARD.cicloCaixaMetaDias} dias (âmbar até {METAS_DASHBOARD.cicloCaixaAmbarAteDias})
        </div>
      )}

      <div className="financeiro-ciclo-formula">
        Ciclo de caixa = giro de estoque + recebimento − pagamento ao produtor (CCC padrão). Se você recebe do
        cliente antes de pagar o produtor, é o produtor quem financia seu capital de giro nesse intervalo — por
        isso o prazo dele reduz o ciclo, em vez de somar.
      </div>
    </div>
  )
}
