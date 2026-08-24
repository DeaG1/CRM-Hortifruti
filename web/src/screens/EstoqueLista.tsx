import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { PerdasLista } from './PerdasLista'
import './EstoqueLista.css'

/** Leitura secundária em embalagens (as mesmas quantidades divididas pelo
 * `peso_medio`), quando `un` não é KG e o produto tem peso médio cadastrado.
 * O número principal é o kg — é a única unidade em que a conta fecha, porque
 * duas das parcelas da perda nascem em quilos por contrato. Ver o comentário
 * de `paraJson` em api/src/routes/estoque.ts. */
interface EquivalenteUn {
  entrou: number
  perda: number
  saiu: number
  saldo: number
}

/** Espelha o corpo de GET /api/estoque (api/src/routes/estoque.ts).
 * `entrou`/`perda`/`saiu`/`saldo` vêm todos EM KG. */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  entrou: number
  perda: number
  saiu: number
  saldo: number
  peso_medio: number
  equivalente_un: EquivalenteUn | null
  /** Lançamentos desta linha que ficaram fora das quantidades por não serem
   * convertíveis em quilos (unidade ≠ KG sem `peso_medio` cadastrado). */
  itens_sem_conversao: number
}

const TEXTO = '#2a2a24'
const SUAVE = '#6a685c'
const VERMELHO = '#c2502f'

/** Quantidade com no máximo uma casa decimal. A conversão produz fração dos
 * dois lados: em kg, quando o rateio da perda de coleta divide um total
 * entre os itens da entrada; em embalagens, quando um saldo em kg carrega
 * uma perda que nasceu em quilos (149 kg / 15 = 9,9 CX). */
const fmtQtd = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** Saldo negativo é o alerta que importa nesta tela — vermelho. Zero fica
 * neutro (produto zerado não é risco, só não tem estoque agora). Positivo
 * usa o texto padrão. Portado de `saldoColor` em logica-estoque.txt.
 *
 * `incompleta`: linha com lançamento não convertível não recebe a cor de
 * alerta. O vermelho é um julgamento ("está faltando mercadoria"), e o saldo
 * de uma linha incompleta é negativo por construção — as quantidades ficaram
 * de fora e só as perdas em kg entraram. Marcar com `*` conserta a leitura;
 * pintar de vermelho criaria um alarme falso que o `*` não desfaz. */
function corSaldo(saldo: number, incompleta: boolean): string {
  if (incompleta) return SUAVE
  if (saldo < 0) return VERMELHO
  if (saldo === 0) return SUAVE
  return TEXTO
}

// ------------------------------------- quantidade incompleta (sem peso médio)

/**
 * Texto do aviso — mesma regra e mesma marca das outras telas afetadas
 * (RelatoriosTela.tsx, ProdutosLista.tsx, EntradasLista.tsx), com a
 * consequência desta: aqui o número que fica incompleto é o SALDO, o que o
 * funcionário abre a tela para ver.
 *
 * As quantidades saem da API em quilos, cada lançamento convertido pela
 * unidade dele; lançamento em unidade diferente de KG cujo produto não tem
 * peso médio cadastrado NÃO é convertível, e a API prefere deixá-lo de fora
 * a inventar um fator (ver `itens_sem_conversao` em
 * api/src/routes/estoque.ts). Como a linha é (produto, unidade lançada), o
 * fator é o mesmo para a linha inteira: ou tudo converte, ou nada converte e
 * sobram só as perdas que já eram kg por contrato — por isso a marca vai nas
 * quatro colunas, nunca em uma só.
 */
function avisoSemConversao(n: number): string {
  const itens = n === 1 ? '1 lançamento' : `${n} lançamentos`
  const verbo = n === 1 ? 'ficou' : 'ficaram'
  return `${itens} desta linha em unidade diferente de KG, sem peso médio cadastrado no `
    + `produto, ${verbo} fora das quantidades — sem o peso da embalagem não há como somar `
    + 'em quilos. O saldo desta linha está incompleto.'
}

/** Um número que pode estar incompleto: com `n` = 0 sai limpo (o caso
 * normal); com `n` > 0 ganha o `*` e a explicação no `title`. */
function NumIncompleto({ texto, n }: { texto: string; n: number }) {
  if (!n) return <>{texto}</>
  return <span className="estoque-incompleto" title={avisoSemConversao(n)}>{texto}*</span>
}

interface EstoqueListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

/**
 * Estoque não guarda dado próprio — é uma conta (entradas − perdas − saídas),
 * calculada em SQL num endpoint agregado (GET /api/estoque) porque soma todo
 * o histórico de itens já movimentados, não só a dúzia de registros que as
 * outras telas desta fase carregam. Este componente só busca e exibe o
 * resultado já pronto.
 *
 * A seção de perdas do depósito (registro/CRUD) reaproveita PerdasLista, que
 * já existia como paliativo nesta tela — trocado aqui pelo saldo de verdade,
 * mas o registro de perdas continua funcionando, agora como a segunda metade
 * da tela de Estoque (mesmo layout do protótipo, tela-estoque.html).
 */
export function EstoqueLista({ onSessaoExpirada }: EstoqueListaProps) {
  const [linhas, setLinhas] = useState<LinhaEstoque[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    api.get<LinhaEstoque[]>('/api/estoque')
      .then(ls => { if (!cancelado) setLinhas(ls) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar o estoque.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  const comEstoque = linhas.filter(l => l.saldo > 0).length
  const totalSemConversao = linhas.reduce((s, l) => s + (l.itens_sem_conversao || 0), 0)

  return (
    <div className="estoque-modulo">
      <section className="estoque-saldo-secao">
        {carregando && <p className="estoque-estado">Carregando…</p>}

        {!carregando && erro && (
          <p className="estoque-estado estoque-estado--erro" role="alert">{erro}</p>
        )}

        {!carregando && !erro && linhas.length === 0 && (
          <div className="estado-vazio estoque-vazio">
            <div className="estoque-vazio-titulo">Nada em estoque ainda</div>
            <div className="estoque-vazio-sub">
              O estoque se preenche sozinho: lance uma <strong>Entrada (compra)</strong> e a
              quantidade aparece aqui.
            </div>
          </div>
        )}

        {!carregando && !erro && linhas.length > 0 && (
          <>
            <div className="estoque-stats">
              <div className="estoque-stat">
                <div className="estoque-stat-label">ITENS COM ESTOQUE</div>
                <div className="estoque-stat-valor">{comEstoque}</div>
                <div className="estoque-stat-sub">{linhas.length} item(ns) movimentados</div>
              </div>
            </div>

            <div className="estoque-tabela">
              <div className="estoque-linha estoque-linha--cabecalho">
                <div>PRODUTO</div>
                <div>LANÇADO EM</div>
                <div className="estoque-col-num">ENTROU (KG)</div>
                <div className="estoque-col-num">PERDAS (KG)</div>
                <div className="estoque-col-num">SAIU (KG)</div>
                <div className="estoque-col-num">EM ESTOQUE (KG)</div>
              </div>

              {linhas.map(l => {
                // Linha com lançamento não convertível tem as QUATRO
                // quantidades erradas na mesma medida — todas saem das mesmas
                // embalagens. Marcar só uma sugeriria que as outras fecham.
                const inc = l.itens_sem_conversao || 0
                return (
                  <div key={`${l.produto_id}|${l.un}`} className="estoque-linha estoque-linha--dados">
                    <div className="estoque-nome">{l.nome}</div>
                    <div><span className="estoque-un-badge">{l.un}</span></div>
                    <div className="estoque-col-num estoque-mono">
                      <NumIncompleto texto={fmtQtd(l.entrou)} n={inc} />
                    </div>
                    <div className="estoque-col-num estoque-mono estoque-perda">
                      <NumIncompleto texto={fmtQtd(l.perda)} n={inc} />
                    </div>
                    <div className="estoque-col-num estoque-mono">
                      <NumIncompleto texto={fmtQtd(l.saiu)} n={inc} />
                    </div>
                    <div className="estoque-col-num estoque-mono estoque-saldo">
                      <span className="estoque-saldo-valor" style={{ color: corSaldo(l.saldo, inc > 0) }}>
                        <NumIncompleto texto={fmtQtd(l.saldo)} n={inc} />
                      </span>
                      {l.equivalente_un && (
                        <div className="estoque-saldo-kg">≈ {fmtQtd(l.equivalente_un.saldo)} {l.un}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="estoque-legenda">
              Estoque = <strong style={{ color: TEXTO }}>entradas − perdas − saídas</strong>, sempre
              em <strong style={{ color: TEXTO }}>quilos</strong> (caixas convertidas pelo peso médio
              do produto). <strong style={{ color: TEXTO }}>LANÇADO EM</strong> é a unidade em que a
              movimentação foi registrada — cada uma tem sua própria linha.
            </div>

            {totalSemConversao > 0 && (
              <div className="estoque-legenda estoque-legenda--incompleto" role="note">
                <strong>*</strong> {avisoSemConversao(totalSemConversao)} Cadastre o peso médio da
                embalagem em Produtos para que entrem na conta.
              </div>
            )}
          </>
        )}
      </section>

      <section className="estoque-perdas-secao">
        <PerdasLista onSessaoExpirada={onSessaoExpirada} />
      </section>
    </div>
  )
}
