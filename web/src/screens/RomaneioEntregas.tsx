import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  montarRomaneio, resumoRomaneio, diaVizinho, dataPorExtensoRomaneio,
  CAMPOS_ROMANEIO, CAMPOS_FIXOS_ROMANEIO,
  type CampoRomaneio, type CamposRomaneio, type Romaneio, type RespostaRomaneio,
  type ItemRomaneio,
} from '../derive/romaneio'
import {
  montarFolhaEntrega, pedidosDoDia, rotuloDoPedido, avisoDeLegibilidade,
  CORPO_CONFORTAVEL, type FolhaEntrega,
} from '../derive/folhaEntrega'
import { camposSalvosRomaneio, salvarCamposRomaneio } from '../preferenciaRomaneio'
import {
  useModoFolha, BarraDaFolha, PainelDeCampos, TopoDaFolha,
  CaixaDeMarcar, LinhaAssinatura, emPares,
} from '../components/FolhaImpressa'
import { FolhaEntregaCliente } from './FolhaEntregaCliente'

/**
 * O ROMANEIO DE ENTREGAS — a tela que produz a folha de conferência do
 * caminhão.
 *
 * Mora DENTRO de Saídas (screens/SaidasLista.tsx a abre e fecha) e não como
 * item de menu próprio, por três razões:
 *
 *   1. É a mesma matéria: as entregas do dia SÃO as saídas. Um item de menu
 *      novo faria o dono procurar "onde ficam as entregas" em dois lugares.
 *   2. A permissão já está certa. 'pedidos' não está em ADMIN_ONLY_SCREENS
 *      (web/src/telas.ts) e `GET /api/saidas/*` só exige sessão — então o
 *      colaborador, que é quem carrega o caminhão, alcança a folha sem
 *      nenhuma mudança de permissão. Uma tela nova exigiria decidir isso de
 *      novo, e a resposta certa seria a mesma.
 *   3. Imprimir é uma AÇÃO sobre a lista de saídas, como exportar CSV é uma
 *      ação sobre um relatório — não um lugar onde se mora.
 *
 * ---- A CASCA É COMPARTILHADA COM AS OUTRAS DUAS FOLHAS ----
 *
 * Esta tela foi a primeira das três (93972c3) e resolveu sozinha a barra, o
 * painel de campos, o topo do documento e o `@media print`. Quando Estoque e
 * Entradas ganharam folha, tudo isso saiu daqui para
 * components/FolhaImpressa.tsx + .css: três cópias do mesmo CSS de impressão
 * seria três lugares para corrigir o mesmo defeito, e o que acontece na
 * prática é que dois são corrigidos e o terceiro fica para trás. O que
 * continua sendo desta tela é o MIOLO — o bloco por cliente, que é o que
 * distingue um romaneio de uma folha de contagem.
 *
 * ---- O DIA É INDEPENDENTE DO PERÍODO GLOBAL, E ISSO É DELIBERADO ----
 *
 * O seletor do cabeçalho (derive/periodo.ts) recorta MESES e vale para a
 * lista de saídas; aqui a unidade é O DIA, e um dia só. Esta tela não recebe
 * `periodo` de propósito — precedente de EstoqueLista, que tem a própria data
 * "Posição em" pelo mesmo motivo: são perguntas diferentes, e misturá-las
 * produziria "romaneio de agosto", que não é coisa nenhuma. A data escolhida
 * aqui aparece em três lugares (o controle, o topo da folha e o selo de cada
 * bloco de cliente) porque romaneio do dia errado na mão do motorista é pior
 * que romaneio nenhum: um ele confere e descobre, o outro ele segue
 * confiante.
 *
 * ---- DUAS FOLHAS SAEM DAQUI, PARA DUAS PESSOAS DIFERENTES ----
 *
 * O ROMANEIO é do motorista: todas as entregas do dia, agrupadas por cliente,
 * para conferir o caminhão antes de sair. É a folha original desta tela e não
 * mudou.
 *
 * A FOLHA DE ENTREGA (screens/FolhaEntregaCliente.tsx) é do CLIENTE: UM
 * pedido, com valores, que ele confere na porta e assina reconhecendo o que
 * recebeu. Ela mora nesta tela, e não numa nova, pelas mesmas três razões que
 * puseram o romaneio aqui — é a mesma matéria (as entregas do dia SÃO as
 * saídas), a permissão já está certa e imprimir é uma AÇÃO sobre esta lista.
 * E por uma quarta: as duas saem da MESMA resposta da API. O dono escolhe o
 * dia uma vez; imprimir a via de um cliente não custa uma segunda ida ao
 * banco.
 *
 * O que troca entre as duas é UM BOTÃO na barra. Não é navegação: é escolher
 * PARA QUEM se está imprimindo.
 */

/** Data de hoje em 'AAAA-MM-DD', componentes LOCAIS (não UTC) — o mesmo
 * `hojeIsoLocal()` de SaidasLista/EstoqueLista/Shell. Fica na tela (e não em
 * derive/) porque toca `new Date()`: as funções puras recebem a data por
 * parâmetro para continuarem testáveis sem mockar relógio. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

interface RomaneioEntregasProps {
  /** Fecha a folha e devolve a lista de saídas. */
  onVoltar: () => void
  onSessaoExpirada: () => void
}

/** Qual das duas folhas do dia está na tela — ver o cabeçalho do arquivo. */
type ModoDeFolha = 'romaneio' | 'entrega'

export function RomaneioEntregas({ onVoltar, onSessaoExpirada }: RomaneioEntregasProps) {
  // Uma vez por montagem: "hoje" não pode mudar debaixo do usuário enquanto
  // ele navega entre dias (a virada de meia-noite com a tela aberta é um caso
  // que uma recarga resolve). Mesmo raciocínio do `useMemo` das opções de
  // período no Shell.
  const hoje = useMemo(() => hojeIsoLocal(), [])
  const [data, setData] = useState(hoje)
  /** A escolha de campos vem do armazenamento na PRIMEIRA renderização
   * (função de inicialização, não valor) — ler a cada render seria tocar o
   * `localStorage` dezenas de vezes por sessão sem necessidade. */
  const [campos, setCampos] = useState<CamposRomaneio>(camposSalvosRomaneio)
  /** A escolha mudou mas o armazenamento recusou gravar. A folha na tela já
   * respeitou o clique; isto só avisa que ela volta ao padrão no próximo F5. */
  const [preferenciaNaoGravou, setPreferenciaNaoGravou] = useState(false)

  const [resposta, setResposta] = useState<RespostaRomaneio | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  /** Qual das duas folhas está na tela. O romaneio é o padrão: é a folha do
   * dia inteiro, a que se imprime uma vez por manhã; a de entrega é por
   * pedido, e quem a quer sabe qual pedido quer. */
  const [modo, setModo] = useState<ModoDeFolha>('romaneio')
  /** O pedido ESCOLHIDO À MÃO. `null` significa "nenhuma escolha ainda", e não
   * "nenhum pedido": a folha cai no primeiro do dia sozinha (ver
   * `pedidoEscolhido`). Guardar a escolha e não o pedido resolvido é o que faz
   * a troca de dia não carregar uma escolha que já não existe. */
  const [pedidoEscolhidoId, setPedidoEscolhidoId] = useState<string | null>(null)
  /** O corpo de letra em que a folha de entrega coube — medido pelo próprio
   * componente da folha. É por ele que a tela conta ao dono que a letra
   * encolheu, e quando ela encolheu demais. */
  const [corpoDaEntrega, setCorpoDaEntrega] = useState(CORPO_CONFORTAVEL)

  const dataPorExtenso = dataPorExtensoRomaneio(data)

  // Retrato só enquanto esta folha está montada — ver `useModoFolha`.
  useModoFolha()

  useEffect(() => {
    // `<input type="date">` pode ficar vazio (o usuário apaga o campo), e uma
    // data impossível digitada à mão não vira requisição: sem dia não há
    // romaneio, e pedir `/romaneio/` à API só produziria um 400 para traduzir
    // de volta. A tela diz o que fazer em vez disso.
    if (!dataPorExtensoRomaneio(data)) {
      setResposta(null)
      setCarregando(false)
      setErro('')
      return
    }
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<RespostaRomaneio>(`/api/saidas/romaneio/${data}`)
      .then(r => { if (!cancelado) setResposta(r) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada(); return }
        setErro('Não foi possível carregar as entregas deste dia.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [data, onSessaoExpirada])

  function alternarCampo(chave: CampoRomaneio) {
    const novos = { ...campos, [chave]: !campos[chave] }
    setCampos(novos)
    // Gravar é o BÔNUS; a folha já mudou na tela. Ver preferenciaFolha.ts.
    setPreferenciaNaoGravou(!salvarCamposRomaneio(novos))
  }

  function irPara(iso: string) {
    setData(iso)
  }

  /**
   * ISOLAÇÃO DE FALHA (padrão de ClientesLista/SaidasLista): se a montagem da
   * folha lançar, a tela NÃO cai — o controle de data, a escolha de campos e
   * o aviso continuam de pé, e um `role="status"` explica que a folha ficou
   * indisponível. Uma tela de impressão que some inteira por um defeito de
   * formatação deixaria o motorista sem folha e sem explicação.
   */
  let romaneio: Romaneio | null = null
  let montagemFalhou = false
  if (resposta) {
    try {
      romaneio = montarRomaneio(resposta, campos)
    } catch {
      montagemFalhou = true
    }
  }

  const temEntregas = !!romaneio && romaneio.grupos.length > 0

  /**
   * OS PEDIDOS DO DIA, para o seletor da folha de entrega. Saem da MESMA
   * resposta que o romaneio: um dia carregado, duas folhas possíveis.
   */
  const pedidos = useMemo(() => pedidosDoDia(resposta), [resposta])

  /**
   * O pedido que a folha mostra: o escolhido à mão, se ele ainda existir neste
   * dia, senão o primeiro.
   *
   * A queda para o primeiro é o que faz trocar de dia funcionar sem efeito
   * nenhum: a escolha antiga simplesmente não é encontrada na lista nova, e a
   * folha passa a ser a do primeiro pedido do dia novo. Um `useEffect` que
   * "limpasse a seleção" faria a mesma coisa com um render a mais e um
   * intervalo em que a tela mostra a folha do dia errado.
   */
  const pedidoEscolhido = pedidos.find(p => p.id === pedidoEscolhidoId) ?? pedidos[0] ?? null

  /** Mesma isolação de falha do romaneio: a folha de entrega pode não montar,
   * e a tela continua de pé com o controle de dia e a escolha de pedido. */
  const entrega = useMemo<{ folha: FolhaEntrega | null; falhou: boolean }>(() => {
    if (!resposta || !pedidoEscolhido) return { folha: null, falhou: false }
    try {
      return { folha: montarFolhaEntrega(resposta, pedidoEscolhido.id, hoje), falhou: false }
    } catch {
      return { folha: null, falhou: true }
    }
  }, [resposta, pedidoEscolhido, hoje])

  // Estável de propósito: entra numa dependência de efeito dentro da folha, e
  // uma função nova a cada render remediria a folha inteira toda vez.
  const aoMedirCorpo = useCallback((corpo: number) => setCorpoDaEntrega(corpo), [])

  const avisoDoTamanho = entrega.folha
    ? avisoDeLegibilidade(corpoDaEntrega, entrega.folha.totalItens)
    : ''

  const podeImprimir = modo === 'romaneio' ? temEntregas : !!entrega.folha

  return (
    <div className="folha-tela">
      <BarraDaFolha
        onVoltar={onVoltar}
        aoImprimir={podeImprimir ? () => window.print() : null}
        rotuloImprimir={modo === 'romaneio' ? 'Imprimir romaneio' : 'Imprimir folha de entrega'}
      >
        <div className="folha-controle">
          <button
            type="button"
            className="folha-passo"
            aria-label="Dia anterior"
            onClick={() => irPara(diaVizinho(data, -1))}
          >
            ◀
          </button>
          <label className="folha-controle-rotulo" htmlFor="romaneio-data">Entregas de</label>
          <input
            id="romaneio-data"
            className="folha-controle-campo"
            type="date"
            value={data}
            onChange={e => irPara(e.target.value)}
          />
          <button
            type="button"
            className="folha-passo"
            aria-label="Próximo dia"
            onClick={() => irPara(diaVizinho(data, 1))}
          >
            ▶
          </button>
          {data !== hoje && (
            <button type="button" className="folha-hoje" onClick={() => irPara(hoje)}>
              Hoje
            </button>
          )}
        </div>

        {/* OS DOIS BOTÕES DE FOLHA — e eles existem SEMPRE, inclusive num dia
            sem entrega nenhuma e enquanto o dia carrega. É a lição de 8cad53e:
            botão que some no caso vazio é botão que o dono procura, não acha, e
            conclui que a funcionalidade não existe. O que some com a folha
            vazia é o de IMPRIMIR, que aí não teria o que mandar ao papel. */}
        <div className="folha-abas" role="group" aria-label="Qual folha imprimir">
          <button
            type="button"
            className={modo === 'romaneio' ? 'folha-aba folha-aba--ativa' : 'folha-aba'}
            aria-pressed={modo === 'romaneio'}
            onClick={() => setModo('romaneio')}
          >
            Romaneio do dia
          </button>
          <button
            type="button"
            className={modo === 'entrega' ? 'folha-aba folha-aba--ativa' : 'folha-aba'}
            aria-pressed={modo === 'entrega'}
            onClick={() => setModo('entrega')}
          >
            Folha de entrega
          </button>
        </div>

        {modo === 'entrega' && pedidos.length > 0 && (
          <div className="folha-controle">
            <label className="folha-controle-rotulo" htmlFor="entrega-pedido">Pedido</label>
            <select
              id="entrega-pedido"
              className="folha-controle-campo"
              value={pedidoEscolhido?.id ?? ''}
              onChange={e => setPedidoEscolhidoId(e.target.value)}
            >
              {pedidos.map(p => (
                <option key={p.id} value={p.id}>{rotuloDoPedido(p)}</option>
              ))}
            </select>
          </div>
        )}
      </BarraDaFolha>

      {/* O painel é do ROMANEIO: são os campos DELE que ele liga e desliga. A
          folha de entrega não tem painel de propósito — o que sai nela é
          decisão fechada (ver derive/folhaEntrega.ts), e valor não é opcional
          numa via que o cliente assina reconhecendo quanto recebeu. */}
      {modo === 'romaneio' && (
        <PainelDeCampos
          defs={CAMPOS_ROMANEIO}
          campos={campos}
          aoAlternar={alternarCampo}
          fixos={CAMPOS_FIXOS_ROMANEIO}
          naoGravou={preferenciaNaoGravou}
          nota={
            <>
              Os três campos de <strong>Preços</strong> vêm desmarcados de propósito: a folha leva
              vários clientes juntos, e um cliente lê o preço do outro se ela ficar à vista. A
              escolha fica gravada neste navegador para a próxima impressão.
            </>
          }
        />
      )}

      {romaneio && romaneio.avisoSemData && (
        // Só na tela (data-no-print): é trabalho do escritório, não do
        // motorista — ele não tem como agir sobre isso no pátio, e a folha
        // dele não pode ganhar um alerta que ele precisa ignorar.
        <p className="folha-aviso" role="status" data-no-print="1">
          {romaneio.avisoSemData}
        </p>
      )}

      {(montagemFalhou || entrega.falhou) && (
        <p className="folha-estado-aviso" role="status" data-no-print="1">
          Não foi possível montar a folha deste dia. O controle de data e a escolha de campos
          continuam funcionando — troque o dia ou recarregue a tela.
        </p>
      )}

      {carregando && <p className="folha-estado" data-no-print="1">Carregando…</p>}

      {!carregando && erro && (
        <p className="folha-estado folha-estado--erro" role="alert" data-no-print="1">{erro}</p>
      )}

      {!carregando && !erro && !dataPorExtenso && (
        <p className="folha-estado" data-no-print="1">
          Escolha um dia para montar o romaneio.
        </p>
      )}

      {!carregando && !erro && romaneio && !temEntregas && (
        // VAZIO, NÃO ERRO: um dia sem entrega é um fato do negócio (feriado,
        // domingo, dia sem rota), não uma falha. A frase repete a data por
        // extenso para não deixar dúvida sobre QUAL dia está vazio.
        <div className="estado-vazio folha-vazio" data-no-print="1">
          <div className="folha-vazio-titulo">
            Nenhuma entrega marcada para {romaneio.dataPorExtenso ?? data}.
          </div>
          <div className="folha-vazio-sub">
            O romaneio usa a <strong>data de entrega</strong> do pedido, não a data em que ele foi
            lançado. Use ◀ e ▶ para ver outro dia.
          </div>
        </div>
      )}

      {/* O AVISO DE TAMANHO — a informação que o dono precisa ter mesmo tendo
          pedido para a folha nunca passar de uma página.
          `data-no-print`: é conversa com quem manda imprimir, não com o cliente
          que assina. Ver `avisoDeLegibilidade`. */}
      {modo === 'entrega' && avisoDoTamanho && (
        <p className="folha-aviso" role="status" data-no-print="1">{avisoDoTamanho}</p>
      )}

      {modo === 'romaneio' && romaneio && temEntregas && <Folha romaneio={romaneio} />}

      {modo === 'entrega' && entrega.folha && (
        <FolhaEntregaCliente folha={entrega.folha} aoMedirCorpo={aoMedirCorpo} />
      )}

      {modo === 'entrega' && !carregando && !erro && !entrega.folha && dataPorExtenso && (
        <div className="estado-vazio folha-vazio" data-no-print="1">
          <div className="folha-vazio-titulo">
            Nenhum pedido para imprimir em {romaneio?.dataPorExtenso ?? dataPorExtenso}.
          </div>
          <div className="folha-vazio-sub">
            A folha de entrega sai de <strong>um pedido</strong> do dia escolhido. Pedido
            cancelado ou devolvido não entra: a folha é o recibo do que o cliente recebeu, e
            nenhum dos dois foi entregue. Use ◀ e ▶ para ver outro dia.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A FOLHA — o que de fato vai para o papel. Tudo aqui dentro é impresso;
 * tudo que é controle mora fora, marcado com `data-no-print`.
 */
function Folha({ romaneio }: { romaneio: Romaneio }) {
  const { campos } = romaneio
  const dataFolha = romaneio.dataPorExtenso ?? romaneio.data

  /**
   * DUAS COLUNAS SÓ QUANDO O ITEM CABE EM MEIA FOLHA.
   *
   * Um item do romaneio é texto curto — "Alface Crespa · 45 UN" — e sozinho
   * numa A4 retrato desperdiça metade da largura. Em duas colunas cabe o
   * dobro por página, que é o desenho que o dono mandou.
   *
   * Ligar preço unitário ou total do item põe duas colunas numéricas de 110px
   * dentro de cada metade, e aí o nome do produto ficaria com menos de 90px:
   * "Batata Inglesa Lavada" quebraria em três linhas e a folha ficaria mais
   * ALTA que a de uma coluna só. Não há corpo de letra que resolva isso sem
   * descer do piso de 12px, que é a linha que não se cruza (e2e9968) — então
   * a folha volta para uma coluna, que é a resposta honesta: não coube.
   */
  const duasColunas = !campos.precoUnitario && !campos.totalItem

  return (
    <div className="folha">
      <TopoDaFolha
        titulo="ROMANEIO DE ENTREGAS"
        data={dataFolha}
        resumo={resumoRomaneio(romaneio)}
      />

      {romaneio.grupos.map(g => (
        <section className="folha-bloco" key={g.clienteId ?? g.cliente}>
          <div className="folha-bloco-topo">
            <div className="folha-bloco-nome">{g.cliente}</div>
            {/* A data repetida em cada bloco: `break-inside: avoid` mantém o
                cliente inteiro numa página, então cada página carrega pelo
                menos um destes. Quem separar as folhas continua sabendo de
                que dia cada uma é. */}
            <div className="folha-bloco-selo">{dataFolha}</div>
          </div>

          {(g.rota || g.endereco || g.telefone) && (
            <div className="folha-bloco-dados">
              {g.rota && <span className="folha-bloco-dado">Rota: {g.rota}</span>}
              {g.endereco && <span className="folha-bloco-dado">{g.endereco}</span>}
              {g.telefone && <span className="folha-bloco-dado">Tel.: {g.telefone}</span>}
            </div>
          )}

          {g.pedidos.map(p => (
            <div className="folha-bloco-secao" key={p.id}>
              {(p.numero || p.total) && (
                <div className="folha-nao-quebrar folha-bloco-linha">
                  {p.numero && <span>Pedido {p.numero}</span>}
                  {p.total && <span>Total {p.total}</span>}
                </div>
              )}
              {p.obs && <div className="folha-nao-quebrar folha-bloco-obs">Obs.: {p.obs}</div>}

              {duasColunas
                ? (
                  <table className="folha-tabela folha-tabela--duas">
                    <thead>
                      {/* Os rótulos saem NOS DOIS LADOS, como no desenho — e
                          `thead` é o que os repete em toda página. */}
                      <tr>
                        <RotulosDeItem />
                        <RotulosDeItem corte />
                      </tr>
                    </thead>
                    <tbody>
                      {emPares(p.itens).map(([a, b]) => (
                        <tr key={a.id} className="folha-item">
                          <CelulasDeItem item={a} />
                          {/* A metade direita vazia da última linha ímpar sai
                              SEM quadradinho: um quadradinho é um item a
                              conferir, e ali não há item nenhum. */}
                          {b
                            ? <CelulasDeItem item={b} corte />
                            : (
                              <>
                                <td className="folha-col-check folha-col-corte" />
                                <td />
                                <td className="folha-col-qtd" />
                              </>
                            )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
                : (
                  <table className="folha-tabela">
                    <thead>
                      <tr>
                        <th className="folha-col-check" scope="col"><span aria-hidden="true">✓</span></th>
                        <th scope="col">PRODUTO</th>
                        <th className="folha-col-qtd" scope="col">QUANTIDADE</th>
                        {campos.precoUnitario && <th className="folha-col-num" scope="col">PREÇO UN.</th>}
                        {campos.totalItem && <th className="folha-col-num" scope="col">TOTAL</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {p.itens.map(i => (
                        <tr key={i.id} className="folha-item">
                          <td className="folha-col-check"><CaixaDeMarcar /></td>
                          <td className="folha-produto">{i.produto}</td>
                          <td className="folha-col-qtd">{i.quantidade}</td>
                          {campos.precoUnitario && (
                            <td className="folha-col-num">{i.precoUnitario ?? '—'}</td>
                          )}
                          {campos.totalItem && (
                            <td className="folha-col-num">{i.total ?? '—'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          ))}

          <div className="folha-bloco-rodape">
            {g.totalItens === 1 ? '1 item' : `${g.totalItens} itens`} · Recebido por
            <LinhaAssinatura />
          </div>
        </section>
      ))}

      <div className="folha-rodape">
        <span>Conferido por<LinhaAssinatura /></span>
        <span>Motorista<LinhaAssinatura /></span>
        <span>Saída às<LinhaAssinatura curta /></span>
      </div>
    </div>
  )
}

/**
 * Os rótulos de UMA metade da folha de duas colunas. Saem duas vezes na mesma
 * `<tr>` do `<thead>` — é isso que põe PRODUTO e QTD nos dois lados, como no
 * desenho, e `display: table-header-group` (@media print) os repete em toda
 * página.
 *
 * "QTD" e não "QUANTIDADE": em meia folha a coluna tem 76px, e o rótulo longo
 * quebraria em duas linhas no cabeçalho. É a abreviação do próprio desenho.
 */
function RotulosDeItem({ corte }: { corte?: boolean }) {
  return (
    <>
      <th
        className={corte ? 'folha-col-check folha-col-corte' : 'folha-col-check'}
        scope="col"
      >
        <span aria-hidden="true">✓</span>
      </th>
      <th scope="col">PRODUTO</th>
      <th className="folha-col-qtd" scope="col">QTD</th>
    </>
  )
}

/** As três células de um item numa metade da folha de duas colunas. */
function CelulasDeItem({ item, corte }: { item: ItemRomaneio; corte?: boolean }) {
  return (
    <>
      <td className={corte ? 'folha-col-check folha-col-corte' : 'folha-col-check'}>
        <CaixaDeMarcar />
      </td>
      <td className="folha-produto">{item.produto}</td>
      <td className="folha-col-qtd">{item.quantidade}</td>
    </>
  )
}
