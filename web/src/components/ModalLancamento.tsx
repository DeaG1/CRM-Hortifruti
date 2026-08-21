import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { LANCAMENTO_NOVO_BASE, CATEGORIAS_COM_FUNCIONARIO, type Lancamento } from '../derive/lancamentos'
import './ModalLancamento.css'

// Molde: ModalCliente.tsx (formulario, validacao, noValidate, 401) +
// ModalProduto.tsx (exclusao dentro do proprio modal — lancamentos, assim
// como produtos, nao tem uma tela de "ficha" separada).

type Rascunho = typeof LANCAMENTO_NOVO_BASE & { data: string; categoria: string }

/** AAAA-MM-DD de hoje, no fuso local — mesmo formato de `_hojeIso()` do
 * protótipo (design/CRM Hortifruti.dc.html:1918), usado como default do
 * campo data ao criar um lançamento novo. */
function hojeIso(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

interface FuncionarioOpcao {
  id: string
  nome: string
}

interface ModalLancamentoProps {
  lancamento: Partial<Lancamento> | null // null = criando
  /** Lista fechada de categorias — vem de GET /api/lancamentos/categorias, buscada por quem abre este modal (LancamentosLista). */
  categorias: string[]
  /** Funcionários pra popular o vínculo — só aparece nas categorias de CATEGORIAS_COM_FUNCIONARIO. */
  funcionarios: FuncionarioOpcao[]
  onSalvo: (l: Lancamento) => void
  /** Exclusao confirmada e concluida na API — quem chama decide o que fazer (fechar, atualizar a lista). */
  onExcluido: (id: string) => void
  onFechar: () => void
  /** Sessao expirou (401 da API) — volta ao login em vez de mostrar erro de salvar/excluir. */
  onSessaoExpirada?: () => void
}

export function ModalLancamento({
  lancamento, categorias, funcionarios, onSalvo, onExcluido, onFechar, onSessaoExpirada,
}: ModalLancamentoProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({
    ...LANCAMENTO_NOVO_BASE,
    data: hojeIso(),
    categoria: categorias[0] ?? '',
    ...(lancamento ?? {}),
    funcionario_id: (lancamento?.funcionario_id ?? LANCAMENTO_NOVO_BASE.funcionario_id) as string,
  })
  const [erroData, setErroData] = useState('')
  const [erroValor, setErroValor] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const editando = Boolean(lancamento?.id)
  // `funcionario_id` só se aplica a Salário/Adiantamento de salário (ver
  // CATEGORIAS_COM_FUNCIONARIO em derive/lancamentos.ts) — nas outras
  // categorias o servidor ignora o valor enviado, mas mostrar um campo sem
  // efeito confunde quem usa. Esconder aqui é só UX; a limpeza de fato
  // acontece no submit (`funcionarioIdEfetivo` abaixo).
  const mostraFuncionario = CATEGORIAS_COM_FUNCIONARIO.has(rascunho.categoria)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `lancamento-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroData('')
    setErroValor('')
    setErroGeral('')
    if (!rascunho.data.trim()) {
      setErroData('Informe a data.')
      return
    }
    // `min="0"` no input e so UX (form tem noValidate — ver comentario no
    // JSX). Esta e a validacao que decide se o pedido sai; a API valida de
    // novo (defesa em profundidade, mesmo padrao de ModalCliente).
    const valorNum = Number(rascunho.valor)
    if (Number.isFinite(valorNum) && valorNum < 0) {
      setErroValor('Valor não pode ser negativo.')
      return
    }
    setSalvando(true)
    try {
      const funcionarioIdEfetivo = mostraFuncionario && rascunho.funcionario_id ? rascunho.funcionario_id : null
      const corpo = {
        data: rascunho.data,
        categoria: rascunho.categoria,
        descricao: rascunho.descricao,
        valor: valorNum || 0,
        funcionario_id: funcionarioIdEfetivo,
      }
      const salvo = editando
        ? await api.put<Lancamento>(`/api/lancamentos/${lancamento!.id}`, corpo)
        : await api.post<Lancamento>('/api/lancamentos', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
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
      await api.del(`/api/lancamentos/${lancamento!.id}`)
      onExcluido(lancamento!.id as string)
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

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar lançamento' : 'Novo lançamento'}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalCliente —
          clicar no fundo fecha, clicar dentro nao propaga; noValidate desliga
          so o bloqueio nativo do form (o `required` da data continua no DOM
          e mapeando pra aria-required, quem decide bloquear o submit agora
          e a validacao em JS abaixo). */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar lançamento' : 'Novo lançamento'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {confirmandoExclusao ? (
            <div className="modal-confirma">
              <p className="modal-confirma-texto" role="alert">
                Excluir este lançamento de <strong>{rascunho.categoria}</strong>? Não é possível desfazer.
              </p>
              {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
            </div>
          ) : (
            <>
              <div className="modal-form-grid">
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="lancamento-data">Data do lançamento</label>
                  <input className="modal-input" type="date" {...campo('data')} autoFocus required />
                  {erroData && <p className="modal-erro" role="alert">{erroData}</p>}
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="lancamento-categoria">Categoria</label>
                  <select className="modal-select" {...campo('categoria')}>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="lancamento-descricao">Descrição</label>
                  <input
                    className="modal-input"
                    {...campo('descricao')}
                    placeholder="Ex.: troca de óleo do caminhão"
                  />
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="lancamento-valor">Valor (R$)</label>
                  <input
                    className="modal-input modal-input--mono"
                    type="number"
                    min="0"
                    step="0.01"
                    {...campo('valor')}
                  />
                  {erroValor && <p className="modal-erro" role="alert">{erroValor}</p>}
                </div>

                {mostraFuncionario && (
                  <div className="modal-campo">
                    <label className="modal-rotulo" htmlFor="lancamento-funcionario_id">Funcionário</label>
                    <select className="modal-select" {...campo('funcionario_id')}>
                      <option value="">—</option>
                      {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>
                )}

                <div className="modal-campo modal-campo--full modal-dica">
                  O lançamento entra no <strong>total de custos</strong> do período e — quando vinculado a
                  um funcionário — desconta do <strong>a pagar</strong> dele.
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
