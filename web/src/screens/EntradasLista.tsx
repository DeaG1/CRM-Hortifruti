import { useEffect, useState, type ReactNode } from 'react'
import { api, ErroApi } from '../api/client'
import { ModalEntrada, type EntradaComItens, type Fornecedor } from '../components/ModalEntrada'
import { SeletorPagamento } from '../components/SeletorPagamento'
import type { Health } from '../derive/clientes'
import { METAS_DASHBOARD, statusIndiceDePerdas, type Perda } from '../derive/dashboard'
import { infoPagamento, type SituacaoPagamentoEscolhivel } from '../derive/pagamento'
import { perdaColetaPct } from '../derive/coleta'
import { perdaColetaEfetiva, type EntradaResumo } from '../derive/relatorios'
import { derivarResumoEntradas, type ResumoEntradas } from '../derive/resumoOperacional'
import { filtrarPorPeriodo, rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import { FolhaConferenciaEntrada } from './FolhaConferenciaEntrada'
import './EntradasLista.css'

/** Forma de um item de GET /api/entradas (api/src/routes/entradas.ts,
 * paraJsonLista) — cabecalho com totais agregados dos itens, sem os itens
 * em si (GET /:id traz os itens, usado ao editar). */
interface Entrada {
  id: string
  numero: string
  fornecedor_id: string | null
  data: string
  perda_kg: number
  /**
   * Soma de `entrada_itens.perda_kg` desta entrada. Descreve o MESMO evento
   * de perda que `perda_kg` (o cabeçalho), em outra granularidade — nunca
   * dois números a somar. O cartão ÍNDICE DE PERDAS usa `perdaColetaEfetiva`
   * (o maior dos dois, ver derive/relatorios.ts) para não contar em dobro,
   * que é também o número de Relatórios ▸ Compras e do saldo de Estoque. A
   * coluna PERDA da tabela usa o MESMO `perdaColetaEfetiva` desde o achado
   * E-3 (ver `CelulaPerda`): antes ela mostrava só o cabeçalho, e a linha
   * podia discordar do cartão logo acima sobre a mesma coleta.
   */
  perda_itens_qtd?: number
  motivo: string
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  forma_pag: string
  obs: string
  valor_total: number
  /** Em kg — a API converte cada item pela unidade dele (KG conta direto,
   * caixa conta qtd * produtos.peso_medio). Ver `itens_sem_conversao`. */
  peso_total: number
  /** Itens desta entrada que ficaram FORA de `peso_total` por não serem
   * convertíveis em quilos (unidade ≠ KG sem peso médio cadastrado no
   * produto). A API não inventa fator; a tela avisa que o peso está
   * incompleto em vez de mostrar um número menor sem dizer nada. Ver o
   * comentário grande em api/src/routes/entradas.ts (GET /). */
  itens_sem_conversao?: number
}

const money = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const peso = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg'

/**
 * Aviso de quantidade incompleta — mesma primeira metade do texto do
 * relatório de compras (RelatoriosTela.tsx, avisoSemConversao), com uma
 * `consequencia` própria de cada cartão afetado (mesmo padrão de lá: dois
 * cartões podem estar incompletos por razões diferentes e com direções de
 * desvio diferentes, então não podem compartilhar UMA frase de fechamento).
 */
function avisoSemConversao(n: number, consequencia: string): string {
  const itens = n === 1 ? '1 item' : `${n} itens`
  const verbo = n === 1 ? 'está' : 'estão'
  return `${itens} em unidade diferente de KG sem peso médio cadastrado no produto: `
    + `${verbo} fora da conta, porque sem o peso da embalagem não há como converter em quilos. `
    + `${consequencia} Cadastre o peso médio em Produtos para que entrem na conta.`
}

/** Peso recebido incompleto (lado do denominador, só entradas): o desvio tem
 * direção conhecida — falta peso, então o índice que divide por ele sai
 * para cima. Usada pela célula PESO da tabela e pelo cartão PESO RECEBIDO. */
const avisoPesoIncompleto = (n: number): string => avisoSemConversao(
  n,
  'O peso recebido está incompleto, e o índice de perdas — que divide por ele — sai para cima.',
)

/**
 * Índice de perdas incompleto: soma o lado das entradas (denominador, igual
 * ao de cima) com o lado das perdas de depósito (numerador — ver
 * `itensSemConversaoIndice`, derive/resumoOperacional.ts), e por isso a
 * direção do desvio deixa de ser conhecida — mesma razão de
 * `CONSEQ_PERDA_INDICE` em RelatoriosTela.tsx, que marca este mesmo índice.
 */
const avisoIndiceIncompleto = (n: number): string => avisoSemConversao(
  n,
  'O índice de perdas é uma fração, e os dois lados dela podem ter perdido lançamentos — a perda de '
    + 'depósito no numerador, o quilo comprado no denominador —, então nem a direção do desvio é conhecida.',
)

/** O que um cartão mostra quando não há base para calcular — nunca zero.
 * Zero é uma MEDIDA ("não devo nada ao produtor porque paguei tudo"), e é
 * justamente a informação boa; travessão é a ausência de medida. */
const TRACO = '—'

const CORES_SEMAFORO: Record<Health, string> = {
  green: '#3f8f5b',
  amber: '#c79320',
  red: '#c2502f',
}

/** Percentual com uma casa, em pt-BR — mesmo `fmtPct1` do protótipo (2152) e
 * mesmo `pct1` de RelatoriosTela.tsx, que formata este mesmo índice. */
const pct1 = (n: number) => n.toFixed(1).replace('.', ',') + '%'

/** Um cartão de resumo. `corValor` só é usada onde há semáforo. */
function Cartao({ label, valor, sub, corValor }: {
  label: string
  valor: ReactNode
  sub: ReactNode
  corValor?: string
}) {
  return (
    <div className="entradas-stat">
      <div className="entradas-stat-label">{label}</div>
      <div className="entradas-stat-valor" style={corValor ? { color: corValor } : undefined}>{valor}</div>
      <div className="entradas-stat-sub">{sub}</div>
    </div>
  )
}

/**
 * Os cartões de resumo (protótipo `entradaStats`, markup 471, dados
 * 2506-2507). `resumo` nulo = não foi possível calcular: todos viram
 * travessão e o aviso ao lado explica, mas a lista continua inteira —
 * isolação de falha no padrão de ClientesLista.tsx.
 *
 * Dois cartões são novos e são o motivo deste bloco ter sido reescrito:
 *
 * - **A PAGAR AO PRODUTOR**: "quanto devo ao produtor" não aparecia em
 *   nenhuma tela de rotina, só em Relatórios ▸ Compras (tela de análise).
 *   É a outra ponta do capital de giro, junto do "A receber" de Saídas.
 * - **ÍNDICE DE PERDAS** (antes "Perda média (coleta/transporte)"): a perda
 *   aparecia só em quilos absolutos e sempre em vermelho — 140 kg pode ser
 *   rotina ou catástrofe, e a tela não dizia qual. O índice contra o peso
 *   recebido é o que dá sentido ao número; os quilos continuam visíveis na
 *   sub-linha, ao lado do alvo. O rótulo mudou de novo, agora de "Perda
 *   média" para "Índice de perdas": o cartão somava só a perda de coleta
 *   (o dado que esta tela já carregava) enquanto o KPI do painel somava
 *   coleta + depósito — dois números diferentes com nomes parecidos em
 *   telas vizinhas. Unificados os dois (mesma fórmula, mesma faixa de
 *   semáforo — `indiceDePerdas`/`statusIndiceDePerdas`/`METAS_DASHBOARD`,
 *   derive/dashboard.ts), o nome também precisa ser o mesmo, para as duas
 *   telas se reconhecerem como o mesmo número em vez de dois valores
 *   parecidos brigando pela atenção do leitor.
 *
 * São CINCO cartões, não os quatro do protótipo: PESO RECEBIDO é uma adição
 * da implementação (com o aviso de peso incompleto que o protótipo não
 * tinha) e teria sido justamente o cartão sacrificado para abrir espaço —
 * remover informação honesta para caber no desenho seria o padrão que a
 * auditoria existe para combater.
 */
function CartoesResumo({ resumo, periodo }: { resumo: ResumoEntradas | null; periodo: Periodo }) {
  // Dois contadores, não um: PESO RECEBIDO só pode estar incompleto pelo
  // lado das entradas (denominador); ÍNDICE DE PERDAS soma também o lado
  // das perdas de depósito (numerador) e pode estar incompleto mesmo quando
  // o peso recebido está limpo — ver os dois campos em ResumoEntradas
  // (derive/resumoOperacional.ts).
  const incompletoPeso = resumo ? resumo.itensSemConversao : 0
  const marcarPeso = (texto: string) => (incompletoPeso > 0
    ? <span className="entradas-incompleto" title={avisoPesoIncompleto(incompletoPeso)}>{texto}*</span>
    : <>{texto}</>)

  const incompletoIndice = resumo ? resumo.itensSemConversaoIndice : 0
  const marcarIndice = (texto: string) => (incompletoIndice > 0
    ? <span className="entradas-incompleto" title={avisoIndiceIncompleto(incompletoIndice)}>{texto}*</span>
    : <>{texto}</>)

  const perdaPct = resumo?.perdaMediaPct ?? null
  const perdaKg = resumo?.perdaKg ?? null
  const emAberto = resumo
    ? `${resumo.coletasEmAberto} ${resumo.coletasEmAberto === 1 ? 'coleta pendente' : 'coletas pendentes'}`
    : TRACO

  return (
    <div className="entradas-stats" role="group" aria-label="Resumo das entradas">
      {/* O sub diz o RECORTE, não "todas as lançadas": com o filtro de
          período ativo a contagem é das coletas daquele mês. */}
      <Cartao label="ENTRADAS" valor={resumo ? String(resumo.coletas) : TRACO} sub={rotuloPeriodo(periodo)} />
      <Cartao
        label="PESO RECEBIDO"
        valor={resumo ? marcarPeso(peso(resumo.pesoRecebidoKg)) : TRACO}
        sub="soma das coletas"
      />
      <Cartao
        label="ÍNDICE DE PERDAS"
        // Travessão, não "0,0%": sem quilo recebido não há índice a medir, e
        // travessão também quando as perdas de depósito não carregaram (ver
        // `perdaKg`/`perdaMediaPct` em ResumoEntradas) — nos dois casos
        // mostrar um número seria inventar uma medida que não existe.
        valor={perdaPct === null ? TRACO : marcarIndice(pct1(perdaPct))}
        // Vermelho fixo era o defeito original: o número não dizia se era
        // rotina ou catástrofe. Agora a cor vem do alvo — a MESMA régua do
        // KPI do painel (statusIndiceDePerdas), não uma faixa própria desta
        // tela: a régua duplicada (10/15 aqui, 10/13 no painel) pintava o
        // mesmo valor de cores diferentes em telas vizinhas.
        corValor={perdaPct === null ? undefined : CORES_SEMAFORO[statusIndiceDePerdas(perdaPct)]}
        sub={perdaKg === null
          ? TRACO
          : `meta ≤ ${METAS_DASHBOARD.perdaMetaPct}% · ${peso(perdaKg)} perdidos`}
      />
      <Cartao
        label="A PAGAR AO PRODUTOR"
        valor={resumo ? money(resumo.aPagarAoProdutor) : TRACO}
        // Vermelho só quando de fato se deve: zero em aberto é o bom
        // resultado, e pintá-lo de vermelho ensinaria a ignorar a cor.
        corValor={resumo && resumo.aPagarAoProdutor > 0 ? CORES_SEMAFORO.red : undefined}
        sub={emAberto}
      />
      <Cartao
        label="VALOR TOTAL"
        valor={resumo ? money(resumo.valorTotal) : TRACO}
        sub="comprado no total"
      />
    </div>
  )
}

/**
 * A célula PERDA de uma linha da tabela — em % do peso recebido daquela
 * coleta, com semáforo (achado E-3 da auditoria; protótipo: markup 489,
 * cálculo 2510, cor 2515).
 *
 * Antes mostrava `peso(e.perda_kg)`: quilos absolutos, sempre na mesma cor
 * de alerta. 140 kg pode ser rotina numa coleta de 8 t e catástrofe numa de
 * 300 kg, e a coluna não dizia qual — o mesmo defeito que o cartão de perda
 * desta tela tinha antes de 7a16a20, uma linha abaixo. Os quilos não se
 * perdem: continuam no `title`, ao lado do peso que serve de base.
 *
 * TRÊS decisões que valem registro:
 *
 * 1. O numerador é `perdaColetaEfetiva(e)` (o MAIOR entre o cabeçalho e a
 *    soma dos itens), não `e.perda_kg` cru. Os dois campos descrevem o mesmo
 *    evento de perda em granularidades diferentes (ver derive/relatorios.ts);
 *    a linha usar o cabeçalho enquanto o cartão logo acima usa o efetivo faria
 *    a coluna e o cartão da MESMA tela discordarem sobre a mesma coleta.
 *    O protótipo usa `en.perdaKg` porque lá o cabeçalho é recalculado a
 *    partir dos itens ao salvar (2037) — o que a API portada não faz.
 *
 * 2. O semáforo é `statusIndiceDePerdas` (10% / 13%, METAS_DASHBOARD), e não
 *    a faixa 10/15 do protótipo. É deliberado: a régua duplicada era
 *    exatamente o que 7a16a20 removeu desta tela, e reintroduzi-la na coluna
 *    pintaria de cores diferentes, na mesma tela, o mesmo tipo de número que
 *    o cartão ÍNDICE DE PERDAS pinta pela régua do painel. Uma tela, uma
 *    régua.
 *
 * 3. Travessão quando não há peso recebido — nunca "0,0%", que afirmaria não
 *    ter havido perda numa coleta que não pesou nada (o protótipo já faz
 *    assim, 2513). Zero MEDIDO (houve peso, não houve perda) sai 0,0% e em
 *    verde, que é a boa notícia da coleta.
 */
function CelulaPerda({ entrada }: { entrada: Entrada }) {
  const perdaKg = perdaColetaEfetiva(entrada)
  const pct = perdaColetaPct(perdaKg, entrada.peso_total)
  if (pct === null) {
    return (
      <div className="entradas-col-num entradas-mono" style={{ color: '#6a685c' }}>
        {TRACO}
      </div>
    )
  }
  // O peso recebido é o denominador desta fração: se ele está incompleto
  // (item sem peso médio ficou fora), a % sai PARA CIMA — a mesma
  // consequência que a célula PESO ao lado já explica, e por isso o mesmo
  // texto. Os quilos de perda continuam no title, que é onde o número
  // absoluto passou a morar.
  const incompleto = entrada.itens_sem_conversao ?? 0
  const detalhe = `${peso(perdaKg)} de perda em ${peso(entrada.peso_total)} recebidos.`
  const titulo = incompleto > 0 ? `${detalhe} ${avisoPesoIncompleto(incompleto)}` : detalhe
  return (
    <div
      className="entradas-col-num entradas-mono"
      style={{ color: CORES_SEMAFORO[statusIndiceDePerdas(pct)] }}
    >
      <span className={incompleto > 0 ? 'entradas-incompleto' : undefined} title={titulo}>
        {pct1(pct)}{incompleto > 0 ? '*' : ''}
      </span>
    </div>
  )
}

type Modal = { modo: 'novo' } | { modo: 'editar'; entrada: EntradaComItens } | null

interface EntradasListaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). Aqui o recorte vale
   * para a tabela E para os cartões: uma coleta é um evento datado, e "as
   * entradas de junho" é uma lista, não um subconjunto de um total maior —
   * é assim no protótipo (`entradasPeriodo`, linha 2158) e é o que o rótulo
   * dos cartões passa a dizer.
   */
  periodo?: Periodo
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function EntradasLista({ periodo = PERIODO_TODOS, onSessaoExpirada }: EntradasListaProps) {
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)

  // Perdas de depósito — a metade nova do cartão ÍNDICE DE PERDAS (ver
  // CartoesResumo). `perdas` começa vazio e só passa a ter conteúdo quando
  // /api/perdas responde; `erroPerdas` é o que distingue essa fase de
  // carregamento (comportamento normal, cartão sai correto assim que chega)
  // de uma falha de fato — no efeito abaixo, `derivarResumoEntradas` recebe
  // `null` no lugar da lista quando `erroPerdas` está setado, para o índice
  // virar travessão em vez de recalcular só com a perda de coleta (que
  // reintroduziria a divergência com o painel, agora silenciosa).
  const [perdas, setPerdas] = useState<Perda[]>([])
  const [erroPerdas, setErroPerdas] = useState('')

  const [modal, setModal] = useState<Modal>(null)
  const [abrindoId, setAbrindoId] = useState<string | null>(null)
  const [erroAbrir, setErroAbrir] = useState('')

  const [confirmando, setConfirmando] = useState<{ id: string; numero: string } | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  /**
   * A folha de conferência da carga (screens/FolhaConferenciaEntrada.tsx) abre
   * NO LUGAR da lista, e não numa camada por cima dela — mesma decisão do
   * romaneio em Saídas: sobreposição em `position: fixed` é exatamente o que o
   * navegador imprime pior (a camada vira uma página só, ou repete em todas), e
   * este é um componente que existe para virar papel. Trocar a lista pela folha
   * deixa o documento em fluxo normal, que é o arranjo em que a impressão é
   * previsível.
   */
  const [folhaAberta, setFolhaAberta] = useState(false)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<Entrada[]>('/api/entradas')
      .then(es => { if (!cancelado) setEntradas(es) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar as entradas.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })

    // Nome do fornecedor e so um complemento visual da tabela — colaborador
    // nao tem permissao pra GET /api/fornecedores (fornecedores.ts exige
    // exigirAdmin) e recebe 403 aqui. Isso nunca pode derrubar a lista de
    // entradas (que o colaborador acessa normalmente): falha e silenciosa,
    // a tabela cai pro fallback (mostra so o id).
    api.get<Fornecedor[]>('/api/fornecedores')
      .then(fs => { if (!cancelado) setFornecedores(fs) })
      .catch(() => {})

    // Perdas de depósito: busca separada, falha SOZINHA — ao contrário de
    // fornecedores (dado cosmético, falha em silêncio), a falha aqui precisa
    // de um aviso visível: sem esta lista, o cartão ÍNDICE DE PERDAS não tem
    // como saber se está mostrando o total ou só a metade da coleta, e a
    // regra desta unificação é nunca deixar a segunda passar pela primeira.
    // As demais informações da tela (lista, outros quatro cartões) não
    // dependem de perdas de depósito e continuam normais.
    setErroPerdas('')
    api.get<Perda[]>('/api/perdas')
      .then(ps => { if (!cancelado) setPerdas(ps) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroPerdas(
          'Não foi possível carregar as perdas de depósito — o índice de perdas fica indisponível. '
          + 'As demais informações desta tela continuam corretas.',
        )
      })

    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function nomeFornecedor(id: string | null): string {
    if (!id) return '—'
    return fornecedores.find(f => f.id === id)?.nome ?? id
  }

  async function abrirNovo() {
    setErroAbrir('')
    setModal({ modo: 'novo' })
  }

  async function abrirEdicao(id: string) {
    setErroAbrir('')
    setAbrindoId(id)
    try {
      const detalhe = await api.get<EntradaComItens>(`/api/entradas/${id}`)
      setModal({ modo: 'editar', entrada: detalhe })
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      setErroAbrir('Não foi possível abrir esta entrada. Tente novamente.')
    } finally {
      setAbrindoId(null)
    }
  }

  function aoSalvar() {
    setModal(null)
    setVersao(v => v + 1)
  }

  async function excluir() {
    if (!confirmando) return
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/entradas/${confirmando.id}`)
      setConfirmando(null)
      setVersao(v => v + 1)
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

  /**
   * Chip de pagamento editável direto na linha (PATCH /api/entradas/:id/pago
   * — não reenvia `itens`, ao contrário do PUT completo do modal). A API já
   * grava/limpa `data_pag` sozinha (hoje ao marcar Pago, null ao voltar pra
   * Pendente — ver comentário na rota); aqui só espelha a resposta na linha
   * local, sem precisar de outro round-trip (`versao`) pra tela inteira.
   *
   * Rejeita (deixa o erro subir) em qualquer falha — inclusive 401 — pro
   * SeletorPagamento reverter o valor sozinho; sessão expirada tem um
   * tratamento extra aqui (volta ao login) além da reversão do chip.
   */
  async function alterarPagamento(id: string, pago: SituacaoPagamentoEscolhivel) {
    try {
      const atualizada = await api.patch<{ pago: string; data_pag: string | null }>(
        `/api/entradas/${id}/pago`,
        { pago },
      )
      setEntradas(es => es.map(e => (
        e.id === id ? { ...e, pago: atualizada.pago as Entrada['pago'], data_pag: atualizada.data_pag } : e
      )))
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) onSessaoExpirada?.()
      throw err
    }
  }

  // A folha tem busca própria (itens da coleta escolhida) e não depende do
  // período do cabeçalho — por isso vem ANTES dos estados de carregamento/erro
  // daqui. O que ela precisa desta tela é só a lista de coletas para o
  // seletor, e essa lista é a INTEIRA (`entradas`), não a recortada pelo
  // período: o recorte do cabeçalho serve para ler a tabela, não para decidir
  // o que se consegue imprimir.
  if (folhaAberta) {
    return (
      <FolhaConferenciaEntrada
        entradas={entradas}
        nomeFornecedor={id => (id ? fornecedores.find(f => f.id === id)?.nome ?? null : null)}
        onVoltar={() => setFolhaAberta(false)}
        onSessaoExpirada={onSessaoExpirada}
      />
    )
  }

  if (carregando) return <p className="entradas-estado">Carregando…</p>
  if (erro) return <p className="entradas-estado entradas-estado--erro" role="alert">{erro}</p>

  // `perda_itens_qtd` sempre vem de GET /api/entradas (paraJsonLista), mas é
  // opcional em `EntradaResumo` porque fixtures de teste montam entradas
  // parciais — o `?? 0` torna esse contrato explícito aqui em vez de
  // depender do `|| 0` lá dentro.
  // Recorte de período aplicado uma vez, aqui: tudo abaixo (cartões, tabela,
  // estado vazio) enxerga só as coletas do período escolhido. A busca continua
  // trazendo a base inteira — trocar o período no cabeçalho não vai ao servidor.
  const entradasPeriodo = filtrarPorPeriodo(entradas, periodo, e => e.data)
  // Mesmo recorte para as perdas de depósito: perda de coleta filtrada por
  // um período e perda de depósito por outro seria pior que a divergência
  // original que esta unificação existe para fechar.
  const perdasPeriodo = filtrarPorPeriodo(perdas, periodo, p => p.data)

  const paraResumo: EntradaResumo[] = entradasPeriodo.map(e => ({
    numero: e.numero,
    fornecedor_id: e.fornecedor_id,
    data: e.data,
    perda_kg: e.perda_kg,
    perda_itens_qtd: e.perda_itens_qtd ?? 0,
    motivo: e.motivo,
    pago: e.pago,
    data_pag: e.data_pag,
    valor_total: e.valor_total,
    peso_total: e.peso_total,
    itens_sem_conversao: e.itens_sem_conversao,
  }))

  // `erroPerdas` vira `null` explícito (nunca `[]`): `derivarResumoEntradas`
  // trata os dois de forma diferente de propósito — `[]` é "perdas
  // carregaram e não há nenhuma neste período" (um resultado válido, o
  // índice sai só da perda de coleta); `null` é "não sabemos", e força o
  // cartão inteiro (índice E quilos) a travessão em vez de silenciosamente
  // recalcular com o que sobrou.
  const perdasParaResumo = erroPerdas ? null : perdasPeriodo

  // Isolação de falha (padrão de ClientesLista.tsx): se a derivação não
  // puder ser feita, os cartões viram travessão e o aviso explica — a lista
  // de entradas continua visível e lançável, que é o trabalho de rotina
  // desta tela.
  let resumo: ResumoEntradas | null = null
  let resumoFalhou = false
  try {
    resumo = derivarResumoEntradas(paraResumo, perdasParaResumo)
  } catch {
    resumoFalhou = true
  }

  return (
    <div className="entradas-lista">
      <div className="entradas-topo">
        <div className="entradas-topo-legenda">
          Coletas e compras dos fornecedores · clique numa entrada para editar ·{' '}
          <strong>{rotuloPeriodo(periodo)}</strong>
        </div>
        {/* O botão de imprimir fica AQUI, no mesmo canto e com o mesmo rótulo
            começando por "Imprimir" das outras duas telas de operação: quem
            aprendeu a imprimir numa precisa achar nas outras sem procurar. */}
        <button
          type="button"
          className="entradas-botao-imprimir"
          onClick={() => setFolhaAberta(true)}
        >
          Imprimir conferência
        </button>
        <button type="button" className="entradas-botao-novo" onClick={abrirNovo}>
          <span className="entradas-botao-novo-icone">＋</span> Nova entrada
        </button>
      </div>

      {erroAbrir && <p className="entradas-erro-abrir" role="alert">{erroAbrir}</p>}

      {resumoFalhou && (
        <p className="entradas-aviso-resumo" role="status">
          Não foi possível calcular o resumo das entradas — os cartões ficam indisponíveis. A lista abaixo
          continua correta.
        </p>
      )}

      {/* Falha isolada ao cartão ÍNDICE DE PERDAS (padrão de ClientesLista.tsx,
          aviso `erroVendas`): sem as perdas de depósito o índice não pode ser
          calculado, mas os outros quatro cartões e a lista continuam vivos —
          por isso este aviso é separado do `resumoFalhou` acima, que derruba
          o bloco inteiro. */}
      {!resumoFalhou && erroPerdas && (
        <p className="entradas-aviso-perdas" role="status">{erroPerdas}</p>
      )}

      {entradasPeriodo.length > 0 && <CartoesResumo resumo={resumo} periodo={periodo} />}

      {confirmando && (
        <div className="entradas-confirma" role="region" aria-label="Confirmar exclusão">
          <p className="entradas-confirma-texto" role="alert">
            Excluir a entrada <strong>{confirmando.numero}</strong>? Essa ação não pode ser desfeita.
          </p>
          {erroExclusao && <p className="entradas-erro-abrir" role="alert">{erroExclusao}</p>}
          <div className="entradas-confirma-acoes">
            <button
              type="button"
              className="entradas-confirma-cancelar"
              onClick={() => setConfirmando(null)}
              disabled={excluindo}
            >
              Cancelar
            </button>
            <button type="button" className="entradas-confirma-excluir" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      )}

      {entradas.length === 0
        ? (
          <div className="estado-vazio entradas-vazio">
            <div className="entradas-vazio-titulo">Nenhuma entrada lançada</div>
            <div className="entradas-vazio-sub">
              Lance a primeira compra do produtor. Ela abastece o estoque e vira a compra de mercadoria no
              Financeiro.
            </div>
            <button type="button" className="entradas-botao-novo" onClick={abrirNovo}>
              <span className="entradas-botao-novo-icone">＋</span> Lançar primeira entrada
            </button>
          </div>
        )
        /* Há entradas cadastradas, só nenhuma NESTE período — dizer "nenhuma
           entrada lançada" aqui seria mentira, e mandar lançar a primeira
           entrada mandaria o usuário duplicar coletas que já existem. */
        : entradasPeriodo.length === 0
        ? (
          <div className="estado-vazio entradas-vazio">
            <div className="entradas-vazio-titulo">
              Nenhuma entrada em {rotuloPeriodo(periodo)}
            </div>
            <div className="entradas-vazio-sub">
              Há {entradas.length} entrada(s) lançada(s) em outros períodos. Troque o período no cabeçalho
              para vê-las.
            </div>
          </div>
        )
        : (
          <div className="entradas-tabela">
            <div className="entradas-linha entradas-linha--cabecalho">
              <div>ENTRADA</div>
              <div>FORNECEDOR</div>
              <div>MOTIVO</div>
              <div className="entradas-col-num">PESO</div>
              <div className="entradas-col-num">PERDA</div>
              <div className="entradas-col-num">VALOR</div>
              <div>PAGTO</div>
              <div className="entradas-col-num">AÇÃO</div>
            </div>

            {entradasPeriodo.map(e => (
              <div
                key={e.id}
                className="entradas-linha entradas-linha--dados"
                onClick={() => abrirEdicao(e.id)}
              >
                <div className="entradas-mono entradas-numero">
                  {abrindoId === e.id ? '…' : e.numero}
                </div>
                <div className="entradas-fornecedor-bloco">
                  <div className="entradas-fornecedor-nome">{nomeFornecedor(e.fornecedor_id)}</div>
                  <div className="entradas-data">{e.data}</div>
                </div>
                <div className="entradas-motivo">{e.motivo || '—'}</div>
                <div className="entradas-col-num entradas-mono">
                  {e.itens_sem_conversao
                    ? (
                      <span className="entradas-incompleto" title={avisoPesoIncompleto(e.itens_sem_conversao)}>
                        {peso(e.peso_total)}*
                      </span>
                    )
                    : peso(e.peso_total)}
                </div>
                <CelulaPerda entrada={e} />
                <div className="entradas-col-num entradas-mono entradas-valor">{money(e.valor_total)}</div>
                <div>
                  {/* Entradas não têm vencimento (a tabela `entradas` não
                      tem coluna `venc` — é uma compra do produtor, não uma
                      venda a prazo), então "Atrasado" aqui NUNCA é
                      calculado, ao contrário de Saídas (ver
                      derive/pagamento.ts e SaidasLista.tsx). O seletor só
                      oferece Pendente/Pago; um `pago` já gravado como
                      'Atrasado' (dado anterior a esta mudança de
                      comportamento) continua sendo exibido tal qual, sem
                      nenhuma tentativa de recalculá-lo. */}
                  <SeletorPagamento
                    situacao={e.pago}
                    aoEscolher={pago => alterarPagamento(e.id, pago)}
                    rotulo={`Pagamento da entrada ${e.numero}`}
                  />
                  {/* "PIX · 10/06" — COMO e QUANDO se pagou ao produtor
                      (achado E-4; protótipo markup 491, montagem 2517).
                      `forma_pag`/`data_pag` já vinham na resposta e não
                      apareciam em lugar nenhum desta tela: o chip dizia que
                      estava pago, e a única forma de saber quando era abrir
                      o modal. Some sozinha enquanto não houver pagamento —
                      não é dado faltando, é pagamento que não aconteceu, e
                      o chip acima já diz isso (ver `infoPagamento`,
                      derive/pagamento.ts). Entradas não têm vencimento, então
                      a situação exibida é o `pago` gravado, sem derivação. */}
                  {infoPagamento(e.pago, e.forma_pag, e.data_pag) && (
                    <div className="entradas-pag-info">
                      {infoPagamento(e.pago, e.forma_pag, e.data_pag)}
                    </div>
                  )}
                </div>
                <div className="entradas-col-num">
                  <button
                    type="button"
                    className="entradas-excluir"
                    onClick={ev => { ev.stopPropagation(); setConfirmando({ id: e.id, numero: e.numero }) }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      <div className="entradas-rodape-nota">
        A soma das entradas do período vira a <strong>Compra de mercadoria</strong> no Financeiro automaticamente.
      </div>

      {/* Duas notas de rodapé, não uma — mesmo padrão da aba Perdas de
          RelatoriosTela.tsx (duas `NotaSemConversao` para dois contadores
          independentes): PESO RECEBIDO só pode estar incompleto pelo lado
          das entradas, ÍNDICE DE PERDAS soma também o lado das perdas de
          depósito e pode estar incompleto sozinho (um item de perda sem
          peso médio, com todas as entradas 100% convertíveis). Uma nota só
          apontaria "sai para cima" para um número cuja direção de desvio,
          quando as perdas de depósito contribuem, deixou de ser conhecida —
          o mesmo erro que ter duas réguas de semáforo tentava evitar. */}
      {resumo && resumo.itensSemConversao > 0 && (
        <div className="entradas-rodape-nota entradas-rodape-nota--incompleto" role="note">
          <strong>*</strong> {avisoPesoIncompleto(resumo.itensSemConversao)}
        </div>
      )}
      {resumo && resumo.itensSemConversaoIndice > 0 && (
        <div className="entradas-rodape-nota entradas-rodape-nota--incompleto" role="note">
          <strong>*</strong> {avisoIndiceIncompleto(resumo.itensSemConversaoIndice)}
        </div>
      )}

      {modal && (
        <ModalEntrada
          entrada={modal.modo === 'editar' ? modal.entrada : null}
          onSalvo={aoSalvar}
          onFechar={() => setModal(null)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
