import { useState, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { slugDaEmpresa } from '../slugDaEmpresa'
import './Login.css'

export function Login({ onEntrar }: { onEntrar: () => void }) {
  // Vem do link do cliente (subdominio, /h/<slug> ou ?h=<slug>). So quando
  // nao vier e que o campo aparece na tela — ver slugDaEmpresa.ts.
  const slugDaUrl = slugDaEmpresa()
  const [slug, setSlug] = useState(slugDaUrl)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await api.post('/api/login', { slug, email, senha })
      onEntrar()
    } catch (err) {
      // Mensagem sempre generica: distinguir "empresa nao existe",
      // "e-mail nao encontrado" e "senha errada" permitiria enumerar
      // tenants e contas cadastradas so tentando logins.
      setErro(
        err instanceof ErroApi && err.status === 401
          ? 'Credenciais inválidas.'
          : 'Não foi possível entrar. Tente novamente.',
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="login-pagina">
      <div className="login-conteudo">
        <div className="login-cabecalho">
          <div className="login-logo">
            <div className="login-logo-marca" />
          </div>
          <div className="login-marca">
            <div className="login-marca-titulo">CRM</div>
            <div className="login-marca-sub">Gestão da operação</div>
          </div>
        </div>

        <form className="login-card" onSubmit={entrar}>
          <h1 className="login-titulo">Entrar</h1>
          <p className="login-subtitulo">
            {slugDaUrl ? 'Informe seu e-mail e senha.' : 'Informe os dados de acesso da sua empresa.'}
          </p>

          {!slugDaUrl && <div className="login-campo">
            <label className="login-rotulo" htmlFor="login-slug">Empresa</label>
            <input
              id="login-slug"
              className="login-input"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="identificador da empresa"
              autoComplete="organization"
              disabled={enviando}
              required
            />
          </div>}

          <div className="login-campo">
            <label className="login-rotulo" htmlFor="login-email">E-mail</label>
            <input
              id="login-email"
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
              autoComplete="username"
              disabled={enviando}
              required
            />
          </div>

          <div className="login-campo login-campo--ultimo">
            <label className="login-rotulo" htmlFor="login-senha">Senha</label>
            <input
              id="login-senha"
              className="login-input"
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={enviando}
              required
            />
          </div>

          {erro && (
            <div className="login-erro" role="alert">{erro}</div>
          )}

          <button type="submit" className="login-botao" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar no sistema'}
          </button>
        </form>
      </div>
    </div>
  )
}
