import { useEffect, useState } from 'react'
import { api, ErroApi } from './api/client'
import { Login } from './screens/Login'

/** Espelha o corpo de GET /api/eu (api/src/index.ts). */
interface Eu {
  usuarioId: string
  papel: 'admin' | 'colaborador'
}

type EstadoSessao = 'verificando' | 'deslogado' | 'logado'

function App() {
  const [eu, setEu] = useState<Eu | null>(null)
  const [estado, setEstado] = useState<EstadoSessao>('verificando')

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
      if (!(err instanceof ErroApi)) throw err
    } finally {
      setEu(null)
      setEstado('deslogado')
    }
  }

  if (estado === 'verificando') return null
  if (estado === 'deslogado') return <Login onEntrar={aoEntrar} />

  return (
    <div
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: 24,
        fontFamily: "'Public Sans', sans-serif",
        color: '#2a2a24',
        background: '#f3f0e6',
      }}
    >
      {/* Placeholder ate a Task 9 trazer a sidebar/menu de verdade. */}
      <p>Sessão ativa — usuário {eu?.usuarioId}, papel {eu?.papel}.</p>
      <button onClick={sair}>Sair</button>
    </div>
  )
}

export default App
