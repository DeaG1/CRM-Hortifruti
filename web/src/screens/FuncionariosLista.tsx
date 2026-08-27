import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  derivarFuncionarios,
  estatisticasFuncionarios,
  descricaoSalario,
  sujeitoDoExcedente,
  type Funcionario,
  type FuncionarioDerivado,
} from '../derive/funcionarios'
import { rotuloPeriodo, PERIODO_TODOS, type Periodo } from '../derive/periodo'
import {
  CATEGORIA_ADIANTAMENTO, CATEGORIA_MULTA, CATEGORIA_SALARIO, type Lancamento,
} from '../derive/lancamentos'
import { placaDeVeiculo, type Veiculo } from '../derive/veiculos'
import { dataBrCurta } from '../derive/pagamento'
import type { Desconto } from '../derive/descontos'
import { ModalFuncionario } from '../components/ModalFuncionario'
import { ModalLancamento } from '../components/ModalLancamento'
import { ModalDesconto } from '../components/ModalDesconto'
import './FuncionariosLista.css'

// Molde: ClientesLista.tsx (os quatro estados, cancelado no useEffect,
// ErroApi 401, e a segunda busca que falha SOZINHA). Diferente de
// ClientesLista, esta tela nao tem uma "ficha" separada — a assinatura do
// componente (so `onSessaoExpirada`, definida pela Fase) nao deixa espaco
// pra um modulo externo orquestrar lista+ficha+modal como App.tsx faz com
// clientes — entao quem abre/fecha os modais e decide criar vs. editar mora
// aqui dentro.
//
// Nenhuma conta de dinheiro acontece neste arquivo: ADIANTADO, PAGO,
// DESCONTADO, A PAGAR e os quatro cartoes saem prontos de
// derive/funcionarios.ts (puro, testado a parte). Aqui so se escolhe entre o
// numero e o travessao.

const money = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Numero do periodo, ou travessao quando o dado nao pode ser medido —
 * `null` (lancamentos indisponiveis) nunca vira "R$ 0,00", que fingiria ser
 * uma medicao. Zero de verdade (carregou, nao havia adiantamento) sai como
 * R$ 0,00 normalmente. */
const moneyOuTraco = (n: number | null) => (n === null ? '—' : money(n))

/** 'AAAA-MM-DD' -> 'DD/MM', via `dataBrCurta` (derive/pagamento.ts) — o mesmo
 * formatador curto que estoque e memória de preço usam. A string crua volta
 * quando a data não bate o formato: aqui ela vem sempre da API, e um segundo
 * formatador só para o caso impossível seria a duplicação que este reuso
 * desfaz. */
function formatarDataBr(iso: string): string {
  return dataBrCurta(iso) ?? iso
}

/**
 * Lista vazia de veículos para o ModalLancamento quando /api/veiculos não
 * pôde ser carregado. Constante de módulo (não `[]` inline) para não criar um
 * array novo a cada render e remontar o `<select>` à toa.
 *
 * ESTA TELA PASSOU A BUSCAR OS VEÍCULOS, e a decisão anterior (nunca buscar,
 * passar sempre `[]`) caiu porque o problema mudou, não porque estava errada.
 * Ela valia enquanto o histórico do funcionário só podia conter salário e
 * adiantamento — categorias sem carro nenhum. Com 'Multa' aceitando os dois
 * vínculos, o histórico passou a conter lançamentos DE VEÍCULO, e o dono quer
 * ver de qual carro foi a infração que abateu o salário.
 *
 * O que se preservou da decisão antiga é o motivo dela: a folha não pode
 * depender da frota. Por isso a busca é um `useEffect` PRÓPRIO, que falha
 * sozinho — /api/veiculos fora do ar tira a placa do histórico e nada mais.
 * Adiantar, Pagar salário, Descontar e o "a pagar" (que sai dos lançamentos,
 * não dos veículos) continuam de pé.
 */
const VEICULOS_NENHUM: never[] = []

const AMBER = '#c79320'
const GREEN = '#3f8f5b'
const NEUTRO = '#9a9784'

/** Cor do "a pagar": ambar enquanto sobra a pagar, verde quando quitado
 * (protótipo: `aPagarColor`). Sem lancamento carregado nao ha o que colorir. */
function corAPagar(saldo: FuncionarioDerivado['saldo']): string {
  if (!saldo) return NEUTRO
  return saldo.aPagar > 0 ? AMBER : GREEN
}

/** Cores do selo de categoria no historico (protótipo: `corCat`/`bgCat`).
 * 'Multa' entra com a cor de alerta (a mesma familia do desconto e de
 * "atrasado"): das tres, e a unica que nao e folha — e a que o dono quer
 * distinguir de relance de um adiantamento comum. */
const COR_CATEGORIA: Record<string, { cor: string; bg: string }> = {
  [CATEGORIA_ADIANTAMENTO]: { cor: '#8a5a2a', bg: '#f6efe4' },
  [CATEGORIA_SALARIO]: { cor: '#2f5d3f', bg: '#e7f1e8' },
  [CATEGORIA_MULTA]: { cor: '#9a4a2e', bg: '#f6e4dc' },
}
const COR_CATEGORIA_PADRAO = { cor: '#4a4838', bg: '#f3f0e6' }
/** O selo do desconto no historico. Vermelho — a mesma cor de "atrasado" e de
 * perda nesta paleta: e o unico registro da lista que TIRA do funcionario. */
const COR_DESCONTO = { cor: '#9a4a2e', bg: '#f6e4dc' }
/** Rótulo do selo de desconto. Constante porque o mesmo texto identifica a
 * linha do histórico e é o que o teste procura. */
const ROTULO_DESCONTO = 'Desconto'

interface FuncionariosListaProps {
  /**
   * Período global do cabeçalho (App.tsx, achado S-3). ESTA TELA PERDEU O
   * SELETOR PRÓPRIO, pelo mesmo motivo de FinanceiroTela: era o mesmo
   * recorte na mesma convenção, e dois seletores de período visíveis ao
   * mesmo tempo podendo discordar é pior que um só. O rótulo do período
   * continua no cartão "Adiantado no período".
   *
   * O CADASTRO não some com o filtro: todo funcionário continua listado com
   * nome, cargo, salário e próximo pagamento — quem respeita o recorte são
   * as colunas de folha (adiantado, pago, a pagar) e o histórico expansível.
   */
  periodo?: Periodo
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function FuncionariosLista({ periodo = PERIODO_TODOS, onSessaoExpirada }: FuncionariosListaProps) {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  // `null` = nao disponivel (ainda carregando, ou GET /api/lancamentos
  // falhou). `[]` = carregou e nao ha nenhum. Sao coisas diferentes e a
  // derivacao trata as duas de forma diferente — ver derivarFuncionarios.
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  // Mesma convencao de `lancamentos` acima: `null` = indisponivel (ainda
  // carregando, ou GET /api/descontos falhou), `[]` = carregou e nao ha
  // nenhum. Desconto NAO e lancamento — nada se move quando a falta e
  // registrada — entao vem de rota propria (ver derive/descontos.ts).
  const [descontos, setDescontos] = useState<Desconto[] | null>(null)
  // Mesma convencao: `null` = indisponivel (carregando, ou GET /api/veiculos
  // falhou), `[]` = carregou e nao ha nenhum. Os veiculos NAO entram em
  // nenhuma conta desta tela — servem para dizer de qual carro foi a multa no
  // historico e para o `<select>` do ModalLancamento quando uma multa e aberta
  // dali (ver VEICULOS_NENHUM).
  const [veiculos, setVeiculos] = useState<Veiculo[] | null>(null)
  const [categorias, setCategorias] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [erroLancamentos, setErroLancamentos] = useState('')
  const [erroVeiculos, setErroVeiculos] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  // undefined = modal fechado; null = criando; Funcionario = editando (prefill)
  const [modal, setModal] = useState<Partial<Funcionario> | null | undefined>(undefined)
  // Mesmo protocolo, pro modal de lancamento — mas aqui o "criando" nunca e
  // `null` puro: Adiantar/Pagar salario abrem com categoria e funcionario ja
  // escolhidos (sem `id`, entao ModalLancamento faz POST e nao PUT).
  const [modalLancamento, setModalLancamento] = useState<Partial<Lancamento> | undefined>(undefined)
  // Mesmo protocolo, pro modal de desconto. `funcionarioNome` viaja junto
  // porque o modal nao tem seletor de funcionario (ele sempre abre a partir
  // da linha de alguem) e precisa dizer de quem e o desconto no cabecalho.
  const [modalDesconto, setModalDesconto] = useState<
    { desconto: Partial<Desconto>; funcionarioNome: string } | undefined
  >(undefined)

  useEffect(() => {
    let cancelado = false
    api.get<Funcionario[]>('/api/funcionarios')
      .then(fs => { if (!cancelado) setFuncionarios(fs) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os funcionários.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // Folha do periodo: busca separada do cadastro acima e falha SOZINHA — se
  // /api/lancamentos cair, a lista de funcionarios (nome, cargo, salario,
  // dia e proximo pagamento) continua visivel, so as colunas derivadas
  // ficam em travessao. Mesmo padrao de ClientesLista.tsx com /api/saidas.
  //
  // As categorias vem no mesmo Promise.all de proposito: sao a lista fechada
  // que ModalLancamento precisa pra montar o `<select>`, e ela nunca e
  // hardcoded no front (ver api/src/routes/lancamentos.ts). Sem essa lista
  // nao da pra abrir um lancamento com categoria valida, entao os botoes
  // Adiantar / Pagar salario somem junto — melhor nao oferecer a acao do que
  // abrir um formulario que salvaria a categoria errada.
  //
  // OS DESCONTOS ENTRAM NO MESMO Promise.all, e isso e uma decisao. Eles sao
  // a QUARTA parcela do "a pagar" (salario − adiantado − pago − descontado):
  // com os lancamentos em mãos e os descontos faltando, a tela mostraria um
  // "a pagar" MAIOR que o real, com cara de numero medido — e o botao "Pagar
  // salario", que pre-preenche exatamente esse valor, ofereceria o salario
  // CHEIO de quem faltou. E o erro que esta funcionalidade existe para
  // evitar. Falhando junto, as colunas de dinheiro viram travessao juntas e
  // nenhuma acao de pagamento e oferecida com numero pela metade.
  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Lancamento[]>('/api/lancamentos'),
      api.get<string[]>('/api/lancamentos/categorias'),
      api.get<Desconto[]>('/api/descontos'),
    ])
      .then(([ls, cs, ds]) => {
        if (!cancelado) { setLancamentos(ls); setCategorias(cs); setDescontos(ds) }
      })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroLancamentos('Não foi possível carregar os lançamentos da folha — adiantado, pago, descontado, multas e a pagar ficam indisponíveis.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  // TERCEIRA busca, separada das outras duas de proposito: os veiculos so
  // ETIQUETAM (a placa da multa no historico e o `<select>` do modal quando
  // uma multa e aberta dali), nao entram em conta nenhuma. Junto no
  // Promise.all acima, /api/veiculos fora do ar apagaria o "a pagar" e
  // esconderia Adiantar / Pagar salario / Descontar — acoplando a folha a
  // frota por causa de um rotulo. Sozinha, ela cai sozinha.
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
        setErroVeiculos('Não foi possível carregar os veículos — a placa não aparece nas multas do histórico. O valor abatido não muda.')
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  function aoSalvar(f: Funcionario) {
    setFuncionarios(fs => {
      const i = fs.findIndex(x => x.id === f.id)
      if (i >= 0) { const copia = fs.slice(); copia[i] = f; return copia }
      return [...fs, f]
    })
    setModal(undefined)
  }

  function aoExcluir(id: string) {
    setFuncionarios(fs => fs.filter(f => f.id !== id))
    setModal(undefined)
  }

  // Lancamento salvo/excluido daqui atualiza a lista local (sem refetch),
  // pra as colunas e os cartoes reagirem na hora — mesmo padrao de
  // LancamentosLista.tsx. `?? []` porque salvar so e possivel quando a
  // carga deu certo (os botoes somem quando nao deu).
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

  // Mesmo padrao, pros descontos: a lista local e atualizada sem refetch, pra
  // a coluna DESCONTADO, o "a pagar" e o cartao do topo reagirem na hora.
  function aoSalvarDesconto(d: Desconto) {
    setDescontos(ds => {
      const atual = ds ?? []
      const i = atual.findIndex(x => x.id === d.id)
      if (i >= 0) { const copia = atual.slice(); copia[i] = d; return copia }
      return [d, ...atual]
    })
    setModalDesconto(undefined)
  }

  function aoExcluirDesconto(id: string) {
    setDescontos(ds => (ds ?? []).filter(d => d.id !== id))
    setModalDesconto(undefined)
  }

  if (carregando) return <p className="funcionarios-estado">Carregando…</p>
  if (erro) return <p className="funcionarios-estado funcionarios-estado--erro" role="alert">{erro}</p>

  const derivados = derivarFuncionarios(funcionarios, lancamentos, descontos, new Date(), periodo)
  const stats = estatisticasFuncionarios(funcionarios, lancamentos, descontos, periodo)
  const podeLancar = lancamentos !== null && categorias.length > 0
  // Descontar nao depende da lista de categorias (desconto nao tem
  // categoria), so de a lista de descontos ter carregado — sem ela nao da pra
  // atualizar a tela depois de salvar.
  const podeDescontar = descontos !== null

  const cartoes: { chave: string; label: string; valor: string; sub: string }[] = [
    { chave: 'quantidade', label: 'Funcionários', valor: String(stats.quantidade), sub: 'cadastrados' },
    { chave: 'folha', label: 'Folha mensal', valor: money(stats.folhaMensal), sub: 'soma dos salários' },
    { chave: 'adiantado', label: 'Adiantado no período', valor: moneyOuTraco(stats.adiantadoPeriodo), sub: rotuloPeriodo(periodo) },
    // A SUBLINHA DESCREVE A CONTA QUE O CARTAO FAZ DE FATO. Com a multa
    // entrando em `aPagarTotal`, "salários − adiantado − pago − descontado"
    // passaria a explicar uma conta diferente da exibida — e um rodape que
    // mente e pior que rodape nenhum. Mesma razao da nota no fim da tela.
    { chave: 'apagar', label: 'A pagar', valor: moneyOuTraco(stats.aPagarTotal), sub: 'salários − adiantado − pago − descontado − multas' },
  ]

  function abrirAdiantamento(f: FuncionarioDerivado) {
    setModalLancamento({ categoria: CATEGORIA_ADIANTAMENTO, funcionario_id: f.id })
  }

  /**
   * O VALOR PRE-PREENCHIDO E O LIQUIDO, e e o `aPagar` que garante isso: ele
   * ja nasce de `salario − adiantado − pago − descontado` (saldoFuncionario,
   * derive/funcionarios.ts). Nao ha nenhuma conta aqui, e nao pode haver —
   * pre-preencher o bruto faria o dono pagar o valor cheio de quem faltou,
   * que e exatamente o erro que o desconto existe para evitar.
   *
   * `: 0` so cobre o caso impossivel de saldo null: o botao que chama esta
   * funcao so e desenhado quando `saldo.podePagar`, e saldo null nao tem
   * `podePagar`.
   */
  function abrirPagamento(f: FuncionarioDerivado) {
    setModalLancamento({
      categoria: CATEGORIA_SALARIO,
      funcionario_id: f.id,
      valor: f.saldo ? f.saldo.aPagar : 0,
      descricao: descricaoSalario(),
    })
  }

  function abrirDesconto(f: FuncionarioDerivado) {
    setModalDesconto({ desconto: { funcionario_id: f.id }, funcionarioNome: f.nome })
  }

  return (
    <div className="funcionarios-lista">
      {erroLancamentos && (
        <p className="funcionarios-aviso-folha" role="status">{erroLancamentos}</p>
      )}

      {/* Aviso PROPRIO, e nao junto do de cima: os dois descrevem perdas de
          tamanhos muito diferentes (uma apaga as contas, a outra apaga uma
          etiqueta) e somar as duas frases numa so faria a menor parecer
          grave. */}
      {erroVeiculos && (
        <p className="funcionarios-aviso-folha" role="status">{erroVeiculos}</p>
      )}

      <div className="funcionarios-topo">
        <div className="funcionarios-dica">
          Clique num funcionário para ver adiantamentos, multas e descontos · adiantamentos,
          salários e multas vão para o Financeiro, descontos não ·{' '}
          folha de <strong>{rotuloPeriodo(periodo)}</strong> (o cadastro aparece inteiro)
        </div>
        <button type="button" className="funcionarios-botao-novo" onClick={() => setModal(null)}>
          <span className="funcionarios-botao-novo-icone">＋</span> Novo funcionário
        </button>
      </div>

      <div className="funcionarios-cartoes">
        {cartoes.map(c => (
          <div key={c.chave} className="funcionarios-cartao">
            <div className="funcionarios-cartao-label">{c.label}</div>
            <div className="funcionarios-cartao-valor">{c.valor}</div>
            <div className="funcionarios-cartao-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {funcionarios.length === 0 ? (
        <div className="estado-vazio funcionarios-vazio">
          <div className="funcionarios-vazio-titulo">Nenhum funcionário cadastrado ainda.</div>
          <div className="funcionarios-vazio-sub">
            Clique em <strong>Novo funcionário</strong> para cadastrar a equipe.
          </div>
        </div>
      ) : (
        <div className="funcionarios-tabela">
          {derivados.map(f => {
            const aberto = expandido === f.id
            const saldo = f.saldo
            return (
              <div key={f.id} className={aberto ? 'funcionarios-linha funcionarios-linha--aberta' : 'funcionarios-linha'}>
                <div className="funcionarios-cabecalho">
                  {/* O clique na LINHA expande/recolhe; editar o cadastro e o
                      botao Editar ao lado. Botao de verdade (nao div com
                      onClick) porque agora ele tem estado — aria-expanded —
                      e precisa ser alcancavel pelo teclado. */}
                  <button
                    type="button"
                    className="funcionarios-toggle"
                    aria-expanded={aberto}
                    onClick={() => setExpandido(atual => (atual === f.id ? null : f.id))}
                  >
                    <div className="funcionarios-identificacao">
                      <span className="funcionarios-seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                      <div className="funcionarios-nome-bloco">
                        <div className="funcionarios-celula-nome">
                          <span className="funcionarios-nome">{f.nome}</span>
                          {!f.ativo && <span className="funcionarios-inativo-badge">Inativo</span>}
                        </div>
                        <div className="funcionarios-cargo">{f.cargo || '—'} · {f.tel || '—'}</div>
                      </div>
                      <div className="funcionarios-proximo">
                        <div className="funcionarios-rotulo">PRÓXIMO PAGAMENTO</div>
                        <div className="funcionarios-mono">{formatarDataBr(f.pagamento.proximaData)}</div>
                      </div>
                      <span
                        className="funcionarios-status-badge"
                        style={{ color: f.pagamento.cor, background: f.pagamento.bg }}
                      >
                        {f.pagamento.rotulo}
                      </span>
                    </div>

                    <div className="funcionarios-numeros">
                      <div className="funcionarios-numero">
                        <div className="funcionarios-rotulo">SALÁRIO</div>
                        <div className="funcionarios-mono">{money(f.salario)}</div>
                      </div>
                      <div className="funcionarios-numero">
                        <div className="funcionarios-rotulo">ADIANTADO</div>
                        <div className="funcionarios-mono funcionarios-mono--adiantado">
                          {moneyOuTraco(saldo ? saldo.adiantado : null)}
                        </div>
                      </div>
                      <div className="funcionarios-numero">
                        <div className="funcionarios-rotulo">PAGO</div>
                        <div className="funcionarios-mono funcionarios-mono--pago">
                          {moneyOuTraco(saldo ? saldo.pagoSalario : null)}
                        </div>
                      </div>
                      <div className="funcionarios-numero">
                        <div className="funcionarios-rotulo">DESCONTADO</div>
                        {/* Zero aqui e MEDIDO ("carregou, e este funcionario
                            nao levou desconto no periodo") e sai como R$ 0,00.
                            O travessao fica so para quando a lista nao pode
                            ser carregada. */}
                        <div className="funcionarios-mono funcionarios-mono--descontado">
                          {moneyOuTraco(saldo ? saldo.descontado : null)}
                        </div>
                      </div>
                      {/* COLUNA PROPRIA, e nao somada em ADIANTADO. As duas
                          abatem a folha da mesma forma, mas "adiantado" quer
                          dizer dinheiro ENTREGUE ao funcionario, e multa nao e
                          isso — alem de o cartao do topo se chamar "Adiantado
                          no periodo" e passar a mentir ou a discordar da linha.
                          O raciocinio completo esta em `SaldoFuncionario`
                          (derive/funcionarios.ts). */}
                      <div className="funcionarios-numero">
                        <div className="funcionarios-rotulo">MULTAS</div>
                        <div className="funcionarios-mono funcionarios-mono--multa">
                          {moneyOuTraco(saldo ? saldo.multa : null)}
                        </div>
                      </div>
                      <div className="funcionarios-numero funcionarios-numero--apagar">
                        <div className="funcionarios-rotulo">A PAGAR</div>
                        <div className="funcionarios-mono funcionarios-apagar" style={{ color: corAPagar(saldo) }}>
                          {moneyOuTraco(saldo ? saldo.aPagar : null)}
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="funcionarios-acoes">
                    {saldo?.quitado && (
                      <span className="funcionarios-quitado">salário do mês quitado</span>
                    )}
                    {podeLancar && saldo?.podePagar && (
                      <button
                        type="button"
                        className="funcionarios-botao-pagar"
                        aria-label={`Pagar salário — ${f.nome}`}
                        onClick={() => abrirPagamento(f)}
                      >
                        Pagar salário
                      </button>
                    )}
                    {podeLancar && (
                      <button
                        type="button"
                        className="funcionarios-botao-adiantar"
                        aria-label={`Adiantar — ${f.nome}`}
                        onClick={() => abrirAdiantamento(f)}
                      >
                        Adiantar
                      </button>
                    )}
                    {/* Sempre oferecido (nao so quando ha "a pagar", ao
                        contrario de Pagar salario): registrar a falta de quem
                        ja esta quitado no periodo continua sendo correto — o
                        excedente aparece e a proxima folha e que fica menor. */}
                    {podeDescontar && (
                      <button
                        type="button"
                        className="funcionarios-botao-descontar"
                        aria-label={`Descontar — ${f.nome}`}
                        onClick={() => abrirDesconto(f)}
                      >
                        Descontar
                      </button>
                    )}
                    <button
                      type="button"
                      className="funcionarios-botao-editar"
                      aria-label={`Editar — ${f.nome}`}
                      onClick={() => setModal(f)}
                    >
                      Editar
                    </button>
                  </div>
                </div>

                {aberto && (
                  <div className="funcionarios-detalhe">
                    <div className="funcionarios-detalhe-resumo">
                      <div>
                        <div className="funcionarios-rotulo">ÚLTIMO SALÁRIO PAGO</div>
                        {/* Sem lancamento carregado nao da pra dizer "nunca" —
                            "nunca" e uma afirmacao sobre o historico, e o
                            historico e justamente o que falta. */}
                        <div className="funcionarios-mono">
                          {f.historico === null ? '—' : f.ultimoPago ? formatarDataBr(f.ultimoPago) : 'nunca'}
                        </div>
                      </div>
                      <div className="funcionarios-detalhe-divisor" />
                      <div>
                        <div className="funcionarios-rotulo">DIA DO PAGAMENTO</div>
                        <div className="funcionarios-mono">todo dia {f.dia_pag}</div>
                      </div>
                      <div className="funcionarios-detalhe-divisor" />
                      <div>
                        <div className="funcionarios-rotulo">PRÓXIMO PAGAMENTO</div>
                        <div className="funcionarios-mono">
                          {formatarDataBr(f.pagamento.proximaData)} ·{' '}
                          <span style={{ color: f.pagamento.cor, fontWeight: 600 }}>{f.pagamento.rotulo}</span>
                        </div>
                      </div>
                      <div className="funcionarios-detalhe-divisor" />
                      <div>
                        <div className="funcionarios-rotulo">SALDO A PAGAR</div>
                        <div className="funcionarios-mono funcionarios-apagar" style={{ color: corAPagar(saldo) }}>
                          {moneyOuTraco(saldo ? saldo.aPagar : null)}
                        </div>
                      </div>
                    </div>

                    {/* O SUJEITO DA FRASE VEM DERIVADO, nao fixo. Ele dizia
                        sempre "Adiantado", e com o desconto entrando na conta
                        isso passaria a mentir: quem tem R$ 2.300 de desconto
                        sobre um salario de R$ 2.000 tem excedente sem ter
                        recebido um centavo adiantado. Ver `sujeitoDoExcedente`
                        em derive/funcionarios.ts. */}
                    {saldo && saldo.excedente > 0 && sujeitoDoExcedente(saldo) && (
                      <p className="funcionarios-excedente">
                        {sujeitoDoExcedente(saldo)} <strong>{money(saldo.excedente)}</strong> além do salário
                        do período — nada a pagar agora.
                      </p>
                    )}

                    {/* "registro(s)", e nao "lancamento(s)": a lista passou a
                        conter tambem os descontos, que NAO sao lancamentos —
                        nenhum dinheiro se moveu por causa deles. */}
                    <div className="funcionarios-historico-titulo">
                      HISTÓRICO — {f.historico === null
                        ? 'indisponível'
                        : f.historico.length
                          ? `${f.historico.length} registro(s) no período`
                          : 'Nenhum registro no período'}
                    </div>

                    {f.historico === null ? (
                      <div className="funcionarios-historico-vazio">
                        Os lançamentos não puderam ser carregados. Recarregue a página para ver o histórico.
                      </div>
                    ) : f.historico.length === 0 ? (
                      <div className="funcionarios-historico-vazio">
                        Nenhum adiantamento, salário, multa ou desconto neste período.
                        {podeLancar && <> Use <strong>Adiantar</strong> para registrar.</>}
                      </div>
                    ) : (
                      f.historico.map(item => {
                        // Um clique abre o modal DAQUELE registro: lancamento
                        // e desconto sao coisas diferentes, com formularios e
                        // rotas diferentes — por isso o histórico é uma união
                        // discriminada e não um objeto achatado (ver
                        // `ItemHistorico` em derive/funcionarios.ts).
                        if (item.tipo === 'desconto') {
                          const d = item.desconto
                          return (
                            <button
                              key={`desconto-${d.id}`}
                              type="button"
                              className="funcionarios-lancamento"
                              onClick={() => setModalDesconto({ desconto: d, funcionarioNome: f.nome })}
                            >
                              <span className="funcionarios-mono">{formatarDataBr(d.data)}</span>
                              <span>
                                <span
                                  className="funcionarios-categoria-badge"
                                  style={{ color: COR_DESCONTO.cor, background: COR_DESCONTO.bg }}
                                >
                                  {ROTULO_DESCONTO}
                                </span>
                              </span>
                              {/* O MOTIVO fica no lugar da descrição: é metade
                                  do valor do registro. Nunca cai em travessão
                                  — a API não aceita desconto sem motivo. */}
                              <span className="funcionarios-lancamento-descricao">{d.motivo}</span>
                              <span className="funcionarios-mono funcionarios-lancamento-valor">
                                −{money(d.valor)}
                              </span>
                            </button>
                          )
                        }
                        const l = item.lancamento
                        const cores = COR_CATEGORIA[l.categoria] ?? COR_CATEGORIA_PADRAO
                        // A PLACA, quando o lancamento tem carro — e so a
                        // multa tem, aqui. "Multa R$ 350" sem dizer de qual
                        // carro esconde do dono metade do registro; e um
                        // adiantamento continua sem placa nenhuma, porque nao
                        // tem. `null` (sem veiculo, veiculo excluido do
                        // cadastro, ou lista indisponivel) simplesmente nao
                        // desenha o chip — nunca um texto inventado.
                        const placa = placaDeVeiculo(veiculos, l.veiculo_id)
                        return (
                          <button
                            key={l.id}
                            type="button"
                            className="funcionarios-lancamento"
                            onClick={() => setModalLancamento(l)}
                          >
                            <span className="funcionarios-mono">{formatarDataBr(l.data)}</span>
                            <span className="funcionarios-lancamento-selo">
                              <span
                                className="funcionarios-categoria-badge"
                                style={{ color: cores.cor, background: cores.bg }}
                              >
                                {l.categoria}
                              </span>
                              {placa && (
                                <span className="funcionarios-lancamento-placa">{placa}</span>
                              )}
                            </span>
                            <span className="funcionarios-lancamento-descricao">{l.descricao || '—'}</span>
                            <span className="funcionarios-mono funcionarios-lancamento-valor">{money(l.valor)}</span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* A NOTA DESCREVE A FORMULA QUE A TELA USA DE FATO. Ela dizia
          "salário − adiantamentos − salários pagos"; com o desconto e depois a
          multa entrando na conta, deixaria de ser verdade — e uma nota de
          rodapé que explica uma conta diferente da exibida é pior que nenhuma.
          A última frase existe porque desconto e multa se parecem na tela e são
          opostos na contabilidade: num nenhum dinheiro saiu, no outro saiu. */}
      <div className="funcionarios-nota">
        <strong>A pagar</strong> = salário − adiantamentos − salários pagos − descontos − multas, no
        período. O <strong>próximo pagamento</strong> é o dia escolhido no cadastro, contado a partir
        do último salário pago. <strong>Descontar</strong> registra uma falta (dia, motivo e valor):
        não move dinheiro nenhum, só abate o que há a pagar. Uma <strong>multa</strong> é o
        contrário: ela já foi paga, continua contando como custo do carro no Financeiro e em
        Veículos, e o valor entra aqui como adiantamento — o funcionário reembolsa pela folha.
      </div>

      {modal !== undefined && (
        <ModalFuncionario
          funcionario={modal}
          onSalvo={aoSalvar}
          onExcluido={aoExcluir}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}

      {modalDesconto !== undefined && (
        <ModalDesconto
          desconto={modalDesconto.desconto}
          funcionarioNome={modalDesconto.funcionarioNome}
          onSalvo={aoSalvarDesconto}
          onExcluido={aoExcluirDesconto}
          onFechar={() => setModalDesconto(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}

      {modalLancamento !== undefined && (
        <ModalLancamento
          lancamento={modalLancamento}
          categorias={categorias}
          funcionarios={funcionarios}
          veiculos={veiculos ?? VEICULOS_NENHUM}
          onSalvo={aoSalvarLancamento}
          onExcluido={aoExcluirLancamento}
          onFechar={() => setModalLancamento(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </div>
  )
}
