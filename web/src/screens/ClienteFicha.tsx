import { useEffect, useState, type ReactNode } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarClientes,
  statusCobrancaCliente,
  ultimaCompraCliente,
  quantidadeEntregueCliente,
  atrasosDoCliente,
  pedidosRecentesCliente,
  type Cliente,
  type Pedido,
  type StatusCliente,
  type Health,
  type StatusCobranca,
} from '../derive/clientes'
import {
  METAS_DASHBOARD,
  statusFaturadoCliente,
  statusTicketEntrega,
  statusInadimplencia,
} from '../derive/dashboard'
import { rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import { situacaoExibidaSaida } from '../derive/pagamento'
import { podeVerMetricasDeCadastro, podeExcluirCadastro, type Papel } from '../telas'
import './ClienteFicha.css'

const STATUS_LABEL: Record<StatusCliente, string> = {
  ativo: 'Ativo',
  negociacao: 'Em negociação',
  inadimplente: 'Inadimplente',
  inativo: 'Inativo',
}

const HEALTH_INFO: Record<Health, { cor: string; bg: string; label: string }> = {
  green: { cor: '#3f8f5b', bg: '#e7f1e8', label: 'Saudável' },
  amber: { cor: '#c79320', bg: '#f6efd8', label: 'Atenção' },
  red: { cor: '#c2502f', bg: '#f6e4dc', label: 'Risco' },
}

/** Cor de um número sem julgamento a fazer (métrica sem meta) e de todo
 * travessão: ausência de dado não é boa nem má notícia, e pintá-la de
 * vermelho faria "não medi" parecer "está ruim". */
const NEUTRO = '#2a2a24'

/** Cor do status de cobranca — o prototipo pinta este campo de verde ou
 * vermelho (`design/CRM Hortifruti.dc.html` ~2249). Reaproveita os mesmos
 * hex do HEALTH_INFO acima pra tela nao ganhar um terceiro verde. Sem
 * entrada para a ausencia de status: travessao fica na cor normal do valor,
 * porque "nao ha o que cobrar" nao e nem boa nem ma noticia. */
const COBRANCA_COR: Record<StatusCobranca, string> = {
  'Em dia': '#3f8f5b',
  'Atrasado': '#c2502f',
}

/** Selo de status do pedido no bloco "Pedidos recentes" (protótipo
 * `pStatusColor`/`pStatusBg`, célula 344). Mesmas cores da coluna STATUS de
 * SaidasLista.tsx — é paleta, não regra: o mesmo estado tem que ter a mesma
 * cor nas duas telas, e um mapa de cor não é aritmética a centralizar em
 * `derive/`. 'Em rota' fica neutro de propósito (é "em andamento", não um
 * julgamento). */
const STATUS_PEDIDO: Record<Pedido['status'], { cor: string; bg: string }> = {
  Pendente: { cor: '#c79320', bg: '#f6efd8' },
  'Em rota': { cor: '#9a9784', bg: '#f1eee2' },
  Entregue: { cor: '#3f8f5b', bg: '#e7f1e8' },
  Cancelado: { cor: '#c2502f', bg: '#f6e4dc' },
  Devolvido: { cor: '#c2502f', bg: '#f6e4dc' },
}

/** Quantos pedidos o bloco "Pedidos recentes" mostra — `slice(0,4)` do
 * protótipo (2252). */
const QUANTOS_PEDIDOS_RECENTES = 4

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')
const pesoTxt = (n: number) => n.toLocaleString('pt-BR') + ' kg'

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/ClientesLista.tsx. Fica na
 * tela porque toca `new Date()`; `derivarClientes` continua pura recebendo
 * a data como parâmetro. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Mesma dupla de RelatoriosTela.tsx/AbaClientes: valor em R$, ou travessao
 * quando nao ha dado real por tras (nunca "R$ 0", que fingiria um zero
 * apurado). */
const moneyOuTraco = (n: number) => (n ? money(n) : '—')

/** 'AAAA-MM-DD' -> 'DD/MM'. Mesmo formato de dataBr em SaidasLista.tsx/
 * RelatoriosTela.tsx. Travessao sem data valida. */
function dataBr(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—'
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** Igual a `dataBr`, COM o ano. Usada só na métrica "Última compra", que é a
 * única desta tela que não respeita o filtro de período: "10/06" para uma
 * compra de dois anos atrás leria como "mês passado" e é justamente o
 * cliente parado que essa métrica existe pra denunciar. */
function dataBrAno(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

/** "1 entrega" / "3 entregas" — o "N entrega(s)" do protótipo (2233) sem o
 * parêntese, que existia só pra não ter que decidir o plural. */
function plural(n: number, singular: string, plural_: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural_}`
}

/**
 * Cabeçalho de uma saída (venda), como GET /api/saidas devolve — ver
 * api/src/routes/saidas.ts (paraJson) e o mesmo tipo em
 * ClientesLista.tsx (par desta tela, mesma justificativa de tipo raso
 * duplicado por consumidor).
 */
interface SaidaBruta {
  id: string
  /** Identificador legível do pedido — a coluna PEDIDO de SaidasLista. É por
   * ele que se acha o pedido lá a partir desta ficha. */
  numero: string
  cliente_id: string | null
  entrega: string | null
  valor: number
  /** Quantidade em kg, já convertida pela API (ver `itens_sem_conversao`). */
  peso?: number
  itens_sem_conversao?: number
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  venc: string | null
}

/**
 * Converte o formato bruto de GET /api/saidas para o `Pedido` que
 * `derivarClientes` espera — mesma ideia de `paraPedidos` em
 * ClientesLista.tsx, mas sem precisar da lista inteira de clientes: aqui só
 * um cliente importa (`alvo`), então basta marcar como dele as saídas cujo
 * `cliente_id` bate com o id da ficha; as demais recebem o próprio
 * `cliente_id` (ou '' se nulo) — nunca igual a `alvo.nome`, então continuam
 * fora de `alvo`, mas ainda contam no faturamento total do período
 * (`derivarClientes` usa TODAS as saídas passadas pra calcular a
 * participação, não só as do cliente da ficha — daí buscar a lista inteira
 * de /api/saidas aqui, não uma rota filtrada por cliente).
 */
function paraPedidos(saidasBrutas: SaidaBruta[], alvo: Cliente): Pedido[] {
  return saidasBrutas.map(s => ({
    id: s.id,
    numero: s.numero,
    cliente: s.cliente_id === alvo.id ? alvo.nome : (s.cliente_id || ''),
    entrega: s.entrega ?? '',
    valor: s.valor,
    peso: s.peso,
    itensSemConversao: s.itens_sem_conversao,
    status: s.status,
    pag: s.pag,
    venc: s.venc,
  }))
}

function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(w => w.length > 2)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

/**
 * Texto do aviso de quantidade incompleta — mesma regra e mesmo `*` de
 * SaidasLista/EntradasLista/Produtos: item em unidade diferente de KG cujo
 * produto não tem peso médio cadastrado não é convertível, a API o deixa de
 * fora de `peso` em vez de inventar um fator, e a tela diz que o total está
 * incompleto em vez de exibi-lo como fechado.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 item' : `${n} itens`
  const verbo = n === 1 ? 'está' : 'estão'
  return `${itens} das entregas deste cliente em unidade diferente de KG sem peso médio cadastrado no `
    + `produto: ${verbo} fora desta quantidade, porque sem o peso da embalagem não há como converter em `
    + 'quilos. Cadastre o peso médio em Produtos para que entrem na conta.'
}

/** Uma métrica do bloco "Métricas comerciais": rótulo, valor (com a cor do
 * semáforo) e o sub-rótulo que diz qual é a meta — sem ele o número aparece
 * sem a régua que diz se é bom (achado CF-4). */
function Metrica({ label, valor, sub, cor }: {
  label: string
  valor: ReactNode
  sub: ReactNode
  cor?: string
}) {
  return (
    <div className="ficha-metrica">
      <div className="ficha-metrica-label">{label}</div>
      <div className="ficha-metrica-valor" style={{ color: cor ?? NEUTRO }}>{valor}</div>
      <div className="ficha-metrica-sub">{sub}</div>
    </div>
  )
}

interface ClienteFichaProps {
  id: string
  /**
   * Quem está olhando — a ficha é a mesma história da lista: CADASTRO sim,
   * MÉTRICA não. Para colaborador saem de cena o bloco "Métricas comerciais"
   * (qtd, faturado, ticket, participação, última compra, inadimplência), o
   * selo de HEALTH SCORE do cabeçalho, o bloco "Crédito & inadimplência"
   * (limite de crédito, prazo, status de cobrança, taxa, histórico de
   * atrasos) e "Pedidos recentes" — que é a matéria-prima dos números, pedido
   * a pedido, com valor. Ficam o cabeçalho de identificação, "Cadastro &
   * rota" e as observações do vendedor, que é o que ele precisa para atender.
   *
   * O botão "Excluir" também sai (`podeExcluirCadastro`); "Editar cliente"
   * fica, porque editar passou a ser dos dois papéis.
   */
  papel: Papel
  /**
   * Período global do cabeçalho (App.tsx, achado S-3) — o MESMO que
   * ClientesLista recebe, para o faturado, o ticket, a participação e a
   * inadimplência da ficha baterem com a linha da lista de onde o usuário
   * acabou de clicar. Sem isso a ficha somava a base inteira e mostrava um
   * número maior que o da lista, para o mesmo cliente, na mesma sessão.
   *
   * Nem tudo nesta tela segue o recorte, e é de propósito (o protótipo faz a
   * mesma separação): "última compra", "histórico de atrasos", "status de
   * cobrança" e "pedidos recentes" saem do histórico INTEIRO — dívida
   * vencida em maio continua sendo dívida em agosto, e um cliente que parou
   * de comprar precisa mostrar a data em que comprou pela última vez, não um
   * travessão. A legenda do bloco de métricas diz qual é qual.
   */
  periodo?: Periodo
  onVoltar: () => void
  onEditar: (cliente: Cliente) => void
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ClienteFicha(
  { id, papel, periodo = PERIODO_TODOS, onVoltar, onEditar, onSessaoExpirada }: ClienteFichaProps,
) {
  const verMetricas = podeVerMetricasDeCadastro(papel)
  const podeExcluir = podeExcluirCadastro(papel)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [saidasBrutas, setSaidasBrutas] = useState<SaidaBruta[]>([])
  const [erroVendas, setErroVendas] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  useEffect(() => {
    // Sem `setCarregando(true)`/`setErro('')` no topo do efeito de proposito:
    // App.tsx remonta ClienteFicha inteira (key muda) a cada troca de `id`
    // ou salvamento, entao o estado inicial (carregando=true, erro='') ja
    // vem limpo de fabrica — resetar aqui de novo so dispararia um render
    // sincrono extra dentro do efeito sem necessidade.
    let cancelado = false
    api.get<Cliente>(`/api/clientes/${id}`)
      .then(c => { if (!cancelado) setCliente(c) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        if (err instanceof ErroApi && err.status === 404) {
          setErro('Cliente não encontrado.')
          return
        }
        setErro('Não foi possível carregar o cliente.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [id, onSessaoExpirada])

  // Vendas (todas, nao so as deste cliente — derivarClientes precisa do
  // total pra calcular a participacao dele no faturamento) — busca separada
  // da ficha em si, e falha SOZINHA: mesmo espirito de ClientesLista.tsx,
  // uma falha aqui nao pode apagar a ficha do cliente que ja carregou, so
  // deixa as metricas comerciais indisponiveis (ver `erroVendas`).
  //
  // A lista vem inteira e o recorte de periodo e aplicado em memoria (mesma
  // decisao, e mesma nota de escala, de ClientesLista.tsx): trocar o mes no
  // cabecalho nao dispara uma ida ao servidor.
  //
  // COLABORADOR NAO BUSCA, pelo mesmo motivo (e com a mesma ressalva honesta)
  // de ClientesLista: `GET /api/saidas` responde para ele, entao esconder
  // faturado e inadimplencia aqui e apresentacao, nao permissao. Nada nesta
  // tela usaria a resposta — os tres blocos que dependem dela nao sao
  // renderizados —, entao pedi-la seria trafego a toa.
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
        setErroVendas('Não foi possível carregar as vendas — as métricas comerciais ficam indisponíveis.')
      })
    return () => { cancelado = true }
  }, [id, onSessaoExpirada, verMetricas])

  async function excluir() {
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/clientes/${id}`)
      onVoltar()
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      setErroExclusao('Não foi possível excluir. Tente novamente.')
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <p className="ficha-estado">Carregando…</p>
  if (erro) return <p className="ficha-estado ficha-estado--erro" role="alert">{erro}</p>
  if (!cliente) return null

  // Uma unica leitura do relogio por render: `derivarClientes`, o status de
  // cobranca e o historico abaixo tem que concordar sobre que dia e hoje —
  // duas chamadas separadas podem cair em lados opostos da virada da meia-noite.
  const hoje = hojeIsoLocal()
  const pedidos = paraPedidos(saidasBrutas, cliente)
  const [derivado] = derivarClientes([cliente], pedidos, periodo, hoje)
  const health = HEALTH_INFO[derivado.health]
  const statusLabel = STATUS_LABEL[cliente.status] ?? cliente.status
  // Mesmo sinal de "sem dado real" que ClientesLista.tsx usa por linha:
  // sem faturado no periodo (cliente sem venda, ou vendas indisponiveis por
  // falha de /api/saidas), participacao e inadimplencia viram travessao —
  // nao um zero que fingiria ser apurado.
  const temVendas = derivado.faturado > 0
  // Status de cobranca DERIVADO das vendas (achado CF-1 da auditoria). Ate
  // aqui a tela exibia `cliente.cobranca`, campo de cadastro que nasce
  // 'Em dia' e que nenhum formulario altera — dizia "Em dia" para todo
  // cliente, para sempre, poucas linhas acima da taxa de inadimplencia real
  // dele. `null` (cliente sem venda cobravel, ou /api/saidas fora do ar e
  // `saidasBrutas` vazio) vira travessao: nunca "Em dia" por omissao.
  const cobranca = statusCobrancaCliente(pedidos, cliente.nome, hoje)
  // As tres metricas/linhas que o protótipo calcula sobre o historico
  // INTEIRO (`pedidosRaw`), nao sobre o periodo — ver o comentario da prop
  // `periodo` para o porque de cada uma.
  const ultimaCompra = ultimaCompraCliente(pedidos, cliente.nome)
  const atrasos = atrasosDoCliente(pedidos, cliente.nome, hoje)
  const recentes = pedidosRecentesCliente(pedidos, cliente.nome, QUANTOS_PEDIDOS_RECENTES)
  // Qtd entregue: esta SEGUE o periodo (o rotulo promete "no periodo").
  const qtd = quantidadeEntregueCliente(pedidos, cliente.nome, periodo)

  const metaFaturado = `meta R$ ${METAS_DASHBOARD.ticketMesMetaBaixo.toLocaleString('pt-BR')}`
    + `–${METAS_DASHBOARD.ticketMesMetaAlto.toLocaleString('pt-BR')}`
  const subInadimplencia = `meta ≤ ${METAS_DASHBOARD.inadimplenciaMetaPct}%`
    + (atrasos ? ` · ${plural(atrasos.quantidade, 'atraso', 'atrasos')}` : '')

  return (
    <div className="ficha">
      {erroVendas && (
        <p className="ficha-aviso-vendas" role="status">{erroVendas}</p>
      )}

      <div className="ficha-topo">
        <button type="button" className="ficha-voltar" onClick={onVoltar}>← Voltar para lista</button>
        <div className="ficha-topo-spacer" />
        <button type="button" className="ficha-editar" onClick={() => onEditar(cliente)}>Editar cliente</button>
        {/* Editar é dos dois papéis; excluir continua do admin, e a API
            recusa o DELETE com 403 de qualquer jeito — o botão some para não
            oferecer uma ação que vai falhar. */}
        {podeExcluir && (
          <button type="button" className="ficha-excluir" onClick={() => setConfirmandoExclusao(true)}>
            Excluir
          </button>
        )}
      </div>

      {confirmandoExclusao && (
        // `region` (nao `alertdialog`): alertdialog pressupoe um dialogo modal
        // com focus trap — isto e um painel inline, sem foco roubado nem
        // Escape pra fechar. `role="alert"` no texto garante que a confirmacao
        // seja anunciada quando aparece, sem prometer semantica que a UI nao tem.
        <div className="ficha-confirma" role="region" aria-label="Confirmar exclusão">
          <p className="ficha-confirma-texto" role="alert">
            Excluir <strong>{cliente.nome}</strong>? O cadastro será apagado definitivamente — não é
            possível desfazer.
          </p>
          {erroExclusao && <p className="ficha-erro" role="alert">{erroExclusao}</p>}
          <div className="ficha-confirma-acoes">
            <button
              type="button"
              className="ficha-confirma-cancelar"
              onClick={() => setConfirmandoExclusao(false)}
              disabled={excluindo}
            >
              Cancelar
            </button>
            <button type="button" className="ficha-confirma-excluir" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      )}

      <div className="ficha-header" style={{ borderLeftColor: health.cor }}>
        <div className="ficha-avatar">{iniciais(cliente.nome)}</div>
        <div className="ficha-header-info">
          <div className="ficha-nome">{cliente.nome}</div>
          <div className="ficha-sub">{cliente.resp || '—'} · {cliente.cnpj || '—'} · {cliente.tel || '—'}</div>
          <div className="ficha-sub">{cliente.endereco || '—'}</div>
        </div>
        <div className="ficha-health">
          {verMetricas && (
            <>
              <div className="ficha-health-rotulo">HEALTH SCORE</div>
              <div className="ficha-health-badge" style={{ color: health.cor, background: health.bg }}>
                <span className="ficha-health-dot" style={{ background: health.cor }} />
                {derivado.tend} {health.label}
              </div>
            </>
          )}
          {/* O status do cadastro (Ativo, Em negociação…) FICA para os dois:
              é campo do formulário, não um score derivado — e é o que diz ao
              colaborador se ainda se atende aquele estabelecimento. */}
          <div className="ficha-health-status">{statusLabel}</div>
        </div>
      </div>

      {/* Para colaborador a coluna da esquerda inteira (métricas + pedidos
          recentes) não é renderizada; `--cadastro` faz a grade virar uma
          coluna só, em vez de deixar metade da tela vazia. */}
      <div className={verMetricas ? 'ficha-grid' : 'ficha-grid ficha-grid--cadastro'}>
        {verMetricas && (
        <div className="ficha-col">
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Métricas comerciais</h3>
            {/* Sem esta linha, um número menor aqui do que na lista pareceria
                divergência, e "última compra" fora do recorte pareceria
                inconsistência — as duas coisas são o recorte, dito. */}
            <div className="ficha-bloco-legenda">
              Números de <strong>{rotuloPeriodo(periodo)}</strong> · última compra, atrasos e pedidos
              recentes consideram o histórico inteiro
            </div>
            <div className="ficha-metricas">
              <Metrica
                label="Qtd no período"
                valor={qtd
                  ? (qtd.itensSemConversao > 0
                    ? (
                      <span className="ficha-incompleto" title={avisoSemConversao(qtd.itensSemConversao)}>
                        {pesoTxt(qtd.kg)}*
                      </span>
                    )
                    : pesoTxt(qtd.kg))
                  : '—'}
                sub={qtd ? plural(qtd.entregas, 'entrega', 'entregas') : 'sem entrega no período'}
              />
              <Metrica
                label="Faturado / mês"
                valor={moneyOuTraco(derivado.faturado)}
                sub={metaFaturado}
                // Semáforo só quando há faturamento medido: sem venda no
                // período o vermelho diria "está péssimo" sobre um número que
                // ninguém apurou.
                cor={temVendas ? HEALTH_INFO[statusFaturadoCliente(derivado.faturado)].cor : undefined}
              />
              <Metrica
                label="Ticket / entrega"
                valor={moneyOuTraco(derivado.ticketEntrega)}
                sub={`meta ≥ R$ ${METAS_DASHBOARD.ticketEntregaMeta.toLocaleString('pt-BR')}`}
                cor={derivado.ticketEntrega > 0
                  ? HEALTH_INFO[statusTicketEntrega(derivado.ticketEntrega)].cor
                  : undefined}
              />
              <Metrica
                label="% do faturamento"
                valor={temVendas ? `${derivado.participacao}%` : '—'}
                // Sem semáforo, como no protótipo: concentração alta é um
                // risco, não uma nota — o Painel de Indicadores é quem
                // destaca o cliente acima do limite.
                sub={`risco de concentração acima de ${METAS_DASHBOARD.concentracaoCarteiraAlertaPct}%`}
              />
              <Metrica
                label="Última compra"
                valor={dataBrAno(ultimaCompra)}
                sub={ultimaCompra ? 'do último pedido entregue' : 'nenhum pedido entregue ainda'}
              />
              <Metrica
                label="Inadimplência"
                valor={temVendas ? derivado.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
                sub={subInadimplencia}
                cor={temVendas ? HEALTH_INFO[statusInadimplencia(derivado.inadimplencia)].cor : undefined}
              />
            </div>
          </div>

          {/*
            "Pedidos recentes" (achado CF-6). Este bloco chamava-se "Histórico
            de entregas" e filtrava `status === 'Entregue'`: escondia
            exatamente os pedidos que ainda vão acontecer — o pendente e o em
            rota, que são o que o vendedor precisa ver antes de ligar pro
            cliente — e não trazia nem o número do pedido (para achá-lo em
            Saídas) nem a quantidade.
          */}
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Pedidos recentes</h3>
            {recentes.length === 0 ? (
              <p className="ficha-historico-vazio">Nenhum pedido registrado.</p>
            ) : (
              <div className="ficha-pedidos">
                {recentes.map(p => {
                  const selo = STATUS_PEDIDO[p.status]
                  return (
                    <div key={p.id} className="ficha-pedido">
                      <span className="ficha-pedido-numero">{p.numero || '—'}</span>
                      <span className="ficha-pedido-data">{dataBr(p.entrega)}</span>
                      <span className="ficha-pedido-peso">
                        {/* Pedido sem item convertível soma 0 kg de verdade;
                            pedido sem `peso` na resposta é ausência de dado.
                            Só o segundo vira travessão. */}
                        {p.peso == null
                          ? '—'
                          : (p.itensSemConversao
                            ? (
                              <span
                                className="ficha-incompleto"
                                title={avisoSemConversao(p.itensSemConversao)}
                              >
                                {pesoTxt(p.peso)}*
                              </span>
                            )
                            : pesoTxt(p.peso))}
                      </span>
                      <span className="ficha-pedido-valor">{money(p.valor)}</span>
                      <span className="ficha-pedido-selo" style={{ color: selo.cor, background: selo.bg }}>
                        {p.status}
                      </span>
                      {/* Situação de pagamento DERIVADA (não o `pag` gravado)
                          — a mesma que a coluna PAGAMENTO de Saídas mostra. */}
                      <span className="ficha-pedido-pag">
                        {situacaoExibidaSaida(p.pag, p.venc, hoje)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        )}

        <div className="ficha-col">
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Cadastro &amp; rota</h3>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Região / rota</span>
              <span className="ficha-linha-valor">{cliente.rota || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Frequência</span>
              <span className="ficha-linha-valor">{cliente.freq || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Status</span>
              <span className="ficha-linha-valor">{statusLabel}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Forma de pagamento</span>
              <span className="ficha-linha-valor">{cliente.forma || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">E-mail</span>
              <span className="ficha-linha-valor">{cliente.email || '—'}</span>
            </div>
          </div>

          {/* Bloco inteiro fora para colaborador. `limite` e `prazo` são
              colunas de `clientes` e chegam no GET que ele já lê (e o
              formulário de cadastro continua editando os dois) — esconder o
              limite de crédito AQUI é apresentação, não barreira, e está dito
              assim em `podeVerMetricasDeCadastro` (telas.ts). Taxa, status de
              cobrança e histórico de atrasos, esses são derivados das vendas
              e nem chegam a ser calculados: `saidasBrutas` fica vazio. */}
          {verMetricas && (
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Crédito &amp; inadimplência</h3>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Limite de crédito</span>
              <span className="ficha-linha-valor">{money(cliente.limite)}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Prazo de pagamento</span>
              <span className="ficha-linha-valor">{cliente.prazo} dias</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Status de cobrança</span>
              <span
                className="ficha-linha-valor"
                style={cobranca ? { color: COBRANCA_COR[cobranca] } : undefined}
              >
                {cobranca ?? '—'}
              </span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Taxa de inadimplência</span>
              <span className="ficha-linha-valor">
                {temVendas ? derivado.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
              </span>
            </div>
            {/*
              "Histórico de atrasos" (achado CF-5): a quinta linha do bloco de
              crédito no protótipo (2250), a única que diz QUANTOS pedidos e
              QUANTO em reais estão atrasados — a taxa acima é uma fração e
              não responde nem uma coisa nem outra. `null` (nenhuma venda
              cobrável, ou vendas indisponíveis) vira travessão; zero atraso
              medido vira "0 atrasos", que é a boa notícia e não pode virar
              travessão.
            */}
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Histórico de atrasos</span>
              <span
                className="ficha-linha-valor"
                style={atrasos && atrasos.quantidade > 0 ? { color: COBRANCA_COR.Atrasado } : undefined}
              >
                {atrasos === null
                  ? '—'
                  : atrasos.quantidade === 0
                    ? '0 atrasos'
                    : `${plural(atrasos.quantidade, 'pedido', 'pedidos')} · ${money(atrasos.valor)}`}
              </span>
            </div>
          </div>
          )}

          <div className="ficha-obs">
            <h3 className="ficha-obs-titulo">Observações do vendedor</h3>
            <div className="ficha-obs-texto">
              {cliente.obs ? `"${cliente.obs}"` : 'Nenhuma observação registrada.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
