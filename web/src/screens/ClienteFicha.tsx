import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarClientes,
  statusCobrancaCliente,
  type Cliente,
  type Pedido,
  type StatusCliente,
  type Health,
  type StatusCobranca,
} from '../derive/clientes'
import { situacaoExibidaSaida } from '../derive/pagamento'
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

/** Cor do status de cobranca — o prototipo pinta este campo de verde ou
 * vermelho (`design/CRM Hortifruti.dc.html` ~2249). Reaproveita os mesmos
 * hex do HEALTH_INFO acima pra tela nao ganhar um terceiro verde. Sem
 * entrada para a ausencia de status: travessao fica na cor normal do valor,
 * porque "nao ha o que cobrar" nao e nem boa nem ma noticia. */
const COBRANCA_COR: Record<StatusCobranca, string> = {
  'Em dia': '#3f8f5b',
  'Atrasado': '#c2502f',
}

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR')

/** Data de hoje em 'AAAA-MM-DD', usando os componentes LOCAIS (não UTC) —
 * mesmo `hojeIsoLocal()` de RelatoriosTela.tsx/ClientesLista.tsx. Fica na
 * tela porque toca `new Date()`; `derivarClientes` continua pura recebendo
 * a data como parâmetro. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Mesma dupla de RelatoriosTela.tsx/AbaClientes: valor em R$, ou travessao
 * quando nao ha dado real por tras (nunca "R$ 0", que fingiria um zero
 * apurado). */
const moneyOuTraco = (n: number) => (n ? money(n) : '—')

/** 'AAAA-MM-DD' -> 'DD/MM'. Mesmo formato de dataBr em SaidasLista.tsx/
 * RelatoriosTela.tsx. Travessao sem data valida. */
function dataBr(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—'
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** Cabeçalho de uma saída (venda), como GET /api/saidas devolve — ver
 * api/src/routes/saidas.ts (paraJson) e o mesmo tipo em
 * ClientesLista.tsx (par desta tela, mesma justificativa de tipo raso
 * duplicado por consumidor). */
interface SaidaBruta {
  id: string
  cliente_id: string | null
  entrega: string | null
  valor: number
  status: 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
  pag: 'Pago' | 'Pendente' | 'Atrasado' | '—'
  venc: string | null
}

/**
 * Converte o formato bruto de GET /api/saidas para o `Pedido` que
 * `derivarClientes` espera — mesma ideia de `paraPedidos` em
 * ClientesLista.tsx, mas sem precisar da lista inteira de clientes: aqui só
 * um cliente importa (`alvo`), então basta marcar como dele as saídas cujo
 * `cliente_id` bate com o id da ficha; as demais recebem o próprio
 * `cliente_id` (ou '' se nulo) — nunca igual a `alvo.nome`, então continuam
 * fora de `alvo`, mas ainda contam no faturamento total do período
 * (`derivarClientes` usa TODAS as saídas passadas pra calcular a
 * participação, não só as do cliente da ficha — daí buscar a lista inteira
 * de /api/saidas aqui, não uma rota filtrada por cliente).
 */
function paraPedidos(saidasBrutas: SaidaBruta[], alvo: Cliente): Pedido[] {
  return saidasBrutas.map(s => ({
    id: s.id,
    cliente: s.cliente_id === alvo.id ? alvo.nome : (s.cliente_id || ''),
    entrega: s.entrega ?? '',
    valor: s.valor,
    status: s.status,
    pag: s.pag,
    venc: s.venc,
  }))
}

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
  const [saidasBrutas, setSaidasBrutas] = useState<SaidaBruta[]>([])
  const [erroVendas, setErroVendas] = useState('')
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

  // Vendas (todas, nao so as deste cliente — derivarClientes precisa do
  // total pra calcular a participacao dele no faturamento) — busca separada
  // da ficha em si, e falha SOZINHA: mesmo espirito de ClientesLista.tsx,
  // uma falha aqui nao pode apagar a ficha do cliente que ja carregou, so
  // deixa as metricas comerciais indisponiveis (ver `erroVendas`).
  useEffect(() => {
    let cancelado = false
    api.get<SaidaBruta[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidasBrutas(ss) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroVendas('Não foi possível carregar as vendas — as métricas comerciais ficam indisponíveis.')
      })
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

  // Uma unica leitura do relogio por render: `derivarClientes`, o status de
  // cobranca e o historico abaixo tem que concordar sobre que dia e hoje —
  // duas chamadas separadas podem cair em lados opostos da virada da meia-noite.
  const hoje = hojeIsoLocal()
  const pedidos = paraPedidos(saidasBrutas, cliente)
  const [derivado] = derivarClientes([cliente], pedidos, 'all', hoje)
  const health = HEALTH_INFO[derivado.health]
  const statusLabel = STATUS_LABEL[cliente.status] ?? cliente.status
  // Mesmo sinal de "sem dado real" que ClientesLista.tsx usa por linha:
  // sem faturado no periodo (cliente sem venda, ou vendas indisponiveis por
  // falha de /api/saidas), participacao e inadimplencia viram travessao —
  // nao um zero que fingiria ser apurado.
  const temVendas = derivado.faturado > 0
  // Status de cobranca DERIVADO das vendas (achado CF-1 da auditoria). Ate
  // aqui a tela exibia `cliente.cobranca`, campo de cadastro que nasce
  // 'Em dia' e que nenhum formulario altera — dizia "Em dia" para todo
  // cliente, para sempre, poucas linhas acima da taxa de inadimplencia real
  // dele. `null` (cliente sem venda cobravel, ou /api/saidas fora do ar e
  // `saidasBrutas` vazio) vira travessao: nunca "Em dia" por omissao.
  const cobranca = statusCobrancaCliente(pedidos, cliente.nome, hoje)
  // Entregas deste cliente, mais recente primeiro — alimenta o bloco
  // "Histórico de entregas". So as ja entregues (mesmo recorte de
  // `derivado.entregas`/faturado, que tambem so contam status 'Entregue');
  // um pedido cancelado/em rota nao e uma "entrega" no sentido do bloco.
  const entregasCliente = pedidos
    .filter(p => p.cliente === cliente.nome && p.status === 'Entregue')
    .sort((a, b) => (b.entrega || '').localeCompare(a.entrega || ''))

  return (
    <div className="ficha">
      {erroVendas && (
        <p className="ficha-aviso-vendas" role="status">{erroVendas}</p>
      )}

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
                <div className="ficha-metrica-valor">{moneyOuTraco(derivado.faturado)}</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">Ticket / entrega</div>
                <div className="ficha-metrica-valor">{moneyOuTraco(derivado.ticketEntrega)}</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">% do faturamento</div>
                <div className="ficha-metrica-valor">{temVendas ? `${derivado.participacao}%` : '—'}</div>
              </div>
              <div className="ficha-metrica">
                <div className="ficha-metrica-label">Inadimplência</div>
                <div className="ficha-metrica-valor">
                  {temVendas ? derivado.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="ficha-bloco">
            <h3 className="ficha-bloco-titulo">Histórico de entregas</h3>
            {entregasCliente.length === 0 ? (
              <p className="ficha-historico-vazio">Nenhuma entrega registrada.</p>
            ) : (
              <div className="ficha-historico">
                {entregasCliente.map(p => (
                  <div key={p.id} className="ficha-linha">
                    <span className="ficha-linha-chave">
                      {dataBr(p.entrega)} · {situacaoExibidaSaida(p.pag, p.venc, hoje)}
                    </span>
                    <span className="ficha-linha-valor">{money(p.valor)}</span>
                  </div>
                ))}
              </div>
            )}
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
              <span
                className="ficha-linha-valor"
                style={cobranca ? { color: COBRANCA_COR[cobranca] } : undefined}
              >
                {cobranca ?? '—'}
              </span>
            </div>
            <div className="ficha-linha">
              <span className="ficha-linha-chave">Taxa de inadimplência</span>
              <span className="ficha-linha-valor">
                {temVendas ? derivado.inadimplencia.toFixed(1).replace('.', ',') + '%' : '—'}
              </span>
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
