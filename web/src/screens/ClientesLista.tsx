import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { derivarClientes, type Cliente, type Pedido, type ClienteDerivado, type StatusCliente, type Health } from '../derive/clientes'
import { PERIODO_TODOS, rotuloPeriodo, type Periodo } from '../derive/periodo'
import { statusTicketEntrega, statusInadimplencia } from '../derive/dashboard'
import { podeVerMetricasDeCadastro, type Papel } from '../telas'
import './ClientesLista.css'

const STATUS_LABEL: Record<StatusCliente, string> = {
  ativo: 'Ativo',
  negociacao: 'Em negociação',
  inadimplente: 'Inadimplente',
  inativo: 'Inativo',
}

function rotuloStatus(s: StatusCliente): string {
  return STATUS_LABEL[s] ?? s
}

const FILTROS = ['Todos', 'Ativo', 'Em negociação', 'Inadimplente', 'Inativo'] as const
type Filtro = (typeof FILTROS)[number]

const COR_FILTRO: Record<Filtro, string> = {
  Todos: '#9a9784',
  Ativo: '#3f8f5b',
  'Em negociação': '#c79320',
  Inadimplente: '#c2502f',
  Inativo: '#9a9784',
}

const HEALTH_INFO: Record<Health, { cor: string; bg: string; label: string }> = {
  green: { cor: '#3f8f5b', bg: '#e7f1e8', label: 'Saudável' },
  amber: { cor: '#c79320', bg: '#f6efd8', label: 'Atenção' },
  red: { cor: '#c2502f', bg: '#f6e4dc', label: 'Risco' },
}

const NEUTRO = '#9a9784'

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/SaidasLista.tsx. Fica na tela
 * (não em derive/clientes.ts) porque toca `new Date()`: a função pura
 * (`derivarClientes` → `inadimplenciaPorCliente` → `situacaoExibidaSaida`)
 * recebe isso como parâmetro, pra continuar testável sem mockar relógio. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/**
 * Cor do ticket por entrega: portado de entregaColor do protótipo. Zero fica
 * neutro (ainda não há pedidos), em vez de vermelho — sem pedido não é risco.
 *
 * A CLASSIFICAÇÃO em si vem de `statusTicketEntrega` (derive/dashboard.ts), a
 * mesma que o Painel de Indicadores e a ficha do cliente usam: aqui esta
 * função repetia os limiares 430/150 escritos à mão, e o mesmo ticket podia
 * sair verde numa tela e âmbar na outra no dia em que alguém mudasse a meta
 * num lugar só. Aqui ficou só o que é DESTA tela: o caso "ainda não há
 * pedido", que o semáforo do painel não precisa distinguir.
 */
function corTicketEntrega(v: number): string {
  if (v <= 0) return NEUTRO
  return HEALTH_INFO[statusTicketEntrega(v)].cor
}

/** Mesma história de `corTicketEntrega`: os limiares (1% / 2%) moram em
 * METAS_DASHBOARD, e a classificação em `statusInadimplencia`. */
function corInadimplencia(pct: number): string {
  return HEALTH_INFO[statusInadimplencia(pct)].cor
}

/** Cabeçalho de uma saída (venda), como GET /api/saidas devolve — ver
 * api/src/routes/saidas.ts (paraJson). Só os campos que `paraPedidos`
 * (abaixo) usa; mesmo padrão de tipo raso por consumidor que
 * derive/relatorios.ts (SaidaResumo) e derive/financeiro.ts (SaidaFin) já
 * seguem — não é o tipo "cheio" de ModalSaida.tsx de propósito. */
interface SaidaBruta {
  id: string
  cliente_id: string | null
  entrega: string | null
  valor: number
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  venc: string | null
}

/**
 * Converte o formato bruto de GET /api/saidas (`cliente_id`, chave
 * estrangeira real) para o `Pedido` que `derivarClientes` espera
 * (`cliente`, o NOME do cliente) — `Pedido` é o tipo herdado do protótipo,
 * de antes de existir schema/API, e as demais funções de derive/clientes.ts
 * (ticketPorEntrega, inadimplenciaPorCliente) já dependem de `cliente` ser
 * o nome pra agrupar via `p.cliente === c.nome`. É a resposta que se adapta
 * aqui — não o tipo que se renomeia pra bater com o banco (`Pedido` é usado
 * só aqui hoje, mas nao deveria virar `cliente_id` por isso).
 *
 * Sem `cliente_id` (venda avulsa) ou com um `cliente_id` que não bate com
 * nenhum cliente carregado (cadastro excluído depois da venda), usa o
 * próprio `cliente_id` (ou '' se nulo) como `cliente`: nunca é igual a um
 * nome real, então a venda ainda entra no faturamento total do período
 * (como toda venda real deveria) mas não fica atribuída a cliente nenhum.
 */
function paraPedidos(saidasBrutas: SaidaBruta[], clientes: Cliente[]): Pedido[] {
  const nomePorId = new Map(clientes.map(c => [c.id, c.nome]))
  return saidasBrutas.map(s => ({
    id: s.id,
    cliente: (s.cliente_id && nomePorId.get(s.cliente_id)) || s.cliente_id || '',
    entrega: s.entrega ?? '',
    valor: s.valor,
    status: s.status,
    pag: s.pag,
    venc: s.venc,
  }))
}

interface ClientesListaProps {
  /**
   * Quem está olhando. O colaborador vê e edita o CADASTRO (estabelecimento,
   * responsável, rota, frequência, status) e não vê as métricas da carteira —
   * faturado, ticket por entrega, participação, inadimplência e health score.
   * Decisão em `podeVerMetricasDeCadastro` (telas.ts); esta tela só exibe.
   *
   * Sem default de propósito: um valor padrão faria a tela mostrar o
   * faturamento por cliente a quem esquecesse de informar o papel.
   */
  papel: Papel
  onAbrir: (id: string) => void
  /** Período global do cabeçalho (App.tsx). O CADASTRO nunca some com ele —
   * um cliente não desaparece da carteira porque não comprou em julho; o
   * que respeita o recorte são as colunas derivadas (faturado, ticket,
   * participação, inadimplência) e, por consequência, a saúde do cliente. */
  periodo?: Periodo
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ClientesLista(
  { papel, onAbrir, periodo = PERIODO_TODOS, onSessaoExpirada }: ClientesListaProps,
) {
  const verMetricas = podeVerMetricasDeCadastro(papel)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [saidasBrutas, setSaidasBrutas] = useState<SaidaBruta[]>([])
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [erroVendas, setErroVendas] = useState('')

  useEffect(() => {
    let cancelado = false
    api.get<Cliente[]>('/api/clientes')
      .then(cs => { if (!cancelado) setClientes(cs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os clientes.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Vendas do período: busca separada da lista de clientes acima, e falha
  // SOZINHA — se /api/saidas cair, a carteira de clientes (o que esta tela
  // existe pra mostrar) continua visível, so com as metricas que dependem
  // de venda indisponiveis (ver `erroVendas` e o aviso discreto abaixo, e
  // o travessao no lugar de zero nas celulas). A busca continua trazendo a
  // lista inteira e o recorte de periodo e aplicado em memoria (por
  // `derivarClientes`), pra trocar o periodo no cabecalho nao disparar uma
  // ida ao servidor a cada mudanca —
  // se o volume de saidas crescer a ponto de isso pesar (aproximando de
  // dezenas de milhares de linhas), a resposta e um endpoint agregado por
  // periodo, igual ao que ja existe para /api/relatorios/produtos.
  //
  // COLABORADOR NAO BUSCA. `GET /api/saidas` responde para ele — Saidas e
  // tela dele —, entao faturado, ticket e inadimplencia nao sao protegiveis
  // por permissao: quem lanca as vendas pode soma-las por fora, e o dono
  // aceitou isso. O que esta tela nao faz e ENTREGAR o agregado pronto. Nao
  // pedir o que nao vai mostrar e a consequencia disso, nao a protecao: sem
  // as cinco colunas na tela, a requisicao seria trafego a toa.
  useEffect(() => {
    if (!verMetricas) return
    let cancelado = false
    api.get<SaidaBruta[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidasBrutas(ss) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroVendas('Não foi possível carregar as vendas do período — os números da carteira ficam indisponíveis.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada, verMetricas])

  const pedidos = paraPedidos(saidasBrutas, clientes)
  const derivados: ClienteDerivado[] = derivarClientes(clientes, pedidos, periodo, hojeIsoLocal())
  const visiveis = filtro === 'Todos'
    ? derivados
    : derivados.filter(c => rotuloStatus(c.status) === filtro)

  if (carregando) return <p className="clientes-estado">Carregando…</p>
  if (erro) return <p className="clientes-estado clientes-estado--erro" role="alert">{erro}</p>
  if (clientes.length === 0) {
    return (
      <div className="estado-vazio clientes-vazio">
        <div className="clientes-vazio-titulo">Nenhum cliente cadastrado ainda.</div>
        <div className="clientes-vazio-sub">
          Cadastre os clientes que você atende. Sem cliente não é possível lançar uma saída (venda).
        </div>
      </div>
    )
  }

  const contagem = (rotulo: Filtro) =>
    rotulo === 'Todos' ? derivados.length : derivados.filter(c => rotuloStatus(c.status) === rotulo).length

  return (
    <div className="clientes-lista">
      {erroVendas && (
        <p className="clientes-aviso-vendas" role="status">{erroVendas}</p>
      )}

      {/* Sem esta linha, um cliente inteiro em travessão pareceria cliente
          sem venda nenhuma, quando é só o recorte escolhido no cabeçalho.
          Para colaborador não há números da carteira na tela, então a nota
          falaria de colunas que não existem ali. */}
      {verMetricas && (
        <p className="clientes-periodo-nota">
          Cadastro completo · números da carteira: <strong>{rotuloPeriodo(periodo)}</strong>
        </p>
      )}

      <div className="clientes-filtros">
        {FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtro ? 'clientes-filtro clientes-filtro--ativo' : 'clientes-filtro'}
            onClick={() => setFiltro(f)}
            aria-pressed={f === filtro}
          >
            <span className="clientes-filtro-dot" style={{ background: COR_FILTRO[f] }} />
            <span className="clientes-filtro-label">{f}</span>
            <span className="clientes-filtro-contagem">{contagem(f)}</span>
          </button>
        ))}
        {/* A linha é clicável desde sempre (o `onClick` da linha, abaixo), mas
            nada na tela dizia isso: uma afordância que existe e está
            invisível vale tanto quanto uma que não existe. Protótipo linha
            251, achado CL-1 da auditoria. Fica AQUI, no fim da barra de
            filtros, e não junto ao botão "Novo cliente" (que mora em
            App.tsx), porque é sobre a tabela logo abaixo. */}
        <div className="clientes-filtros-spacer" />
        <div className="clientes-dica">Clique numa linha para abrir a ficha</div>
      </div>

      {/* `--cadastro` reduz a grade de sete colunas para duas (ver
          ClientesLista.css): sem as cinco de métrica, manter as faixas vazias
          espremeria nome e rota no canto de uma tabela que parece quebrada. */}
      <div className={verMetricas ? 'clientes-tabela' : 'clientes-tabela clientes-tabela--cadastro'}>
        <div className="clientes-linha clientes-linha--cabecalho">
          <div>ESTABELECIMENTO</div>
          <div>ROTA</div>
          {verMetricas && (
            <>
              <div className="clientes-col-num">TICKET/MÊS</div>
              <div className="clientes-col-num">/ENTREGA</div>
              <div className="clientes-col-num">% FAT</div>
              <div className="clientes-col-num">INADIMP.</div>
              <div className="clientes-col-num">SAÚDE</div>
            </>
          )}
        </div>

        {visiveis.map(c => {
          const health = HEALTH_INFO[c.health]
          return (
            <div
              key={c.id}
              className="clientes-linha clientes-linha--dados"
              onClick={() => onAbrir(c.id)}
            >
              <div className="clientes-celula-nome">
                {/* O ponto colorido É o health score em miniatura (mesma cor
                    do selo da última coluna) — sai junto com ele, senão o
                    colaborador leria "cliente em risco" sem a coluna que
                    explica de onde vem. */}
                {verMetricas && (
                  <span className="clientes-health-dot" style={{ background: health.cor }} />
                )}
                <div className="clientes-nome-bloco">
                  <div className="clientes-nome">{c.nome}</div>
                  <div className="clientes-nome-sub">{c.resp} · {rotuloStatus(c.status)}</div>
                </div>
              </div>
              <div className="clientes-rota">
                {c.rota}
                <div className="clientes-freq">{c.freq}</div>
              </div>
              {verMetricas && (
                <>
                  <div className="clientes-col-num clientes-mono">{c.faturado ? money(c.faturado) : '—'}</div>
                  <div
                    className="clientes-col-num clientes-mono"
                    style={{ color: corTicketEntrega(c.ticketEntrega) }}
                  >
                    {c.ticketEntrega ? money(c.ticketEntrega) : '—'}
                  </div>
                  {/* Sem faturado no periodo (cliente sem venda, OU vendas
                      indisponiveis por falha de /api/saidas), participacao e
                      inadimplencia ficam em travessao — nao "0%"/"0,0%", que
                      fingiria ser um dado real (0% de atraso de quem nao
                      vendeu nada e diferente de 0% de atraso de quem vendeu e
                      pagou tudo em dia). */}
                  <div className="clientes-col-num clientes-mono">{c.faturado ? `${c.participacao}%` : '—'}</div>
                  <div
                    className="clientes-col-num clientes-mono"
                    style={{ color: c.faturado ? corInadimplencia(c.inadimplencia) : NEUTRO }}
                  >
                    {c.faturado ? c.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
                  </div>
                  <div className="clientes-col-num">
                    <span className="clientes-health-badge" style={{ color: health.cor, background: health.bg }}>
                      {c.tend} {health.label}
                    </span>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {visiveis.length === 0 && (
          <div className="clientes-sem-filtro">Nenhum cliente com este status.</div>
        )}
      </div>
    </div>
  )
}
