import { useEffect, useState, type ReactNode } from 'react'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import { diasRecebimentoSaida } from '../derive/financeiro'
import { situacaoExibidaSaida, type SituacaoPagamentoEscolhivel } from '../derive/pagamento'
import type { SaidaResumo } from '../derive/relatorios'
import { derivarResumoSaidas, type ResumoSaidas } from '../derive/resumoOperacional'
import { ModalSaida, type Saida, type StatusSaida, type PagSaida } from '../components/ModalSaida'
import { SeletorPagamento } from '../components/SeletorPagamento'
import './SaidasLista.css'

const STATUS_FILTROS = ['Todos', 'Pendente', 'Em rota', 'Entregue', 'Devolvido', 'Cancelado'] as const
type FiltroStatus = (typeof STATUS_FILTROS)[number]

const PAG_FILTROS = ['Todos', 'Pago', 'Pendente', 'Atrasado', '—'] as const
type FiltroPag = (typeof PAG_FILTROS)[number]

// Semaforo pedido no briefing: verde/ambar/vermelho + neutro pra estados sem
// carga de julgamento (Em rota e so "em andamento", "—" e so "nao se aplica").
const NEUTRO = '#9a9784'
const VERDE = '#3f8f5b'
const AMBAR = '#c79320'
const VERMELHO = '#c2502f'

const COR_STATUS: Record<StatusSaida, string> = {
  Pendente: AMBAR,
  'Em rota': NEUTRO,
  Entregue: VERDE,
  Cancelado: VERMELHO,
  Devolvido: VERMELHO,
}
const BG_STATUS: Record<StatusSaida, string> = {
  Pendente: '#f6efd8',
  'Em rota': '#f1eee2',
  Entregue: '#e7f1e8',
  Cancelado: '#f6e4dc',
  Devolvido: '#f6e4dc',
}
const COR_PAG: Record<PagSaida, string> = {
  Pago: VERDE,
  Pendente: AMBAR,
  Atrasado: VERMELHO,
  '—': NEUTRO,
}
const BG_PAG: Record<PagSaida, string> = {
  Pago: '#e7f1e8',
  Pendente: '#f6efd8',
  Atrasado: '#f6e4dc',
  '—': '#f1eee2',
}

const COR_FILTRO_STATUS: Record<FiltroStatus, string> = {
  Todos: NEUTRO, Pendente: AMBAR, 'Em rota': NEUTRO, Entregue: VERDE, Devolvido: VERMELHO, Cancelado: VERMELHO,
}
const COR_FILTRO_PAG: Record<FiltroPag, string> = {
  Todos: NEUTRO, Pago: VERDE, Pendente: AMBAR, Atrasado: VERMELHO, '—': NEUTRO,
}

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')
const pesoTxt = (n: number) => n.toLocaleString('pt-BR') + ' kg'

/** O que os cartões mostram quando não há base para calcular — nunca zero.
 * Zero é uma MEDIDA ("não há nada em aberto porque tudo foi pago"), e é
 * justamente a informação boa; travessão é a ausência de medida. */
const TRACO = '—'

/** Aviso do número de quilos que pode estar incompleto — mesmo texto e mesma
 * regra de EntradasLista.tsx e da nota de rodapé de Relatórios (a API deixa
 * de fora o item em unidade ≠ KG sem peso médio cadastrado em vez de
 * inventar um fator; ver `itens_sem_conversao` em api/src/routes/saidas.ts). */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 item' : `${n} itens`
  const verbo = n === 1 ? 'está' : 'estão'
  return `${itens} em unidade diferente de KG sem peso médio cadastrado no produto: `
    + `${verbo} fora desta quantidade, porque sem o peso da embalagem não há como converter em quilos. `
    + 'Cadastre o peso médio em Produtos para que entrem na conta.'
}

/**
 * Cor da coluna RECEB. — pela situação DERIVADA de pagamento (não pelo `pag`
 * gravado), igual ao resto desta tela. Protótipo linha 2407: verde quando
 * pago, vermelho quando atrasado, neutro no resto (e sempre neutro quando
 * não há prazo a exibir).
 */
function corReceb(dias: number | null, situacao: string): string {
  if (dias === null) return NEUTRO
  if (situacao === 'Pago') return VERDE
  if (situacao === 'Atrasado') return VERMELHO
  return NEUTRO
}

/** Um cartão de resumo. `sub` ganha cor só quando há semáforo a mostrar. */
function Cartao({ label, valor, sub, corSub }: {
  label: string
  valor: ReactNode
  sub: ReactNode
  corSub?: string
}) {
  return (
    <div className="saidas-stat">
      <div className="saidas-stat-label">{label}</div>
      <div className="saidas-stat-valor">{valor}</div>
      <div className="saidas-stat-sub" style={corSub ? { color: corSub } : undefined}>{sub}</div>
    </div>
  )
}

/**
 * Os quatro cartões de resumo (protótipo `pedidoStats`, linhas 412-419 e
 * 2394-2399). `resumo` nulo = não foi possível calcular: todos os quatro
 * viram travessão e o aviso ao lado explica, mas a lista de saídas abaixo
 * continua inteira — padrão de isolação de falha de ClientesLista.tsx.
 *
 * O terceiro cartão é o motivo de este bloco existir: "quanto os
 * minimercados me devem" não aparecia em nenhuma tela de rotina, só em
 * Relatórios ▸ Inadimplentes, que é tela de análise.
 */
function CartoesResumo({ resumo }: { resumo: ResumoSaidas | null }) {
  const entregues = resumo
    ? `${resumo.pedidosEntregues} ${resumo.pedidosEntregues === 1 ? 'pedido entregue' : 'pedidos entregues'}`
    : TRACO
  // Semáforo no ATRASO, não no valor a receber. O protótipo pinta o cartão
  // de vermelho sempre que há qualquer coisa a receber (`aReceber>0?RED`,
  // linha 2397) — mas ter contas a receber é o estado normal de quem vende a
  // prazo, e um cartão permanentemente vermelho para de ser lido. Vermelho
  // fica para o que de fato é problema: pedido com vencimento já decorrido.
  const atraso = resumo
    ? (resumo.pedidosAtrasados === 0
      ? { texto: 'nenhum em atraso', cor: VERDE }
      : {
        texto: `${resumo.pedidosAtrasados} ${resumo.pedidosAtrasados === 1 ? 'pedido' : 'pedidos'} em atraso`,
        cor: VERMELHO,
      })
    : { texto: TRACO, cor: undefined }

  return (
    <div className="saidas-stats" role="group" aria-label="Resumo das saídas">
      <Cartao label="PEDIDOS" valor={resumo ? String(resumo.pedidos) : TRACO} sub="todos os lançados" />
      <Cartao
        label="FATURADO (ENTREGUE)"
        valor={resumo ? money(resumo.faturadoEntregue) : TRACO}
        sub={entregues}
      />
      <Cartao
        label="A RECEBER / ATRASADO"
        valor={resumo ? money(resumo.aReceber) : TRACO}
        sub={atraso.texto}
        corSub={atraso.cor}
      />
      <Cartao
        label="QTD ENTREGUE"
        valor={!resumo
          ? TRACO
          : resumo.itensSemConversao > 0
            ? (
              <span className="saidas-incompleto" title={avisoSemConversao(resumo.itensSemConversao)}>
                {pesoTxt(resumo.qtdEntregueKg)}*
              </span>
            )
            : pesoTxt(resumo.qtdEntregueKg)}
        sub="nos pedidos entregues"
      />
    </div>
  )
}

/** 'AAAA-MM-DD' -> 'DD/MM'. Vazio/nulo vira travessao. */
function dataBr(iso: string | null): string {
  if (!iso || iso.length < 10) return '—'
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/`hojeIso()` de
 * ModalLancamento.tsx. Fica na tela (não em derive/pagamento.ts) porque
 * toca `new Date()`: a função pura (`situacaoExibidaSaida`) recebe isso
 * como parâmetro, pra continuar testável sem mockar relógio. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

interface SaidasListaProps {
  onSessaoExpirada: () => void
}

export function SaidasLista({ onSessaoExpirada }: SaidasListaProps) {
  const [saidas, setSaidas] = useState<Saida[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('Todos')
  const [filtroPag, setFiltroPag] = useState<FiltroPag>('Todos')
  // undefined = modal fechado; null = criando; string = editando (id da saida)
  const [modal, setModal] = useState<string | null | undefined>(undefined)
  // Muda a cada salvamento/exclusao pra forcar o refetch da lista.
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<Saida[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidas(ss) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada(); return }
        setErro('Não foi possível carregar as saídas.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  // Resolve cliente_id -> nome pra exibir na tabela. GET /api/saidas so traz
  // o id (coluna real, nao o nome); busca separada, e falha sozinha sem
  // quebrar a lista de saidas — hoje /api/clientes e admin-only
  // (exigirAdmin), diferente de /api/saidas: um colaborador ainda ve a
  // lista de saidas normalmente, so sem o nome do cliente resolvido.
  useEffect(() => {
    let cancelado = false
    api.get<Cliente[]>('/api/clientes')
      .then(cs => { if (!cancelado) setClientes(cs) })
      .catch((err: unknown) => {
        if (cancelado || !(err instanceof ErroApi) || err.status !== 401) return
        onSessaoExpirada()
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada, versao])

  function nomeCliente(id: string | null): string {
    if (!id) return '—'
    return clientes.find(c => c.id === id)?.nome ?? '—'
  }

  function aoSalvar() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  /**
   * Chip de pagamento editável direto na linha (PATCH /api/saidas/:id/pag —
   * não reenvia `itens`, ao contrário do PUT completo do modal). A API já
   * grava/limpa `data_pag` sozinha (hoje ao marcar Pago, null ao voltar pra
   * Pendente); aqui só espelha a resposta na linha local. `venc` nunca muda
   * por este caminho (só pag/data_pag), então não precisa vir na resposta
   * pra recalcular a exibição — a derivação usa o `venc` que a linha já
   * tinha.
   *
   * Rejeita em qualquer falha — inclusive 401 — pro SeletorPagamento
   * reverter o valor sozinho; sessão expirada tem tratamento extra (volta
   * ao login) além da reversão do chip.
   */
  async function alterarPagamento(id: string, pag: SituacaoPagamentoEscolhivel) {
    try {
      const atualizada = await api.patch<{ pag: string; data_pag: string | null }>(
        `/api/saidas/${id}/pag`,
        { pag },
      )
      setSaidas(ss => ss.map(s => (
        s.id === id ? { ...s, pag: atualizada.pag as PagSaida, data_pag: atualizada.data_pag } : s
      )))
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) onSessaoExpirada()
      throw err
    }
  }

  function aoExcluir() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  if (carregando) return <p className="saidas-estado">Carregando…</p>
  if (erro) return <p className="saidas-estado saidas-estado--erro" role="alert">{erro}</p>

  const modalAtivo = modal !== undefined && (
    <ModalSaida
      saidaId={modal}
      onSalvo={aoSalvar}
      onExcluido={aoExcluir}
      onFechar={() => setModal(undefined)}
      onSessaoExpirada={onSessaoExpirada}
    />
  )

  if (saidas.length === 0) {
    return (
      <>
        <div className="estado-vazio saidas-vazio">
          <div className="saidas-vazio-titulo">Nenhuma saída lançada ainda.</div>
          <div className="saidas-vazio-sub">
            Lance a primeira venda entregue a um minimercado. Ela alimenta faturamento, ticket médio e estoque.
          </div>
          <button type="button" className="saidas-botao-novo" onClick={() => setModal(null)}>
            ＋ Lançar primeira saída
          </button>
        </div>
        {modalAtivo}
      </>
    )
  }

  // 'hoje' calculado uma vez por render (nao dentro do filtro/contagem, que
  // rodam por saida) — evita `new Date()` repetido, e mantem a mesma
  // referencia de "hoje" pro filtro E pra cada chip da tabela concordarem
  // entre si na mesma renderizacao.
  const hojeIso = hojeIsoLocal()

  // Filtro e contagem usam a situacao EXIBIDA (com Atrasado derivado — ver
  // derive/pagamento.ts), nao o `pag` cru: senao filtrar por "Atrasado"
  // deixaria de fora exatamente as saidas que a propria tabela mostra como
  // atrasadas (Pendente + vencimento vencido), e filtrar por "Pendente"
  // incluiria saidas que a tabela mostra como Atrasado — os dois
  // discordando na mesma tela.
  const visiveis = saidas.filter(s =>
    (filtroStatus === 'Todos' || s.status === filtroStatus)
    && (filtroPag === 'Todos' || situacaoExibidaSaida(s.pag, s.venc, hojeIso) === filtroPag),
  )

  const contagemStatus = (f: FiltroStatus) =>
    f === 'Todos' ? saidas.length : saidas.filter(s => s.status === f).length
  const contagemPag = (f: FiltroPag) =>
    f === 'Todos' ? saidas.length : saidas.filter(s => situacaoExibidaSaida(s.pag, s.venc, hojeIso) === f).length

  // Os cartões somam a BASE INTEIRA, nunca `visiveis`: "quanto os
  // minimercados me devem" tem que responder pela carteira toda. Se
  // seguissem os filtros, filtrar por "Pago" zeraria o cartão de "A receber"
  // e a tela responderia outra pergunta com o mesmo rótulo. A nota logo
  // abaixo dos cartões diz isso ao usuário, para o número não parecer
  // discordar da tabela.
  //
  // `valor`/`peso` são opcionais em `Saida` (GET /:id não traz agregado) e
  // obrigatórios em `SaidaResumo`; a listagem sempre os manda, mas o `?? 0`
  // deixa o contrato explícito em vez de confiar num campo opcional.
  const paraResumo: SaidaResumo[] = saidas.map(s => ({
    numero: s.numero,
    cliente_id: s.cliente_id,
    rota: s.rota,
    entrega: s.entrega,
    status: s.status,
    pag: s.pag,
    venc: s.venc,
    data_pag: s.data_pag,
    perda_kg: s.perda_kg,
    valor: s.valor ?? 0,
    peso: s.peso ?? 0,
    itens_sem_conversao: s.itens_sem_conversao,
  }))

  // Isolação de falha (padrão de ClientesLista.tsx): se a derivação não
  // puder ser feita, os cartões viram travessão e um aviso explica — a
  // lista de saídas continua visível e utilizável, que é o trabalho de
  // rotina desta tela. Nunca deixar um erro de resumo derrubar o lançamento
  // de pedidos.
  let resumo: ResumoSaidas | null = null
  let resumoFalhou = false
  try {
    resumo = derivarResumoSaidas(paraResumo, hojeIso)
  } catch {
    resumoFalhou = true
  }

  return (
    <div className="saidas-lista">
      <div className="saidas-topo">
        <div className="saidas-topo-dica">Clique numa saída para editar</div>
        <button type="button" className="saidas-botao-novo" onClick={() => setModal(null)}>
          ＋ Novo pedido
        </button>
      </div>

      {resumoFalhou && (
        <p className="saidas-aviso-resumo" role="status">
          Não foi possível calcular o resumo das saídas — os cartões ficam indisponíveis. A lista abaixo
          continua correta.
        </p>
      )}

      <CartoesResumo resumo={resumo} />

      <div className="saidas-resumo-nota">
        Os cartões somam <strong>todas as saídas lançadas</strong>; os filtros abaixo valem só para a tabela.
      </div>

      <div className="saidas-filtros" role="group" aria-label="Filtrar por status">
        {STATUS_FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtroStatus ? 'saidas-filtro saidas-filtro--ativo' : 'saidas-filtro'}
            onClick={() => setFiltroStatus(f)}
            aria-pressed={f === filtroStatus}
          >
            <span className="saidas-filtro-dot" style={{ background: COR_FILTRO_STATUS[f] }} />
            <span className="saidas-filtro-label">{f}</span>
            <span className="saidas-filtro-contagem">{contagemStatus(f)}</span>
          </button>
        ))}
      </div>

      <div className="saidas-filtros" role="group" aria-label="Filtrar por pagamento">
        {PAG_FILTROS.map(f => (
          <button
            key={f}
            type="button"
            className={f === filtroPag ? 'saidas-filtro saidas-filtro--ativo' : 'saidas-filtro'}
            onClick={() => setFiltroPag(f)}
            aria-pressed={f === filtroPag}
          >
            <span className="saidas-filtro-dot" style={{ background: COR_FILTRO_PAG[f] }} />
            <span className="saidas-filtro-label">{f === '—' ? 'Não aplicável' : f}</span>
            <span className="saidas-filtro-contagem">{contagemPag(f)}</span>
          </button>
        ))}
      </div>

      <div className="saidas-tabela">
        <div className="saidas-linha saidas-linha--cabecalho">
          <div>PEDIDO</div>
          <div>CLIENTE</div>
          <div>ENTREGA</div>
          <div className="saidas-col-num">PESO</div>
          <div className="saidas-col-num">VALOR</div>
          <div>STATUS</div>
          <div>PAGAMENTO</div>
          <div className="saidas-col-num">RECEB.</div>
        </div>

        {visiveis.map(s => {
          const situacao = situacaoExibidaSaida(s.pag, s.venc, hojeIso)
          // Coluna RECEB. (protótipo: cabeçalho 424, célula 436, dado 2406):
          // quantos dias o cliente levou da entrega até pagar. É o insumo
          // visível do componente "recebimento" do ciclo de caixa, e sai da
          // MESMA função que alimenta essa média (derive/financeiro.ts) —
          // não de uma subtração de datas escrita aqui.
          const receb = diasRecebimentoSaida(s)
          return (
            <div key={s.id} className="saidas-linha saidas-linha--dados" onClick={() => setModal(s.id)}>
              <div className="saidas-numero">{s.numero}</div>
              <div className="saidas-cliente">
                <div className="saidas-cliente-nome">{nomeCliente(s.cliente_id)}</div>
                <div className="saidas-rota">{s.rota || '—'}</div>
              </div>
              <div className="saidas-entrega">{dataBr(s.entrega)}</div>
              <div className="saidas-col-num saidas-mono">{pesoTxt(s.peso ?? 0)}</div>
              <div className="saidas-col-num saidas-mono saidas-valor">{money(s.valor ?? 0)}</div>
              <div>
                <span className="saidas-badge" style={{ color: COR_STATUS[s.status], background: BG_STATUS[s.status] }}>
                  {s.status}
                </span>
              </div>
              <div>
                {s.pag === '—' ? (
                  // '—' ("nao aplicavel", tipico de pedido cancelado/
                  // devolvido) fica de fora do seletor de duas opcoes
                  // (Pendente/Pago) de proposito: nao ha como representar
                  // "pagamento nao se aplica" nesse toggle sem ambiguidade.
                  // Só o modal completo (PUT, que ainda aceita os quatro
                  // valores do CHECK) alcança esse valor — o chip da linha
                  // continua so um badge estatico neste caso.
                  <span className="saidas-badge" style={{ color: COR_PAG['—'], background: BG_PAG['—'] }}>—</span>
                ) : (
                  <SeletorPagamento
                    situacao={situacao}
                    aoEscolher={pag => alterarPagamento(s.id, pag)}
                    rotulo={`Pagamento do pedido ${s.numero}`}
                  />
                )}
                {s.venc && <div className="saidas-venc">venc. {dataBr(s.venc)}</div>}
              </div>
              <div className="saidas-col-num saidas-mono" style={{ color: corReceb(receb, situacao) }}>
                {receb === null ? TRACO : `${receb} d`}
              </div>
            </div>
          )
        })}

        {visiveis.length === 0 && (
          <div className="saidas-sem-filtro">Nenhuma saída com estes filtros.</div>
        )}
      </div>

      {modalAtivo}
    </div>
  )
}
