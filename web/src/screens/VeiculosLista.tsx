import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarVeiculos, estatisticasVeiculos, nomeVeiculo,
  type Veiculo, type VeiculoDerivado,
} from '../derive/veiculos'
import { rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import {
  CATEGORIA_GASOLINA, CATEGORIA_MANUTENCAO, CATEGORIA_MULTA,
  CATEGORIAS_COM_VEICULO_ORDEM, type Lancamento,
} from '../derive/lancamentos'
import { ModalVeiculo } from '../components/ModalVeiculo'
import { ModalLancamento } from '../components/ModalLancamento'
import './VeiculosLista.css'

// A TELA TROCOU DE PERGUNTA. Ela respondia "quem está com qual carro agora"
// (Pegar / Devolver / Disponível / Em uso). O dono do negócio usou e concluiu
// que não serve; o que ele quer registrar no carro é o CUSTO dele — gasolina,
// multa e manutenção. Saíram desta tela o botão Pegar, o diálogo de escolher
// funcionário, o Devolver, o status Disponível/Em uso e o destaque de uso
// esquecido há mais de 12h, junto com as rotas que os serviam.
//
// Molde agora: FuncionariosLista.tsx — cadastro inteiro sempre visível,
// números do período por linha, linha que expande mostrando o histórico, e o
// botão de lançar abrindo o ModalLancamento QUE JÁ EXISTE, pré-preenchido.
// Não há um segundo modal de lançamento nesta tela: um formulário copiado
// divergiria do original na primeira mudança de regra.
//
// Nenhuma conta de dinheiro acontece neste arquivo: gasto por veículo,
// gasto por categoria e os cartões saem prontos de derive/veiculos.ts (puro,
// testado à parte). Aqui só se escolhe entre o número e o travessão.
//
// `papel` SAIU das props: a tela é admin-only (ADMIN_ONLY_SCREENS em
// telas.ts) desde que passou a mostrar dinheiro, e a API concorda
// (api/src/routes/veiculos.ts exige admin em '*'). Enquanto havia Pegar e
// Devolver ela era a única tela do produto que dois papéis viam com ações
// diferentes; esse caso deixou de existir, e manter o branch de permissão
// seria manter código que parece vivo e não é.

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Número do período, ou travessão quando o dado não pôde ser medido —
 * `null` (lançamentos indisponíveis) nunca vira "R$ 0,00", que fingiria ser
 * uma medição. Zero de verdade (carregou, não houve gasto no período) sai
 * como R$ 0,00 normalmente. Mesma regra de FuncionariosLista.tsx. */
const moneyOuTraco = (n: number | null) => (n === null ? '—' : money(n))

function formatarDataBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : iso
}

/** Cores do selo de categoria no histórico — mesma mecânica de
 * FuncionariosLista.tsx, com as três categorias de carro. */
const COR_CATEGORIA: Record<string, { cor: string; bg: string }> = {
  [CATEGORIA_GASOLINA]: { cor: '#8a5a2a', bg: '#f6efe4' },
  [CATEGORIA_MANUTENCAO]: { cor: '#2f5d3f', bg: '#e7f1e8' },
  [CATEGORIA_MULTA]: { cor: '#9a4a2e', bg: '#f6e4dc' },
}
const COR_CATEGORIA_PADRAO = { cor: '#4a4838', bg: '#f3f0e6' }

interface VeiculosListaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). ESTA TELA PASSOU A
   * RECEBÊ-LO: ela ficou deliberadamente de fora no commit eae52e0 porque
   * era cadastro da frota mais estado atual, e não havia métrica de fluxo
   * para recortar. Passou a haver. Sem o recorte, "gasolina" somaria todos os
   * meses da história sob um cabeçalho que diz um mês — o número mais fácil
   * de acreditar e mais errado da tela.
   *
   * O CADASTRO NÃO SOME COM O FILTRO, igual a Clientes, Produtos,
   * Fornecedores e Funcionários: todo veículo continua listado com placa,
   * marca, modelo e ano num período sem nenhum lançamento. Um carro não
   * deixa de existir porque não abasteceu em julho. Quem respeita o recorte é
   * o gasto, os cartões e o histórico expansível.
   */
  periodo?: Periodo
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function VeiculosLista({ periodo = PERIODO_TODOS, onSessaoExpirada }: VeiculosListaProps) {
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  // `null` = não disponível (ainda carregando, ou GET /api/lancamentos
  // falhou). `[]` = carregou e não há nenhum. São coisas diferentes e a
  // derivação trata as duas de forma diferente — ver derivarVeiculos.
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [categorias, setCategorias] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [erroLancamentos, setErroLancamentos] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  // undefined = modal de cadastro fechado; null = criando; Veiculo = editando
  const [modal, setModal] = useState<Partial<Veiculo> | null | undefined>(undefined)
  // Mesmo protocolo, pro modal de lançamento — mas aqui o "criando" nunca é
  // `null` puro: o botão abre com categoria e veículo já escolhidos (sem
  // `id`, então ModalLancamento faz POST e não PUT).
  const [modalLancamento, setModalLancamento] = useState<Partial<Lancamento> | undefined>(undefined)

  useEffect(() => {
    let cancelado = false
    api.get<Veiculo[]>('/api/veiculos')
      .then(vs => { if (!cancelado) setVeiculos(vs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os veículos.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Gasto do período: busca separada do cadastro acima e que falha SOZINHA —
  // se /api/lancamentos cair, a frota (placa, marca, modelo, ano, ativo)
  // continua visível e só as colunas derivadas ficam em travessão. Mesmo
  // padrão de ClientesLista.tsx com /api/saidas e de FuncionariosLista.tsx
  // com a folha.
  //
  // As categorias vêm no mesmo Promise.all de propósito: são a lista fechada
  // que ModalLancamento precisa pra montar o `<select>`, e ela nunca é
  // hardcoded no front (ver api/src/routes/lancamentos.ts). Sem ela não dá
  // pra abrir um lançamento com categoria válida, então o botão "Lançar
  // despesa" some junto — melhor não oferecer a ação do que abrir um
  // formulário que salvaria a categoria errada.
  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Lancamento[]>('/api/lancamentos'),
      api.get<string[]>('/api/lancamentos/categorias'),
    ])
      .then(([ls, cs]) => { if (!cancelado) { setLancamentos(ls); setCategorias(cs) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroLancamentos('Não foi possível carregar os lançamentos — o gasto de cada veículo fica indisponível.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  function aoSalvarCadastro(v: Veiculo) {
    setVeiculos(vs => {
      const i = vs.findIndex(x => x.id === v.id)
      if (i >= 0) { const copia = vs.slice(); copia[i] = { ...copia[i], ...v }; return copia }
      return [...vs, v]
    })
    setModal(undefined)
  }

  function aoExcluirCadastro(id: string) {
    setVeiculos(vs => vs.filter(v => v.id !== id))
    setModal(undefined)
  }

  // Lançamento salvo/excluído daqui atualiza a lista local (sem refetch), pra
  // o gasto e os cartões reagirem na hora — mesmo padrão de
  // FuncionariosLista.tsx. `?? []` porque salvar só é possível quando a carga
  // deu certo (o botão some quando não deu).
  function aoSalvarLancamento(l: Lancamento) {
    setLancamentos(ls => {
      const atual = ls ?? []
      const i = atual.findIndex(x => x.id === l.id)
      if (i >= 0) { const copia = atual.slice(); copia[i] = l; return copia }
      return [l, ...atual]
    })
    setModalLancamento(undefined)
  }

  function aoExcluirLancamento(id: string) {
    setLancamentos(ls => (ls ?? []).filter(l => l.id !== id))
    setModalLancamento(undefined)
  }

  if (carregando) return <p className="veiculos-estado">Carregando…</p>
  if (erro) return <p className="veiculos-estado veiculos-estado--erro" role="alert">{erro}</p>

  const derivados = derivarVeiculos(veiculos, lancamentos, periodo)
  const stats = estatisticasVeiculos(veiculos, lancamentos, periodo)
  const podeLancar = lancamentos !== null && categorias.length > 0

  const cartoes: { chave: string; label: string; valor: string; sub: string }[] = [
    {
      chave: 'quantidade',
      label: 'Veículos',
      valor: String(stats.quantidade),
      sub: `${stats.ativos} ativo(s) · cadastro completo`,
    },
    {
      chave: 'gasto',
      label: 'Gasto da frota',
      valor: moneyOuTraco(stats.gastoPeriodo),
      sub: rotuloPeriodo(periodo),
    },
    ...CATEGORIAS_COM_VEICULO_ORDEM.map(categoria => ({
      chave: categoria,
      label: categoria,
      valor: moneyOuTraco(stats.porCategoria ? (stats.porCategoria[categoria] ?? 0) : null),
      sub: rotuloPeriodo(periodo),
    })),
  ]

  const modalCadastro = modal !== undefined && (
    <ModalVeiculo
      veiculo={modal}
      onSalvo={aoSalvarCadastro}
      onExcluido={aoExcluirCadastro}
      onFechar={() => setModal(undefined)}
      onSessaoExpirada={onSessaoExpirada}
    />
  )

  const modalDeLancamento = modalLancamento !== undefined && (
    <ModalLancamento
      lancamento={modalLancamento}
      categorias={categorias}
      // Só a folha vincula funcionário, e nenhum caminho desta tela abre o
      // modal numa categoria de folha — mesma decisão (e mesmo racional
      // espelhado) de VEICULOS_NENHUM em FuncionariosLista.tsx.
      funcionarios={FUNCIONARIOS_NENHUM}
      veiculos={veiculos}
      onSalvo={aoSalvarLancamento}
      onExcluido={aoExcluirLancamento}
      onFechar={() => setModalLancamento(undefined)}
      onSessaoExpirada={onSessaoExpirada}
    />
  )

  /** Abre o modal que já existe, pré-preenchido com ESTE carro e a categoria
   * escolhida. Sem `id` no rascunho, então ModalLancamento faz POST. */
  function abrirLancamento(v: VeiculoDerivado, categoria: string) {
    setModalLancamento({ categoria, veiculo_id: v.id })
  }

  if (veiculos.length === 0) {
    return (
      <>
        <div className="estado-vazio veiculos-vazio">
          <div className="veiculos-vazio-titulo">Nenhum veículo cadastrado ainda.</div>
          <div className="veiculos-vazio-sub">
            Cadastre os carros da frota para lançar gasolina, manutenção e multas em cada um.
          </div>
          <button type="button" className="veiculos-botao-novo" onClick={() => setModal(null)}>
            ＋ Novo veículo
          </button>
        </div>
        {modalCadastro}
      </>
    )
  }

  return (
    <div className="veiculos-lista">
      {erroLancamentos && (
        <p className="veiculos-aviso-gasto" role="status">{erroLancamentos}</p>
      )}

      <div className="veiculos-topo">
        <div className="veiculos-dica">
          Clique num veículo para ver os lançamentos · lançados automaticamente no Financeiro ·{' '}
          gasto de <strong>{rotuloPeriodo(periodo)}</strong> (o cadastro aparece inteiro)
        </div>
        <button type="button" className="veiculos-botao-novo" onClick={() => setModal(null)}>
          <span className="veiculos-botao-novo-icone">＋</span> Novo veículo
        </button>
      </div>

      <div className="veiculos-cartoes">
        {cartoes.map(c => (
          <div key={c.chave} className="veiculos-cartao">
            <div className="veiculos-cartao-label">{c.label}</div>
            <div className="veiculos-cartao-valor">{c.valor}</div>
            <div className="veiculos-cartao-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="veiculos-tabela">
        {derivados.map(v => {
          const aberto = expandido === v.id
          return (
            <div key={v.id} className={aberto ? 'veiculos-linha veiculos-linha--aberta' : 'veiculos-linha'}>
              <div className="veiculos-cabecalho">
                {/* O clique na LINHA expande/recolhe; editar o cadastro é o
                    botão Editar ao lado. Botão de verdade (não div com
                    onClick) porque tem estado — aria-expanded — e precisa ser
                    alcançável pelo teclado. Mesmo desenho de Funcionários. */}
                <button
                  type="button"
                  className="veiculos-toggle"
                  aria-expanded={aberto}
                  onClick={() => setExpandido(atual => (atual === v.id ? null : v.id))}
                >
                  <div className="veiculos-identificacao">
                    <span className="veiculos-seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                    <div className="veiculos-nome-bloco">
                      <div className="veiculos-celula-nome">
                        <span className="veiculos-nome">{nomeVeiculo(v)}</span>
                        {!v.ativo && <span className="veiculos-inativo-badge">Inativo</span>}
                      </div>
                      <div className="veiculos-sub">{v.placa} · {v.ano ?? '—'}</div>
                    </div>
                  </div>

                  <div className="veiculos-numeros">
                    <div className="veiculos-numero">
                      <div className="veiculos-rotulo">GASTO NO PERÍODO</div>
                      <div className="veiculos-mono veiculos-gasto">{moneyOuTraco(v.gasto)}</div>
                    </div>
                    <div className="veiculos-numero">
                      <div className="veiculos-rotulo">LANÇAMENTOS</div>
                      <div className="veiculos-mono">
                        {v.historico === null ? '—' : v.historico.length}
                      </div>
                    </div>
                  </div>
                </button>

                <div className="veiculos-acoes">
                  {podeLancar && (
                    <button
                      type="button"
                      className="veiculos-botao-lancar"
                      aria-label={`Lançar gasolina — ${nomeVeiculo(v)}`}
                      onClick={() => abrirLancamento(v, CATEGORIA_GASOLINA)}
                    >
                      Gasolina
                    </button>
                  )}
                  {podeLancar && (
                    <button
                      type="button"
                      className="veiculos-botao-lancar"
                      aria-label={`Lançar manutenção — ${nomeVeiculo(v)}`}
                      onClick={() => abrirLancamento(v, CATEGORIA_MANUTENCAO)}
                    >
                      Manutenção
                    </button>
                  )}
                  {podeLancar && (
                    <button
                      type="button"
                      className="veiculos-botao-lancar"
                      aria-label={`Lançar multa — ${nomeVeiculo(v)}`}
                      onClick={() => abrirLancamento(v, CATEGORIA_MULTA)}
                    >
                      Multa
                    </button>
                  )}
                  <button
                    type="button"
                    className="veiculos-botao-editar"
                    aria-label={`Editar — ${nomeVeiculo(v)}`}
                    onClick={() => setModal(v)}
                  >
                    Editar
                  </button>
                </div>
              </div>

              {aberto && (
                <div className="veiculos-detalhe">
                  <div className="veiculos-historico-titulo">
                    HISTÓRICO — {v.historico === null
                      ? 'indisponível'
                      : v.historico.length
                        ? `${v.historico.length} lançamento(s) no período`
                        : 'Nenhum lançamento no período'}
                  </div>

                  {v.historico === null ? (
                    <div className="veiculos-historico-vazio">
                      Os lançamentos não puderam ser carregados. Recarregue a página para ver o histórico.
                    </div>
                  ) : v.historico.length === 0 ? (
                    <div className="veiculos-historico-vazio">
                      Nenhuma gasolina, manutenção ou multa lançada neste período.
                      {podeLancar && <> Use <strong>Gasolina</strong> para registrar.</>}
                    </div>
                  ) : (
                    v.historico.map(l => {
                      const cores = COR_CATEGORIA[l.categoria] ?? COR_CATEGORIA_PADRAO
                      return (
                        <button
                          key={l.id}
                          type="button"
                          className="veiculos-lancamento"
                          onClick={() => setModalLancamento(l)}
                        >
                          <span className="veiculos-mono">{formatarDataBr(l.data)}</span>
                          <span>
                            <span
                              className="veiculos-categoria-badge"
                              style={{ color: cores.cor, background: cores.bg }}
                            >
                              {l.categoria}
                            </span>
                          </span>
                          <span className="veiculos-lancamento-descricao">{l.descricao || '—'}</span>
                          <span className="veiculos-mono veiculos-lancamento-valor">{money(l.valor)}</span>
                        </button>
                      )
                    })
                  )}

                  {v.obs && <p className="veiculos-obs">{v.obs}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="veiculos-nota">
        <strong>Gasto no período</strong> = gasolina + manutenção + multas lançadas neste veículo no
        recorte escolhido no cabeçalho. Os mesmos lançamentos entram no total de custos do{' '}
        <strong>Financeiro</strong> — não são um segundo caixa.
      </div>

      {modalCadastro}
      {modalDeLancamento}
    </div>
  )
}

/** Ver o comentário em `modalDeLancamento`. Constante de módulo (não `[]`
 * inline) para não criar um array novo a cada render. */
const FUNCIONARIOS_NENHUM: never[] = []
