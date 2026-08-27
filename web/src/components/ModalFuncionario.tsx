import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi, mensagemDeBloqueio } from '../api/client'
import { FUNCIONARIO_NOVO, type Funcionario } from '../derive/funcionarios'
import './ModalFuncionario.css'

// Molde: ModalCliente.tsx (formulario, validacao, noValidate, 401) +
// ModalProduto.tsx (exclusao dentro do proprio modal — funcionarios, assim
// como produtos, nao tem uma tela de "ficha" separada, entao nao ha onde
// mais colocar a confirmacao de exclusao).

type Rascunho = typeof FUNCIONARIO_NOVO

/** Dias validos de pagamento: 1..28 — mesmo intervalo da constraint
 * `funcionarios_dia_pag_check` (db/migrations/009_entidades_fase1.sql) e da
 * validacao de erroDeCampoInvalido em api/src/routes/funcionarios.ts. Vive
 * aqui (nao em derive/funcionarios.ts) por ser puramente uma lista de opcoes
 * de UI, sem logica de negocio associada. */
const DIAS_DO_MES = Array.from({ length: 28 }, (_, i) => i + 1)

interface ModalFuncionarioProps {
  funcionario: Partial<Funcionario> | null // null = criando
  onSalvo: (f: Funcionario) => void
  /** Exclusao confirmada e concluida na API — quem chama decide o que fazer (fechar, atualizar a lista). */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessao expirou (401 da API) — volta ao login em vez de mostrar erro de salvar/excluir. */
  onSessaoExpirada?: () => void
}

export function ModalFuncionario({ funcionario, onSalvo, onExcluido, onFechar, onSessaoExpirada }: ModalFuncionarioProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({ ...FUNCIONARIO_NOVO, ...(funcionario ?? {}) })
  const [erroNome, setErroNome] = useState('')
  const [erroSalario, setErroSalario] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(funcionario?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `funcionario-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  function aoMudarAtivo(e: ChangeEvent<HTMLInputElement>) {
    setRascunho(r => ({ ...r, ativo: e.target.checked }))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNome('')
    setErroSalario('')
    setErroGeral('')
    if (!rascunho.nome.trim()) {
      setErroNome('Informe o nome.')
      return
    }
    // `min="0"` no input e so UX (form tem noValidate — ver comentario no
    // JSX). Esta e a validacao que decide se o pedido sai; a API valida de
    // novo (defesa em profundidade, mesmo padrao de ModalCliente).
    const salarioNum = Number(rascunho.salario)
    if (Number.isFinite(salarioNum) && salarioNum < 0) {
      setErroSalario('Salário não pode ser negativo.')
      return
    }
    setSalvando(true)
    try {
      const corpo = {
        nome: rascunho.nome,
        cargo: rascunho.cargo,
        tel: rascunho.tel,
        salario: salarioNum || 0,
        dia_pag: Number(rascunho.dia_pag) || 5,
        ativo: Boolean(rascunho.ativo),
      }
      const salvo = editando
        ? await api.put<Funcionario>(`/api/funcionarios/${funcionario!.id}`, corpo)
        : await api.post<Funcionario>('/api/funcionarios', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        // Sessao expirada no meio do salvamento: volta pro login, o erro de
        // "nao foi possivel salvar" seria enganoso (o problema nao foi o envio).
        onSessaoExpirada?.()
      } else {
        // Funcionarios nao tem constraint unique de nome (dois "Joao" na
        // equipe e cenario real — ver comentario em
        // api/src/routes/funcionarios.ts), entao nao ha um caso 409
        // especifico pra tratar aqui como ModalCliente trata pra clientes.
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
      await api.del(`/api/funcionarios/${funcionario!.id}`)
      onExcluido(funcionario!.id as string)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      // 409 = a API recusou por uma REGRA e mandou junto o motivo e o caminho
      // (respostaDeErroPg em api/src/routes/funcionarios.ts). Exibe o texto
      // dela; um fixo aqui so poderia falar de bloqueios que este arquivo ja
      // conhece, e o que prendeu o dono foi justamente um que ele nao
      // conhecia — uma FK de `veiculo_usos`, tabela cuja tela foi removida.
      // Ele lia so "Tente novamente." e tentar de novo dava o mesmo erro,
      // sempre. Ver mensagemDeBloqueio em api/client.ts.
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
      aria-label={editando ? 'Editar funcionário' : 'Novo funcionário'}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalCliente —
          clicar no fundo fecha, clicar dentro nao propaga; noValidate desliga
          so o bloqueio nativo do form (o `required` do nome continua no DOM
          e mapeando pra aria-required, quem decide bloquear o submit agora
          e a validacao em JS abaixo). */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar funcionário' : 'Novo funcionário'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {confirmandoExclusao ? (
            <div className="modal-confirma">
              <p className="modal-confirma-texto" role="alert">
                Excluir <strong>{rascunho.nome}</strong>? O cadastro será apagado definitivamente — não é
                possível desfazer. Lançamentos já feitos para este funcionário continuam no histórico, só
                deixam de estar vinculados a ele.
              </p>
              {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
            </div>
          ) : (
            <>
              <div className="modal-form-grid">
                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="funcionario-nome">Nome do funcionário</label>
                  <input
                    className="modal-input"
                    {...campo('nome')}
                    placeholder="Ex.: João da Silva"
                    autoFocus
                    required
                  />
                  {erroNome && <p className="modal-erro" role="alert">{erroNome}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="funcionario-cargo">Função / cargo</label>
                  <input className="modal-input" {...campo('cargo')} placeholder="Ex.: Motorista" />
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="funcionario-tel">Telefone</label>
                  <input className="modal-input" {...campo('tel')} />
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="funcionario-salario">Salário mensal (R$)</label>
                  <input
                    className="modal-input modal-input--mono"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex.: 2200"
                    {...campo('salario')}
                  />
                  {erroSalario && <p className="modal-erro" role="alert">{erroSalario}</p>}
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="funcionario-dia_pag">Dia do pagamento</label>
                  <select className="modal-select" {...campo('dia_pag')}>
                    {DIAS_DO_MES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div className="modal-campo modal-campo--full modal-ativo">
                  <label className="modal-checkbox-label" htmlFor="funcionario-ativo">
                    <input
                      id="funcionario-ativo"
                      name="ativo"
                      type="checkbox"
                      checked={Boolean(rascunho.ativo)}
                      onChange={aoMudarAtivo}
                    />
                    Funcionário ativo
                  </label>
                </div>

                <div className="modal-campo modal-campo--full modal-dica">
                  O <strong>dia do pagamento</strong> define a próxima data prevista. Adiantamentos e
                  salários pagos são lançamentos do Financeiro vinculados a este funcionário.
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
