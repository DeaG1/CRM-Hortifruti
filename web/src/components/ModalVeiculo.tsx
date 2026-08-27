import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi, mensagemDeBloqueio } from '../api/client'
import { VEICULO_NOVO, type Veiculo } from '../derive/veiculos'
import './ModalVeiculo.css'

// Molde: ModalCliente.tsx (formulario, validacao, noValidate, 401) +
// ModalFuncionario.tsx (exclusao dentro do proprio modal — veiculos, assim
// como funcionarios, nao tem uma tela de "ficha" separada).

type Rascunho = typeof VEICULO_NOVO

interface ModalVeiculoProps {
  veiculo: Partial<Veiculo> | null // null = criando
  onSalvo: (v: Veiculo) => void
  /** Exclusao confirmada e concluida na API — quem chama decide o que fazer (fechar, atualizar a lista). */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessao expirou (401 da API) — volta ao login em vez de mostrar erro de salvar/excluir. */
  onSessaoExpirada?: () => void
}

export function ModalVeiculo({ veiculo, onSalvo, onExcluido, onFechar, onSessaoExpirada }: ModalVeiculoProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({ ...VEICULO_NOVO, ...(veiculo ?? {}), ano: veiculo?.ano ?? '' })
  const [erroPlaca, setErroPlaca] = useState('')
  const [erroAno, setErroAno] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(veiculo?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `veiculo-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  function aoMudarAtivo(e: ChangeEvent<HTMLInputElement>) {
    setRascunho(r => ({ ...r, ativo: e.target.checked }))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroPlaca('')
    setErroAno('')
    setErroGeral('')
    if (!rascunho.placa.trim()) {
      setErroPlaca('Informe a placa.')
      return
    }
    // `noValidate` desliga so o bloqueio nativo do form (ver comentario no
    // JSX) — esta e a validacao que decide se o pedido sai; a API valida de
    // novo (defesa em profundidade, mesmo padrao de ModalCliente).
    const anoBruto = rascunho.ano
    const anoNum = anoBruto === '' ? null : Number(anoBruto)
    if (anoNum !== null && !Number.isInteger(anoNum)) {
      setErroAno('Ano deve ser um número inteiro.')
      return
    }
    setSalvando(true)
    try {
      const corpo = {
        placa: rascunho.placa,
        modelo: rascunho.modelo,
        marca: rascunho.marca,
        ano: anoNum,
        ativo: Boolean(rascunho.ativo),
        obs: rascunho.obs,
      }
      const salvo = editando
        ? await api.put<Veiculo>(`/api/veiculos/${veiculo!.id}`, corpo)
        : await api.post<Veiculo>('/api/veiculos', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroPlaca('Já existe um veículo com essa placa.')
      } else if (err instanceof ErroApi && err.status === 401) {
        // Sessao expirada no meio do salvamento: volta pro login, o erro de
        // "nao foi possivel salvar" seria enganoso (o problema nao foi o envio).
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
      await api.del(`/api/veiculos/${veiculo!.id}`)
      onExcluido(veiculo!.id as string)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      // 409 = a API recusou por uma REGRA, e mandou junto o motivo e o
      // caminho. Mostra o texto dela, nao um fixo daqui.
      //
      // Este branch ja existiu errado de duas maneiras ao mesmo tempo, e as
      // duas escondiam o defeito real:
      //
      //  1. testava `status === 400`. A rota devolve 409 (respostaDeErroPg em
      //     api/src/routes/veiculos.ts) e sempre devolveu — entao o ramo
      //     nunca era alcancado por um erro de verdade e o usuario caia no
      //     texto generico abaixo. O teste que o "cobria" mockava um 400 na
      //     mao, provando so que o branch existia.
      //  2. o texto era fixo e nomeava a causa ("uso registrado"). A causa
      //     mudou — `veiculo_usos` deixou de barrar na migration 015 — e um
      //     texto fixo aqui teria continuado mentindo, agora sobre qualquer
      //     FK futura que barrasse a exclusao.
      //
      // Quem sabe o que barrou e o banco, e quem traduz isso e a API. O front
      // so precisa exibir. Assim a mensagem continua correta para bloqueios
      // que este arquivo nao conhece e que ainda nem existem.
      const mensagemDaApi = mensagemDeBloqueio(err)
      setErroExclusao(mensagemDaApi ?? 'Não foi possível excluir. Tente novamente.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar veículo' : 'Novo veículo'}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalCliente —
          clicar no fundo fecha, clicar dentro nao propaga; o `required` do
          campo placa continua no DOM (aria-required), so quem decide
          bloquear o submit e a validacao em JS abaixo. */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar veículo' : 'Novo veículo'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {confirmandoExclusao ? (
            <div className="modal-confirma">
              <p className="modal-confirma-texto" role="alert">
                {/* O texto anterior avisava "só é possível excluir um veículo sem nenhum uso
                    registrado" — a regra do `on delete restrict` de veiculo_usos (011). Ela
                    deixou de existir na migration 015 (cascade), e um aviso que descreve uma
                    regra morta é pior que nenhum: manda desativar quem só quer excluir, e o
                    faz por um motivo que não vale mais. No lugar, o mesmo que ModalFuncionario
                    diz — o que acontece com o que já foi lançado, que é o que a pessoa
                    realmente precisa saber antes de confirmar. */}
                Excluir <strong>{rascunho.placa}</strong>? O cadastro será apagado definitivamente — não é
                possível desfazer. Despesas já lançadas para este veículo continuam no histórico, só
                deixam de estar vinculadas a ele.
              </p>
              {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
            </div>
          ) : (
            <>
              <div className="modal-form-grid">
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="veiculo-placa">Placa</label>
                  <input
                    className="modal-input modal-input--mono"
                    {...campo('placa')}
                    placeholder="ABC-1234"
                    autoFocus
                    required
                  />
                  {erroPlaca && <p className="modal-erro" role="alert">{erroPlaca}</p>}
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="veiculo-ano">Ano</label>
                  <input
                    className="modal-input modal-input--mono"
                    type="number"
                    step="1"
                    placeholder="Ex.: 2019"
                    {...campo('ano')}
                  />
                  {erroAno && <p className="modal-erro" role="alert">{erroAno}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="veiculo-marca">Marca</label>
                  <input className="modal-input" {...campo('marca')} placeholder="Ex.: Fiat" />
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="veiculo-modelo">Modelo</label>
                  <input className="modal-input" {...campo('modelo')} placeholder="Ex.: Fiorino" />
                </div>

                <div className="modal-campo modal-campo--full modal-ativo">
                  <label className="modal-checkbox-label" htmlFor="veiculo-ativo">
                    <input
                      id="veiculo-ativo"
                      name="ativo"
                      type="checkbox"
                      checked={Boolean(rascunho.ativo)}
                      onChange={aoMudarAtivo}
                    />
                    Veículo ativo (disponível para uso)
                  </label>
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="veiculo-obs">Observações</label>
                  <textarea className="modal-textarea" {...campo('obs')} rows={3} />
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
