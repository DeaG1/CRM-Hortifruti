import { useState } from 'react'
import {
  montarFolhaContagem,
  CAMPOS_FOLHA_CONTAGEM, CAMPOS_FIXOS_FOLHA_CONTAGEM,
  type CampoFolhaContagem, type CamposFolhaContagem,
  type LinhaContagemBruta, type FolhaContagem,
} from '../derive/folhaEstoque'
import { camposSalvosDaFolha, salvarCamposDaFolha } from '../preferenciaFolha'
import {
  useModoFolha, BarraDaFolha, PainelDeCampos, TopoDaFolha,
  EspacoParaEscrever, LinhaAssinatura,
} from '../components/FolhaImpressa'

/**
 * A FOLHA DE CONTAGEM FÍSICA — Estoque.
 *
 * Mora DENTRO de Estoque (screens/EstoqueLista.tsx a abre e fecha), pelo mesmo
 * raciocínio que pôs o romaneio dentro de Saídas: é a mesma matéria (o que a
 * folha lista É o saldo da tela), imprimir é uma AÇÃO sobre a lista, e a
 * permissão já está certa — 'estoque' não está em ADMIN_ONLY_SCREENS
 * (web/src/telas.ts) e `GET /api/estoque` só exige sessão. O colaborador, que
 * é quem conta o depósito, alcança a folha sem nenhuma permissão nova.
 *
 * NÃO HÁ BUSCA NOVA AQUI. As linhas descem prontas de EstoqueLista, que já as
 * carregou com o corte de "Posição em" aplicado. Isso é deliberado e é o que
 * garante a invariante que importa: a folha impressa mostra EXATAMENTE os
 * números que estavam na tela quando a pessoa clicou em imprimir. Uma segunda
 * busca poderia trazer um saldo diferente (uma venda lançada no meio) e a
 * folha sairia discordando do monitor de onde saiu.
 *
 * A DATA VEM JUNTO, E É A DA POSIÇÃO — nunca "hoje" por presunção. Ver o
 * comentário de derive/folhaEstoque.ts: conferir o estoque físico de hoje
 * contra uma posição de duas semanas atrás é o erro que esta folha pode
 * causar, e o alerta emoldurado vai para o PAPEL, não só para a tela.
 */

const CHAVE_PREFERENCIA = 'crm_hf_folha_contagem_campos'

interface FolhaContagemEstoqueProps {
  /** As linhas que a tela já tem, com o corte de "Posição em" aplicado. */
  linhas: readonly LinhaContagemBruta[]
  /** A data da posição (ISO) — o "Posição em" da tela. */
  dataPosicao: string
  /** Hoje (ISO), para a folha saber se está olhando para trás. */
  hoje: string
  onVoltar: () => void
}

export function FolhaContagemEstoque({
  linhas, dataPosicao, hoje, onVoltar,
}: FolhaContagemEstoqueProps) {
  const [campos, setCampos] = useState<CamposFolhaContagem>(
    () => camposSalvosDaFolha(CHAVE_PREFERENCIA, CAMPOS_FOLHA_CONTAGEM),
  )
  const [preferenciaNaoGravou, setPreferenciaNaoGravou] = useState(false)

  useModoFolha()

  function alternarCampo(chave: CampoFolhaContagem) {
    const novos = { ...campos, [chave]: !campos[chave] }
    setCampos(novos)
    setPreferenciaNaoGravou(!salvarCamposDaFolha(CHAVE_PREFERENCIA, CAMPOS_FOLHA_CONTAGEM, novos))
  }

  /** ISOLAÇÃO DE FALHA: se a montagem lançar, a tela não cai — a escolha de
   * campos e o botão de voltar continuam de pé. */
  let folha: FolhaContagem | null = null
  let montagemFalhou = false
  try {
    folha = montarFolhaContagem(linhas, campos, dataPosicao, hoje)
  } catch {
    montagemFalhou = true
  }

  const temLinhas = !!folha && folha.linhas.length > 0

  return (
    <div className="folha-tela">
      <BarraDaFolha
        onVoltar={onVoltar}
        rotuloVoltar="← Voltar para o estoque"
        aoImprimir={temLinhas ? () => window.print() : null}
        rotuloImprimir="Imprimir contagem"
      >
        {/* A data NÃO é editável aqui de propósito: ela é a da tela de
            Estoque, e ter dois controles para a mesma posição em dois lugares
            é como eles passam a discordar. Quem quer outra data volta, troca
            o "Posição em" e imprime de novo — e assim a folha nunca mostra um
            dia diferente do que o monitor mostrava. */}
        <div className="folha-controle">
          <span className="folha-controle-rotulo">Posição em</span>
          <strong className="folha-controle-campo">
            {folha?.dataPorExtenso ?? dataPosicao}
          </strong>
        </div>
      </BarraDaFolha>

      <PainelDeCampos
        defs={CAMPOS_FOLHA_CONTAGEM}
        campos={campos}
        aoAlternar={alternarCampo}
        fixos={CAMPOS_FIXOS_FOLHA_CONTAGEM}
        naoGravou={preferenciaNaoGravou}
        nota={
          <>
            <strong>Produtos que acabaram</strong> vêm marcados: “o sistema diz que não tem” é a
            afirmação que mais erra, e sobrar mercadoria numa prateleira zerada quase sempre é
            entrada que ninguém lançou. <strong>Nunca comprados</strong> vêm desmarcados: não há
            prateleira para conferir, e eles podem ser a maioria das linhas — marque quando quiser
            varrer o catálogo inteiro. A escolha fica gravada neste navegador.
          </>
        }
      />

      {folha?.historica && (
        // Na tela TAMBÉM, além do papel: quem imprime precisa ver antes de
        // gastar folha que está levando uma posição histórica para a câmara.
        <p className="folha-aviso" role="status" data-no-print="1">
          {folha.alertaHistorico}
        </p>
      )}

      {montagemFalhou && (
        <p className="folha-estado-aviso" role="status" data-no-print="1">
          Não foi possível montar a folha de contagem. A escolha de campos continua funcionando —
          volte ao estoque e tente de novo.
        </p>
      )}

      {folha && !temLinhas && (
        // VAZIO, NÃO ERRO. E duas causas diferentes: ou o depósito não tem
        // linha nenhuma, ou a escolha de campos escondeu todas — e a segunda
        // tem conserto imediato, na caixa logo acima.
        <div className="estado-vazio folha-vazio" data-no-print="1">
          <div className="folha-vazio-titulo">
            {folha.ocultas > 0
              ? 'Nenhuma linha sobrou para contar.'
              : 'Não há produto para contar.'}
          </div>
          <div className="folha-vazio-sub">
            {folha.ocultas > 0
              ? <>
                  As {folha.ocultas} linha(s) desta posição são todas de produtos zerados, e as
                  caixas acima estão desmarcadas. Marque <strong>Produtos que acabaram</strong> ou{' '}
                  <strong>Produtos nunca comprados</strong> para trazê-las.
                </>
              : <>
                  Esta posição não tem nenhum produto. Cadastre em <strong>Produtos</strong> e
                  lance a primeira <strong>Entrada (compra)</strong>.
                </>}
          </div>
        </div>
      )}

      {folha && temLinhas && <Folha folha={folha} />}
    </div>
  )
}

/** A FOLHA — o que de fato vai para o papel. */
function Folha({ folha }: { folha: FolhaContagem }) {
  const { campos } = folha

  return (
    <div className="folha">
      <TopoDaFolha
        titulo="CONTAGEM FÍSICA DE ESTOQUE"
        data={folha.dataPorExtenso ?? folha.data}
        resumo={folha.resumo}
        // Vai para o PAPEL: quem anda com a prancheta não tem a tela na
        // frente, e conferir contra uma posição antiga sem saber é o erro que
        // esta folha pode causar.
        alerta={folha.alertaHistorico || undefined}
      />

      <table className="folha-tabela">
        <thead>
          <tr>
            <th scope="col">PRODUTO</th>
            <th scope="col">UN.</th>
            {campos.ultimaMovimentacao && <th scope="col">ÚLT. MOV.</th>}
            {/* "SISTEMA" e não "EM ESTOQUE": a folha tem duas quantidades, e o
                cabeçalho precisa dizer qual é qual. Esta é a afirmação a
                verificar; a de baixo é a verdade medida. */}
            <th className="folha-col-qtd" scope="col">SISTEMA</th>
            {campos.emKg && <th className="folha-col-num" scope="col">≈ KG</th>}
            {/* A COLUNA EM BRANCO — o motivo da folha. */}
            <th className="folha-col-qtd" scope="col">CONTADO</th>
            {campos.observacao && <th scope="col">OBSERVAÇÃO</th>}
          </tr>
        </thead>
        <tbody>
          {folha.linhas.map(l => (
            <tr key={l.chave} className="folha-item">
              <td className="folha-produto">{l.produto}</td>
              <td>{l.un}</td>
              {campos.ultimaMovimentacao && <td>{l.ultimaMovimentacao}</td>}
              <td className="folha-col-qtd">
                {l.saldoSistema}
                {/* O selo ESCRITO, não a cor: é ele que separa "acabou" de
                    "nunca comprado" — os dois imprimem o mesmo zero — e é o
                    único que sobrevive a uma impressora monocromática. */}
                {l.selo && <div className="folha-selo">{l.selo}</div>}
              </td>
              {campos.emKg && <td className="folha-col-num">{l.emKg ?? '—'}</td>}
              <td className="folha-col-qtd"><EspacoParaEscrever /></td>
              {campos.observacao && <td><EspacoParaEscrever /></td>}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="folha-rodape">
        <span>Contado por<LinhaAssinatura /></span>
        <span>Conferido por<LinhaAssinatura /></span>
        <span>Hora<LinhaAssinatura curta /></span>
      </div>
    </div>
  )
}
