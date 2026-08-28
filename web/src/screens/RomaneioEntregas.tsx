import { useEffect, useMemo, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  montarRomaneio, resumoRomaneio, diaVizinho, dataPorExtensoRomaneio,
  CAMPOS_ROMANEIO, CAMPOS_FIXOS_ROMANEIO,
  type CampoRomaneio, type CamposRomaneio, type Romaneio, type RespostaRomaneio,
} from '../derive/romaneio'
import { camposSalvosRomaneio, salvarCamposRomaneio } from '../preferenciaRomaneio'
import './RomaneioEntregas.css'

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

  const dataPorExtenso = dataPorExtensoRomaneio(data)

  /**
   * MARCA O DOCUMENTO ENQUANTO A FOLHA ESTÁ MONTADA — é o que dá orientação
   * de retrato só a esta impressão.
   *
   * Regra de `@page` é do DOCUMENTO, não do componente, e `RelatoriosTela.css`
   * já declara `@page { size: A4 landscape }` para o app inteiro (o bundle
   * carrega o CSS de todas as telas). Um segundo `@page` sem nome aqui
   * brigaria por ordem de bundle e, vencendo, viraria os relatórios de
   * paisagem para retrato — regressão numa tela que ninguém tocou. A saída é
   * uma página NOMEADA (`@page romaneio`, em RomaneioEntregas.css) pedida por
   * `body.romaneio-imprimindo`, e esta classe é o interruptor dela.
   *
   * O `remove` na limpeza é obrigatório: sair do romaneio e imprimir
   * Relatórios não pode herdar o retrato daqui.
   */
  useEffect(() => {
    document.body.classList.add('romaneio-imprimindo')
    return () => document.body.classList.remove('romaneio-imprimindo')
  }, [])

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
    // Gravar é o BÔNUS; a folha já mudou na tela. Ver preferenciaRomaneio.ts.
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

  return (
    <div className="romaneio">
      <div className="romaneio-barra" data-no-print="1">
        <button type="button" className="romaneio-voltar" onClick={onVoltar}>
          ← Voltar para a lista
        </button>

        <div className="romaneio-dia">
          <button
            type="button"
            className="romaneio-passo"
            aria-label="Dia anterior"
            onClick={() => irPara(diaVizinho(data, -1))}
          >
            ◀
          </button>
          <label className="romaneio-dia-rotulo" htmlFor="romaneio-data">Entregas de</label>
          <input
            id="romaneio-data"
            className="romaneio-dia-input"
            type="date"
            value={data}
            onChange={e => irPara(e.target.value)}
          />
          <button
            type="button"
            className="romaneio-passo"
            aria-label="Próximo dia"
            onClick={() => irPara(diaVizinho(data, 1))}
          >
            ▶
          </button>
          {data !== hoje && (
            <button type="button" className="romaneio-hoje" onClick={() => irPara(hoje)}>
              Hoje
            </button>
          )}
        </div>

        <div className="romaneio-flex-espaco" />

        {temEntregas && (
          <button type="button" className="romaneio-imprimir" onClick={() => window.print()}>
            Imprimir romaneio
          </button>
        )}
      </div>

      <fieldset className="romaneio-campos" data-no-print="1">
        <legend className="romaneio-campos-titulo">O que sai na folha</legend>
        <div className="romaneio-campos-grade">
          {['Cliente', 'Pedido', 'Preços'].map(grupo => (
            <div key={grupo} className="romaneio-campos-grupo">
              <div className="romaneio-campos-grupo-nome">{grupo}</div>
              {CAMPOS_ROMANEIO.filter(c => c.grupo === grupo).map(c => (
                <label key={c.chave} className="romaneio-campo" title={c.ajuda}>
                  <input
                    type="checkbox"
                    checked={campos[c.chave]}
                    onChange={() => alternarCampo(c.chave)}
                  />
                  <span className="romaneio-campo-rotulo">{c.rotulo}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {/* A escolha só é honesta se disser também o que NÃO se escolhe. */}
        <p className="romaneio-campos-fixos">
          <strong>Sempre sai:</strong> {CAMPOS_FIXOS_ROMANEIO.join(' · ')}.
        </p>
        <p className="romaneio-campos-nota">
          Os três campos de <strong>Preços</strong> vêm desmarcados de propósito: a folha leva
          vários clientes juntos, e um cliente lê o preço do outro se ela ficar à vista. A escolha
          fica gravada neste navegador para a próxima impressão.
        </p>
        {preferenciaNaoGravou && (
          <p className="romaneio-campos-aviso" role="status">
            A escolha vale para esta impressão, mas não pôde ser gravada neste navegador — no
            próximo acesso ela volta ao padrão.
          </p>
        )}
      </fieldset>

      {romaneio && romaneio.avisoSemData && (
        // Só na tela (data-no-print): é trabalho do escritório, não do
        // motorista — ele não tem como agir sobre isso no pátio, e a folha
        // dele não pode ganhar um alerta que ele precisa ignorar.
        <p className="romaneio-aviso-sem-data" role="status" data-no-print="1">
          {romaneio.avisoSemData}
        </p>
      )}

      {montagemFalhou && (
        <p className="romaneio-estado-aviso" role="status" data-no-print="1">
          Não foi possível montar a folha deste dia. O controle de data e a escolha de campos
          continuam funcionando — troque o dia ou recarregue a tela.
        </p>
      )}

      {carregando && <p className="romaneio-estado" data-no-print="1">Carregando…</p>}

      {!carregando && erro && (
        <p className="romaneio-estado romaneio-estado--erro" role="alert" data-no-print="1">{erro}</p>
      )}

      {!carregando && !erro && !dataPorExtenso && (
        <p className="romaneio-estado" data-no-print="1">
          Escolha um dia para montar o romaneio.
        </p>
      )}

      {!carregando && !erro && romaneio && !temEntregas && (
        // VAZIO, NÃO ERRO: um dia sem entrega é um fato do negócio (feriado,
        // domingo, dia sem rota), não uma falha. A frase repete a data por
        // extenso para não deixar dúvida sobre QUAL dia está vazio.
        <div className="estado-vazio romaneio-vazio" data-no-print="1">
          <div className="romaneio-vazio-titulo">
            Nenhuma entrega marcada para {romaneio.dataPorExtenso ?? data}.
          </div>
          <div className="romaneio-vazio-sub">
            O romaneio usa a <strong>data de entrega</strong> do pedido, não a data em que ele foi
            lançado. Use ◀ e ▶ para ver outro dia.
          </div>
        </div>
      )}

      {romaneio && temEntregas && <Folha romaneio={romaneio} />}
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

  return (
    <div className="romaneio-folha">
      <div className="romaneio-folha-topo">
        <div className="romaneio-folha-titulo">ROMANEIO DE ENTREGAS</div>
        {/* A DATA GRANDE. É o maior texto da folha de propósito — ver o
            comentário de `dataPorExtensoRomaneio` em derive/romaneio.ts. */}
        <div className="romaneio-folha-data">{dataFolha}</div>
        <div className="romaneio-folha-resumo">{resumoRomaneio(romaneio)}</div>
      </div>

      {romaneio.grupos.map(g => (
        <section className="romaneio-cliente" key={g.clienteId ?? g.cliente}>
          <div className="romaneio-cliente-topo">
            <div className="romaneio-cliente-nome">{g.cliente}</div>
            {/* A data repetida em cada bloco: `break-inside: avoid` mantém o
                cliente inteiro numa página, então cada página carrega pelo
                menos um destes. Quem separar as folhas continua sabendo de
                que dia cada uma é. */}
            <div className="romaneio-cliente-selo">{dataFolha}</div>
          </div>

          {(g.rota || g.endereco || g.telefone) && (
            <div className="romaneio-cliente-dados">
              {g.rota && <span className="romaneio-cliente-dado">Rota: {g.rota}</span>}
              {g.endereco && <span className="romaneio-cliente-dado">{g.endereco}</span>}
              {g.telefone && <span className="romaneio-cliente-dado">Tel.: {g.telefone}</span>}
            </div>
          )}

          {g.pedidos.map(p => (
            <div className="romaneio-pedido" key={p.id}>
              {(p.numero || p.total) && (
                <div className="romaneio-pedido-topo">
                  {p.numero && <span className="romaneio-pedido-numero">Pedido {p.numero}</span>}
                  {p.total && <span className="romaneio-pedido-total">Total {p.total}</span>}
                </div>
              )}
              {p.obs && <div className="romaneio-pedido-obs">Obs.: {p.obs}</div>}

              <table className="romaneio-itens">
                <thead>
                  <tr>
                    <th className="romaneio-col-check" scope="col"><span aria-hidden="true">✓</span></th>
                    <th scope="col">PRODUTO</th>
                    <th className="romaneio-col-qtd" scope="col">QUANTIDADE</th>
                    {campos.precoUnitario && <th className="romaneio-col-num" scope="col">PREÇO UN.</th>}
                    {campos.totalItem && <th className="romaneio-col-num" scope="col">TOTAL</th>}
                  </tr>
                </thead>
                <tbody>
                  {p.itens.map(i => (
                    <tr key={i.id} className="romaneio-item">
                      <td className="romaneio-col-check">
                        {/* O quadradinho é uma caixa desenhada com borda, não
                            um caractere: caractere depende da fonte instalada
                            na máquina que imprime e some em impressora
                            monocromática antiga. */}
                        <span className="romaneio-check" aria-hidden="true" />
                      </td>
                      <td className="romaneio-item-produto">{i.produto}</td>
                      <td className="romaneio-col-qtd">{i.quantidade}</td>
                      {campos.precoUnitario && (
                        <td className="romaneio-col-num">{i.precoUnitario ?? '—'}</td>
                      )}
                      {campos.totalItem && (
                        <td className="romaneio-col-num">{i.total ?? '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="romaneio-cliente-rodape">
            {g.totalItens === 1 ? '1 item' : `${g.totalItens} itens`} · Recebido por
            <span className="romaneio-linha-assinatura" />
          </div>
        </section>
      ))}

      <div className="romaneio-folha-rodape">
        <span>Conferido por<span className="romaneio-linha-assinatura" /></span>
        <span>Motorista<span className="romaneio-linha-assinatura" /></span>
        <span>Saída às<span className="romaneio-linha-assinatura romaneio-linha-assinatura--curta" /></span>
      </div>
    </div>
  )
}
