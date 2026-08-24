import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import './ModalEntrada.css'

/** Unidades aceitas — mesmo enum de `produtos.un` (produtos_un_check, migration
 * 009). `entrada_itens.un` nao tem CHECK no banco, mas usar a mesma lista aqui
 * mantem a UI consistente com o cadastro de produtos. */
export const UNIDADES = ['KG', 'CX', 'UN', 'DZ', 'MC'] as const

export interface Produto {
  id: string
  nome: string
  un: string
  peso_medio: number
}

export interface Fornecedor {
  id: string
  nome: string
  regiao: string
  contato: string
}

export interface ItemEntrada {
  id?: string
  produto_id: string
  un: string
  qtd: number
  preco: number
  perda_kg: number
}

/** Cabecalho de uma entrada — os mesmos campos em POST/PUT (api/src/routes/entradas.ts, CAMPOS). */
export interface EntradaCabecalho {
  id: string
  numero: string
  fornecedor_id: string | null
  data: string
  perda_kg: number
  motivo: string
  pago: 'Pago' | 'Pendente' | 'Atrasado'
  data_pag: string | null
  forma_pag: string
  obs: string
}

/** Forma de GET /api/entradas/:id (e do retorno de POST/PUT) — cabecalho + itens. */
export type EntradaComItens = EntradaCabecalho & { itens: ItemEntrada[] }

interface Rascunho {
  numero: string
  fornecedor_id: string
  data: string
  perda_kg: string
  motivo: string
  // string (nao a uniao 'Pago'|'Pendente'|'Atrasado' de EntradaCabecalho) de
  // proposito — e um rascunho editavel vindo de <select>.value, sempre
  // string; mesma convencao do molde (ModalCliente/CLIENTE_NOVO.status).
  pago: string
  data_pag: string
  forma_pag: string
  obs: string
}

/** Valores iniciais de uma entrada nova — sem numero/data/fornecedor (o
 * usuario preenche), pago comeca Pendente (é o que a coluna assume por
 * default no banco). `perda_kg: ''` (nao '0'): campo numerico comeca vazio
 * com placeholder, nao com 0 pre-escrito — abrir com 0 ja digitado faz quem
 * preenche esquecer de apagar o zero e gravar "01"/"0250" em vez do valor
 * pretendido (bug real reportado pelo dono do produto). Vazio vira 0 so na
 * hora de enviar (ver `perdaHeaderNum || 0` em `salvar`). */
const ENTRADA_NOVA: Rascunho = {
  numero: '',
  fornecedor_id: '',
  data: '',
  perda_kg: '',
  motivo: '',
  pago: 'Pendente',
  data_pag: '',
  forma_pag: 'PIX',
  obs: '',
}

interface ItemRascunho {
  produto_id: string
  un: string
  qtd: string
  preco: string
  perda_kg: string
}

function itemVazio(unSugerido = 'KG'): ItemRascunho {
  return { produto_id: '', un: unSugerido, qtd: '', preco: '', perda_kg: '' }
}

function rascunhoDeEntrada(e: EntradaCabecalho | null): Rascunho {
  if (!e) return { ...ENTRADA_NOVA }
  return {
    numero: e.numero,
    fornecedor_id: e.fornecedor_id ?? '',
    data: e.data,
    perda_kg: String(e.perda_kg ?? 0),
    motivo: e.motivo ?? '',
    pago: e.pago,
    data_pag: e.data_pag ?? '',
    forma_pag: e.forma_pag ?? '',
    obs: e.obs ?? '',
  }
}

function itensDeEntrada(e: EntradaComItens | null): ItemRascunho[] {
  if (!e) return []
  return e.itens.map(it => ({
    produto_id: it.produto_id,
    un: it.un,
    qtd: String(it.qtd),
    preco: String(it.preco),
    perda_kg: String(it.perda_kg ?? 0),
  }))
}

const money = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface ModalEntradaProps {
  /** null = criando; objeto com itens (GET /api/entradas/:id) = editando. */
  entrada: EntradaComItens | null
  onSalvo: (e: EntradaComItens) => void
  onFechar: () => void
  /** Sessão expirou (401 da API) — volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function ModalEntrada({ entrada, onSalvo, onFechar, onSessaoExpirada }: ModalEntradaProps) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDeEntrada(entrada))
  const [itens, setItens] = useState<ItemRascunho[]>(() => itensDeEntrada(entrada))
  const editando = Boolean(entrada)

  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregandoProdutos, setCarregandoProdutos] = useState(true)
  const [erroProdutos, setErroProdutos] = useState('')

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregandoFornecedores, setCarregandoFornecedores] = useState(true)
  const [erroFornecedores, setErroFornecedores] = useState('')

  // Produtos que o fornecedor selecionado entrega — GET /api/fornecedores/:id
  // devolve o vinculo (fornecedor_produtos). Usado so pra ordenar o seletor
  // de item, os produtos do fornecedor primeiro — nunca bloqueia nada se
  // falhar (é so uma conveniencia de clique a menos).
  const [produtosDoFornecedor, setProdutosDoFornecedor] = useState<Set<string>>(new Set())

  const [erroNumero, setErroNumero] = useState('')
  const [erroData, setErroData] = useState('')
  const [erroPerda, setErroPerda] = useState('')
  const [erroItens, setErroItens] = useState('')
  const [erroGeral, setErroGeral] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let cancelado = false
    api.get<Produto[]>('/api/produtos')
      .then(ps => { if (!cancelado) setProdutos(ps) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        // 403 acontece para colaborador (produtos.ts exige exigirAdmin) — a
        // tela de entradas em si é permitida pro colaborador, mas hoje ele
        // nao tem como listar produtos. Degrada pro usuario poder ver o
        // resto do formulario, em vez de a tela inteira quebrar.
        setErroProdutos('Não foi possível carregar a lista de produtos.')
      })
      .finally(() => { if (!cancelado) setCarregandoProdutos(false) })

    api.get<Fornecedor[]>('/api/fornecedores')
      .then(fs => { if (!cancelado) setFornecedores(fs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) { onSessaoExpirada?.(); return }
        setErroFornecedores('Não foi possível carregar a lista de fornecedores.')
      })
      .finally(() => { if (!cancelado) setCarregandoFornecedores(false) })

    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Busca os produtos vinculados ao fornecedor selecionado (inclusive o que
  // já vem preenchido ao editar) — reordena o seletor de item sem esperar o
  // usuario reabrir o campo fornecedor.
  useEffect(() => {
    const fornecedorId = rascunho.fornecedor_id
    if (!fornecedorId) { setProdutosDoFornecedor(new Set()); return }
    let cancelado = false
    api.get<{ produtos: { id: string }[] }>(`/api/fornecedores/${fornecedorId}`)
      .then(res => { if (!cancelado) setProdutosDoFornecedor(new Set(res.produtos.map(p => p.id))) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) onSessaoExpirada?.()
        // Qualquer outra falha (403 pro colaborador, 404, rede): so nao
        // reordena — nao é motivo pra travar o formulario.
      })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho.fornecedor_id])

  // Produtos primeiro os do fornecedor selecionado (protótipo: economia real
  // de cliques pra quem lanca dezenas de entradas por semana), depois o
  // resto em ordem alfabetica.
  const produtosOrdenados = [...produtos].sort((a, b) => {
    const pa = produtosDoFornecedor.has(a.id) ? 0 : 1
    const pb = produtosDoFornecedor.has(b.id) ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })

  function campo<K extends keyof Rascunho>(chave: K) {
    return {
      id: `entrada-${chave}`,
      name: chave,
      value: rascunho[chave] as string,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setRascunho(r => ({ ...r, [chave]: e.target.value })),
    }
  }

  function addItem() {
    // Novo item ja nasce com a unidade do produto mais provavel (o primeiro
    // da lista priorizada, se o fornecedor tiver produtos vinculados) —
    // menos um clique pra quem lanca varias linhas seguidas.
    const sugestao = produtosOrdenados.find(p => produtosDoFornecedor.has(p.id))
    setItens(its => [...its, itemVazio(sugestao?.un ?? 'KG')])
    setErroItens('')
  }

  function removerItem(idx: number) {
    setItens(its => its.filter((_, i) => i !== idx))
  }

  function atualizarItem(idx: number, campoItem: keyof ItemRascunho, valor: string) {
    setItens(its => its.map((it, i) => {
      if (i !== idx) return it
      if (campoItem === 'produto_id') {
        // Ao trocar o produto, sugere a unidade cadastrada nele — o usuario
        // ainda pode trocar depois, isto e so o ponto de partida.
        const produto = produtos.find(p => p.id === valor)
        return { ...it, produto_id: valor, un: produto?.un ?? it.un }
      }
      return { ...it, [campoItem]: valor }
    }))
  }

  const totalQtd = itens.reduce((s, it) => s + (Number(it.qtd) || 0), 0)
  const totalPerda = itens.reduce((s, it) => s + (Number(it.perda_kg) || 0), 0)
  const totalValor = itens.reduce((s, it) => s + (Number(it.qtd) || 0) * (Number(it.preco) || 0), 0)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErroNumero('')
    setErroData('')
    setErroPerda('')
    setErroItens('')
    setErroGeral('')

    if (!rascunho.numero.trim()) {
      setErroNumero('Informe o número da entrada.')
      return
    }
    if (!rascunho.data) {
      setErroData('Informe a data.')
      return
    }
    const perdaHeaderNum = Number(rascunho.perda_kg)
    if (Number.isFinite(perdaHeaderNum) && perdaHeaderNum < 0) {
      setErroPerda('Perda não pode ser negativa.')
      return
    }

    // O usuario merece saber ANTES de perder o preenchimento — a API tambem
    // rejeita (entradas.ts, saneiaItens), mas so depois do round-trip.
    if (itens.length === 0) {
      setErroItens('Adicione pelo menos um produto antes de salvar.')
      return
    }
    for (const it of itens) {
      if (!it.produto_id) {
        setErroItens('Selecione o produto em todas as linhas.')
        return
      }
      const qtdNum = Number(it.qtd)
      if (it.qtd === '' || !Number.isFinite(qtdNum) || qtdNum < 0) {
        setErroItens('Informe uma quantidade válida (maior ou igual a zero) em todas as linhas.')
        return
      }
      const precoNum = Number(it.preco)
      if (it.preco === '' || !Number.isFinite(precoNum) || precoNum < 0) {
        setErroItens('Informe um preço válido (maior ou igual a zero) em todas as linhas.')
        return
      }
      const perdaNum = Number(it.perda_kg)
      if (it.perda_kg !== '' && (!Number.isFinite(perdaNum) || perdaNum < 0)) {
        setErroItens('Perda do item não pode ser negativa.')
        return
      }
    }

    setSalvando(true)
    try {
      const corpo = {
        numero: rascunho.numero.trim(),
        fornecedor_id: rascunho.fornecedor_id || null,
        data: rascunho.data,
        perda_kg: perdaHeaderNum || 0,
        motivo: rascunho.motivo,
        pago: rascunho.pago,
        data_pag: rascunho.data_pag || null,
        forma_pag: rascunho.forma_pag,
        obs: rascunho.obs,
        itens: itens.map(it => ({
          produto_id: it.produto_id,
          un: it.un || 'KG',
          qtd: Number(it.qtd),
          preco: Number(it.preco),
          perda_kg: Number(it.perda_kg) || 0,
        })),
      }
      const salvo = editando
        ? await api.put<EntradaComItens>(`/api/entradas/${entrada!.id}`, corpo)
        : await api.post<EntradaComItens>('/api/entradas', corpo)
      onSalvo(salvo)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        setErroNumero('Já existe uma entrada com esse número.')
      } else if (err instanceof ErroApi && err.status === 401) {
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
      className="modal-entrada-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar entrada' : 'Nova entrada'}
      onClick={onFechar}
    >
      <form className="modal-entrada-card" onClick={e => e.stopPropagation()} onSubmit={salvar} noValidate>
        <div className="modal-entrada-header">
          <span className="modal-entrada-header-dot" />
          <div className="modal-entrada-header-titulo">{editando ? 'Editar entrada' : 'Nova entrada'}</div>
          <button type="button" className="modal-entrada-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="modal-entrada-corpo">
          <div className="modal-entrada-grid">
            <div className="modal-entrada-campo modal-entrada-campo--full">
              <label className="modal-entrada-rotulo" htmlFor="entrada-numero">Número da entrada</label>
              <input
                className="modal-entrada-input"
                {...campo('numero')}
                placeholder="Ex.: C-1041"
                autoFocus
                required
              />
              {erroNumero && <p className="modal-entrada-erro" role="alert">{erroNumero}</p>}
            </div>

            <div className="modal-entrada-campo modal-entrada-campo--full">
              <label className="modal-entrada-rotulo" htmlFor="entrada-fornecedor_id">Fornecedor (produtor)</label>
              <select
                className="modal-entrada-select"
                {...campo('fornecedor_id')}
                disabled={carregandoFornecedores}
              >
                <option value="">
                  {carregandoFornecedores ? 'Carregando…' : 'Sem fornecedor definido'}
                </option>
                {fornecedores.map(f => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
              {erroFornecedores && <p className="modal-entrada-erro" role="alert">{erroFornecedores}</p>}
            </div>

            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-data">Data da coleta</label>
              <input className="modal-entrada-input" type="date" {...campo('data')} required />
              {erroData && <p className="modal-entrada-erro" role="alert">{erroData}</p>}
            </div>
            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-pago">Pagamento ao fornecedor</label>
              <select className="modal-entrada-select" {...campo('pago')}>
                <option value="Pendente">Pendente</option>
                <option value="Pago">Pago</option>
                <option value="Atrasado">Atrasado</option>
              </select>
            </div>
            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-data_pag">Data do pagamento</label>
              <input className="modal-entrada-input" type="date" {...campo('data_pag')} />
            </div>
            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-forma_pag">Forma de pagamento</label>
              <select className="modal-entrada-select" {...campo('forma_pag')}>
                <option value="PIX">PIX</option>
                <option value="Cartão de crédito">Cartão de crédito</option>
                <option value="Boleto">Boleto</option>
                <option value="Dinheiro">Dinheiro</option>
              </select>
            </div>

            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-motivo">Motivo da perda (coleta/transporte)</label>
              <select className="modal-entrada-select" {...campo('motivo')}>
                <option value="">—</option>
                <option value="transporte">Transporte</option>
                <option value="armazenagem">Armazenagem</option>
                <option value="vencimento">Vencimento</option>
                <option value="manuseio">Manuseio</option>
              </select>
            </div>
            <div className="modal-entrada-campo">
              <label className="modal-entrada-rotulo" htmlFor="entrada-perda_kg">Perda na coleta/transporte (kg)</label>
              <input
                className="modal-entrada-input modal-entrada-input--mono"
                type="number"
                min="0"
                step="0.001"
                placeholder="Ex.: 8"
                {...campo('perda_kg')}
              />
              {erroPerda && <p className="modal-entrada-erro" role="alert">{erroPerda}</p>}
            </div>

            {/* ---- itens ---- */}
            <div className="modal-entrada-campo modal-entrada-campo--full">
              <div className="modal-entrada-itens">
                <div className="modal-entrada-itens-header">
                  <div className="modal-entrada-itens-titulo">Produtos recebidos</div>
                  <button type="button" className="modal-entrada-add-item" onClick={addItem}>
                    <span className="modal-entrada-add-item-icone">＋</span> Adicionar produto
                  </button>
                </div>

                {itens.length > 0 && (
                  <div className="modal-entrada-item-cabecalho">
                    <div>Produto</div>
                    <div>Un.</div>
                    <div className="modal-entrada-item-col-num">Qtd</div>
                    <div className="modal-entrada-item-col-num">R$/un</div>
                    <div className="modal-entrada-item-col-num">Perda</div>
                    <div className="modal-entrada-item-col-num">Subtotal</div>
                    <div />
                  </div>
                )}

                {itens.map((it, idx) => (
                  <div className="modal-entrada-item-linha" key={idx}>
                    <select
                      className="modal-entrada-item-select"
                      aria-label={`Produto do item ${idx + 1}`}
                      value={it.produto_id}
                      onChange={e => atualizarItem(idx, 'produto_id', e.target.value)}
                      disabled={carregandoProdutos}
                    >
                      <option value="">{carregandoProdutos ? 'Carregando…' : 'Selecione…'}</option>
                      {produtosOrdenados.map(p => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                    <select
                      className="modal-entrada-item-select"
                      aria-label={`Unidade do item ${idx + 1}`}
                      value={it.un}
                      onChange={e => atualizarItem(idx, 'un', e.target.value)}
                    >
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input
                      className="modal-entrada-item-input"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Ex.: 1450"
                      aria-label={`Quantidade do item ${idx + 1}`}
                      value={it.qtd}
                      onChange={e => atualizarItem(idx, 'qtd', e.target.value)}
                    />
                    <input
                      className="modal-entrada-item-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Ex.: 3,20"
                      aria-label={`Preço do item ${idx + 1}`}
                      value={it.preco}
                      onChange={e => atualizarItem(idx, 'preco', e.target.value)}
                    />
                    <input
                      className="modal-entrada-item-input"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Ex.: 8"
                      aria-label={`Perda do item ${idx + 1}`}
                      value={it.perda_kg}
                      onChange={e => atualizarItem(idx, 'perda_kg', e.target.value)}
                    />
                    <div className="modal-entrada-item-subtotal">
                      {money((Number(it.qtd) || 0) * (Number(it.preco) || 0))}
                    </div>
                    <button
                      type="button"
                      className="modal-entrada-item-remover"
                      onClick={() => removerItem(idx)}
                      aria-label={`Remover item ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {itens.length === 0 && (
                  <div className="modal-entrada-itens-vazio">
                    Nenhum produto ainda. Clique em <strong>Adicionar produto</strong> para lançar o que entrou.
                  </div>
                )}

                {itens.length > 0 && (
                  <div className="modal-entrada-item-totais">
                    <div>Totais</div>
                    <div />
                    <div className="modal-entrada-item-col-num">{totalQtd.toLocaleString('pt-BR')}</div>
                    <div />
                    <div className="modal-entrada-item-col-num">{totalPerda.toLocaleString('pt-BR')} kg</div>
                    <div className="modal-entrada-item-col-num">{money(totalValor)}</div>
                    <div />
                  </div>
                )}
              </div>
              {erroItens && <p className="modal-entrada-erro" role="alert">{erroItens}</p>}
              {erroProdutos && <p className="modal-entrada-erro" role="alert">{erroProdutos}</p>}
            </div>

            <div className="modal-entrada-campo modal-entrada-campo--full">
              <label className="modal-entrada-rotulo" htmlFor="entrada-obs">Observações</label>
              <textarea className="modal-entrada-textarea" {...campo('obs')} rows={3} />
            </div>

            <div className="modal-entrada-campo modal-entrada-campo--full modal-entrada-dica">
              A <strong>perda</strong> registrada aqui alimenta o índice de perdas. O <strong>total</strong> dos
              itens vira a compra de mercadoria no Financeiro.
            </div>
          </div>

          {erroGeral && <p className="modal-entrada-erro modal-entrada-erro-geral" role="alert">{erroGeral}</p>}
        </div>

        <div className="modal-entrada-rodape">
          <div className="modal-entrada-rodape-total">
            Total: <strong>{money(totalValor)}</strong>
          </div>
          <div className="modal-entrada-rodape-spacer" />
          <button type="button" className="modal-entrada-botao-cancelar" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="modal-entrada-botao-salvar" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
