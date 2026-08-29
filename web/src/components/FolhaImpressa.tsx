import { useEffect, type ReactNode } from 'react'
import {
  gruposDeCampos,
  type CamposDaFolha, type DefinicaoCampoFolha,
} from '../derive/folha'
import './FolhaImpressa.css'

/**
 * AS PEÇAS COMUNS DAS TRÊS FOLHAS IMPRESSAS.
 *
 * O romaneio de entregas (Saídas) resolveu isto primeiro, em 93972c3. Quando
 * a folha de contagem física (Estoque) e a de conferência da carga (Entradas)
 * apareceram, a escolha era copiar aquele arquivo duas vezes ou extrair o que
 * as três têm igual. Copiar é como uma das três fica para trás na próxima
 * correção — e a que ficar para trás vai ser a que ninguém abriu no mês em
 * que o defeito apareceu.
 *
 * O que mora aqui é a CASCA: a barra de ações (voltar + controle + imprimir),
 * o painel "O que sai na folha", o topo do documento e os dois desenhos que
 * toda folha usa (o quadradinho de marcar e a linha de assinatura). O miolo —
 * quais colunas, o que cada linha diz — continua sendo de cada tela, porque é
 * ali que elas de fato diferem.
 *
 * A REGRA DE OURO DESTE ARQUIVO: tudo que é CONTROLE nasce com
 * `data-no-print`. Botão impresso é tinta gasta em coisa que não se pode
 * clicar, e o teste de cada tela verifica que nenhum botão sobrou fora de uma
 * região marcada.
 */

/** A classe que liga o modo de impressão da folha no documento inteiro. */
export const CLASSE_MODO_FOLHA = 'folha-imprimindo'

/**
 * MARCA O DOCUMENTO ENQUANTO UMA FOLHA ESTÁ MONTADA — é o que dá orientação
 * de retrato só a estas impressões.
 *
 * Regra de `@page` é do DOCUMENTO, não do componente, e `RelatoriosTela.css`
 * já declara `@page { size: A4 landscape }` para o app inteiro (o bundle
 * carrega o CSS de todas as telas). Um segundo `@page` sem nome brigaria por
 * ordem de bundle e, vencendo, viraria os relatórios de paisagem para
 * retrato — regressão numa tela que ninguém tocou. A saída é uma página
 * NOMEADA (`@page folha`, em FolhaImpressa.css) pedida por
 * `body.folha-imprimindo`, e este hook é o interruptor dela.
 *
 * A limpeza é obrigatória: sair da folha e imprimir Relatórios não pode
 * herdar o retrato daqui.
 */
export function useModoFolha() {
  useEffect(() => {
    document.body.classList.add(CLASSE_MODO_FOLHA)
    return () => document.body.classList.remove(CLASSE_MODO_FOLHA)
  }, [])
}

/**
 * A barra do topo da tela de folha: voltar à esquerda, o controle da folha no
 * meio (a data do romaneio, a posição do estoque, a entrada escolhida) e o
 * botão de imprimir à direita.
 *
 * O BOTÃO É SEMPRE O MESMO, NO MESMO CANTO, COM RÓTULO COMEÇANDO POR
 * "IMPRIMIR". Não é preciosismo: o dono procurou "imprimir" numa tela em que
 * o botão se chamava "Romaneio de entregas" e concluiu que a funcionalidade
 * não existia. Se o funcionário não acha, a funcionalidade não existe na
 * prática — e alguém que aprendeu a imprimir numa tela precisa achar nas
 * outras duas sem procurar.
 *
 * `aoImprimir` nulo ESCONDE o botão, e isso vale só para o caso em que não há
 * nada no papel a imprimir (dia sem entrega, depósito sem produto). Não
 * confundir com o botão que ABRE esta tela, lá na lista: aquele precisa
 * existir sempre, inclusive com a lista vazia, porque a folha imprime
 * qualquer data.
 */
export function BarraDaFolha({
  onVoltar, rotuloVoltar = '← Voltar para a lista',
  aoImprimir, rotuloImprimir, children,
}: {
  onVoltar: () => void
  rotuloVoltar?: string
  aoImprimir: (() => void) | null
  rotuloImprimir: string
  /** O controle próprio da folha (data, seletor). Fica entre voltar e
   * imprimir porque é o que se mexe antes de mandar imprimir. */
  children?: ReactNode
}) {
  return (
    <div className="folha-barra" data-no-print="1">
      <button type="button" className="folha-voltar" onClick={onVoltar}>
        {rotuloVoltar}
      </button>

      {children}

      <div className="folha-barra-espaco" />

      {aoImprimir && (
        <button type="button" className="folha-imprimir" onClick={aoImprimir}>
          {rotuloImprimir}
        </button>
      )}
    </div>
  )
}

/**
 * O painel "O que sai na folha": uma caixa por campo opcional, agrupadas, com
 * a lista do que sai SEMPRE logo abaixo.
 *
 * A ESCOLHA SÓ É HONESTA SE DISSER TAMBÉM O QUE NÃO SE ESCOLHE. "Escolha o
 * que sai" com quatro coisas saindo em silêncio seria meia verdade — por isso
 * `fixos` é obrigatório e aparece na tela.
 *
 * `naoGravou` é o padrão de aviso do romaneio: a folha na tela JÁ respeitou o
 * clique; isto só avisa que ela volta ao padrão no próximo F5. Mudar a folha
 * é a resposta ao clique, persistir é o bônus (ver preferenciaFolha.ts).
 */
export function PainelDeCampos<C extends string>({
  defs, campos, aoAlternar, fixos, nota, naoGravou,
}: {
  defs: readonly DefinicaoCampoFolha<C>[]
  campos: CamposDaFolha<C>
  aoAlternar: (chave: C) => void
  /** O que sai sempre, sem caixa para desmarcar. */
  fixos: readonly string[]
  /** Por que os padrões são os que são — em especial por que preço vem
   * desmarcado. */
  nota: ReactNode
  naoGravou: boolean
}) {
  return (
    <fieldset className="folha-campos" data-no-print="1">
      <legend className="folha-campos-titulo">O que sai na folha</legend>
      <div className="folha-campos-grade">
        {/* Os grupos saem da MESMA fonte que os campos (`gruposDeCampos`), e
            não de uma lista escrita à parte: a lista à parte é o que fica
            desatualizada no dia em que alguém acrescenta um campo de um grupo
            novo e a caixa dele simplesmente não aparece, sem erro nenhum. */}
        {gruposDeCampos(defs).map(grupo => (
          <div key={grupo} className="folha-campos-grupo">
            <div className="folha-campos-grupo-nome">{grupo}</div>
            {defs.filter(c => c.grupo === grupo).map(c => (
              <label key={c.chave} className="folha-campo" title={c.ajuda}>
                <input
                  type="checkbox"
                  checked={campos[c.chave]}
                  onChange={() => aoAlternar(c.chave)}
                />
                <span className="folha-campo-rotulo">{c.rotulo}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <p className="folha-campos-fixos">
        <strong>Sempre sai:</strong> {fixos.join(' · ')}.
      </p>
      <p className="folha-campos-nota">{nota}</p>
      {naoGravou && (
        <p className="folha-campos-aviso" role="status">
          A escolha vale para esta impressão, mas não pôde ser gravada neste navegador — no
          próximo acesso ela volta ao padrão.
        </p>
      )}
    </fieldset>
  )
}

/**
 * O topo do documento: título pequeno, data GRANDE, resumo de conferência e —
 * quando existe — o alerta que precisa ir junto para o papel.
 *
 * A DATA É O MAIOR TEXTO DA FOLHA, maior que o próprio título. Folha do dia
 * errado na mão de quem confere é pior que folha nenhuma: sem folha a pessoa
 * pergunta; com a folha errada ela confere confiante e aceita a carga
 * trocada, ou conta o estoque contra uma posição de duas semanas atrás.
 *
 * `alerta` não é `data-no-print`, e essa é a diferença que importa entre ele
 * e os avisos da tela: quem anda com a prancheta não tem o monitor na frente.
 */
export function TopoDaFolha({ titulo, data, resumo, alerta }: {
  titulo: string
  data: string
  resumo: string
  alerta?: string
}) {
  return (
    <div className="folha-topo">
      <div className="folha-titulo">{titulo}</div>
      <div className="folha-data">{data}</div>
      <div className="folha-resumo">{resumo}</div>
      {alerta && <div className="folha-alerta">{alerta}</div>}
    </div>
  )
}

/**
 * EMPARELHA OS ITENS PARA A FOLHA DE DUAS COLUNAS — item 0 e 1 na primeira
 * linha impressa, 2 e 3 na segunda, e assim por diante. A última linha vem com
 * `undefined` do lado direito quando a lista tem tamanho ímpar.
 *
 * A ORDEM É ALTERNADA (esquerda, direita, esquerda…), e não "desce a coluna
 * esquerda inteira e continua na direita". Conferir carga é UMA passada de
 * cima a baixo: cada linha impressa é uma linha de leitura com dois itens, e o
 * fim da folha é o fim da lista. A ordem por coluna inteira exigiria que o
 * leitor soubesse ONDE a coluna esquerda acaba — e essa marca não existe na
 * última página, onde a lista termina no meio — e, para ficar correta em mais
 * de uma página, precisaria que o navegador recalculasse a divisão página a
 * página (`column-count`), que é justamente o que não repete os rótulos de
 * coluna na página 2. Ver o comentário de `.folha-tabela--duas`.
 *
 * Fica aqui, e não em `derive/`, porque não é regra de negócio nenhuma: é a
 * forma da folha. Nenhum dado é somado, filtrado ou reordenado — os itens
 * saem na mesma ordem em que entraram, só que dois por linha.
 */
export function emPares<T>(itens: readonly T[]): [T, T | undefined][] {
  const pares: [T, T | undefined][] = []
  for (let i = 0; i < itens.length; i += 2) pares.push([itens[i], itens[i + 1]])
  return pares
}

/**
 * O quadradinho de marcar. É uma caixa DESENHADA COM BORDA, não um caractere:
 * caractere depende da fonte instalada na máquina que imprime e some em
 * impressora monocromática antiga.
 */
export function CaixaDeMarcar() {
  return <span className="folha-check" aria-hidden="true" />
}

/**
 * A COLUNA EM BRANCO: espaço com linha para escrever à mão o que se contou/
 * conferiu de verdade. Sem ela a folha de contagem não serve ao que motiva
 * imprimi-la — viraria uma segunda cópia do que a tela já diz.
 */
export function EspacoParaEscrever() {
  return <span className="folha-branco" aria-hidden="true" />
}

/** A linha de assinatura do rodapé. */
export function LinhaAssinatura({ curta }: { curta?: boolean }) {
  return (
    <span
      className={curta
        ? 'folha-linha-assinatura folha-linha-assinatura--curta'
        : 'folha-linha-assinatura'}
    />
  )
}
