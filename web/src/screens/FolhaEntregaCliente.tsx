import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PLANO_INICIAL, escalaDoCorpo, proximoPlano, resumoFolhaEntrega,
  type FolhaEntrega, type ItemEntrega, type PlanoDaFolha,
} from '../derive/folhaEntrega'
import {
  TopoDaFolha, CaixaDeMarcar, LinhaAssinatura, emPares,
} from '../components/FolhaImpressa'
import { medirCorpoQueCabe } from '../components/medicaoDaFolha'

/**
 * A FOLHA DE ENTREGA — a via que o CLIENTE confere e assina ao receber.
 *
 * Um pedido por folha. O que ela diz, por que diz e o que fica de fora está em
 * derive/folhaEntrega.ts, que é onde a regra mora; aqui é só a exibição, como
 * manda o padrão do projeto.
 *
 * Ela reaproveita a casca das outras três (components/FolhaImpressa): o topo
 * do documento, o quadradinho de marcar, a linha de assinatura e todo o
 * `@media print`. A ÚNICA coisa que é dela — e o motivo de este arquivo
 * existir separado de RomaneioEntregas.tsx — é o mecanismo de caber em uma
 * página, logo abaixo.
 *
 * ================================ UMA FOLHA SÓ, E ISSO É REQUISITO
 *
 * Palavras do dono: "quando não couber vai ter que caber de alguma forma,
 * qualquer coisa diminua a letra". A folha é a via de UMA entrega: duas
 * páginas viram duas vias, e a segunda é a que fica no caminhão sem
 * assinatura — ou a que o cliente assina sem ter lido a primeira.
 *
 * ---- MEDIR, NÃO ESTIMAR ----
 *
 * O corpo de letra sai de uma MEDIÇÃO da folha renderizada contra a altura
 * útil da página, e não de uma tabela "N itens → tal corpo". Duas razões:
 *
 *   1. A altura não é função da contagem de itens. Nome de produto comprido
 *      que quebra em duas linhas, endereço longo, um cliente com nome que
 *      ocupa a largura toda — tudo isso muda a altura sem mudar N. Uma tabela
 *      erraria nesses casos, e erraria em silêncio.
 *   2. Encolher só quando precisa. O maior pedido real do dono tem 44 itens e
 *      o segundo tem 21: no volume do dia a dia a folha sai nos 12px
 *      confortáveis que e2e9968 fixou. Encolher tudo por causa do caso raro
 *      puniria o uso normal.
 *
 * ---- A MEDIÇÃO ACONTECE NA GEOMETRIA DO PAPEL, NÃO NA DA TELA ----
 *
 * Este é o detalhe que faz o mecanismo funcionar ou mentir. Na tela a folha
 * tem `max-width: 1000px` e 16px de recheio; no papel ela tem 190mm (A4
 * retrato menos as margens de `@page folha`) e recheio nenhum. Medir a folha
 * da tela e decidir sobre o papel é medir a coisa errada — dá 718px de largura
 * contra 1000px, e a linha que cabia na tela quebra no papel.
 *
 * Por isso a medição é feita num CLONE dentro de `.folha-medindo`, uma caixa
 * fora da vista com exatamente a largura útil da página e as mesmas regras de
 * geometria que o `@media print` aplica (ver FolhaImpressa.css, onde as duas
 * ficam lado a lado justamente para serem mudadas juntas). O clone é
 * descartado ao fim; a folha de verdade nunca pisca.
 *
 * ---- POR QUE `zoom`, E NÃO `transform: scale` ----
 *
 * `transform` DESENHA menor e continua ocupando a mesma altura de layout: a
 * folha sairia minúscula e ainda em duas páginas. `zoom` muda o layout — é o
 * único jeito de "diminuir a letra" que a paginação enxerga. E ele escala
 * TUDO junto (letra, recheio, borda, o quadradinho de 4mm), que é o que
 * mantém a folha proporcional em vez de virar texto miúdo em linhas gordas.
 */

export function FolhaEntregaCliente({ folha, aoMedirCorpo }: {
  folha: FolhaEntrega
  /** Avisa a tela em que corpo a folha coube — é com esse número que ela
   * conta ao dono que a letra encolheu (ver `avisoDeLegibilidade`). */
  aoMedirCorpo?: (corpo: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [plano, setPlano] = useState<PlanoDaFolha>(PLANO_INICIAL)
  const folhaAnterior = useRef(folha)

  /**
   * O LAÇO DE MEDIÇÃO — três linhas, porque quem decide é `proximoPlano`.
   *
   * `useLayoutEffect` e não `useEffect`: a medição e o encolhimento têm de
   * acontecer ANTES de o navegador pintar. Com `useEffect` a folha aparece um
   * quadro no tamanho grande e encolhe na frente de quem olha — e, pior, um
   * clique em imprimir nesse intervalo mandaria a folha grande para o papel.
   *
   * O laço converge porque cada passada ou devolve `null` (nada a mudar) ou um
   * plano diferente do atual; a última passada mede o que já está na tela e
   * confirma. Folha nova recomeça do zero: uma coluna, tamanho confortável.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (folhaAnterior.current !== folha) {
      folhaAnterior.current = folha
      // Se o plano já é o inicial, não há o que reiniciar — seguir direto para
      // a medição evita um render à toa (e o `setState` com a MESMA referência
      // que o React descartaria, deixando a folha nova sem medição nenhuma).
      if (plano !== PLANO_INICIAL) {
        setPlano(PLANO_INICIAL)
        return
      }
    }
    const proximo = proximoPlano(plano, medirCorpoQueCabe(el))
    if (proximo) setPlano(proximo)
  }, [folha, plano])

  /**
   * A REMEDIÇÃO QUANDO AS FONTES CHEGAM.
   *
   * 'Public Sans' e 'Archivo' vêm da rede (index.html). Até elas carregarem, o
   * navegador desenha com a fonte de reserva do sistema, cujas letras têm
   * outra largura — e uma medição feita ali decide o layout da folha errada.
   * Voltar ao plano inicial refaz a decisão inteira (inclusive uma coluna
   * contra duas) com a letra de verdade, e corrige justamente a primeira
   * impressão do dia, que é a que ninguém confere duas vezes.
   *
   * `document.fonts` não existe em todo ambiente (o jsdom dos testes não o
   * implementa), então a ausência dele simplesmente não agenda nada.
   */
  useEffect(() => {
    // Tipado como sempre presente, mas o jsdom dos testes não o implementa —
    // por isso a checagem em tempo de execução.
    const fontes: FontFaceSet | undefined = document.fonts
    if (!fontes?.ready) return
    let cancelado = false
    fontes.ready.then(() => {
      if (!cancelado) setPlano(p => (p === PLANO_INICIAL ? p : PLANO_INICIAL))
    }).catch(() => { /* fonte que não carrega não pode derrubar a folha */ })
    return () => { cancelado = true }
  }, [folha])

  // Avisa a tela do corpo alcançado. A tela passa uma função estável
  // (`useCallback`), então isto dispara uma vez por medição; uma função
  // instável só faria repetir o mesmo número, que é inofensivo.
  useEffect(() => { aoMedirCorpo?.(plano.corpo) }, [plano.corpo, aoMedirCorpo])

  const corpo = plano.corpo
  const escala = escalaDoCorpo(corpo)
  const dataFolha = folha.dataPorExtenso ?? folha.dataEntrega
  const { pagamento } = folha

  return (
    <div
      className="folha folha-entrega"
      ref={ref}
      // Só quando encolhe: uma folha no tamanho normal não carrega atributo de
      // estilo nenhum, e é assim que se lê no inspetor se ela encolheu ou não.
      style={escala === 1 ? undefined : { zoom: escala }}
      data-corpo={String(corpo)}
    >
      <TopoDaFolha
        titulo="FOLHA DE ENTREGA"
        data={dataFolha}
        resumo={resumoFolhaEntrega(folha)}
      />

      <section className="folha-bloco">
        <div className="folha-bloco-topo">
          <div className="folha-bloco-nome">{folha.cliente}</div>
          <div className="folha-bloco-selo">
            {folha.numero ? `Pedido ${folha.numero}` : 'Pedido sem número'}
          </div>
        </div>

        {(folha.endereco || folha.telefone) && (
          <div className="folha-bloco-dados">
            {folha.endereco && <span className="folha-bloco-dado">{folha.endereco}</span>}
            {folha.telefone && <span className="folha-bloco-dado">Tel.: {folha.telefone}</span>}
          </div>
        )}

        {folha.itens.length === 0
          ? (
            // Não deve acontecer — a API exige pelo menos um item por venda —,
            // mas uma folha impressa em branco com uma linha de assinatura no
            // pé é o pior resultado possível: alguém assina o nada.
            <div className="folha-sem-linhas">
              Este pedido está sem itens. Não há o que conferir nem o que assinar.
            </div>
          )
          : plano.duasColunas
            ? (
              // A MESMA tabela de seis colunas do romaneio, com dez: os dois
              // itens de uma linha impressa são células da MESMA `<tr>`, então
              // nenhum item é partido entre as metades — garantia estrutural,
              // não promessa do navegador. Ver `.folha-tabela--duas`.
              <table className="folha-tabela folha-tabela--duas">
                <thead>
                  <tr>
                    <RotulosDeItem />
                    <RotulosDeItem corte />
                  </tr>
                </thead>
                <tbody>
                  {emPares(folha.itens).map(([a, b]) => (
                    <tr key={a.id} className="folha-item">
                      <CelulasDeItem item={a} />
                      {/* A metade direita vazia da última linha ímpar sai SEM
                          quadradinho: um quadradinho é um item a conferir, e
                          ali não há item nenhum. */}
                      {b
                        ? <CelulasDeItem item={b} corte />
                        : (
                          <>
                            <td className="folha-col-check folha-col-corte" />
                            <td />
                            <td className="folha-col-qtd" />
                            <td className="folha-col-num" />
                            <td className="folha-col-num" />
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
                    <th className="folha-col-num" scope="col">PREÇO UN.</th>
                    <th className="folha-col-num" scope="col">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {folha.itens.map(i => (
                    <tr key={i.id} className="folha-item">
                      <td className="folha-col-check"><CaixaDeMarcar /></td>
                      <td className="folha-produto">{i.produto}</td>
                      <td className="folha-col-qtd">{i.quantidade}</td>
                      {/* Travessão, nunca "R$ 0,00": item sem preço registrado é
                          "ninguém preencheu", e afirmar zero numa folha que o
                          cliente assina é afirmar que aquilo foi de graça. */}
                      <td className="folha-col-num">{i.precoUnitario ?? '—'}</td>
                      <td className="folha-col-num">{i.total ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

        <div className="folha-entrega-total folha-nao-quebrar">
          <span className="folha-entrega-total-rotulo">TOTAL DO PEDIDO</span>
          <span className="folha-entrega-total-valor">{folha.totalPedido ?? '—'}</span>
        </div>
      </section>

      {/* O bloco que o motorista lê na porta. O aviso em caixa alta primeiro:
          é a única linha da folha que muda o que ele FAZ. */}
      <div className="folha-entrega-pagamento folha-nao-quebrar">
        <div className="folha-entrega-aviso">{pagamento.aviso}</div>
        <div className="folha-entrega-situacao">
          Pagamento: <strong>{pagamento.situacao}</strong>
          {pagamento.detalhe && <> · {pagamento.detalhe}</>}
        </div>
      </div>

      <div className="folha-entrega-recibo folha-nao-quebrar">
        <div className="folha-entrega-declaracao">
          Recebi e conferi os itens acima, nas quantidades e nos valores indicados.
        </div>
        <div className="folha-rodape">
          <span>Assinatura<LinhaAssinatura /></span>
          <span>Nome legível<LinhaAssinatura /></span>
          <span>Data<LinhaAssinatura curta /></span>
        </div>
      </div>
    </div>
  )
}

/**
 * Os rótulos de UMA metade da folha de duas colunas. Saem duas vezes na mesma
 * `<tr>` do `<thead>`, e `display: table-header-group` (@media print) os
 * repete em toda página.
 *
 * "QTD", "PREÇO" e "TOTAL" no lugar de "QUANTIDADE" e "PREÇO UN.": em meia
 * folha a coluna tem 66px, e o rótulo longo quebraria em duas linhas no
 * cabeçalho — a mesma abreviação que o romaneio já usa pelo mesmo motivo.
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
      <th className="folha-col-num" scope="col">PREÇO</th>
      <th className="folha-col-num" scope="col">TOTAL</th>
    </>
  )
}

/** As cinco células de um item numa metade da folha de duas colunas. */
function CelulasDeItem({ item, corte }: { item: ItemEntrega; corte?: boolean }) {
  return (
    <>
      <td className={corte ? 'folha-col-check folha-col-corte' : 'folha-col-check'}>
        <CaixaDeMarcar />
      </td>
      <td className="folha-produto">{item.produto}</td>
      <td className="folha-col-qtd">{item.quantidade}</td>
      <td className="folha-col-num">{item.precoUnitario ?? '—'}</td>
      <td className="folha-col-num">{item.total ?? '—'}</td>
    </>
  )
}
