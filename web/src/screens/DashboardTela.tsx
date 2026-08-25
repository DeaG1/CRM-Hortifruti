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
import type { ProdutoAgregado } from '../derive/relatorios'
import {
  filtrarPorPeriodo, queryDePeriodo, rotuloPeriodo, PERIODO_TODOS, type Periodo,
} from '../derive/periodo'
import {
  guiaDePrimeirosPassos,
  type ContagensDeCadastro,
  type GuiaDePrimeirosPassos,
} from '../derive/primeirosPassos'
import { guiaFoiDispensado, dispensarGuia } from '../preferenciaGuia'
import type { Tela } from '../telas'
import './DashboardTela.css'

const CORES: Record<Health, string> = { green: '#3f8f5b', amber: '#c79320', red: '#c2502f' }
const NEUTRO = '#6a685c'

const money = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const pct1 = (n: number) => n.toFixed(1).replace('.', ',') + '%'

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/SaidasLista.tsx. Fica na tela
 * porque toca `new Date()`; inadimplenciaGeral() continua pura recebendo a
 * data como parâmetro (ver derive/dashboard.ts). */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Texto do card quando o indicador nao esta disponivel: nunca "0", sempre
 * "—" com o motivo — o ponto central desta tela (ver derive/dashboard.ts). */
function valorOuTracejado(ind: Indicador, formatar: (v: number) => string): string {
  return ind.disponivel ? formatar(ind.valor) : '—'
}

// -------------------------------- indicador incompleto (sem peso médio)

/**
 * Texto do aviso — mesma regra e mesma marca das outras telas afetadas
 * (RelatoriosTela.tsx, EstoqueLista.tsx, ProdutosLista.tsx,
 * EntradasLista.tsx), com a consequência desta.
 *
 * Um indicador pode sair de uma soma da qual ficaram FORA lançamentos em
 * unidade diferente de KG cujo produto não tem peso médio cadastrado: a API
 * prefere deixá-los de fora a inventar um fator (ver `itens_sem_conversao`
 * em api/src/routes/perdas.ts e irmãs). O número continua sendo o melhor
 * disponível e continua sendo exibido — mas não pode ser exibido LIMPO, como
 * se fechasse: um painel existe para dizer se a operação está bem, e um
 * número incompleto sem marca é uma resposta confiante para uma pergunta que
 * ainda não foi respondida.
 *
 * O `*` é a sinalização mais discreta que ainda é honesta num cartão — não há
 * espaço para uma nota por cartão, então a explicação vai no `title` e o
 * rodapé do painel (um só, abaixo da grade) diz o que fazer a respeito.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 lançamento' : `${n} lançamentos`
  const verbo = n === 1 ? 'ficou' : 'ficaram'
  return `${itens} em unidade diferente de KG, sem peso médio cadastrado no produto, `
    + `${verbo} fora deste indicador — sem o peso da embalagem não há como somar em `
    + 'quilos. O número está calculado sobre uma quantidade incompleta.'
}

/** Quantos lançamentos ficaram fora de um indicador: 0 quando ele está
 * fechado, e 0 também quando ele é indisponível (não há conta nenhuma
 * para estar incompleta). */
function semConversaoDe(ind: Indicador): number {
  return ind.disponivel ? (ind.itensSemConversao ?? 0) : 0
}

interface CartaoKpi {
  rotulo: string
  valorTexto: string
  metaTexto: string
  tagTexto: string
  cor: string
  barraPct: number
  /** > 0 = o valor saiu de uma soma incompleta; o cartão ganha `*` e title. */
  semConversao: number
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
    return {
      rotulo, valorTexto: '—', metaTexto: ind.motivo, tagTexto: 'sem dado',
      cor: NEUTRO, barraPct: 0, semConversao: 0,
    }
  }
  const cor = classificar(ind.valor)
  const bateAMeta = cor === 'green'
  return {
    rotulo,
    valorTexto: formatar(ind.valor),
    metaTexto,
    tagTexto: bateAMeta ? 'na meta' : cor === 'amber' ? 'atenção' : 'fora da meta',
    // O semáforo NÃO muda por causa de lançamento fora da conta: a cor é um
    // julgamento sobre o valor medido, e o valor medido continua sendo esse.
    // Pintar de âmbar um indicador que bate a meta seria trocar um número
    // incompleto por um alarme falso — o `*` conserta a leitura, o alarme não
    // (mesma decisão do saldo negativo em EstoqueLista.tsx).
    cor: CORES[cor],
    barraPct: Math.min(100, Math.round((ind.valor / metaBase) * 100)),
    semConversao: semConversaoDe(ind),
  }
}

// -------------------------------- guia de primeiros passos (achado D-2)

/**
 * O painel de onboarding. Só DESENHA — quem decide o que está feito, qual é
 * o passo atual e se o painel deve existir é `guiaDePrimeirosPassos()`
 * (derive/primeirosPassos.ts), e quem lembra da dispensa é
 * preferenciaGuia.ts. Portado de design/CRM Hortifruti.dc.html:119-150.
 */
function PainelPrimeirosPassos(
  { guia, onIr, onDispensar }:
  { guia: GuiaDePrimeirosPassos; onIr: (tela: Tela) => void; onDispensar: () => void },
) {
  return (
    <section className="dashboard-guia" aria-label="Guia de primeiros passos">
      <div className="dashboard-guia-cabecalho">
        <div className="dashboard-guia-textos">
          <div className="dashboard-guia-titulo">{guia.titulo}</div>
          <div className="dashboard-guia-sub">{guia.sub}</div>
        </div>
        <div className="dashboard-guia-progresso">
          <div className="dashboard-guia-progresso-texto">{guia.progresso}</div>
          <div className="dashboard-guia-barra-trilha">
            <div className="dashboard-guia-barra-preenchimento" style={{ width: `${guia.barraPct}%` }} />
          </div>
        </div>
        {/* O guia fecha sozinho na primeira saída lançada; até lá, quem não
            quer o painel precisa de uma saída que não seja "cumpra os cinco
            passos agora". */}
        <button
          type="button"
          className="dashboard-guia-dispensar"
          onClick={onDispensar}
          title="Não mostrar mais este guia"
        >
          Dispensar
        </button>
      </div>
      <div className="dashboard-guia-passos">
        {guia.passos.map(p => (
          <div
            key={p.id}
            className={`dashboard-guia-passo${p.atual ? ' dashboard-guia-passo--atual' : ''}`}
          >
            <span
              className={
                'dashboard-guia-marca'
                + (p.feito ? ' dashboard-guia-marca--feito' : p.atual ? ' dashboard-guia-marca--atual' : '')
              }
              aria-hidden="true"
            >
              {p.marca}
            </span>
            <div className="dashboard-guia-passo-corpo">
              <div className={`dashboard-guia-passo-label${p.feito ? ' dashboard-guia-passo-label--feito' : ''}`}>
                {p.label}
                {/* O ✓ é decorativo (aria-hidden na bolinha); sem isto,
                    "feito" e "pendente" soam idênticos num leitor de tela. */}
                <span className="dashboard-guia-passo-situacao"> — {p.feito ? 'concluído' : 'pendente'}</span>
              </div>
              <div className="dashboard-guia-passo-hint">{p.hint}</div>
            </div>
            <div className="dashboard-guia-passo-contagem">{p.contagemTexto}</div>
            {p.mostrarCta && (
              <button type="button" className="dashboard-guia-cta" onClick={() => onIr(p.tela)}>
                {p.cta}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Estado da carga dos DOIS cadastros que o Dashboard ainda não buscava
 * (produtos e fornecedores). Fica separado do `Promise.all` das cinco listas
 * de propósito, por duas razões:
 *
 *  - Uma falha aqui não pode derrubar o painel inteiro. Os oito KPIs não
 *    dependem de produtos nem de fornecedores; se essa busca falhar, o que
 *    se perde é o guia, não a tela.
 *  - E o guia, sem esse dado, não pode CHUTAR. 'falhou' vira `null` na
 *    derivação, que fecha o painel — nunca "cadastre um produto" para quem
 *    tem cem e sofreu um erro de rede (ver derive/primeirosPassos.ts).
 */
type CargaDeCadastros =
  | { situacao: 'carregando' }
  | { situacao: 'ok'; produtos: number; fornecedores: number }
  | { situacao: 'falhou' }

interface DashboardTelaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). Esta tela é a razão
   * principal do filtro existir: sem recorte, o ticket médio vira média
   * histórica, a meta é comparada contra o acumulado de todas as épocas e
   * todo indicador "amolece" conforme a base cresce. O comentário que dizia
   * "esta tela nunca teve seletor de período" estava errado — o protótipo
   * (markup 95-101) sempre teve, e o Dashboard sempre respeitou.
   *
   * A CARTEIRA DE CLIENTES não é filtrada: "minimercados ativos" é uma
   * contagem de CADASTRO (quantos clientes estão com status ativo agora),
   * não um fluxo do mês. Filtrá-la faria o número cair para zero num mês sem
   * vendas, dizendo que a base de clientes evaporou.
   */
  periodo?: Periodo
  /**
   * Leva o usuário a outra tela — hoje só o botão do guia de primeiros
   * passos usa (achado D-2). Obrigatória, e não opcional com no-op: o botão
   * "Cadastrar produto" que não sai do lugar é pior que guia nenhum, e o
   * compilador é o único lugar onde esse esquecimento é barato de pegar.
   */
  onNavegar: (tela: Tela) => void
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada: () => void
}

export function DashboardTela({ periodo = PERIODO_TODOS, onNavegar, onSessaoExpirada }: DashboardTelaProps) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saidas, setSaidas] = useState<Saida[]>([])
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [perdas, setPerdas] = useState<Perda[]>([])
  const [produtosAgregados, setProdutosAgregados] = useState<ProdutoAgregado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [cadastros, setCadastros] = useState<CargaDeCadastros>({ situacao: 'carregando' })
  // Inicializador preguiçoso: lê o armazenamento UMA vez, na montagem — e
  // nunca deixa uma exceção de `localStorage` subir (ver preferenciaGuia.ts).
  const [guiaDispensado, setGuiaDispensado] = useState(guiaFoiDispensado)

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

  // Consolidado por produto (compra/venda/perda) — alimenta markupMedio().
  // Diferente da carga acima, este REFAZ a busca a cada troca de período: o
  // agregado é somado em SQL e já sai filtrado do servidor (?de=&ate=), do
  // mesmo jeito que RelatoriosTela e ProdutosLista fazem com o mesmo
  // endpoint. As outras cinco listas vêm inteiras e são recortadas em
  // memória logo abaixo — trocar o período no cabeçalho não precisa de cinco
  // idas ao servidor.
  useEffect(() => {
    let cancelado = false
    api.get<ProdutoAgregado[]>(`/api/relatorios/produtos${queryDePeriodo(periodo)}`)
      .then(pas => { if (!cancelado) setProdutosAgregados(pas) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada()
          return
        }
        setErro('Não foi possível carregar os dados do painel.')
      })
    return () => { cancelado = true }
  }, [periodo, onSessaoExpirada])

  /**
   * Produtos e fornecedores — os dois únicos dados do guia que o Dashboard
   * ainda não tinha. Os outros três passos saem das listas que já estavam
   * aqui: clientes, entradas e saídas (base inteira, não a recortada).
   *
   * Não dava para derivar nenhum dos dois do que já havia. O agregado de
   * `/api/relatorios/produtos` só traz produto MOVIMENTADO e vem filtrado
   * pelo período — produto recém-cadastrado, que é justo o caso do passo 1,
   * não aparece nele. E fornecedor só apareceria através de uma entrada, que
   * é o passo 4: o passo 2 precisa poder ser cumprido ANTES do 4, ou a ordem
   * do guia se contradiz. Duas listas curtas (`select *` sem join pesado nem
   * agregação), buscadas uma vez na montagem.
   *
   * SEM `periodo` NA DEPENDÊNCIA — de propósito: o guia é sobre CADASTRO, e
   * cadastro não pertence a mês nenhum. É a mesma razão pela qual a carteira
   * de clientes não é filtrada (ver a prop `periodo` acima). Trocar o mês no
   * cabeçalho não muda o guia nem refaz esta busca.
   */
  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<unknown[]>('/api/produtos'),
      api.get<unknown[]>('/api/fornecedores'),
    ])
      .then(([ps, fs]) => {
        if (cancelado) return
        setCadastros({ situacao: 'ok', produtos: ps.length, fornecedores: fs.length })
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada()
          return
        }
        // Não mexe em `erro`: uma falha aqui esconde o guia, não a tela.
        setCadastros({ situacao: 'falhou' })
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  if (carregando) return <p className="dashboard-estado">Carregando…</p>
  if (erro) return <p className="dashboard-estado dashboard-estado--erro" role="alert">{erro}</p>

  // ---- guia de primeiros passos (achado D-2) ----
  // As contagens vêm da base INTEIRA — `clientes`, `entradas` e `saidas`, e
  // não `saidasPeriodo`/`entradasPeriodo` (que nem existem ainda neste ponto
  // do arquivo, o que é proposital: o guia não tem como filtrar por engano).
  const contagens: ContagensDeCadastro | null = cadastros.situacao === 'ok'
    ? {
      produtos: cadastros.produtos,
      fornecedores: cadastros.fornecedores,
      clientes: clientes.length,
      entradas: entradas.length,
      saidas: saidas.length,
    }
    : null
  const guia = guiaDePrimeirosPassos(contagens, guiaDispensado)

  function dispensar() {
    // O retorno diz se a preferência sobreviverá ao F5; o painel fecha de
    // qualquer jeito. Quem clicou em "Dispensar" tem direito a ver o painel
    // sumir mesmo com o armazenamento bloqueado — só voltará na próxima
    // recarga (ver preferenciaGuia.ts).
    dispensarGuia()
    setGuiaDispensado(true)
  }

  const painelDoGuia = guia.aberto
    ? <PainelPrimeirosPassos guia={guia} onIr={onNavegar} onDispensar={dispensar} />
    : null

  if (clientes.length === 0) {
    // O guia vem ANTES do estado vazio, e não no lugar dele: o estado vazio
    // explica por que a tela está muda, o guia diz o que fazer a respeito —
    // e é justamente aqui, no sistema recém-aberto, que ele mais serve.
    return (
      <div className="dashboard-tela">
        {painelDoGuia}
        <div className="estado-vazio dashboard-vazio">
          <div className="dashboard-vazio-titulo">Nenhum cliente cadastrado ainda.</div>
          <div className="dashboard-vazio-sub">
            Cadastre os minimercados que você atende para começar a acompanhar a saúde do negócio — os
            indicadores desta tela dependem da carteira de clientes.
          </div>
        </div>
      </div>
    )
  }

  // ---- recorte de período ----
  // Cada lista é filtrada pela SUA data de referência: a saída pela entrega
  // (é quando a receita acontece), a entrada e a perda pela data do evento,
  // o lançamento pela data do custo. `clientes` fica FORA: é cadastro (ver o
  // comentário da prop `periodo`).
  const saidasPeriodo = filtrarPorPeriodo(saidas, periodo, s => s.entrega)
  const entradasPeriodo = filtrarPorPeriodo(entradas, periodo, e => e.data)
  const lancamentosPeriodo = filtrarPorPeriodo(lancamentos, periodo, l => l.data)
  const perdasPeriodo = filtrarPorPeriodo(perdas, periodo, p => p.data)

  // ---- financeiro base ----
  const receita = receitaBruta(saidasPeriodo)
  const custo = custoTotal(entradasPeriodo, lancamentosPeriodo)
  const lucro = lucroLiquido(receita, custo)
  const pctLucro = percentualLucro(receita, lucro)
  const nAtivos = clientesAtivos(clientes)
  // Giro e ciclo recebem as listas INTEIRAS mais o período: os dois medem
  // DIAS, e o denominador deles é o número de dias do período escolhido
  // (`diasDoPeriodo` em derive/financeiro.ts). Passar a lista já filtrada com
  // periodo='all' faria a janela ser medida pelo intervalo entre a primeira e
  // a última data presentes — um mês com uma venda só teria "1 dia" de
  // período e o giro sairia absurdo.
  const giro = giroDeEstoque(entradas, saidas, periodo)
  const ciclo = cicloDeCaixa(entradas, saidas, periodo)

  const entreguesCount = saidasPeriodo.filter(s => s.status === 'Entregue').length

  // ---- cartoes do topo ----
  const equilibrioDiff = nAtivos - METAS_DASHBOARD.clientesAtivosEquilibrio

  // ---- KPIs (painel de indicadores) ----
  const perdas1 = indiceDePerdas(entradasPeriodo, perdasPeriodo)
  // `produtosAgregados` já vem filtrado do servidor (ver o efeito acima).
  const markup = markupMedio(produtosAgregados)
  const ticketMes = ticketMedioPorMinimercado(saidasPeriodo)
  const ticketEntrega = ticketMedioPorEntrega(saidasPeriodo)
  const inad = inadimplenciaGeral(saidasPeriodo, hojeIsoLocal())

  const kpis: CartaoKpi[] = [
    cartaoDeIndicador('Índice de perdas (%)', perdas1, pct1, '≤ 10%', statusIndiceDePerdas, METAS_DASHBOARD.perdaMetaPct),
    cartaoDeIndicador('Markup médio (venda/compra)', markup, v => Math.round(v) + '%', '≥ 60%', statusMarkup, METAS_DASHBOARD.markupMetaPct),
    {
      rotulo: 'Nº de minimercados ativos', valorTexto: String(nAtivos), metaTexto: '~35',
      tagTexto: statusClientesAtivosKpi(nAtivos) === 'green' ? 'na meta' : statusClientesAtivosKpi(nAtivos) === 'amber' ? 'atenção' : 'fora da meta',
      cor: CORES[statusClientesAtivosKpi(nAtivos)],
      barraPct: Math.min(100, Math.round((nAtivos / METAS_DASHBOARD.clientesAtivosMeta) * 100)),
      // Contagem de cadastro, não soma de quantidade — nunca fica incompleta
      // por falta de peso médio.
      semConversao: 0,
    },
    cartaoDeIndicador('Ticket médio / minimercado', ticketMes, money, '3,5–3,8k', statusTicketMes, METAS_DASHBOARD.ticketMesMetaAlto),
    cartaoDeIndicador('Ticket médio por entrega', ticketEntrega, money, '≥ R$ 430', statusTicketEntrega, METAS_DASHBOARD.ticketEntregaMeta),
    cartaoDeIndicador('Inadimplência por cliente', inad, pct1, '≤ 1%', statusInadimplencia, METAS_DASHBOARD.inadimplenciaMetaPct),
    cartaoDeIndicador('Giro de estoque (dias)', giro, v => String(Math.round(v)), '≤ 4 d', statusGiroDeEstoque, METAS_DASHBOARD.giroEstoqueMetaDias),
    cartaoDeIndicador('Ciclo de caixa (dias)', ciclo, v => String(Math.round(v)), '≤ 13 d', statusCicloDeCaixa, METAS_DASHBOARD.cicloCaixaMetaDias),
  ]

  // Quantos lançamentos ficaram fora de ALGUM cartão — decide se a nota de
  // rodapé do painel aparece. Hoje só o Índice de perdas alimenta isto; o
  // total é lido do próprio array de cartões (não recalculado a partir de
  // `perdas1`) para que qualquer indicador que passe a marcar no futuro entre
  // na nota sem que ninguém precise lembrar de somá-lo aqui.
  const totalSemConversaoKpis = kpis.reduce((s, k) => s + k.semConversao, 0)

  // Clientes inteiros (cadastro) x saidas do periodo: a concentracao e
  // quanto do faturamento DO PERIODO veio de cada cliente, e todo cliente
  // cadastrado e candidato — quem nao vendeu no mes aparece com 0%, nao
  // desaparece da carteira.
  const carteira = concentracaoDeCarteira(clientes, saidasPeriodo)
  const cenarios = cenariosDeResultado(receita, custo)

  return (
    <div className="dashboard-tela">
      {painelDoGuia}

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
          <span className="dashboard-kpis-contagem">
            {kpis.length} KPIs do estudo · meta vs. realizado · {rotuloPeriodo(periodo)}
          </span>
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
              <div className="dashboard-kpi-valor" style={{ color: k.cor }}>
                {k.semConversao > 0
                  ? (
                    <span className="dashboard-kpi-incompleto" title={avisoSemConversao(k.semConversao)}>
                      {k.valorTexto}*
                    </span>
                  )
                  : k.valorTexto}
              </div>
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
        {/* Uma nota só, abaixo da grade, e não uma por cartão: o `*` já diz
            QUAL indicador está incompleto; o que falta é a saída do problema,
            que é a mesma para todos. Some inteira quando nada ficou de fora. */}
        {totalSemConversaoKpis > 0 && (
          <div className="dashboard-kpis-nota" role="note">
            <strong>*</strong> {avisoSemConversao(totalSemConversaoKpis)} Cadastre o peso médio da
            embalagem em Produtos para que esses lançamentos entrem na conta.
          </div>
        )}
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
