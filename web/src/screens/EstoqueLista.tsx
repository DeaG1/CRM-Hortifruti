import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { PerdasLista } from './PerdasLista'
import './EstoqueLista.css'

/** Equivalente em KG, quando `un` não é KG e o produto tem `peso_medio`
 * cadastrado. Fica separado das colunas originais — não mistura as duas
 * contas (ver api/src/routes/estoque.ts). */
interface EquivalenteKg {
  entrou: number
  perda: number
  saiu: number
  saldo: number
}

/** Espelha o corpo de GET /api/estoque (api/src/routes/estoque.ts). */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  entrou: number
  perda: number
  saiu: number
  saldo: number
  peso_medio: number
  equivalente_kg: EquivalenteKg | null
}

const TEXTO = '#2a2a24'
const SUAVE = '#6a685c'
const VERMELHO = '#c2502f'

const fmtQ = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR')

/** Saldo negativo é o alerta que importa nesta tela — vermelho. Zero fica
 * neutro (produto zerado não é risco, só não tem estoque agora). Positivo
 * usa o texto padrão. Portado de `saldoColor` em logica-estoque.txt. */
function corSaldo(saldo: number): string {
  if (saldo < 0) return VERMELHO
  if (saldo === 0) return SUAVE
  return TEXTO
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

  return (
    <div className="estoque-modulo">
      <section className="estoque-saldo-secao">
        {carregando && <p className="estoque-estado">Carregando…</p>}

        {!carregando && erro && (
          <p className="estoque-estado estoque-estado--erro" role="alert">{erro}</p>
        )}

        {!carregando && !erro && linhas.length === 0 && (
          <div className="estoque-vazio">
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
                <div>UNIDADE</div>
                <div className="estoque-col-num">ENTROU</div>
                <div className="estoque-col-num">PERDAS</div>
                <div className="estoque-col-num">SAIU</div>
                <div className="estoque-col-num">EM ESTOQUE</div>
              </div>

              {linhas.map(l => (
                <div key={`${l.produto_id}|${l.un}`} className="estoque-linha estoque-linha--dados">
                  <div className="estoque-nome">{l.nome}</div>
                  <div><span className="estoque-un-badge">{l.un}</span></div>
                  <div className="estoque-col-num estoque-mono">{fmtQ(l.entrou)}</div>
                  <div className="estoque-col-num estoque-mono estoque-perda">{fmtQ(l.perda)}</div>
                  <div className="estoque-col-num estoque-mono">{fmtQ(l.saiu)}</div>
                  <div className="estoque-col-num estoque-mono estoque-saldo">
                    <span className="estoque-saldo-valor" style={{ color: corSaldo(l.saldo) }}>
                      {fmtQ(l.saldo)}
                    </span>
                    {l.equivalente_kg && (
                      <div className="estoque-saldo-kg">≈ {fmtQ(l.equivalente_kg.saldo)} kg</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="estoque-legenda">
              Estoque = <strong style={{ color: TEXTO }}>entradas − perdas − saídas</strong>, somado
              por produto e unidade (KG, CX, bandeja…).
            </div>
          </>
        )}
      </section>

      <section className="estoque-perdas-secao">
        <PerdasLista onSessaoExpirada={onSessaoExpirada} />
      </section>
    </div>
  )
}
