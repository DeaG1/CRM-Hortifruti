import { useEffect, useState, type CSSProperties } from 'react'
import { api, ErroApi } from './api/client'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
import { ClientesLista } from './screens/ClientesLista'
import { ClienteFicha } from './screens/ClienteFicha'
import { ModalCliente } from './components/ModalCliente'
import type { Cliente } from './derive/clientes'
import { ADMIN_ONLY_SCREENS, type Tela } from './telas'

/** Espelha o corpo de GET /api/eu (api/src/index.ts). */
interface Eu {
  usuarioId: string
  papel: 'admin' | 'colaborador'
}

type EstadoSessao = 'verificando' | 'deslogado' | 'logado'

/** Telas ainda sem implementacao nesta fase — mostram um placeholder identificado. */
function TelaPlaceholder({ tela }: { tela: Tela }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e6e2d4',
        borderRadius: 13,
        padding: '40px 24px',
        textAlign: 'center',
        color: '#8a8775',
        fontSize: 13,
        maxWidth: 560,
      }}
    >
      Tela <strong style={{ color: '#4a4838' }}>{tela}</strong> ainda não implementada nesta fase.
    </div>
  )
}

const BOTAO_NOVO_CLIENTE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: '#5a7d3a',
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  padding: '9px 15px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'Public Sans', sans-serif",
}

type VisaoClientes = 'lista' | 'ficha'

/**
 * Orquestra lista, ficha e modal de clientes (Task 10): quem decide qual
 * tela mostrar e se o modal esta aberto (criando ou editando) vive aqui,
 * fora de ClientesLista/ClienteFicha — os dois ficam sem estado de
 * navegacao entre si, so preocupados com a propria tela.
 */
function ClientesModulo({ onSessaoExpirada }: { onSessaoExpirada: () => void }) {
  const [visao, setVisao] = useState<VisaoClientes>('lista')
  const [clienteId, setClienteId] = useState<string | null>(null)
  // undefined = modal fechado; null = criando; Cliente = editando (prefill)
  const [modal, setModal] = useState<Partial<Cliente> | null | undefined>(undefined)
  // Muda a cada salvamento pra forcar ClientesLista/ClienteFicha a remontar
  // e refazer o fetch — e como a lista/ficha refletem a mudanca sem reload.
  const [versao, setVersao] = useState(0)

  function abrirFicha(id: string) {
    setClienteId(id)
    setVisao('ficha')
  }

  function voltarParaLista() {
    setVisao('lista')
    setClienteId(null)
  }

  function aoSalvar() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  return (
    <>
      {visao === 'ficha' && clienteId
        ? (
          <ClienteFicha
            key={`${clienteId}:${versao}`}
            id={clienteId}
            onVoltar={voltarParaLista}
            onEditar={c => setModal(c)}
            onSessaoExpirada={onSessaoExpirada}
          />
        )
        : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button type="button" style={BOTAO_NOVO_CLIENTE} onClick={() => setModal(null)}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span> Novo cliente
              </button>
            </div>
            <ClientesLista key={versao} onAbrir={abrirFicha} onSessaoExpirada={onSessaoExpirada} />
          </div>
        )}

      {modal !== undefined && (
        <ModalCliente
          cliente={modal}
          onSalvo={aoSalvar}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </>
  )
}

function App() {
  const [eu, setEu] = useState<Eu | null>(null)
  const [estado, setEstado] = useState<EstadoSessao>('verificando')
  const [tela, setTela] = useState<Tela | null>(null)

  // Ao carregar a pagina (inclui F5), pergunta pra API se o cookie de
  // sessao ainda e valido antes de decidir entre tela de login e app.
  useEffect(() => {
    api.get<Eu>('/api/eu')
      .then(dados => { setEu(dados); setEstado('logado') })
      .catch(() => setEstado('deslogado'))
  }, [])

  async function aoEntrar() {
    // POST /api/login so confirma { ok: true } e grava o cookie; usuarioId
    // e papel vem de uma segunda chamada a /api/eu, ja autenticada por ele.
    try {
      const dados = await api.get<Eu>('/api/eu')
      setEu(dados)
      setEstado('logado')
    } catch {
      setEstado('deslogado')
    }
  }

  async function sair() {
    try {
      await api.post('/api/logout')
    } catch (err) {
      // Tambem usada quando uma chamada autenticada devolve 401 (sessao
      // expirada): o logout no servidor falha (ja nao ha sessao valida),
      // mas o estado local precisa voltar ao login do mesmo jeito.
      if (!(err instanceof ErroApi)) throw err
    } finally {
      setEu(null)
      setTela(null)
      setEstado('deslogado')
    }
  }

  if (estado === 'verificando') return null
  if (estado === 'deslogado') return <Login onEntrar={aoEntrar} />
  if (!eu) return null // inalcancavel: estado só vira 'logado' junto com setEu

  // Primeira tela ao entrar: para o admin, Clientes (a unica tela real desta
  // fase); para o colaborador, Entradas (Clientes é admin-only). Guarda
  // tambem contra `tela` sobrevivendo de uma sessao anterior com outro papel.
  const telaPadrao: Tela = eu.papel === 'admin' ? 'clientes' : 'entradas'
  const telaEfetiva: Tela =
    tela && !(ADMIN_ONLY_SCREENS.includes(tela) && eu.papel !== 'admin') ? tela : telaPadrao

  return (
    <Shell papel={eu.papel} telaAtual={telaEfetiva} onNavegar={setTela} onSair={sair}>
      {telaEfetiva === 'clientes'
        ? <ClientesModulo onSessaoExpirada={sair} />
        : <TelaPlaceholder tela={telaEfetiva} />}
    </Shell>
  )
}

export default App
