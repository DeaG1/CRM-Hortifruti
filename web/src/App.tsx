import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { api, ErroApi } from './api/client'
import { instalarGuardaDeScrollNumerico } from './campoNumerico'
import { abaFoiMarcada, marcarAba } from './marcaDaAba'
import { instalarSinalDePresenca } from './presenca'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
import { SessaoExpirada } from './components/SessaoExpirada'
import { ClientesLista } from './screens/ClientesLista'
import { ClienteFicha } from './screens/ClienteFicha'
import { ModalCliente } from './components/ModalCliente'
import { ProdutosLista } from './screens/ProdutosLista'
import { FornecedoresLista } from './screens/FornecedoresLista'
import { FuncionariosLista } from './screens/FuncionariosLista'
import { VeiculosLista } from './screens/VeiculosLista'
import { EntradasLista } from './screens/EntradasLista'
import { SaidasLista } from './screens/SaidasLista'
import { EstoqueLista } from './screens/EstoqueLista'
// LancamentosLista nao aparece aqui: FinanceiroTela ja a embute como a secao
// de lancamentos, entao expor as duas separadamente duplicaria a mesma lista.
import { DashboardTela } from './screens/DashboardTela'
import { FinanceiroTela } from './screens/FinanceiroTela'
import { RelatoriosTela } from './screens/RelatoriosTela'
import type { Cliente } from './derive/clientes'
import { PERIODO_TODOS, type Periodo } from './derive/periodo'
// `Papel` VOLTOU a ser importado aqui, junto com a prop `papel` de
// `Conteudo`. Ele saiu quando VeiculosLista virou admin-only e nenhuma tela
// precisava mais saber quem estava olhando; voltou porque Clientes, Produtos
// e Fornecedores passaram a ser telas dos DOIS papeis, com conteudo
// diferente em cada um (ver o comentario de `Conteudo`).
import { ADMIN_ONLY_SCREENS, type Papel, type Tela } from './telas'

/** Espelha o corpo de GET /api/eu (api/src/index.ts). */
interface Eu {
  usuarioId: string
  papel: 'admin' | 'colaborador'
}

type EstadoSessao = 'verificando' | 'deslogado' | 'logado'

/** Rede de seguranca do `default` de `Conteudo` (abaixo) — hoje inalcancavel,
 * ja que toda `Tela` cadastrada em telas.ts tem case proprio no switch. Fica
 * pronta pra caso um valor novo seja acrescentado a `Tela` antes do switch
 * ganhar o case correspondente: placeholder identificado em vez de tela
 * em branco silenciosa. */
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

const BOTAO_NOVO_CLIENTE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: '#5a7d3a',
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  padding: '9px 15px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'Public Sans', sans-serif",
}

type VisaoClientes = 'lista' | 'ficha'

/**
 * Orquestra lista, ficha e modal de clientes (Task 10): quem decide qual
 * tela mostrar e se o modal esta aberto (criando ou editando) vive aqui,
 * fora de ClientesLista/ClienteFicha — os dois ficam sem estado de
 * navegacao entre si, so preocupados com a propria tela.
 */
function ClientesModulo(
  { papel, periodo, onSessaoExpirada }:
  { papel: Papel; periodo: Periodo; onSessaoExpirada: () => void },
) {
  const [visao, setVisao] = useState<VisaoClientes>('lista')
  const [clienteId, setClienteId] = useState<string | null>(null)
  // undefined = modal fechado; null = criando; Cliente = editando (prefill)
  const [modal, setModal] = useState<Partial<Cliente> | null | undefined>(undefined)
  // Muda a cada salvamento pra forcar ClientesLista/ClienteFicha a remontar
  // e refazer o fetch — e como a lista/ficha refletem a mudanca sem reload.
  const [versao, setVersao] = useState(0)

  function abrirFicha(id: string) {
    setClienteId(id)
    setVisao('ficha')
  }

  function voltarParaLista() {
    setVisao('lista')
    setClienteId(null)
  }

  function aoSalvar() {
    setModal(undefined)
    setVersao(v => v + 1)
  }

  return (
    <>
      {visao === 'ficha' && clienteId
        ? (
          // `periodo` desce para a ficha pelo mesmo motivo que desce para a
          // lista: o faturado, o ticket e a inadimplência do cliente têm que
          // ser os MESMOS números na linha de onde se clicou e na ficha que
          // abre. Ver o comentário da prop em ClienteFicha.tsx para o que
          // nesta tela fica de fora do recorte (e por quê).
          <ClienteFicha
            key={`${clienteId}:${versao}`}
            id={clienteId}
            papel={papel}
            periodo={periodo}
            onVoltar={voltarParaLista}
            onEditar={c => setModal(c)}
            onSessaoExpirada={onSessaoExpirada}
          />
        )
        : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button type="button" style={BOTAO_NOVO_CLIENTE} onClick={() => setModal(null)}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span> Novo cliente
              </button>
            </div>
            <ClientesLista
              key={versao}
              papel={papel}
              periodo={periodo}
              onAbrir={abrirFicha}
              onSessaoExpirada={onSessaoExpirada}
            />
          </div>
        )}

      {modal !== undefined && (
        <ModalCliente
          cliente={modal}
          papel={papel}
          onSalvo={aoSalvar}
          onFechar={() => setModal(undefined)}
          onSessaoExpirada={onSessaoExpirada}
        />
      )}
    </>
  )
}

function App() {
  const [eu, setEu] = useState<Eu | null>(null)
  const [estado, setEstado] = useState<EstadoSessao>('verificando')
  const [tela, setTela] = useState<Tela | null>(null)
  /**
   * PERÍODO GLOBAL (achado S-3 da auditoria). Mora aqui, ao lado de `tela` e
   * do papel da sessão, pelo mesmo motivo: `App` não desmonta ao trocar de
   * tela, então o recorte SOBREVIVE à navegação. Trocar de tela e ver o
   * recorte mudar sozinho é o tipo de coisa que faz o usuário desconfiar do
   * número.
   *
   * Estado de React puro, descendo por prop: é uma string, lida por uma
   * dúzia de telas e escrita por um controle só (o `<select>` do Shell). Uma
   * biblioteca de estado global — ou até um Context — aqui só acrescentaria
   * indireção a um dado que já tem dono claro e caminho curto, e o projeto
   * inteiro passa dados assim (`papel`, `onSessaoExpirada`).
   */
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_TODOS)
  /**
   * A sessao venceu com o app aberto (algum 401 chegou). NAO desmonta nada:
   * a arvore inteira — Shell, tela, modal com formulario preenchido —
   * continua montada, e o `SessaoExpirada` entra por cima pedindo a senha de
   * novo. Ver o comentario grande em components/SessaoExpirada.tsx.
   */
  const [sessaoExpirada, setSessaoExpirada] = useState(false)

  // Vale para o app inteiro: a roda do mouse nao pode alterar campo
  // numerico focado (ver campoNumerico.ts).
  useEffect(instalarGuardaDeScrollNumerico, [])

  /**
   * O BOOT — e a terceira camada da politica de computador compartilhado.
   *
   * Ao carregar a pagina (inclui F5), pergunta pra API se o cookie de sessao
   * ainda e valido antes de decidir entre tela de login e app. So que o
   * cookie sozinho responde a pergunta errada. Ele e escopo de NAVEGADOR:
   * fechar a aba do CRM e abrir outra devolve a mesma sessao, sem tela de
   * login nenhuma. As duas camadas de 478133f nao pegam isso — a primeira so
   * age ao fechar o navegador inteiro, a segunda so depois de 30 minutos
   * parada.
   *
   * Entao a primeira pergunta nao e "o cookie vale?", e "ESTA ABA ja
   * autenticou alguem?" (marcaDaAba.ts). Sem marca, o cookie que chegou junto
   * e de outra aba, e ele NAO E APENAS IGNORADO: a sessao e encerrada NO
   * SERVIDOR. Esconder a tela e deixar o token vivo seria trocar uma sessao
   * aberta na tela por uma sessao aberta esperando quem souber usar o cookie
   * — e o POST /api/logout apaga a linha de verdade (provado em
   * api/test/janela_sessao.test.ts, nao presumido).
   *
   * A ORDEM IMPORTA. A verificacao da aba vem ANTES de qualquer busca
   * autenticada: nao faz sentido pedir /api/eu (nem, mais adiante, a lista de
   * clientes) com um cookie que se vai invalidar em seguida. Enquanto
   * `estado` for 'verificando' o App nao renderiza nada, entao nenhuma tela
   * chega a montar e disparar fetch proprio.
   *
   * NAO HA `beforeunload`/`pagehide` AQUI, E ISSO E DELIBERADO. Esses eventos
   * disparam tambem em F5 e em navegacao — deslogar por eles derrubaria a
   * sessao a cada recarregamento acidental. O sinal e a AUSENCIA DA MARCA no
   * boot, e a marca sobrevive ao recarregamento; por isso F5 nao desloga.
   *
   * CONSEQUENCIA ACEITA: abrir uma segunda aba do CRM derruba a primeira, que
   * cai no aviso de sessao expirada com o formulario preservado atras. Nao ha
   * excecao para "e a mesma pessoa em duas abas" porque nao existe como
   * distinguir isso de duas pessoas — que e o problema inteiro.
   */
  useEffect(() => {
    if (abaFoiMarcada()) {
      api.get<Eu>('/api/eu')
        .then(dados => { setEu(dados); setEstado('logado') })
        .catch(() => setEstado('deslogado'))
      return
    }
    // O erro e engolido de proposito: sem sessao valida o logout responde
    // 401, e esse e o caso comum (primeira visita, cookie ja expirado). Deu
    // certo ou nao, o destino e o mesmo — tela de login.
    api.post('/api/logout')
      .catch(() => {})
      .finally(() => setEstado('deslogado'))
  }, [])

  /** Identidade estavel: e prop de dezenas de telas, varias delas com
   * `useEffect` que a lista nas dependencias (SaidasLista, EntradasLista...).
   * Uma funcao nova a cada render refaria aqueles fetches sem motivo. */
  const aoExpirar = useCallback(() => setSessaoExpirada(true), [])

  /**
   * SINAL DE PRESENCA (a armadilha do timeout de 30 minutos).
   *
   * A sessao morre por falta de REQUISICAO, e digitar um pedido de vinte
   * itens nao produz requisicao nenhuma. Sem isto, quarenta minutos digitando
   * terminariam num 401 no clique de salvar. Tecla, clique e toque passam a
   * empurrar o vencimento — presenca real, agrupada em no maximo um sinal a
   * cada tres minutos, e ZERO sinais com a pagina parada. Ver presenca.ts.
   *
   * O sinal e o proprio `GET /api/eu`: e a requisicao autenticada mais barata
   * que existe aqui (uma linha, nenhuma juncao) e a renovacao mora no
   * middleware, valendo para qualquer rota — nao ha nada a inventar.
   *
   * So instala com a sessao viva. Deslogado nao ha o que renovar; com o aviso
   * de expiracao na tela, cada tecla digitada no campo de senha viraria uma
   * requisicao que ja se sabe que vai voltar 401.
   */
  useEffect(() => {
    if (estado !== 'logado' || sessaoExpirada) return
    return instalarSinalDePresenca(() => {
      api.get<Eu>('/api/eu').catch(err => {
        if (err instanceof ErroApi && err.status === 401) aoExpirar()
      })
    })
  }, [estado, sessaoExpirada, aoExpirar])

  async function aoEntrar() {
    // A MARCA VEM PRIMEIRO. Ela e o que diz ao proximo boot desta aba
    // (qualquer F5 daqui pra frente) que aqui dentro alguem autenticou de
    // verdade. Gravar depois de `setEstado('logado')` deixaria uma janela em
    // que a area logada esta montada e a aba, aos olhos da politica, ainda e
    // uma aba estranha carregando cookie alheio.
    marcarAba()
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

  /**
   * Encerra a sessao e volta a tela de login LIMPA. E o unico botao de saida
   * do Shell ("Sair"), e serve aos dois motivos pelos quais alguem clica
   * nele num computador compartilhado: o dono saindo no fim do dia e o
   * funcionario que assume a maquina no meio do turno. Ja existiu um segundo
   * botao so para a segunda situacao ("Trocar de usuario") — nasceu quando
   * sair nao levava a uma tela de login limpa, e deixou de fazer sentido
   * quando passou a levar (478133f, sessao morre por aba). Desde entao os
   * dois botoes chamavam esta mesma funcao; hoje so ha um.
   *
   * "LIMPA" e a parte que exige cuidado, e nao e o cookie — e o estado desta
   * funcao. TUDO que veio da sessao anterior e zerado aqui: quem era (`eu`),
   * onde estava (`tela`), o recorte de periodo que ele escolheu (`periodo`) e
   * o aviso de expiracao. Sem zerar `periodo`, o proximo a entrar veria as
   * metricas dele recortadas em "Junho/2026" porque o anterior escolheu
   * junho — um numero errado que ninguem sabe de onde veio. E, como `estado`
   * vira 'deslogado', o `Shell` e as telas DESMONTAM: aqui o descarte da
   * memoria e o objetivo, ao contrario do que acontece no aviso de sessao
   * expirada. O `Login` que aparece e uma montagem nova, com e-mail e senha
   * vazios; o unico campo herdado e o slug da empresa, que vem da URL e e o
   * mesmo para todo mundo daquele hortifruti.
   *
   * `api.post` PRIMEIRO, estado depois: o cookie sozinho nao basta. Apagar o
   * cookie do navegador deixaria o token valido no banco por ate 30 minutos —
   * quem o tivesse copiado continuaria dentro. Quem apaga a sessao de verdade
   * e o DELETE do servidor (POST /api/logout, api/src/index.ts).
   */
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
      setPeriodo(PERIODO_TODOS)
      setSessaoExpirada(false)
      setEstado('deslogado')
    }
  }

  /**
   * Autenticou de novo por cima do aviso de sessao expirada.
   *
   * A pergunta que decide tudo aqui e QUEM entrou. Se for a mesma pessoa, o
   * ponto do aviso e justamente nao ter desmontado nada: fecha a camada e a
   * tela volta como estava, com o formulario preenchido intacto.
   *
   * Se for OUTRA pessoa — e este e o cenario da maquina compartilhada: a
   * sessao do dono vence, o funcionario esta ali e entra com a conta dele —
   * nada do anterior pode sobreviver. Zera tela e periodo, e a `key` do
   * `Shell` (usuarioId, no return) muda, o que desmonta e remonta a arvore
   * inteira. Sem isso o funcionario herdaria a tela aberta do dono, que pode
   * ser Financeiro com salarios na tela — o mesmo vazamento que a politica de
   * sessao existe para fechar, entrando pela porta do lado.
   */
  async function aoReautenticar() {
    // Mesmo motivo de `aoEntrar`: quem autentica NESTA aba marca esta aba.
    // Sao os dois unicos caminhos por onde alguem entra, e a regra tem que
    // valer nos dois — senao uma sessao nascida aqui morreria no F5 seguinte
    // sem que ninguem tivesse fechado aba nenhuma.
    marcarAba()
    try {
      const dados = await api.get<Eu>('/api/eu')
      if (dados.usuarioId !== eu?.usuarioId) {
        setTela(null)
        setPeriodo(PERIODO_TODOS)
      }
      setEu(dados)
      setSessaoExpirada(false)
    } catch {
      // Entrou, mas o /api/eu seguinte falhou: nao da para afirmar quem esta
      // logado, entao vai para o caminho seguro (login limpo) em vez de
      // reexibir a tela do usuario anterior.
      await sair()
    }
  }

  if (estado === 'verificando') return null
  if (estado === 'deslogado') return <Login onEntrar={aoEntrar} />
  if (!eu) return null // inalcancavel: estado só vira 'logado' junto com setEu

  // Primeira tela ao entrar: para o admin, Clientes; para o colaborador,
  // Entradas. Clientes deixou de ser admin-only, entao o colaborador PODE
  // abrir a tela — so nao e onde o dia dele comeca: o trabalho dele e lancar
  // coleta e venda, e Clientes e onde ele vai quando precisa cadastrar ou
  // corrigir alguem. Guarda tambem contra `tela` sobrevivendo de uma sessao
  // anterior com outro papel (Financeiro, por exemplo, continua admin-only).
  const telaPadrao: Tela = eu.papel === 'admin' ? 'clientes' : 'entradas'
  const telaEfetiva: Tela =
    tela && !(ADMIN_ONLY_SCREENS.includes(tela) && eu.papel !== 'admin') ? tela : telaPadrao

  return (
    <>
      {/* `key={eu.usuarioId}`: a arvore e de UM usuario. Trocar de pessoa sem
          recarregar a pagina (o que o aviso de sessao expirada permite) tem
          que jogar fora tudo que estava montado — lista carregada, modal
          aberto, saldo em caixa no cabecalho. Enquanto for a MESMA pessoa a
          chave nao muda e nada desmonta, que e o que preserva o formulario
          preenchido durante a reautenticacao. */}
      <Shell
        key={eu.usuarioId}
        papel={eu.papel}
        telaAtual={telaEfetiva}
        periodo={periodo}
        onPeriodo={setPeriodo}
        onNavegar={setTela}
        onSair={sair}
        onSessaoExpirada={aoExpirar}
      >
        <Conteudo
          tela={telaEfetiva}
          papel={eu.papel}
          periodo={periodo}
          onNavegar={setTela}
          onSessaoExpirada={aoExpirar}
        />
      </Shell>
      {sessaoExpirada && <SessaoExpirada onEntrar={aoReautenticar} onSair={sair} />}
    </>
  )
}

/**
 * Escolhe a tela. As dez telas do menu (mais Veiculos) ja tem case proprio
 * abaixo — `default` fica so como rede de seguranca caso um novo valor
 * apareca em `Tela` (telas.ts) antes do switch ser atualizado, nao porque
 * alguma esteja faltando hoje. Das que nao guardam dado proprio (Saude do
 * Negocio, Financeiro completo, Relatorios e Estoque): as tres primeiras
 * calculam sobre as outras telas, por isso vem depois delas na ordem deste
 * comentario; Estoque agrega entradas, perdas e saidas em SQL num endpoint
 * proprio (GET /api/estoque, ver src/screens/EstoqueLista.tsx).
 *
 * `papel` DESCE PARA TRES TELAS: Clientes, Produtos e Fornecedores. Elas sao
 * hoje as unicas em que admin e colaborador veem a MESMA tela com conteudo
 * diferente — o cadastro e dos dois, as metricas derivadas e o botao de
 * excluir sao so do admin (ver `podeVerMetricasDeCadastro` e
 * `podeExcluirCadastro` em telas.ts, que sao quem decide; aqui so passa o
 * papel adiante). As outras oito continuam sem receber: ou sao inteiras de um
 * papel so (Financeiro, Relatorios, Funcionarios, Veiculos, painel — quem nao
 * pode nem chega aqui, o item some do menu), ou sao iguais para os dois
 * (Entradas, Saidas, Estoque). VeiculosLista ja recebeu `papel` e deixou de
 * receber quando virou admin-only; e o mesmo criterio, aplicado ao contrario.
 */
function Conteudo(
  { tela, papel, periodo, onNavegar, onSessaoExpirada }:
  {
    tela: Tela
    papel: Papel
    periodo: Periodo
    onNavegar: (tela: Tela) => void
    onSessaoExpirada: () => void
  },
) {
  switch (tela) {
    // `onNavegar` e o MESMO `setTela` do menu lateral: o botao do guia de
    // primeiros passos (achado D-2) leva a tela do passo atual exatamente
    // como se o usuario tivesse clicado no item do menu — mesmo destino,
    // mesmo estado, periodo global preservado.
    case 'dashboard':     return <DashboardTela periodo={periodo} onNavegar={onNavegar} onSessaoExpirada={onSessaoExpirada} />
    case 'relatorios':    return <RelatoriosTela periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'clientes':      return <ClientesModulo papel={papel} periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'produtos':      return <ProdutosLista papel={papel} periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'fornecedores':  return <FornecedoresLista papel={papel} periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'funcionarios':  return <FuncionariosLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Veiculos PASSOU A RECEBER periodo. Ela ficou de fora do filtro global
    // em eae52e0 porque era cadastro da frota mais estado atual, sem metrica
    // de fluxo para recortar. Passou a haver uma: o gasto de cada carro no
    // periodo. Sem o recorte, "gasolina" somaria todos os meses da historia
    // sob um cabecalho que diz um mes. O cadastro continua inteiro na tela
    // num periodo sem lancamento — ver o comentario da prop em VeiculosLista.
    case 'veiculos':      return <VeiculosLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'entradas':      return <EntradasLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'pedidos':       return <SaidasLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Lancamentos e a parte de Financeiro que ja existe: a tela completa
    // (resultado, ciclo de caixa) depende de vendas e compras cadastradas.
    case 'financeiro':    return <FinanceiroTela periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Estoque nao guarda dado proprio: e o saldo por produto+unidade
    // (entradas - perdas - saidas, GET /api/estoque) mais o registro de
    // perdas do deposito, que vive dentro de Estoque no design.
    // Estoque continua sem receber periodo: o saldo e uma POSICAO (o que ha
    // no deposito num instante), nao um fluxo do mes. A tela ganhou data
    // PROPRIA — "posicao em", um corte "ate a data" que nao e o intervalo do
    // cabecalho —, e ela mora inteira dentro do componente, sem passar por
    // aqui. Ver o comentario e a nota na propria tela (EstoqueLista.tsx).
    case 'estoque':       return <EstoqueLista onSessaoExpirada={onSessaoExpirada} />
    default:              return <TelaPlaceholder tela={tela} />
  }
}

export default App
