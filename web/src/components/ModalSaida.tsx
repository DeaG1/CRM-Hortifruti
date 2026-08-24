import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'
import { avisoLimiteCredito } from '../derive/pagamento'
import './ModalSaida.css'

export type StatusSaida = 'Pendente' | 'Em rota' | 'Entregue' | 'Cancelado' | 'Devolvido'
export type PagSaida = 'Pago' | 'Pendente' | 'Atrasado' | '—'

export interface ItemSaida {
  id?: string
  produto_id: string
  un: string
  qtd: number
  preco: number
  perda_kg: number
}

/** Espelha o cabecalho de `saidas` (api/src/routes/saidas.ts). `valor`/`peso`
 * so vem em GET / (agregado dos itens); `itens` so vem em GET /:id. */
export interface Saida {
  id: string
  numero: string
  cliente_id: string | null
  rota: string
  data_pedido: string
  entrega: string | null
  status: StatusSaida
  pag: PagSaida
  venc: string | null
  data_pag: string | null
  forma_pag: string
  perda_kg: number
  motivo: string
  obs: string
  criado_em?: string
  alterado_em?: string
  valor?: number
  peso?: number
  itens?: ItemSaida[]
}

interface Produto {
  id: string
  nome: string
  un: string
  peso_medio: number
}

/** Cabecalho de uma saida (venda) como GET /api/saidas (listagem) devolve —
 * mesmo raciocinio de `SaidaBruta` em screens/ClientesLista.tsx: um tipo
 * raso por consumidor, so com os campos que o calculo do aviso de limite
 * de credito usa. Nao reaproveita `Saida` (acima) de proposito: la
 * `valor` e opcional (`GET /:id`, usado no modo edicao, nao garante
 * agregado), aqui a listagem sempre traz `valor` — reaproveitar criaria um
 * campo obrigatorio que o tipo de origem nao garante. */
interface SaidaResumo {
  id: string
  cliente_id: string | null
  pag: PagSaida
  venc: string | null
  valor: number
}

/**
 * Valores iniciais do cabecalho. `status`/`pag` nao levam `as StatusSaida`/
 * `as PagSaida` de proposito — mesma convencao de CLIENTE_NOVO
 * (derive/clientes.ts): sem o cast, o literal e alargado para `string` pelo
 * TypeScript, que e o que `campo()` abaixo espera (senao a atribuicao
 * generica de `e.target.value` — sempre `string` — nao bateria com um tipo
 * unico como `StatusSaida`).
 *
 * `venc` comeca vazio de proposito — e o ponto central do To Do do cliente
 * (P1): "vencimento = entrega + prazo do cliente, hoje digitado a mao".
 * Deixar em branco aqui e o que faz o corpo do POST nao incluir a chave
 * `venc`, e e so a ausencia da chave que faz a API calcular sozinha (ver
 * calcularVencAutomatico em api/src/routes/saidas.ts). Se o usuario digitar
 * algo, o valor dele e enviado e respeitado sem recalculo.
 */
const SAIDA_NOVA = {
  numero: '',
  cliente_id: '',
  data_pedido: '',
  entrega: '',
  status: 'Pendente',
  pag: 'Pendente',
  venc: '',
  data_pag: '',
  forma_pag: '',
  obs: '',
}

type Rascunho = typeof SAIDA_NOVA

const UNIDADES = ['KG', 'CX', 'UN', 'DZ', 'MC'] as const

/** Chave estavel de UI para cada linha de item — nao vai pro corpo do
 * request. `produto_id` sozinho nao serve de key (o mesmo produto pode
 * aparecer em duas linhas), e o indice do array muda ao remover uma linha
 * do meio (perderia o estado de foco/digitacao das linhas seguintes). */
let proximaChaveItem = 0
// `qtd`/`preco` sao `number | string` (nao so `number` como em ItemSaida):
// uma linha nova comeca com os dois campos vazios ('') — mesmo motivo de
// CLIENTE_NOVO.limite (derive/clientes.ts) — e o usuario digita ali dentro,
// entao o estado precisa aceitar tanto o numero vindo da API (ao editar,
// ver o useEffect de carregar a saida) quanto a string vazia/em digitacao.
// Convertidos para numero so no calculo do total/subtotal e no envio
// (`salvar`, abaixo).
interface ItemLinha extends Omit<ItemSaida, 'qtd' | 'preco'> {
  chave: number
  qtd: number | string
  preco: number | string
}

function linhaNova(): ItemLinha {
  return { chave: proximaChaveItem++, produto_id: '', un: 'KG', qtd: '', preco: '', perda_kg: 0 }
}

const money = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** AAAA-MM-DD de hoje, no fuso local — mesmo padrão de `hojeIso()`
 * (ModalLancamento.tsx) / `hojeIsoLocal()` (SaidasLista.tsx e outras
 * telas). Fica aqui (não em derive/pagamento.ts) porque toca `new Date()`:
 * a função pura (`avisoLimiteCredito`) recebe isso como parâmetro, pra
 * continuar testável sem mockar relógio. */
function hojeIso(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

interface ModalSaidaProps {
  /** null = criando uma saida nova. String = editando — usado para buscar o
   * cabecalho COM itens (GET /:id; a listagem so traz totais agregados). */
  saidaId: string | null
  onSalvo: (s: Saida) => void
  onExcluido?: () => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ModalSaida({ saidaId, onSalvo, onExcluido, onFechar, onSessaoExpirada }: ModalSaidaProps) {
  const editando = saidaId !== null

  const [rascunho, setRascunho] = useState<Rascunho>(SAIDA_NOVA)
  const [itens, setItens] = useState<ItemLinha[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [saidasAnteriores, setSaidasAnteriores] = useState<SaidaResumo[]>([])
  // Separado de `saidasAnteriores.length > 0`: um cliente sem NENHUMA venda
  // anterior tambem produz array vazio, e isso e uma informacao valida
  // ("em aberto = 0", nao "nao sei"). So esta flag distingue "carregou e
  // nao tem nada" de "nao carregou" — ver o calculo de `aviso` abaixo.
  const [saidasAnterioresCarregadas, setSaidasAnterioresCarregadas] = useState(false)

  const [carregando, setCarregando] = useState(editando)
  const [erroDetalhe, setErroDetalhe] = useState('')
  const [erroOpcoes, setErroOpcoes] = useState('')

  const [erroNumero, setErroNumero] = useState('')
  const [erroDataPedido, setErroDataPedido] = useState('')
  const [erroItens, setErroItens] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  // Clientes e produtos alimentam os seletores em ambos os modos (criar/editar).
  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Cliente[]>('/api/clientes'),
      api.get<Produto[]>('/api/produtos'),
    ])
      .then(([cs, ps]) => { if (!cancelado) { setClientes(cs); setProdutos(ps) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        // Colaborador: hoje /api/clientes e /api/produtos sao admin-only
        // (exigirAdmin), diferente de /api/saidas. A tela de saidas em si e
        // liberada pro colaborador, mas sem esses dois endpoints os
        // seletores ficam vazios — mensagem honesta em vez de um formulario
        // silenciosamente quebrado. Ver observacao no relatorio final.
        setErroOpcoes('Não foi possível carregar clientes e produtos para os seletores.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Vendas anteriores (GET /api/saidas) — usadas SO pra calcular o aviso de
  // limite de credito (ver avisoLimiteCredito, derive/pagamento.ts, e o
  // calculo de `aviso` abaixo). Busca separada da acima, e falha SOZINHA —
  // mesmo padrao de isolacao de ClientesLista.tsx (GET /api/saidas la
  // tambem tem seu proprio catch, independente de /api/clientes): se este
  // fetch cair, o modal continua TOTALMENTE funcional pra lancar/editar a
  // venda, so o aviso de limite fica indisponivel. Sem mensagem de erro de
  // proposito — o aviso e um extra informativo, entao a falha dele some em
  // silencio, nunca bloqueia nem exige atencao do usuario.
  useEffect(() => {
    let cancelado = false
    api.get<SaidaResumo[]>('/api/saidas')
      .then(ss => { if (!cancelado) { setSaidasAnteriores(ss); setSaidasAnterioresCarregadas(true) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        // `saidasAnterioresCarregadas` fica false — o aviso de limite fica
        // suprimido (ver `aviso` abaixo), nunca calculado com dado parcial:
        // um "em aberto" de R$ 0,00 por falha de rede pareceria dado real
        // e podia mostrar um excedente menor do que o de verdade (ou nenhum
        // aviso quando deveria haver um) — pior que nao mostrar nada.
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Modo edicao: busca o cabecalho COM itens (GET /:id) para preencher o
  // rascunho — a listagem (GET /) nao traz itens, so os totais agregados.
  useEffect(() => {
    if (!saidaId) return
    let cancelado = false
    setCarregando(true)
    api.get<Saida>(`/api/saidas/${saidaId}`)
      .then((s) => {
        if (cancelado) return
        setRascunho({
          numero: s.numero,
          cliente_id: s.cliente_id ?? '',
          data_pedido: s.data_pedido ?? '',
          entrega: s.entrega ?? '',
          status: s.status,
          pag: s.pag,
          venc: s.venc ?? '',
          data_pag: s.data_pag ?? '',
          forma_pag: s.forma_pag ?? '',
          obs: s.obs ?? '',
        })
        setItens((s.itens ?? []).map(it => ({ ...it, chave: proximaChaveItem++ })))
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        setErroDetalhe('Não foi possível carregar esta saída.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [saidaId, onSessaoExpirada])

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `saida-${chave}`,
      name: chave,
      value: rascunho[chave],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  const clienteSelecionado = clientes.find(c => c.id === rascunho.cliente_id)

  function adicionarItem() {
    setItens(is => [...is, linhaNova()])
  }

  function removerItem(chave: number) {
    setItens(is => is.filter(it => it.chave !== chave))
  }

  // Guarda a string digitada como veio do input — sem converter pra numero
  // aqui. Convertendo cada tecla (o que o codigo antigo fazia: '' virava 0
  // no meio da digitacao) o campo "pisca" de volta pra "0" toda vez que o
  // usuario apaga tudo, reproduzindo o mesmo bug do 0 pre-preenchido: a
  // pessoa apaga, ve "0" nao vazio, e digita em cima gravando "01"/"05" sem
  // perceber. A conversao pra numero acontece so onde o valor e usado de
  // fato — total/subtotal abaixo, e no corpo do envio em `salvar`.
  function atualizarItem(chave: number, campoItem: 'produto_id' | 'un' | 'qtd' | 'preco', valor: string) {
    setItens(is => is.map((it) => (it.chave === chave ? { ...it, [campoItem]: valor } : it)))
  }

  const total = itens.reduce((soma, it) => soma + (Number(it.qtd) || 0) * (Number(it.preco) || 0), 0)

  // Aviso de limite de credito (NUNCA bloqueia — ver avisoLimiteCredito).
  // `saidaId` como `ignorarId`: ao editar, `saidasAnteriores` ja contem a
  // versao gravada desta mesma saida — sem excluir ela, o valor entraria
  // duas vezes (a versao antiga dentro de "em aberto" e a versao atual
  // dentro de `total`). Em criacao `saidaId` e null, entao nada e excluido.
  const aviso = clienteSelecionado && saidasAnterioresCarregadas
    ? avisoLimiteCredito(clienteSelecionado.limite, saidasAnteriores, clienteSelecionado.id, total, hojeIso(), saidaId)
    : null

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNumero('')
    setErroDataPedido('')
    setErroItens('')
    setErroGeral('')

    let temCampoInvalido = false
    if (!rascunho.numero.trim()) {
      setErroNumero('Informe o número do pedido.')
      temCampoInvalido = true
    }
    if (!rascunho.data_pedido) {
      setErroDataPedido('Informe a data do pedido.')
      temCampoInvalido = true
    }
    // A API tambem rejeita (400: "pelo menos um item e obrigatorio"), mas o
    // usuario merece saber antes de perder o preenchimento do formulario —
    // pedido explicito do briefing desta tela.
    if (itens.length === 0) {
      setErroItens('Adicione pelo menos um item antes de salvar.')
      temCampoInvalido = true
    } else if (itens.some(it => !it.produto_id)) {
      setErroItens('Selecione um produto em todos os itens.')
      temCampoInvalido = true
    }
    if (temCampoInvalido) return

    setSalvando(true)
    try {
      const corpo: Record<string, unknown> = {
        numero: rascunho.numero.trim(),
        cliente_id: rascunho.cliente_id || null,
        rota: clienteSelecionado?.rota ?? '',
        data_pedido: rascunho.data_pedido,
        entrega: rascunho.entrega || null,
        status: rascunho.status,
        pag: rascunho.pag,
        data_pag: rascunho.data_pag || null,
        forma_pag: rascunho.forma_pag,
        obs: rascunho.obs,
        // qtd/preco: campo vazio vira 0 no envio (mesma regra dos demais
        // campos numericos do sistema) — nao ha validacao de "obrigatorio"
        // pra esses dois nesta tela hoje (so produto_id e checado acima),
        // entao converter '' pra 0 aqui nao afrouxa nenhuma validacao
        // existente.
        itens: itens.map(({ chave: _chave, id: _id, qtd, preco, ...item }) => ({
          ...item,
          qtd: Number(qtd) || 0,
          preco: Number(preco) || 0,
        })),
      }
      // venc so entra no corpo se o usuario digitou algo — campo vazio
      // significa "deixa a API calcular entrega + prazo do cliente" (ver
      // comentario em SAIDA_NOVA e calcularVencAutomatico na API).
      if (rascunho.venc) corpo.venc = rascunho.venc

      const salvo = editando
        ? await api.put<Saida>(`/api/saidas/${saidaId}`, corpo)
        : await api.post<Saida>('/api/saidas', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        // ja existe uma saida com esse numero (indice unico tenant+numero) —
        // erro pertence ao campo numero, nao a mensagem generica.
        setErroNumero('Já existe uma saída com esse número.')
      } else if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
      } else {
        setErroGeral('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!saidaId) return
    setErroExclusao('')
    setExcluindo(true)
    try {
      await api.del(`/api/saidas/${saidaId}`)
      onExcluido?.()
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
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
      aria-label={editando ? 'Editar saída' : 'Nova saída'}
      onClick={onFechar}
    >
      {/* stopPropagation + noValidate: mesmo raciocinio de ModalCliente.tsx —
          clicar no fundo fecha, clicar dentro nao propaga; noValidate desliga
          so o bloqueio nativo do navegador, quem decide bloquear o submit e a
          validacao em JS abaixo (o `required` continua no DOM/acessibilidade). */}
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-header">
          <span className="modal-header-dot" />
          <div className="modal-header-titulo">{editando ? 'Editar saída' : 'Nova saída'}</div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-corpo">
          {carregando ? (
            <p className="modal-carregando">Carregando…</p>
          ) : erroDetalhe ? (
            <p className="modal-erro" role="alert">{erroDetalhe}</p>
          ) : (
            <>
              {confirmandoExclusao && (
                // role="region" (nao "alertdialog"): e um painel inline dentro
                // do proprio modal, sem focus trap proprio nem Escape — mesmo
                // raciocinio de ClienteFicha.tsx. role="alert" no texto garante
                // que a confirmacao seja anunciada quando aparece.
                <div className="modal-confirma" role="region" aria-label="Confirmar exclusão">
                  <p className="modal-confirma-texto" role="alert">
                    Excluir a saída <strong>{rascunho.numero || saidaId}</strong>? Não é possível desfazer.
                  </p>
                  {erroExclusao && <p className="modal-erro" role="alert">{erroExclusao}</p>}
                  <div className="modal-confirma-acoes">
                    <button
                      type="button"
                      className="modal-botao-cancelar"
                      onClick={() => setConfirmandoExclusao(false)}
                      disabled={excluindo}
                    >
                      Cancelar
                    </button>
                    <button type="button" className="modal-confirma-excluir" onClick={excluir} disabled={excluindo}>
                      {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
                    </button>
                  </div>
                </div>
              )}

              {erroOpcoes && <p className="modal-erro" role="alert">{erroOpcoes}</p>}

              <div className="modal-form-grid">
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-numero">Número do pedido</label>
                  <input className="modal-input" {...campo('numero')} placeholder="Ex.: S-0001" autoFocus required />
                  {erroNumero && <p className="modal-erro" role="alert">{erroNumero}</p>}
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-cliente_id">Cliente</label>
                  <select className="modal-select" {...campo('cliente_id')}>
                    <option value="">Selecione…</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  {/* Aviso, nunca bloqueio (decisao do dono do produto): a
                      venda sempre pode ser salva estourando o limite — quem
                      esta no balcao as vezes precisa vender pra um cliente
                      estourado, e travar viraria ligacao pra destravar. Por
                      isso role="status" (anuncia sem interromper o leitor de
                      tela, diferente de role="alert") e nao ha `disabled` no
                      botao de salvar nem confirmacao extra em lugar nenhum. */}
                  {aviso && (
                    <p className="modal-aviso-limite" role="status">
                      Limite de crédito de {money(aviso.limite)}: cliente já deve {money(aviso.emAberto)} em
                      aberto e esta venda soma {money(aviso.estaVenda)} — ultrapassa o limite
                      em {money(aviso.excedente)}.
                    </p>
                  )}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-rota">Rota (automática do cliente)</label>
                  <input
                    className="modal-input modal-input--desabilitado"
                    id="saida-rota"
                    value={clienteSelecionado?.rota ?? ''}
                    disabled
                    readOnly
                  />
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-data_pedido">Data do pedido</label>
                  <input className="modal-input modal-input--mono" type="date" {...campo('data_pedido')} required />
                  {erroDataPedido && <p className="modal-erro" role="alert">{erroDataPedido}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-entrega">Data de entrega</label>
                  <input className="modal-input modal-input--mono" type="date" {...campo('entrega')} />
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-status">Status do pedido</label>
                  <select className="modal-select" {...campo('status')}>
                    <option value="Pendente">Pendente</option>
                    <option value="Em rota">Em rota</option>
                    <option value="Entregue">Entregue</option>
                    <option value="Devolvido">Devolvido</option>
                    <option value="Cancelado">Cancelado</option>
                  </select>
                </div>

                {/* ---------------- itens ---------------- */}
                <div className="modal-campo modal-campo--full modal-itens">
                  <div className="modal-itens-cabecalho">
                    <div className="modal-itens-titulo">Itens do pedido</div>
                    <button type="button" className="modal-itens-adicionar" onClick={adicionarItem}>
                      <span className="modal-itens-adicionar-icone">＋</span> Adicionar produto
                    </button>
                  </div>

                  {itens.length > 0 && (
                    <div className="modal-itens-linha modal-itens-linha--cabecalho">
                      <div>PRODUTO</div>
                      <div>UNIDADE</div>
                      <div className="modal-itens-num">QTD</div>
                      <div className="modal-itens-num">R$/UN</div>
                      <div className="modal-itens-num">SUBTOTAL</div>
                      <div />
                    </div>
                  )}

                  {itens.map(it => (
                    <div className="modal-itens-linha" key={it.chave}>
                      <select
                        className="modal-select modal-select--linha"
                        value={it.produto_id}
                        onChange={e => atualizarItem(it.chave, 'produto_id', e.target.value)}
                        aria-label="Produto"
                      >
                        <option value="">Selecione…</option>
                        {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                      <select
                        className="modal-select modal-select--linha"
                        value={it.un}
                        onChange={e => atualizarItem(it.chave, 'un', e.target.value)}
                        aria-label="Unidade"
                      >
                        {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <div>
                        <input
                          className="modal-input modal-input--mono modal-input--linha"
                          type="number"
                          min="0"
                          step="0.001"
                          placeholder="Ex.: 1450"
                          value={it.qtd}
                          onChange={e => atualizarItem(it.chave, 'qtd', e.target.value)}
                          aria-label="Quantidade"
                        />
                        {/* Aviso de "quantidade acima do estoque disponivel"
                            (existe no protótipo, modal-pedido.html) continua
                            sem implementar aqui — mas nao mais por falta de
                            dado: GET /api/estoque ja existe e agrega
                            entradas - perdas - saidas (ver
                            api/src/routes/estoque.ts e
                            screens/EstoqueLista.tsx). Falta buscar esse saldo
                            neste modal e comparar contra `it.qtd`. Sao TRES
                            armadilhas nessa comparacao, e as tres derrubam o
                            aviso de formas diferentes:

                            1) UNIDADE. O saldo vem EM KG e `it.qtd` esta na
                            unidade escolhida na linha (`it.un`). Comparar os
                            dois crus repetiria exatamente o defeito que as
                            telas de Estoque, Compras, Vendas, Produtos e
                            Perdas acabaram de corrigir: "50" caixas nunca
                            passam de "200" quilos, e o aviso simplesmente
                            nunca dispararia. A comparacao tem de acontecer
                            toda em kg — `it.qtd` convertido pela MESMA regra
                            da API (un === 'KG' ? qtd : qtd * peso_medio, e so
                            quando peso_medio > 0), com o `peso_medio` que
                            `produtos` ja traz neste modal.

                            2) LINHAS POR PRODUTO. GET /api/estoque devolve uma
                            linha por (produto, unidade LANCADA), nao uma por
                            produto: um mesmo produto movimentado em CX e em KG
                            aparece em duas linhas. O saldo do produto e a SOMA
                            do kg dessas linhas — pegar a linha cujo `un` bate
                            com `it.un` daria so o saldo do que foi lancado
                            naquela unidade, um numero menor e sem significado
                            aqui (avisaria falta de mercadoria que existe).

                            3) LINHA INCOMPLETA. Linha com
                            `itens_sem_conversao > 0` tem saldo incompleto por
                            construcao (as quantidades ficaram de fora e so as
                            perdas em kg entraram, entao ele tende a negativo).
                            Um aviso disparado sobre ela e alarme falso — pelo
                            mesmo motivo que EstoqueLista.tsx nao pinta esse
                            saldo de vermelho. Nesse caso o certo e nao avisar
                            (ou dizer que o saldo daquele produto nao e
                            conhecido), nunca acusar excesso.

                            E `equivalente_un` NAO e um atalho para nada disso:
                            ele e null justamente quando un === 'KG' (nada a
                            converter) ou peso_medio === 0 (sem fator), ou
                            seja, falta nos dois casos em que seria preciso, e
                            e por linha, herdando a armadilha 2.

                            Nao fizemos isso aqui ainda, entao nenhum calculo
                            e nenhum valor de disponibilidade sao inventados
                            nesta interface por enquanto. */}
                      </div>
                      <input
                        className="modal-input modal-input--mono modal-input--linha"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Ex.: 3,20"
                        value={it.preco}
                        onChange={e => atualizarItem(it.chave, 'preco', e.target.value)}
                        aria-label="Preço por unidade"
                      />
                      <div className="modal-itens-subtotal">
                        {money((Number(it.qtd) || 0) * (Number(it.preco) || 0))}
                      </div>
                      <button
                        type="button"
                        className="modal-itens-remover"
                        onClick={() => removerItem(it.chave)}
                        aria-label="Remover item"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  {itens.length === 0 && (
                    <div className="modal-itens-vazio">
                      Nenhum item ainda. Clique em <strong>Adicionar produto</strong> para lançar caixas/kg por produto.
                    </div>
                  )}

                  <div className="modal-itens-totais">
                    <div className="modal-itens-totais-label">Total</div>
                    <div className="modal-itens-totais-valor">{money(total)}</div>
                  </div>

                  {erroItens && <p className="modal-erro" role="alert">{erroItens}</p>}
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-pag">Situação de pagamento</label>
                  <select className="modal-select" {...campo('pag')}>
                    <option value="Pendente">Pendente</option>
                    <option value="Pago">Pago</option>
                    <option value="Atrasado">Atrasado</option>
                    <option value="—">— (não aplicável)</option>
                  </select>
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-venc">Vencimento</label>
                  <input className="modal-input modal-input--mono" type="date" {...campo('venc')} />
                  <p className="modal-nota">
                    {rascunho.venc
                      ? 'Valor informado manualmente — não será recalculado.'
                      : 'Em branco: calculado automaticamente (entrega + prazo de pagamento do cliente).'}
                  </p>
                </div>

                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-forma_pag">Forma de pagamento</label>
                  <select className="modal-select" {...campo('forma_pag')}>
                    <option value="">—</option>
                    <option value="PIX">PIX</option>
                    <option value="Boleto">Boleto</option>
                    <option value="Dinheiro">Dinheiro</option>
                  </select>
                </div>
                <div className="modal-campo">
                  <label className="modal-rotulo" htmlFor="saida-data_pag">Data do pagamento</label>
                  <input className="modal-input modal-input--mono" type="date" {...campo('data_pag')} />
                </div>

                <div className="modal-campo modal-campo--full">
                  <label className="modal-rotulo" htmlFor="saida-obs">Observações</label>
                  <textarea className="modal-textarea" {...campo('obs')} rows={3} />
                </div>

                <div className="modal-campo modal-campo--full modal-dica">
                  O <strong>peso total</strong> e o <strong>valor</strong> são somados dos itens acima e alimentam
                  automaticamente o faturamento.
                </div>
              </div>

              {erroGeral && <p className="modal-erro modal-erro-geral" role="alert">{erroGeral}</p>}
            </>
          )}
        </div>

        <div className="modal-rodape">
          {editando && !carregando && !erroDetalhe && (
            <button type="button" className="modal-botao-excluir" onClick={() => setConfirmandoExclusao(true)}>
              Excluir
            </button>
          )}
          <div className="modal-rodape-spacer" />
          <button type="button" className="modal-botao-cancelar" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="modal-botao-salvar" disabled={salvando || carregando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
