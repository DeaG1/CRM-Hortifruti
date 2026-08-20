import { useEffect, useState } from 'react'
import { api, ErroApi } from './api/client'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
import { ClientesLista } from './screens/ClientesLista'
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
        ? <ClientesLista onAbrir={() => { /* ficha do cliente: Task 10 */ }} onSessaoExpirada={sair} />
        : <TelaPlaceholder tela={telaEfetiva} />}
    </Shell>
  )
}

export default App
