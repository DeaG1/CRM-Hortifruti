import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { DESCONTO_NOVO, type Desconto } from '../derive/descontos'
import './ModalDesconto.css'

// Molde: ModalLancamento.tsx (formulario curto, noValidate, 401, exclusao
// dentro do proprio modal — desconto tambem nao tem tela de "ficha").
//
// TRES DIFERENCAS DELIBERADAS EM RELACAO AO ModalLancamento:
//
//  1. NAO HA SELETOR DE FUNCIONARIO. Este modal so abre a partir da linha de
//     alguem (o botao "Descontar", ou um desconto do historico daquela
//     pessoa), entao o funcionario ja esta decidido — oferecer um `<select>`
//     abriria a porta para registrar a falta na pessoa errada com um clique
//     distraido. O nome aparece no cabecalho, como confirmacao.
//  2. NAO HA CATEGORIA. Desconto e uma coisa so; nao ha lista fechada a
//     escolher (e por isso este modal, ao contrario do de lancamento, nao
//     depende de GET /api/lancamentos/categorias para poder abrir).
//  3. O MOTIVO E OBRIGATORIO. E a metade do registro que explica o numero:
//     "faltou em 12/06" sem o porque e um valor abatido do salario de alguem
//     que ninguem consegue justificar tres meses depois. A API valida de novo
//     (defesa em profundidade, mesmo padrao de ModalCliente).

type Rascunho = typeof DESCONTO_NOVO & { data: string }

/** AAAA-MM-DD de hoje, no fuso local — mesma funcao (e mesmo motivo) de
 * ModalLancamento.tsx. Aqui ela e so um PALPITE inicial: a data que interessa
 * e a da falta, que costuma ser hoje ou ontem, e e editavel. */
function hojeIso(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

interface ModalDescontoProps {
  /** `null` = registrando um desconto novo; com `id` = editando. Em ambos os
   * casos `funcionario_id` tem de vir preenchido por quem abriu. */
  desconto: Partial<Desconto> | null
  /** Nome do funcionario, so para exibir no cabecalho — o vinculo em si viaja
   * em `desconto.funcionario_id`. */
  funcionarioNome: string
  onSalvo: (d: Desconto) => void
  /** Exclusao confirmada e concluida na API — quem chama decide o que fazer. */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessao expirou (401 da API) — volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ModalDesconto({
  desconto, funcionarioNome, onSalvo, onExcluido, onFechar, onSessaoExpirada,
}: ModalDescontoProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({
    ...DESCONTO_NOVO,
    data: hojeIso(),
    ...(desconto ?? {}),
  })
  const [erroData, setErroData] = useState('')
  const [erroMotivo, setErroMotivo] = useState('')
  const [erroValor, setErroValor] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(desconto?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `desconto-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroData('')
    setErroMotivo('')
    setErroValor('')
    setErroGeral('')
    if (!rascunho.data.trim()) {
      setErroData('Informe o dia da falta.')
      return
    }
    if (!String(rascunho.motivo).trim()) {
      setErroMotivo('Informe o motivo.')
      return
    }
    // `min="0"` no input e so UX (o form tem noValidate). Esta e a validacao
    // que decide se o pedido sai.
    const valorNum = Number(rascunho.valor)
    if (Number.isFinite(valorNum) && valorNum < 0) {
      setErroValor('Valor não pode ser negativo.')
      return
    }
    setSalvando(true)
    try {
      const corpo = {
        funcionario_id: desconto?.funcionario_id,
        data: rascunho.data,
        motivo: String(rascunho.motivo).trim(),
        valor: valorNum || 0,
      }
      const salvo = editando
        ? await api.put<Desconto>(`/api/descontos/${desconto!.id}`, corpo)
        : await api.post<Desconto>('/api/descontos', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
      } else {
        setErroGeral('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/descontos/${desconto!.id}`)
      onExcluido(desconto!.id as string)
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

  const titulo = editando ? 'Editar desconto' : 'Descontar do salário'

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalLancamento —
          clicar no fundo fecha, clicar dentro nao propaga; noValidate desliga
          so o bloqueio nativo do form (os `required` continuam no DOM e
          mapeando pra aria-required; quem bloqueia o submit e o JS acima). */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div>
            <div className="modal-header-titulo">{titulo}</div>
            <div className="modal-desconto-nome">{funcionarioNome}</div>
          </div>
          <div className="modal-rodape-spacer" />
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {confirmandoExclusao ? (
            <div className="modal-confirma">
              <p className="modal-confirma-texto" role="alert">
                Excluir este desconto de <strong>{funcionarioNome}</strong>? O valor volta a ser devido.
                Não é possível desfazer.
              </p>
              {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
            </div>
          ) : (
            <>
              <div className="modal-form-grid">
                <div className="modal-campo">
                  {/* "Dia da falta", nao "data do registro": e a data que
                      decide em qual periodo o desconto abate. */}
                  <label className="modal-rotulo" htmlFor="desconto-data">Dia da falta</label>
                  <input className="modal-input" type="date" {...campo('data')} autoFocus required />
                  {erroData && <p className="modal-erro" role="alert">{erroData}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="desconto-valor">Valor a descontar (R$)</label>
                  <input
                    className="modal-input modal-input--mono"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex.: 80,00"
                    {...campo('valor')}
                  />
                  {erroValor && <p className="modal-erro" role="alert">{erroValor}</p>}
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="desconto-motivo">Motivo</label>
                  <input
                    className="modal-input"
                    {...campo('motivo')}
                    placeholder="Ex.: faltou sem avisar"
                    required
                  />
                  {erroMotivo && <p className="modal-erro" role="alert">{erroMotivo}</p>}
                </div>

                <div className="modal-campo modal-campo--full modal-desconto-dica">
                  Isto <strong>não paga nem lança nada</strong>: nenhum dinheiro se move agora. O valor
                  abate o <strong>a pagar</strong> de {funcionarioNome} no período da falta, e o botão{' '}
                  <strong>Pagar salário</strong> já sugere o valor com o desconto aplicado.
                </div>
              </div>

              {erroGeral && <p className="modal-erro modal-erro-geral" role="alert">{erroGeral}</p>}
            </>
          )}
        </div>

        <div className="modal-rodape">
          {editando && !confirmandoExclusao && (
            <button type="button" className="modal-botao-excluir" onClick={() => setConfirmandoExclusao(true)}>
              Excluir
            </button>
          )}
          <div className="modal-rodape-spacer" />
          {confirmandoExclusao ? (
            <>
              <button
                type="button"
                className="modal-botao-cancelar"
                onClick={() => setConfirmandoExclusao(false)}
                disabled={excluindo}
              >
                Cancelar
              </button>
              <button type="button" className="modal-botao-excluir-confirmar" onClick={excluir} disabled={excluindo}>
                {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="modal-botao-cancelar" onClick={onFechar}>Cancelar</button>
              <button type="submit" className="modal-botao-salvar" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
