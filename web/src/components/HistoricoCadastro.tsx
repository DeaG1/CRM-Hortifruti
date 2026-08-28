import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  avisoDeDeclaracao, carimboDeHistorico, resumoDaLinha, rotuloDoCampo,
  textoDoAutor, valorParaLeitura,
  type EntidadeHistorico, type RegistroHistorico,
} from '../derive/historico'
import './HistoricoCadastro.css'

interface HistoricoCadastroProps {
  entidade: EntidadeHistorico
  /** O registro cujo histórico se quer ver. */
  registroId: string
  onSessaoExpirada?: () => void
}

/**
 * O HISTÓRICO DE ALTERAÇÕES, DENTRO DO MODAL DO PRÓPRIO CADASTRO.
 *
 * ONDE O ADMIN LÊ, E POR QUÊ AQUI. A pergunta que este painel responde nunca
 * é solta — é sempre "quem mexeu NESTE cliente?", feita enquanto o dono já
 * está com o cadastro aberto na frente, geralmente porque um número pareceu
 * errado. O lugar certo para essa resposta é a mesma janela onde a pergunta
 * nasce, a um clique.
 *
 * As alternativas foram descartadas por motivos concretos:
 *  - TELA PRÓPRIA no menu: precisaria de um seletor de registro para
 *    reconstruir o contexto que o modal já tem, e viraria mais um item de
 *    menu que ninguém abre. Histórico que ninguém encontra não é consultado.
 *  - ABA no modal: esconderia o formulário para mostrar o log, quando as duas
 *    coisas são lidas juntas ("o telefone está errado — quem mudou?").
 *
 * CARREGA SÓ AO ABRIR, e isso não é economia de request por avareza: a
 * esmagadora maioria das aberturas do modal é para EDITAR, não para auditar.
 * Buscar o log em toda abertura custaria uma ida ao banco por edição para
 * alimentar uma seção fechada. O botão fica visível o tempo todo — o que se
 * adia é a busca, não a descoberta.
 *
 * SÓ O ADMIN CHEGA AQUI: quem decide é `podeVerHistoricoCadastro`
 * (web/src/telas.ts), aplicado pelo modal, e o servidor concorda —
 * `GET /api/historico/...` exige admin e responde 403 a colaborador venha o
 * pedido de onde vier.
 */
export function HistoricoCadastro({ entidade, registroId, onSessaoExpirada }: HistoricoCadastroProps) {
  const [aberto, setAberto] = useState(false)
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!aberto || registros !== null || erro) return
    let cancelado = false
    setCarregando(true)
    api.get<RegistroHistorico[]>(`/api/historico/${entidade}/${registroId}`)
      .then(linhas => { if (!cancelado) setRegistros(linhas) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar o histórico deste cadastro.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [aberto, registros, erro, entidade, registroId, onSessaoExpirada])

  const aviso = registros ? avisoDeDeclaracao(registros) : null

  return (
    <div className="historico">
      <button
        type="button"
        className="historico-botao"
        onClick={() => setAberto(a => !a)}
        aria-expanded={aberto}
        aria-controls="historico-painel"
      >
        <span className="historico-botao-seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
        Histórico de alterações
      </button>

      {aberto && (
        <div id="historico-painel" className="historico-painel">
          {carregando && <p className="historico-estado">Carregando…</p>}

          {/* FALHA ISOLADA: o histórico não carregar não derruba o formulário
              nem apaga o que já foi digitado. `role="status"` e não "alert"
              porque é o estado de uma seção secundária, não um erro do que o
              usuário acabou de fazer. */}
          {erro && <p className="historico-estado historico-estado--erro" role="status">{erro}</p>}

          {!carregando && !erro && registros?.length === 0 && (
            <p className="historico-estado" role="status">
              Nenhuma alteração registrada para este cadastro. O histórico começou a ser gravado a
              partir da versão que trouxe esta tela — o que foi alterado antes disso não aparece
              aqui.
            </p>
          )}

          {!erro && registros && registros.length > 0 && (
            <>
              <ol className="historico-lista">
                {registros.map(r => (
                  <li key={r.id} className="historico-item">
                    <div className="historico-item-topo">
                      <span className="historico-acao">{resumoDaLinha(r)}</span>
                      {/* Travessão quando a data não veio no formato esperado
                          — nunca uma data inventada, nunca a string crua. */}
                      <span className="historico-data">{carimboDeHistorico(r.criado_em) ?? '—'}</span>
                    </div>

                    {/* "Declarado por" / "Registrado no login de" — a redação
                        vem de `textoDoAutor`, testada. Nunca "editado por":
                        chamar declaração de prova é mentir sobre a própria
                        evidência. */}
                    <div
                      className={r.autor_origem === 'declarado'
                        ? 'historico-autor historico-autor--declarado'
                        : 'historico-autor'}
                    >
                      {textoDoAutor(r)}
                    </div>

                    {r.motivo && <div className="historico-motivo">“{r.motivo}”</div>}

                    {r.alteracoes.length > 0 && (
                      <ul className="historico-campos">
                        {r.alteracoes.map(a => (
                          <li key={a.campo} className="historico-campo">
                            <span className="historico-campo-nome">{rotuloDoCampo(r.entidade, a.campo)}</span>
                            <span className="historico-campo-de">{valorParaLeitura(a.de)}</span>
                            <span className="historico-campo-seta" aria-label="para">→</span>
                            <span className="historico-campo-para">{valorParaLeitura(a.para)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>

              {aviso && <p className="historico-nota" role="note">{aviso}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
