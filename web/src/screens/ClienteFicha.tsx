import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import { derivarClientes, type Cliente, type StatusCliente, type Health } from '../derive/clientes'
import './ClienteFicha.css'

const STATUS_LABEL: Record<StatusCliente, string> = {
  ativo: 'Ativo',
  negociacao: 'Em negociação',
  inadimplente: 'Inadimplente',
  inativo: 'Inativo',
}

const HEALTH_INFO: Record<Health, { cor: string; bg: string; label: string }> = {
  green: { cor: '#3f8f5b', bg: '#e7f1e8', label: 'Saudável' },
  amber: { cor: '#c79320', bg: '#f6efd8', label: 'Atenção' },
  red: { cor: '#c2502f', bg: '#f6e4dc', label: 'Risco' },
}

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')

function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(w => w.length > 2)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

interface ClienteFichaProps {
  id: string
  onVoltar: () => void
  onEditar: (cliente: Cliente) => void
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ClienteFicha({ id, onVoltar, onEditar, onSessaoExpirada }: ClienteFichaProps) {
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  useEffect(() => {
    // Sem `setCarregando(true)`/`setErro('')` no topo do efeito de proposito:
    // App.tsx remonta ClienteFicha inteira (key muda) a cada troca de `id`
    // ou salvamento, entao o estado inicial (carregando=true, erro='') ja
    // vem limpo de fabrica — resetar aqui de novo so dispararia um render
    // sincrono extra dentro do efeito sem necessidade.
    let cancelado = false
    api.get<Cliente>(`/api/clientes/${id}`)
      .then(c => { if (!cancelado) setCliente(c) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        if (err instanceof ErroApi && err.status === 404) {
          setErro('Cliente não encontrado.')
          return
        }
        setErro('Não foi possível carregar o cliente.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [id, onSessaoExpirada])

  async function excluir() {
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/clientes/${id}`)
      onVoltar()
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

  if (carregando) return <p className="ficha-estado">Carregando…</p>
  if (erro) return <p className="ficha-estado ficha-estado--erro" role="alert">{erro}</p>
  if (!cliente) return null

  // Ainda nao ha endpoint de pedidos (Fase 1): lista vazia, mesma convencao
  // de ClientesLista — as derivacoes tratam ausencia de pedido sem quebrar.
  const [derivado] = derivarClientes([cliente], [], 'all')
  const health = HEALTH_INFO[derivado.health]
  const statusLabel = STATUS_LABEL[cliente.status] ?? cliente.status

  return (
    <div className="ficha">
      <div className="ficha-topo">
        <button type="button" className="ficha-voltar" onClick={onVoltar}>← Voltar para lista</button>
        <div className="ficha-topo-spacer" />
        <button type="button" className="ficha-editar" onClick={() => onEditar(cliente)}>Editar cliente</button>
        <button type="button" className="ficha-excluir" onClick={() => setConfirmandoExclusao(true)}>
          Excluir
        </button>
      </div>

      {confirmandoExclusao && (
        // `region` (nao `alertdialog`): alertdialog pressupoe um dialogo modal
        // com focus trap — isto e um painel inline, sem foco roubado nem
        // Escape pra fechar. `role="alert"` no texto garante que a confirmacao
        // seja anunciada quando aparece, sem prometer semantica que a UI nao tem.
        <div className="ficha-confirma" role="region" aria-label="Confirmar exclusão">
          <p className="ficha-confirma-texto" role="alert">
            Excluir <strong>{cliente.nome}</strong>? O cadastro será apagado definitivamente — não é
            possível desfazer.
          </p>
          {erroExclusao && <p className="ficha-erro" role="alert">{erroExclusao}</p>}
          <div className="ficha-confirma-acoes">
            <button
              type="button"
              className="ficha-confirma-cancelar"
              onClick={() => setConfirmandoExclusao(false)}
              disabled={excluindo}
            >
              Cancelar
            </button>
            <button type="button" className="ficha-confirma-excluir" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </div>
      )}

      <div className="ficha-header" style={{ borderLeftColor: health.cor }}>
        <div className="ficha-avatar">{iniciais(cliente.nome)}</div>
        <div className="ficha-header-info">
          <div className="ficha-nome">{cliente.nome}</div>
          <div className="ficha-sub">{cliente.resp || '—'} · {cliente.cnpj || '—'} · {cliente.tel || '—'}</div>
          <div className="ficha-sub">{cliente.endereco || '—'}</div>
        </div>
        <div className="ficha-health">
          <div className="ficha-health-rotulo">HEALTH SCORE</div>
          <div className="ficha-health-badge" style={{ color: health.cor, background: health.bg }}>
            <span className="ficha-health-dot" style={{ background: health.cor }} />
            {derivado.tend} {health.label}
          </div>
          <div className="ficha-health-status">{statusLabel}</div>
        </div>
      </div>

      <div className="ficha-grid">
        <div className="ficha-col">
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Métricas comerciais</h3>
            <div className="ficha-metricas">
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">Faturado / mês</div>
                <div className="ficha-metrica-valor">{money(derivado.faturado)}</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">Ticket / entrega</div>
                <div className="ficha-metrica-valor">{money(derivado.ticketEntrega)}</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">% do faturamento</div>
                <div className="ficha-metrica-valor">{derivado.participacao}%</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">Inadimplência</div>
                <div className="ficha-metrica-valor">{derivado.inadimplencia.toFixed(1).replace('.', ',')}%</div>
              </div>
            </div>
          </div>

          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Histórico de entregas</h3>
            {/* Sem endpoint de pedidos ainda (Fase 1): mensagem explicita em
                vez de renderizar uma tabela vazia. */}
            <p className="ficha-historico-vazio">Nenhuma entrega registrada.</p>
          </div>
        </div>

        <div className="ficha-col">
          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Cadastro &amp; rota</h3>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Região / rota</span>
              <span className="ficha-linha-valor">{cliente.rota || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Frequência</span>
              <span className="ficha-linha-valor">{cliente.freq || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Status</span>
              <span className="ficha-linha-valor">{statusLabel}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Forma de pagamento</span>
              <span className="ficha-linha-valor">{cliente.forma || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">E-mail</span>
              <span className="ficha-linha-valor">{cliente.email || '—'}</span>
            </div>
          </div>

          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Crédito &amp; inadimplência</h3>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Limite de crédito</span>
              <span className="ficha-linha-valor">{money(cliente.limite)}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Prazo de pagamento</span>
              <span className="ficha-linha-valor">{cliente.prazo} dias</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Status de cobrança</span>
              <span className="ficha-linha-valor">{cliente.cobranca || '—'}</span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Taxa de inadimplência</span>
              <span className="ficha-linha-valor">{derivado.inadimplencia.toFixed(1).replace('.', ',')}%</span>
            </div>
          </div>

          <div className="ficha-obs">
            <h3 className="ficha-obs-titulo">Observações do vendedor</h3>
            <div className="ficha-obs-texto">
              {cliente.obs ? `"${cliente.obs}"` : 'Nenhuma observação registrada.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
