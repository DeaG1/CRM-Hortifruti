import { useEffect, useState, type CSSProperties } from 'react'
import { api, ErroApi } from './api/client'
import { instalarGuardaDeScrollNumerico } from './campoNumerico'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
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
function ClientesModulo({ periodo, onSessaoExpirada }: { periodo: Periodo; onSessaoExpirada: () => void }) {
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
          <ClienteFicha
            key={`${clienteId}:${versao}`}
            id={clienteId}
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
            <ClientesLista key={versao} periodo={periodo} onAbrir={abrirFicha} onSessaoExpirada={onSessaoExpirada} />
          </div>
        )}

      {modal !== undefined && (
        <ModalCliente
          cliente={modal}
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

  // Ao carregar a pagina (inclui F5), pergunta pra API se o cookie de
  // sessao ainda e valido antes de decidir entre tela de login e app.
  // Vale para o app inteiro: a roda do mouse nao pode alterar campo
  // numerico focado (ver campoNumerico.ts).
  useEffect(instalarGuardaDeScrollNumerico, [])

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
      // Tambem usada quando uma chamada autenticada devolve 401 (sessao
      // expirada): o logout no servidor falha (ja nao ha sessao valida),
      // mas o estado local precisa voltar ao login do mesmo jeito.
      if (!(err instanceof ErroApi)) throw err
    } finally {
      setEu(null)
      setTela(null)
      setEstado('deslogado')
    }
  }

  if (estado === 'verificando') return null
  if (estado === 'deslogado') return <Login onEntrar={aoEntrar} />
  if (!eu) return null // inalcancavel: estado só vira 'logado' junto com setEu

  // Primeira tela ao entrar: para o admin, Clientes (a unica tela real desta
  // fase); para o colaborador, Entradas (Clientes é admin-only). Guarda
  // tambem contra `tela` sobrevivendo de uma sessao anterior com outro papel.
  const telaPadrao: Tela = eu.papel === 'admin' ? 'clientes' : 'entradas'
  const telaEfetiva: Tela =
    tela && !(ADMIN_ONLY_SCREENS.includes(tela) && eu.papel !== 'admin') ? tela : telaPadrao

  return (
    <Shell
      papel={eu.papel}
      telaAtual={telaEfetiva}
      periodo={periodo}
      onPeriodo={setPeriodo}
      onNavegar={setTela}
      onSair={sair}
      onSessaoExpirada={sair}
    >
      <Conteudo
        tela={telaEfetiva}
        papel={eu.papel}
        periodo={periodo}
        onNavegar={setTela}
        onSessaoExpirada={sair}
      />
    </Shell>
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
 * `papel` so e repassado adiante pra VeiculosLista: e a unica tela onde
 * admin e colaborador veem a MESMA tela com acoes diferentes (cadastrar e
 * admin, pegar/devolver e qualquer sessao) — as demais telas admin-only
 * simplesmente nao aparecem pro colaborador (ADMIN_ONLY_SCREENS), entao nao
 * precisam saber o papel de quem esta olhando.
 */
function Conteudo(
  { tela, papel, periodo, onNavegar, onSessaoExpirada }:
  { tela: Tela; papel: Papel; periodo: Periodo; onNavegar: (tela: Tela) => void; onSessaoExpirada: () => void },
) {
  switch (tela) {
    // `onNavegar` e o MESMO `setTela` do menu lateral: o botao do guia de
    // primeiros passos (achado D-2) leva a tela do passo atual exatamente
    // como se o usuario tivesse clicado no item do menu — mesmo destino,
    // mesmo estado, periodo global preservado.
    case 'dashboard':     return <DashboardTela periodo={periodo} onNavegar={onNavegar} onSessaoExpirada={onSessaoExpirada} />
    case 'relatorios':    return <RelatoriosTela periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'clientes':      return <ClientesModulo periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'produtos':      return <ProdutosLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'fornecedores':  return <FornecedoresLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'funcionarios':  return <FuncionariosLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Veiculos nao recebe periodo: a tela e o cadastro da frota mais o
    // estado ATUAL de cada carro (quem esta com ele agora). Nao ha metrica
    // de fluxo para recortar — "quem pegou o carro em junho" seria um
    // relatorio de uso que a tela nao tem.
    case 'veiculos':      return <VeiculosLista papel={papel} onSessaoExpirada={onSessaoExpirada} />
    case 'entradas':      return <EntradasLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    case 'pedidos':       return <SaidasLista periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Lancamentos e a parte de Financeiro que ja existe: a tela completa
    // (resultado, ciclo de caixa) depende de vendas e compras cadastradas.
    case 'financeiro':    return <FinanceiroTela periodo={periodo} onSessaoExpirada={onSessaoExpirada} />
    // Estoque nao guarda dado proprio: e o saldo por produto+unidade
    // (entradas - perdas - saidas, GET /api/estoque) mais o registro de
    // perdas do deposito, que vive dentro de Estoque no design.
    // Estoque nao recebe periodo: o saldo e uma POSICAO acumulada (o que ha
    // no deposito agora), nao um fluxo do mes — ver o comentario e a nota na
    // propria tela (EstoqueLista.tsx).
    case 'estoque':       return <EstoqueLista onSessaoExpirada={onSessaoExpirada} />
    default:              return <TelaPlaceholder tela={tela} />
  }
}

export default App
