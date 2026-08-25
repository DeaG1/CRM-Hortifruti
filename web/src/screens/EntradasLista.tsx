import { useEffect, useState, type ReactNode } from 'react'
import { api, ErroApi } from '../api/client'
import { ModalEntrada, type EntradaComItens, type Fornecedor } from '../components/ModalEntrada'
import { SeletorPagamento } from '../components/SeletorPagamento'
import type { Health } from '../derive/clientes'
import type { SituacaoPagamentoEscolhivel } from '../derive/pagamento'
import type { EntradaResumo } from '../derive/relatorios'
import {
  derivarResumoEntradas,
  statusPerdaMedia,
  META_PERDA_MEDIA_PCT,
  type ResumoEntradas,
} from '../derive/resumoOperacional'
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
   * dois números a somar. O cartão de perda média usa `perdaColetaEfetiva`
   * (o maior dos dois, ver derive/relatorios.ts) para não contar em dobro,
   * que é também o número de Relatórios ▸ Compras e do saldo de Estoque; a
   * coluna PERDA da tabela continua mostrando só o cabeçalho, então os dois
   * podem divergir quando o dado gravado diverge.
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

/** Aviso da célula/estatística de peso incompleto — mesmo texto e mesma
 * regra do relatório de compras (RelatoriosTela.tsx, avisoSemConversao). */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 item' : `${n} itens`
  const verbo = n === 1 ? 'está' : 'estão'
  return `${itens} em unidade diferente de KG sem peso médio cadastrado no produto: `
    + `${verbo} fora deste peso, porque sem o peso da embalagem não há como converter em quilos. `
    + 'Cadastre o peso médio em Produtos para que entrem na conta.'
}

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
 * - **PERDA MÉDIA**: a perda aparecia só em quilos absolutos e sempre em
 *   vermelho — 140 kg pode ser rotina ou catástrofe, e a tela não dizia
 *   qual. O índice contra o peso recebido é o que dá sentido ao número; os
 *   quilos continuam visíveis na sub-linha, ao lado do alvo.
 *
 * São CINCO cartões, não os quatro do protótipo: PESO RECEBIDO é uma adição
 * da implementação (com o aviso de peso incompleto que o protótipo não
 * tinha) e teria sido justamente o cartão sacrificado para abrir espaço —
 * remover informação honesta para caber no desenho seria o padrão que a
 * auditoria existe para combater.
 */
function CartoesResumo({ resumo }: { resumo: ResumoEntradas | null }) {
  // O índice divide pelo peso recebido, então herda o mesmo contador de
  // itens não convertíveis do cartão de peso — e com denominador incompleto
  // ele sai PARA CIMA. Marcar só o peso e deixar a % limpa esconderia
  // exatamente o número mais fácil de ler errado.
  const incompleto = resumo ? resumo.itensSemConversao : 0
  const marcar = (texto: string) => (incompleto > 0
    ? <span className="entradas-incompleto" title={avisoSemConversao(incompleto)}>{texto}*</span>
    : <>{texto}</>)

  const perdaPct = resumo?.perdaMediaPct ?? null
  const emAberto = resumo
    ? `${resumo.coletasEmAberto} ${resumo.coletasEmAberto === 1 ? 'coleta pendente' : 'coletas pendentes'}`
    : TRACO

  return (
    <div className="entradas-stats" role="group" aria-label="Resumo das entradas">
      <Cartao label="ENTRADAS" valor={resumo ? String(resumo.coletas) : TRACO} sub="todas as lançadas" />
      <Cartao
        label="PESO RECEBIDO"
        valor={resumo ? marcar(peso(resumo.pesoRecebidoKg)) : TRACO}
        sub="soma das coletas"
      />
      <Cartao
        label="PERDA MÉDIA (COLETA/TRANSPORTE)"
        // Travessão, não "0,0%": sem quilo recebido não há índice a medir.
        valor={perdaPct === null ? TRACO : marcar(pct1(perdaPct))}
        // Vermelho fixo era o defeito: o número não dizia se era rotina ou
        // catástrofe. Agora a cor vem do alvo.
        corValor={perdaPct === null ? undefined : CORES_SEMAFORO[statusPerdaMedia(perdaPct)]}
        sub={resumo
          ? `meta ≤ ${META_PERDA_MEDIA_PCT}% · ${peso(resumo.perdaKg)} perdidos`
          : TRACO}
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

type Modal = { modo: 'novo' } | { modo: 'editar'; entrada: EntradaComItens } | null

interface EntradasListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function EntradasLista({ onSessaoExpirada }: EntradasListaProps) {
  const [entradas, setEntradas] = useState<Entrada[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [versao, setVersao] = useState(0)

  const [modal, setModal] = useState<Modal>(null)
  const [abrindoId, setAbrindoId] = useState<string | null>(null)
  const [erroAbrir, setErroAbrir] = useState('')

  const [confirmando, setConfirmando] = useState<{ id: string; numero: string } | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

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

  if (carregando) return <p className="entradas-estado">Carregando…</p>
  if (erro) return <p className="entradas-estado entradas-estado--erro" role="alert">{erro}</p>

  // `perda_itens_qtd` sempre vem de GET /api/entradas (paraJsonLista), mas é
  // opcional em `EntradaResumo` porque fixtures de teste montam entradas
  // parciais — o `?? 0` torna esse contrato explícito aqui em vez de
  // depender do `|| 0` lá dentro.
  const paraResumo: EntradaResumo[] = entradas.map(e => ({
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

  // Isolação de falha (padrão de ClientesLista.tsx): se a derivação não
  // puder ser feita, os cartões viram travessão e o aviso explica — a lista
  // de entradas continua visível e lançável, que é o trabalho de rotina
  // desta tela.
  let resumo: ResumoEntradas | null = null
  let resumoFalhou = false
  try {
    resumo = derivarResumoEntradas(paraResumo)
  } catch {
    resumoFalhou = true
  }

  return (
    <div className="entradas-lista">
      <div className="entradas-topo">
        <div className="entradas-topo-legenda">
          Coletas e compras dos fornecedores · clique numa entrada para editar
        </div>
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

      {entradas.length > 0 && <CartoesResumo resumo={resumo} />}

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

            {entradas.map(e => (
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
                      <span className="entradas-incompleto" title={avisoSemConversao(e.itens_sem_conversao)}>
                        {peso(e.peso_total)}*
                      </span>
                    )
                    : peso(e.peso_total)}
                </div>
                <div
                  className="entradas-col-num entradas-mono"
                  style={{ color: e.perda_kg > 0 ? '#c2502f' : '#2a2a24' }}
                >
                  {peso(e.perda_kg)}
                </div>
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

      {/* Nota de rodapé do `*`, no mesmo padrão das abas Compras, Produtos e
          Perdas de Relatórios: o asterisco marca o número, esta nota diz o
          que ficou de fora, a consequência e a saída do problema. Só aparece
          quando há de fato item sem conversão. */}
      {resumo && resumo.itensSemConversao > 0 && (
        <div className="entradas-rodape-nota entradas-rodape-nota--incompleto" role="note">
          <strong>*</strong> {avisoSemConversao(resumo.itensSemConversao)} A perda média divide por esse peso,
          então o índice está calculado sobre uma quantidade incompleta e sai para cima.
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
