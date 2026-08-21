import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { derivarFuncionarios, type Funcionario, type LancamentoParaFuncionario } from '../derive/funcionarios'
import { ModalFuncionario } from '../components/ModalFuncionario'
import './FuncionariosLista.css'

// Molde: ClientesLista.tsx (os quatro estados, cancelado no useEffect,
// ErroApi 401). Diferente de ClientesLista, esta tela nao tem uma "ficha"
// separada — a assinatura do componente (so `onSessaoExpirada`, definida
// pela Fase) nao deixa espaco pra um modulo externo orquestrar
// lista+ficha+modal como App.tsx faz com clientes — entao quem abre/fecha o
// ModalFuncionario e decide criar vs. editar mora aqui dentro.

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatarDataBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : iso
}

interface FuncionariosListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function FuncionariosLista({ onSessaoExpirada }: FuncionariosListaProps) {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [lancamentos, setLancamentos] = useState<LancamentoParaFuncionario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = modal fechado; null = criando; Funcionario = editando (prefill)
  const [modal, setModal] = useState<Partial<Funcionario> | null | undefined>(undefined)

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Funcionario[]>('/api/funcionarios'),
      // So precisamos de categoria/data/funcionario_id pra achar o ultimo
      // salario pago de cada funcionario (ver derive/funcionarios.ts) — a
      // API devolve o lancamento completo, LancamentoParaFuncionario e so o
      // subconjunto que este modulo consome.
      api.get<LancamentoParaFuncionario[]>('/api/lancamentos'),
    ])
      .then(([fs, ls]) => { if (!cancelado) { setFuncionarios(fs); setLancamentos(ls) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os funcionários.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  function aoSalvar(f: Funcionario) {
    setFuncionarios(fs => {
      const i = fs.findIndex(x => x.id === f.id)
      if (i >= 0) { const copia = fs.slice(); copia[i] = f; return copia }
      return [...fs, f]
    })
    setModal(undefined)
  }

  function aoExcluir(id: string) {
    setFuncionarios(fs => fs.filter(f => f.id !== id))
    setModal(undefined)
  }

  if (carregando) return <p className="funcionarios-estado">Carregando…</p>
  if (erro) return <p className="funcionarios-estado funcionarios-estado--erro" role="alert">{erro}</p>

  const derivados = derivarFuncionarios(funcionarios, lancamentos)

  return (
    <div className="funcionarios-lista">
      <div className="funcionarios-topo">
        <div className="funcionarios-dica">Clique num funcionário para editar o cadastro.</div>
        <button type="button" className="funcionarios-botao-novo" onClick={() => setModal(null)}>
          <span className="funcionarios-botao-novo-icone">＋</span> Novo funcionário
        </button>
      </div>

      {funcionarios.length === 0 ? (
        <div className="funcionarios-vazio">
          <div className="funcionarios-vazio-titulo">Nenhum funcionário cadastrado ainda.</div>
          <div className="funcionarios-vazio-sub">
            Clique em <strong>Novo funcionário</strong> para cadastrar a equipe.
          </div>
        </div>
      ) : (
        <div className="funcionarios-tabela">
          <div className="funcionarios-linha funcionarios-linha--cabecalho">
            <div>NOME</div>
            <div>CARGO</div>
            <div className="funcionarios-col-num">SALÁRIO</div>
            <div>DIA PAG.</div>
            <div>PRÓXIMO PAGAMENTO</div>
          </div>

          {derivados.map(f => (
            <div
              key={f.id}
              className="funcionarios-linha funcionarios-linha--dados"
              onClick={() => setModal(f)}
            >
              <div className="funcionarios-celula-nome">
                <div className="funcionarios-nome">{f.nome}</div>
                {!f.ativo && <span className="funcionarios-inativo-badge">Inativo</span>}
              </div>
              <div className="funcionarios-cargo">{f.cargo || '—'}</div>
              <div className="funcionarios-col-num funcionarios-mono">{money(f.salario)}</div>
              <div className="funcionarios-mono">todo dia {f.dia_pag}</div>
              <div className="funcionarios-proximo">
                <span className="funcionarios-mono">{formatarDataBr(f.pagamento.proximaData)}</span>
                <span
                  className="funcionarios-status-badge"
                  style={{ color: f.pagamento.cor, background: f.pagamento.bg }}
                >
                  {f.pagamento.rotulo}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== undefined && (
        <ModalFuncionario
          funcionario={modal}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
