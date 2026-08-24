import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
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
      if (err instanceof ErroApi && err.status === 400) {
        // veiculo_usos_veiculo_fk e ON DELETE RESTRICT (migration 011): um
        // veiculo com historico de uso nao pode ser apagado — o caminho e
        // desativar (ativo=false), nao apagar o cadastro.
        setErroExclusao('Este veículo tem uso registrado e não pode ser excluído. Desative-o em vez de excluir.')
        return
      }
      setErroExclusao('Não foi possível excluir. Tente novamente.')
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
                Excluir <strong>{rascunho.placa}</strong>? O cadastro será apagado definitivamente — não é
                possível desfazer. Só é possível excluir um veículo sem nenhum uso registrado; se ele já foi
                usado alguma vez, desative-o em vez de excluir.
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
