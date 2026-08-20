import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import { CLIENTE_NOVO, type Cliente } from '../derive/clientes'
import './ModalCliente.css'

type Rascunho = typeof CLIENTE_NOVO

interface ModalClienteProps {
  cliente: Partial<Cliente> | null // null = criando
  onSalvo: (c: Cliente) => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro de salvar. */
  onSessaoExpirada?: () => void
}

export function ModalCliente({ cliente, onSalvo, onFechar, onSessaoExpirada }: ModalClienteProps) {
  const [rascunho, setRascunho] = useState<Rascunho>({ ...CLIENTE_NOVO, ...(cliente ?? {}) })
  const [erroNome, setErroNome] = useState('')
  const [erroLimite, setErroLimite] = useState('')
  const [erroPrazo, setErroPrazo] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)
  const editando = Boolean(cliente?.id)

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `cliente-${chave}`,
      name: chave,
      value: rascunho[chave] as string | number,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNome('')
    setErroLimite('')
    setErroPrazo('')
    setErroGeral('')
    if (!rascunho.nome.trim()) {
      setErroNome('Informe o nome.')
      return
    }
    // `min="0"` no input e so UX (o navegador nao bloqueia mais o submit —
    // ver `noValidate` no form). Esta e a validacao que decide se o pedido
    // sai; a API valida de novo (defesa em profundidade — Fix round 1).
    const limiteNum = Number(rascunho.limite)
    const prazoNum = Number(rascunho.prazo)
    let temCampoInvalido = false
    if (Number.isFinite(limiteNum) && limiteNum < 0) {
      setErroLimite('Limite não pode ser negativo.')
      temCampoInvalido = true
    }
    if (Number.isFinite(prazoNum) && prazoNum < 0) {
      setErroPrazo('Prazo não pode ser negativo.')
      temCampoInvalido = true
    }
    if (temCampoInvalido) return
    setSalvando(true)
    try {
      const corpo = {
        ...rascunho,
        limite: limiteNum || 0,
        prazo: prazoNum || 0,
      }
      const salvo = editando
        ? await api.put<Cliente>(`/api/clientes/${cliente!.id}`, corpo)
        : await api.post<Cliente>('/api/clientes', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroNome('Já existe um cliente com esse nome.')
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

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar cliente' : 'Novo cliente'}
      onClick={onFechar}
    >
      {/* stopPropagation aqui e o que faz clicar no fundo fechar o modal sem
          que clicar dentro dele feche tambem — closeModalBackdrop do protótipo.
          noValidate desliga so a UI nativa de bloqueio do navegador (que
          impediria o onSubmit de rodar e escondia a mensagem custom em
          role="alert" atras de um tooltip nativo) — o `required` do campo
          nome continua no DOM e continua mapeando pra aria-required="true"
          na arvore de acessibilidade; so quem decide bloquear o submit agora
          e a validacao em JS logo abaixo, nao o navegador. */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar cliente' : 'Novo cliente'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          <div className="modal-form-grid">
            <div className="modal-campo modal-campo--full">
              <label className="modal-rotulo" htmlFor="cliente-nome">Nome do estabelecimento</label>
              <input
                className="modal-input"
                {...campo('nome')}
                placeholder="Ex.: Mercado Bom Preço"
                autoFocus
                required
              />
              {erroNome && <p className="modal-erro" role="alert">{erroNome}</p>}
            </div>

            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-resp">Responsável / comprador</label>
              <input className="modal-input" {...campo('resp')} />
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-cnpj">CNPJ / CPF</label>
              <input className="modal-input" {...campo('cnpj')} />
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-tel">Telefone / WhatsApp</label>
              <input className="modal-input" {...campo('tel')} />
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-email">E-mail</label>
              <input className="modal-input" type="email" {...campo('email')} />
            </div>
            <div className="modal-campo modal-campo--full">
              <label className="modal-rotulo" htmlFor="cliente-endereco">Endereço completo</label>
              <input
                className="modal-input"
                {...campo('endereco')}
                placeholder="Rua, número, bairro, cidade/UF, CEP"
              />
            </div>

            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-rota">Região / rota</label>
              <input className="modal-input" {...campo('rota')} placeholder="Ex.: Sul A" />
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-freq">Frequência de entrega</label>
              <input className="modal-input" {...campo('freq')} placeholder="Ex.: 2×/sem · Seg e Qui" />
            </div>

            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-status">Status</label>
              <select className="modal-select" {...campo('status')}>
                <option value="ativo">Ativo</option>
                <option value="negociacao">Em negociação</option>
                <option value="inadimplente">Inadimplente</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-forma">Forma de pagamento</label>
              <select className="modal-select" {...campo('forma')}>
                <option value="PIX">PIX</option>
                <option value="Boleto">Boleto</option>
                <option value="Dinheiro">Dinheiro</option>
              </select>
            </div>

            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-limite">Limite de crédito</label>
              <input
                className="modal-input modal-input--mono"
                type="number"
                min="0"
                step="0.01"
                {...campo('limite')}
              />
              {erroLimite && <p className="modal-erro" role="alert">{erroLimite}</p>}
            </div>
            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-prazo">Prazo de pagamento (dias)</label>
              <input className="modal-input modal-input--mono" type="number" min="0" {...campo('prazo')} />
              {erroPrazo && <p className="modal-erro" role="alert">{erroPrazo}</p>}
            </div>

            <div className="modal-campo">
              <label className="modal-rotulo" htmlFor="cliente-tend">Tendência</label>
              <select className="modal-select" {...campo('tend')}>
                <option value="↑">Crescendo</option>
                <option value="→">Estável</option>
                <option value="↓">Caindo</option>
              </select>
            </div>

            <div className="modal-campo modal-campo--full">
              <label className="modal-rotulo" htmlFor="cliente-obs">Observações do vendedor</label>
              <textarea className="modal-textarea" {...campo('obs')} rows={3} />
            </div>

            <div className="modal-campo modal-campo--full modal-dica">
              O <strong>health score</strong> e a <strong>% do faturamento</strong> são calculados
              automaticamente a partir dos pedidos do cliente.
            </div>
          </div>

          {erroGeral && <p className="modal-erro modal-erro-geral" role="alert">{erroGeral}</p>}
        </div>

        <div className="modal-rodape">
          <div className="modal-rodape-spacer" />
          <button type="button" className="modal-botao-cancelar" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="modal-botao-salvar" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
