import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import type { Lancamento } from '../derive/lancamentos'
import type { Funcionario } from '../derive/funcionarios'
import { ModalLancamento } from '../components/ModalLancamento'
import './LancamentosLista.css'

// Molde: ClientesLista.tsx (os quatro estados, cancelado no useEffect,
// ErroApi 401). Diferente de ClientesLista, esta tela nao tem uma "ficha"
// separada — a assinatura do componente (so `onSessaoExpirada`) nao deixa
// espaco pra um modulo externo (como App.tsx faz com clientes) orquestrar
// lista+modal, entao isso mora aqui dentro (mesmo padrao de FuncionariosLista.tsx).

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatarDataBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** AAAA-MM de um lançamento — usado pelo filtro de período (input type="month"). */
function mesDe(iso: string): string {
  return typeof iso === 'string' && iso.length >= 7 ? iso.slice(0, 7) : ''
}

interface LancamentosListaProps {
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function LancamentosLista({ onSessaoExpirada }: LancamentosListaProps) {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [de, setDe] = useState('') // AAAA-MM, vazio = sem limite inferior
  const [ate, setAte] = useState('') // AAAA-MM, vazio = sem limite superior
  // undefined = modal fechado; null = criando; Lancamento = editando (prefill)
  const [modal, setModal] = useState<Partial<Lancamento> | null | undefined>(undefined)

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Lancamento[]>('/api/lancamentos'),
      api.get<Funcionario[]>('/api/funcionarios'),
      // Lista fechada de categorias: SEMPRE vem do servidor (nunca hardcoded
      // aqui), pra nao ter duas fontes divergindo — ver comentario em
      // api/src/routes/lancamentos.ts sobre a rota /categorias.
      api.get<string[]>('/api/lancamentos/categorias'),
    ])
      .then(([ls, fs, cs]) => { if (!cancelado) { setLancamentos(ls); setFuncionarios(fs); setCategorias(cs) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os lançamentos.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  function aoSalvar(l: Lancamento) {
    setLancamentos(ls => {
      const i = ls.findIndex(x => x.id === l.id)
      if (i >= 0) { const copia = ls.slice(); copia[i] = l; return copia }
      return [l, ...ls]
    })
    setModal(undefined)
  }

  function aoExcluir(id: string) {
    setLancamentos(ls => ls.filter(l => l.id !== id))
    setModal(undefined)
  }

  if (carregando) return <p className="lancamentos-estado">Carregando…</p>
  if (erro) return <p className="lancamentos-estado lancamentos-estado--erro" role="alert">{erro}</p>

  const nomeFuncionario = (id: string | null) => funcionarios.find(f => f.id === id)?.nome ?? '—'

  const visiveis = lancamentos.filter(l => {
    const mes = mesDe(l.data)
    if (de && mes < de) return false
    if (ate && mes > ate) return false
    return true
  })
  const filtroAtivo = Boolean(de || ate)

  return (
    <div className="lancamentos-lista">
      <div className="lancamentos-topo">
        <div className="lancamentos-filtro-periodo">
          <label className="lancamentos-filtro-rotulo" htmlFor="lancamentos-de">De</label>
          <input
            id="lancamentos-de"
            type="month"
            className="lancamentos-filtro-input"
            value={de}
            onChange={e => setDe(e.target.value)}
          />
          <label className="lancamentos-filtro-rotulo" htmlFor="lancamentos-ate">Até</label>
          <input
            id="lancamentos-ate"
            type="month"
            className="lancamentos-filtro-input"
            value={ate}
            onChange={e => setAte(e.target.value)}
          />
          {filtroAtivo && (
            <button type="button" className="lancamentos-filtro-limpar" onClick={() => { setDe(''); setAte('') }}>
              Limpar período
            </button>
          )}
        </div>
        <button type="button" className="lancamentos-botao-novo" onClick={() => setModal(null)}>
          <span className="lancamentos-botao-novo-icone">＋</span> Novo lançamento
        </button>
      </div>

      {lancamentos.length === 0 ? (
        <div className="estado-vazio lancamentos-vazio">
          <div className="lancamentos-vazio-titulo">Nenhum lançamento registrado ainda.</div>
          <div className="lancamentos-vazio-sub">
            Clique em <strong>Novo lançamento</strong> para registrar custos como frete, gasolina ou folha.
          </div>
        </div>
      ) : (
        <div className="lancamentos-tabela">
          <div className="lancamentos-linha lancamentos-linha--cabecalho">
            <div>DATA</div>
            <div>CATEGORIA</div>
            <div>DESCRIÇÃO</div>
            <div>FUNCIONÁRIO</div>
            <div className="lancamentos-col-num">VALOR</div>
          </div>

          {visiveis.map(l => (
            <div
              key={l.id}
              className="lancamentos-linha lancamentos-linha--dados"
              onClick={() => setModal(l)}
            >
              <div className="lancamentos-mono">{formatarDataBr(l.data)}</div>
              <div><span className="lancamentos-categoria-badge">{l.categoria}</span></div>
              <div className="lancamentos-descricao">{l.descricao || '—'}</div>
              <div className="lancamentos-funcionario">{nomeFuncionario(l.funcionario_id)}</div>
              <div className="lancamentos-col-num lancamentos-mono lancamentos-valor">({money(l.valor)})</div>
            </div>
          ))}

          {visiveis.length === 0 && (
            <div className="lancamentos-sem-filtro">Nenhum lançamento no período selecionado.</div>
          )}
        </div>
      )}

      {modal !== undefined && (
        <ModalLancamento
          lancamento={modal}
          categorias={categorias}
          funcionarios={funcionarios}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
