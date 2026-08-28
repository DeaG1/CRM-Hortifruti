import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  montarFolhaEntrada, rotuloEntradaNoSeletor,
  CAMPOS_FOLHA_ENTRADA, CAMPOS_FIXOS_FOLHA_ENTRADA,
  type CampoFolhaEntrada, type CamposFolhaEntrada,
  type EntradaBruta, type FolhaEntrada,
} from '../derive/folhaEntrada'
import { camposSalvosDaFolha, salvarCamposDaFolha } from '../preferenciaFolha'
import {
  useModoFolha, BarraDaFolha, PainelDeCampos, TopoDaFolha,
  CaixaDeMarcar, EspacoParaEscrever, LinhaAssinatura,
} from '../components/FolhaImpressa'

/**
 * A FOLHA DE CONFERÊNCIA DA CARGA — Entradas.
 *
 * Mora DENTRO de Entradas (screens/EntradasLista.tsx a abre e fecha), pelo
 * mesmo raciocínio que pôs o romaneio dentro de Saídas: é a mesma matéria (a
 * carga que chegou É a entrada), imprimir é uma AÇÃO sobre a lista, e a
 * permissão já está certa — 'entradas' não está em ADMIN_ONLY_SCREENS
 * (web/src/telas.ts), `GET /api/entradas/*` e `GET /api/produtos` só exigem
 * sessão. O colaborador, que é quem recebe a mercadoria, alcança a folha sem
 * nenhuma permissão nova, e nada aqui expõe dado que ele já não veja na
 * própria lista de Entradas.
 *
 * A ESCOLHA É DE UMA ENTRADA, NÃO DE UM DIA — ver o comentário grande em
 * derive/folhaEntrada.ts. Por isso o controle da barra é um seletor de coleta
 * e não um `<input type="date">`: a carga chega por fornecedor, uma de cada
 * vez, e é uma delas que se confere com a folha na mão.
 *
 * O SELETOR OFERECE TODAS AS ENTRADAS, não só as do período do cabeçalho. É
 * a mesma regra do romaneio, que imprime qualquer data: o recorte do
 * cabeçalho serve para LER a lista, e não pode decidir o que se consegue
 * imprimir. Uma coleta lançada ontem, com o cabeçalho em "este mês", tem de
 * continuar alcançável.
 */

const CHAVE_PREFERENCIA = 'crm_hf_folha_entrada_campos'

/** O mínimo que o seletor precisa de cada entrada — vem da listagem que
 * EntradasLista já carregou, para a folha não refazer a busca inteira. */
export interface EntradaNoSeletor {
  id: string
  numero: string
  data: string
  fornecedor_id: string | null
}

interface FolhaConferenciaEntradaProps {
  /** Todas as entradas lançadas, na ordem da listagem (mais recente primeiro).
   * SEM o recorte de período — ver o comentário do componente. */
  entradas: readonly EntradaNoSeletor[]
  /** Nome do fornecedor, ou `null` quando não há vínculo ou o cadastro não
   * pôde ser lido (o colaborador recebe 403 em `GET /api/fornecedores`, e a
   * folha não pode cair por causa disso — cai para "Sem fornecedor
   * vinculado", como a lista cai para o id). */
  nomeFornecedor: (id: string | null) => string | null
  onVoltar: () => void
  onSessaoExpirada?: () => void
}

export function FolhaConferenciaEntrada({
  entradas, nomeFornecedor, onVoltar, onSessaoExpirada,
}: FolhaConferenciaEntradaProps) {
  // Começa na coleta mais recente: é a que acabou de chegar, e é ela que se
  // confere em 9 de cada 10 impressões. A lista já vem ordenada por data desc
  // da API (`order by e.data desc, e.numero desc`).
  const [id, setId] = useState(() => entradas[0]?.id ?? '')
  const [campos, setCampos] = useState<CamposFolhaEntrada>(
    () => camposSalvosDaFolha(CHAVE_PREFERENCIA, CAMPOS_FOLHA_ENTRADA),
  )
  const [preferenciaNaoGravou, setPreferenciaNaoGravou] = useState(false)

  const [entrada, setEntrada] = useState<EntradaBruta | null>(null)
  const [produtos, setProdutos] = useState<ReadonlyMap<string, string>>(new Map())
  const [carregando, setCarregando] = useState(entradas.length > 0)
  const [erro, setErro] = useState('')

  useModoFolha()

  // Nome dos produtos: `GET /api/entradas/:id` devolve `produto_id` cru (é a
  // coluna real). Falha SOZINHA — a folha continua saindo com o id no lugar
  // do nome, que é feio mas rastreável, em vez de não sair.
  useEffect(() => {
    let cancelado = false
    api.get<{ id: string; nome: string }[]>('/api/produtos')
      .then(ps => {
        if (cancelado) return
        setProdutos(new Map(ps.map(p => [p.id, p.nome])))
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) onSessaoExpirada?.()
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  useEffect(() => {
    if (!id) { setEntrada(null); setCarregando(false); setErro(''); return }
    let cancelado = false
    setCarregando(true)
    setErro('')
    api.get<EntradaBruta>(`/api/entradas/${id}`)
      .then(e => { if (!cancelado) setEntrada(e) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        setErro('Não foi possível carregar os itens desta entrada.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [id, onSessaoExpirada])

  function alternarCampo(chave: CampoFolhaEntrada) {
    const novos = { ...campos, [chave]: !campos[chave] }
    setCampos(novos)
    setPreferenciaNaoGravou(!salvarCamposDaFolha(CHAVE_PREFERENCIA, CAMPOS_FOLHA_ENTRADA, novos))
  }

  /**
   * ISOLAÇÃO DE FALHA (padrão de ClientesLista/RomaneioEntregas): se a
   * montagem da folha lançar, a tela NÃO cai — o seletor de coleta e a
   * escolha de campos continuam de pé, e um `role="status"` explica.
   */
  let folha: FolhaEntrada | null = null
  let montagemFalhou = false
  if (entrada) {
    try {
      folha = montarFolhaEntrada(
        entrada,
        { fornecedor: nomeFornecedor(entrada.fornecedor_id), produtos },
        campos,
      )
    } catch {
      montagemFalhou = true
    }
  }

  const temItens = !!folha && folha.itens.length > 0

  return (
    <div className="folha-tela">
      <BarraDaFolha
        onVoltar={onVoltar}
        aoImprimir={temItens ? () => window.print() : null}
        rotuloImprimir="Imprimir conferência"
      >
        {entradas.length > 0 && (
          <div className="folha-controle">
            <label className="folha-controle-rotulo" htmlFor="folha-entrada">Coleta</label>
            <select
              id="folha-entrada"
              className="folha-controle-campo"
              value={id}
              onChange={e => setId(e.target.value)}
            >
              {entradas.map(e => (
                <option key={e.id} value={e.id}>
                  {rotuloEntradaNoSeletor(e.numero, e.data, nomeFornecedor(e.fornecedor_id))}
                </option>
              ))}
            </select>
          </div>
        )}
      </BarraDaFolha>

      <PainelDeCampos
        defs={CAMPOS_FOLHA_ENTRADA}
        campos={campos}
        aoAlternar={alternarCampo}
        fixos={CAMPOS_FIXOS_FOLHA_ENTRADA}
        naoGravou={preferenciaNaoGravou}
        nota={
          <>
            Os três campos de <strong>Preços</strong> vêm desmarcados de propósito: esta folha é
            assinada e arquivada, e passa pela mão de quem entrega — o que a carga custou é assunto
            entre você e o produtor. A escolha fica gravada neste navegador para a próxima
            impressão.
          </>
        }
      />

      {montagemFalhou && (
        <p className="folha-estado-aviso" role="status" data-no-print="1">
          Não foi possível montar a folha desta coleta. O seletor e a escolha de campos continuam
          funcionando — troque a coleta ou recarregue a tela.
        </p>
      )}

      {carregando && <p className="folha-estado" data-no-print="1">Carregando…</p>}

      {!carregando && erro && (
        <p className="folha-estado folha-estado--erro" role="alert" data-no-print="1">{erro}</p>
      )}

      {/* VAZIO, NÃO ERRO. Duas ausências diferentes, duas frases: não há
          entrada nenhuma lançada (nada a conferir em lugar nenhum) ou a coleta
          escolhida não tem item (só possível por lançamento direto no banco —
          a API exige pelo menos um). */}
      {!carregando && !erro && entradas.length === 0 && (
        <div className="estado-vazio folha-vazio" data-no-print="1">
          <div className="folha-vazio-titulo">Nenhuma entrada lançada ainda.</div>
          <div className="folha-vazio-sub">
            A folha de conferência é impressa a partir de uma <strong>coleta lançada</strong>:
            é ela que diz o que era para chegar. Lance a entrada e volte aqui para conferir a
            carga.
          </div>
        </div>
      )}

      {!carregando && !erro && folha && !temItens && (
        <div className="estado-vazio folha-vazio" data-no-print="1">
          <div className="folha-vazio-titulo">Esta coleta não tem itens.</div>
          <div className="folha-vazio-sub">
            Não há o que conferir nela. Escolha outra coleta no seletor acima.
          </div>
        </div>
      )}

      {folha && temItens && <Folha folha={folha} />}
    </div>
  )
}

/** A FOLHA — o que de fato vai para o papel. */
function Folha({ folha }: { folha: FolhaEntrada }) {
  const { campos } = folha
  const dataFolha = folha.dataPorExtenso ?? folha.data

  return (
    <div className="folha">
      <TopoDaFolha
        titulo="CONFERÊNCIA DE CARGA RECEBIDA"
        data={dataFolha}
        resumo={folha.resumo}
      />

      <section className="folha-bloco">
        <div className="folha-bloco-topo">
          <div className="folha-bloco-nome">{folha.fornecedor}</div>
          {/* A data repetida junto do fornecedor: quem arquiva a folha
              assinada precisa saber de que coleta ela é sem procurar o topo. */}
          <div className="folha-bloco-selo">{dataFolha}</div>
        </div>

        {(folha.numero || folha.motivo) && (
          <div className="folha-bloco-dados">
            {folha.numero && <span>Entrada {folha.numero}</span>}
            {folha.motivo && <span>Motivo: {folha.motivo}</span>}
          </div>
        )}
        {folha.obs && <div className="folha-bloco-obs">Obs.: {folha.obs}</div>}

        <table className="folha-tabela">
          <thead>
            <tr>
              <th className="folha-col-check" scope="col"><span aria-hidden="true">✓</span></th>
              <th scope="col">PRODUTO</th>
              {/* "QUANTIDADE LANÇADA" e não "QUANTIDADE": o número que sai
                  aqui é o que o sistema diz que era para chegar, na unidade em
                  que foi lançado. A coluna ao lado é o que de fato chegou. */}
              <th className="folha-col-qtd" scope="col">LANÇADO</th>
              {campos.perda && <th className="folha-col-num" scope="col">PERDA COLETA</th>}
              {campos.precoUnitario && <th className="folha-col-num" scope="col">PREÇO UN.</th>}
              {campos.totalItem && <th className="folha-col-num" scope="col">TOTAL</th>}
              {/* A COLUNA EM BRANCO. Marcar o quadradinho diz "conferi"; esta
                  diz QUANTO chegou quando não bate — e é a diferença entre uma
                  folha que registra a divergência e uma que só registra que
                  alguém olhou. */}
              <th className="folha-col-qtd" scope="col">RECEBIDO</th>
            </tr>
          </thead>
          <tbody>
            {folha.itens.map(i => (
              <tr key={i.id} className="folha-item">
                <td className="folha-col-check"><CaixaDeMarcar /></td>
                <td className="folha-produto">{i.produto}</td>
                <td className="folha-col-qtd">{i.quantidade}</td>
                {campos.perda && <td className="folha-col-num">{i.perda ?? '—'}</td>}
                {campos.precoUnitario && (
                  <td className="folha-col-num">{i.precoUnitario ?? '—'}</td>
                )}
                {campos.totalItem && <td className="folha-col-num">{i.total ?? '—'}</td>}
                <td className="folha-col-qtd"><EspacoParaEscrever /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {folha.total && (
          <div className="folha-bloco-rodape">Total da entrada: {folha.total}</div>
        )}
      </section>

      <div className="folha-rodape">
        <span>Conferido por<LinhaAssinatura /></span>
        <span>Entregue por<LinhaAssinatura /></span>
        <span>Hora<LinhaAssinatura curta /></span>
      </div>
    </div>
  )
}
