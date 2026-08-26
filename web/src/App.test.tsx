import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import App from './App'
import { api, ErroApi } from './api/client'
import { rotuloPeriodo } from './derive/periodo'
import { abaFoiMarcada, marcarAba } from './marcaDaAba'
import { JANELA_DE_AGRUPAMENTO_MS } from './presenca'

// Mock de `api.get` e `api.post` — mantem a classe ErroApi real (App e as
// telas fazem `err instanceof ErroApi`). Molde: FinanceiroTela.test.tsx.
// `post` entra porque a sessao agora se encerra pelo servidor: sair e trocar
// de usuario passam por POST /api/logout.
vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>

const SAIDA = {
  id: 's-1', numero: 'S-0001', cliente_id: 'c-1', rota: 'Norte',
  data_pedido: '2026-06-01', entrega: '2026-06-05', status: 'Entregue',
  pag: 'Pago', venc: null, data_pag: '2026-06-06', forma_pag: 'PIX',
  perda_kg: 0, motivo: '', obs: '', valor: 1000, peso: 100,
}

const ENTRADA = {
  id: 'e-1', numero: 'C-1040', fornecedor_id: 'f-1', data: '2026-06-08',
  perda_kg: 0, perda_itens_qtd: 0, motivo: 'transporte', pago: 'Pago',
  data_pag: '2026-06-10', forma_pag: 'PIX', obs: '',
  valor_total: 4000, peso_total: 2000,
}

/** Toda rota que qualquer tela desta navegacao possa pedir. O foco destes
 * testes e o ESTADO do periodo atravessando a troca de tela, nao o conteudo
 * de cada tela — por isso as respostas sao minimas. */
function mockTudo(papel: 'admin' | 'colaborador' = 'admin', usuarioId = 'u-1') {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/eu') return Promise.resolve({ usuarioId, papel })
    if (rota === '/api/saidas') return Promise.resolve([SAIDA])
    if (rota === '/api/entradas') return Promise.resolve([ENTRADA])
    if (rota.startsWith('/api/relatorios/produtos')) return Promise.resolve([])
    return Promise.resolve([])
  })
}

/** O `sessionStorage` real do jsdom, para restaurar depois dos testes que o
 * trocam por um que lança (molde: preferenciaGuia.test.ts). */
const sessionStorageOriginal = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!

function trocarSessionStorage(descritor: PropertyDescriptor) {
  Object.defineProperty(window, 'sessionStorage', { configurable: true, ...descritor })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPost.mockResolvedValue({ ok: true })
  // ESTA ABA JA AUTENTICOU ALGUEM. Desde a terceira camada da politica de
  // sessao (marcaDaAba.ts), o boot so confia no cookie se a aba carregar a
  // marca; sem ela, todo `render(<App />)` deste arquivo cairia na tela de
  // login. Marcada, a aba modela o estado normal de quem entrou e depois
  // recarregou a pagina — que e o que os testes daqui precisam. Os testes da
  // propria camada limpam a marca de proposito.
  trocarSessionStorage(sessionStorageOriginal)
  window.sessionStorage.clear()
  marcarAba()
})

describe('App — o periodo global sobrevive a troca de tela', () => {
  it('escolher um mes e navegar para outra tela mantem o recorte', async () => {
    mockTudo('colaborador')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    // Um mes qualquer da janela oferecida — nao um literal, que envelheceria
    // junto com o relogio.
    const mes = seletor.options[1].value
    fireEvent.change(seletor, { target: { value: mes } })
    expect(seletor.value).toBe(mes)

    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText('Saídas (Vendas)', { selector: '.shell-header-titulo' })
    // O seletor continua no mesmo mes: o estado mora em App, que nao
    // desmonta ao trocar de tela.
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
    // E a tela nova ja abre falando desse recorte.
    expect(screen.getByText(/os filtros abaixo/i)).toHaveTextContent(rotuloPeriodo(mes))

    fireEvent.click(screen.getByRole('button', { name: 'Entradas (Compras)' }))
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
    expect(screen.getByText(/clique numa entrada para editar/i))
      .toHaveTextContent(rotuloPeriodo(mes))
  })

  it('o padrao ao entrar e "Todo o periodo" — nunca um recorte que o usuario nao escolheu', async () => {
    mockTudo('colaborador')
    render(<App />)
    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    expect(seletor.value).toBe('all')
  })

  it('voltar para o mes anterior e navegar de novo continua consistente', async () => {
    mockTudo('colaborador')
    render(<App />)
    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement

    fireEvent.change(seletor, { target: { value: seletor.options[2].value } })
    const mes = seletor.value
    fireEvent.click(screen.getByRole('button', { name: 'Estoque' }))
    await screen.findByText('Estoque', { selector: '.shell-header-titulo' })
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText('Saídas (Vendas)', { selector: '.shell-header-titulo' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
  })
})

describe('App — saldo em caixa por papel', () => {
  it('admin ve o badge de saldo', async () => {
    mockTudo('admin')
    render(<App />)
    expect(await screen.findByText('SALDO EM CAIXA · ACUMULADO')).toBeInTheDocument()
    // 1000 recebido − 4000 pago ao produtor − 0 lancamentos = −3000.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('-R$ 3.000'))
  })

  it('colaborador nao ve o badge em tela nenhuma', async () => {
    mockTudo('colaborador')
    render(<App />)
    await screen.findByLabelText('Período')
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Estoque' }))
    await screen.findByText('Estoque', { selector: '.shell-header-titulo' })
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()
  })
})

// ==================================================================
// POLITICA DE SESSAO NO COMPUTADOR COMPARTILHADO
//
// Admin e funcionarios usam a MESMA maquina. O cookie deixou de ser
// persistente (fechar o navegador exige login) e o servidor derruba a sessao
// depois de 30 minutos de inatividade. Os testes abaixo cobrem as duas
// consequencias disso no front: o sinal de presenca, que impede a sessao de
// cair no meio de um pedido longo sendo digitado, e a troca de usuario, que
// tem que deixar a tela sem NADA de quem estava antes.
// ==================================================================

/** A partir daqui a sessao venceu no servidor: toda chamada volta 401. */
function expirarSessaoNoServidor() {
  mockGet.mockImplementation(() => Promise.reject(new ErroApi(401, { erro: 'sessao invalida' })))
}

/** Preenche e envia o formulario de login — o da entrada ou o que aparece
 * por cima quando a sessao expira (e o mesmo componente nos dois lugares). */
function preencherLogin(email = 'quem@empresa.com') {
  const empresa = screen.queryByLabelText('Empresa')
  if (empresa) fireEvent.change(empresa, { target: { value: 'velasqui' } })
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar no sistema' }))
}

const chamadas = (rota: string) => mockGet.mock.calls.filter(c => c[0] === rota).length

const AVISO_EXPIRADA = 'Sessão expirada por inatividade'

describe('App — o botao Sair tambem serve pra trocar de usuario sem fechar o navegador', () => {
  it('encerra a sessao no SERVIDOR e volta a um login sem residuo do anterior', async () => {
    mockTudo('admin', 'u-dono')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    fireEvent.change(seletor, { target: { value: seletor.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: 'Fornecedores' }))
    await screen.findByText('Fornecedores', { selector: '.shell-header-titulo' })

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    // Apagar o cookie no navegador nao basta: o token tem que morrer no
    // banco, senao quem o copiou continua dentro por mais 30 minutos.
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/logout'))

    // Login limpo: sem e-mail preenchido e sem nada do dono na tela.
    const email = await screen.findByLabelText('E-mail') as HTMLInputElement
    expect(email.value).toBe('')
    expect(screen.getByLabelText('Senha')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Fornecedores' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()

    // O funcionario assume a maquina: comeca na tela dele, no periodo padrao,
    // sem ver nada de admin.
    mockTudo('colaborador', 'u-funcionario')
    preencherLogin('funcionario@empresa.com')

    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe('all')
    expect(screen.queryByRole('button', { name: 'Fornecedores' })).not.toBeInTheDocument()
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()
  })
})

describe('App — a sessao expirar nao pode descartar o que esta na tela', () => {
  it('o aviso entra POR CIMA: o Shell, a tela e o recorte continuam de pe', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    const mes = seletor.options[1].value
    fireEvent.change(seletor, { target: { value: mes } })

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))

    expect(await screen.findByText(AVISO_EXPIRADA)).toBeInTheDocument()
    // O comportamento antigo (onSessaoExpirada = sair) trocava tudo isto pela
    // tela de login e levava junto o formulario que estivesse preenchido.
    expect(screen.getByText('Saídas (Vendas)', { selector: '.shell-header-titulo' }))
      .toBeInTheDocument()
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
  })

  it('reautenticar a MESMA pessoa fecha o aviso sem remontar a tela', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    const mes = seletor.options[1].value
    fireEvent.change(seletor, { target: { value: mes } })

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText(AVISO_EXPIRADA)

    // Quantas vezes a tela de saidas ja buscou os dados dela. Se a arvore
    // remontar na reautenticacao, este numero sobe — e um formulario aberto
    // teria sido zerado junto.
    const buscasAntes = chamadas('/api/saidas')

    mockTudo('colaborador', 'u-func')
    preencherLogin()

    await waitFor(() => expect(screen.queryByText(AVISO_EXPIRADA)).not.toBeInTheDocument())
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe(mes)
    expect(screen.getByText('Saídas (Vendas)', { selector: '.shell-header-titulo' }))
      .toBeInTheDocument()
    expect(chamadas('/api/saidas')).toBe(buscasAntes)
  })

  it('OUTRA pessoa entrando pelo aviso nao herda a tela nem o recorte do anterior', async () => {
    // O cenario da maquina compartilhada: a sessao do dono vence com
    // Fornecedores aberto e o funcionario esta ali. Se a arvore nao remontar,
    // ele herda a tela de admin que estava montada.
    mockTudo('admin', 'u-dono')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    fireEvent.change(seletor, { target: { value: seletor.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: 'Fornecedores' }))
    await screen.findByText('Fornecedores', { selector: '.shell-header-titulo' })

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Produtos' }))
    await screen.findByText(AVISO_EXPIRADA)

    mockTudo('colaborador', 'u-funcionario')
    preencherLogin('funcionario@empresa.com')

    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    expect(screen.queryByText(AVISO_EXPIRADA)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Produtos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fornecedores' })).not.toBeInTheDocument()
    expect(screen.queryByText('SALDO EM CAIXA · ACUMULADO')).not.toBeInTheDocument()
    expect((screen.getByLabelText('Período') as HTMLSelectElement).value).toBe('all')
  })

  it('o funcionario que cai na MESMA tela nao ve os dados carregados pelo dono', async () => {
    // O caso que a `key={eu.usuarioId}` (App.tsx) existe para cobrir. Zerar
    // `tela` nao basta: se o anterior estava em Entradas e o proximo tambem
    // comeca em Entradas, o componente nao desmontaria — e a lista seguiria
    // na tela com as linhas buscadas pela sessao do dono, sem refazer o
    // fetch, porque nenhuma dependencia do efeito mudou.
    mockTudo('admin', 'u-dono')
    render(<App />)
    await screen.findByLabelText('Período')
    fireEvent.click(screen.getByRole('button', { name: 'Entradas (Compras)' }))
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    await waitFor(() => expect(chamadas('/api/entradas')).toBeGreaterThan(0))

    // A sessao vence SEM que ninguem saia da tela — quem descobre e o sinal
    // de presenca. E isto que deixa o dono e o funcionario na MESMA tela
    // ('entradas' e a inicial do colaborador): sem a `key`, React reaproveita
    // o componente que ja estava montado e a lista do dono fica na tela.
    expirarSessaoNoServidor()
    const relogio = vi.spyOn(Date, 'now')
      .mockReturnValue(Date.now() + JANELA_DE_AGRUPAMENTO_MS + 1)
    fireEvent.keyDown(document.body)
    relogio.mockRestore()
    await screen.findByText(AVISO_EXPIRADA)

    mockTudo('colaborador', 'u-funcionario')
    const buscasAntes = chamadas('/api/entradas')
    preencherLogin('funcionario@empresa.com')

    // Mesma tela, outra pessoa: a lista tem que ser buscada de novo, na
    // sessao nova.
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    await waitFor(() => expect(chamadas('/api/entradas')).toBeGreaterThan(buscasAntes))
  })

  it('desistir pelo aviso leva ao login limpo e encerra a sessao no servidor', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText(AVISO_EXPIRADA)

    fireEvent.click(screen.getByRole('button', { name: /Não sou eu/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/logout'))
    await waitFor(() => expect(screen.queryByText(AVISO_EXPIRADA)).not.toBeInTheDocument())
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveValue('')
  })

  it('desistir vale mesmo se a sessao tiver voltado a valer sozinha', async () => {
    // Duas abas abertas na mesma maquina: a outra reautenticou e o cookie
    // voltou a valer enquanto este aviso ainda estava na tela. "Não sou eu"
    // nao pode virar "continuar como o anterior" — quem clicou disse que a
    // sessao aberta nao e dele.
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText(AVISO_EXPIRADA)

    mockTudo('colaborador', 'u-func')
    fireEvent.click(screen.getByRole('button', { name: /Não sou eu/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/logout'))
    expect(await screen.findByLabelText('E-mail')).toHaveValue('')
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
  })

  it('com o aviso na tela, digitar a senha NAO vira sinal de presenca', async () => {
    // O sinal existe para renovar uma sessao viva. Com a sessao ja vencida,
    // cada tecla digitada no campo de senha viraria uma requisicao que se
    // sabe de antemao que volta 401 — o formulario de login batendo no
    // servidor uma vez por janela enquanto a pessoa digita.
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText(AVISO_EXPIRADA)

    const antes = chamadas('/api/eu')
    const relogio = vi.spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 10 * JANELA_DE_AGRUPAMENTO_MS)
    fireEvent.keyDown(document.body)
    fireEvent.keyDown(document.body)
    relogio.mockRestore()

    await waitFor(() => expect(screen.getByText(AVISO_EXPIRADA)).toBeInTheDocument())
    expect(chamadas('/api/eu')).toBe(antes)
  })
})

describe('App — sinal de presenca mantem viva a sessao de quem esta digitando', () => {
  it('tecla depois da janela de agrupamento renova a sessao; antes dela, nao', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')
    await waitFor(() => expect(chamadas('/api/eu')).toBeGreaterThan(0))

    const antes = chamadas('/api/eu')

    // Logo depois de abrir o app a sessao acabou de ser renovada pelo
    // /api/eu da montagem: digitar agora nao gasta requisicao.
    fireEvent.keyDown(document.body)
    expect(chamadas('/api/eu')).toBe(antes)

    // Passada a janela, a mesma tecla vira sinal — e um pedido longo sendo
    // digitado deixa de ser inatividade aos olhos do servidor.
    const relogio = vi.spyOn(Date, 'now')
      .mockReturnValue(Date.now() + JANELA_DE_AGRUPAMENTO_MS + 1)
    fireEvent.keyDown(document.body)
    relogio.mockRestore()

    await waitFor(() => expect(chamadas('/api/eu')).toBe(antes + 1))
  })

  it('se o sinal voltar 401, o aviso aparece — sem desmontar a tela', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')

    expirarSessaoNoServidor()
    const relogio = vi.spyOn(Date, 'now')
      .mockReturnValue(Date.now() + JANELA_DE_AGRUPAMENTO_MS + 1)
    fireEvent.keyDown(document.body)
    relogio.mockRestore()

    expect(await screen.findByText(AVISO_EXPIRADA)).toBeInTheDocument()
    expect(screen.getByLabelText('Período')).toBeInTheDocument()
  })
})

// ==================================================================
// TERCEIRA CAMADA: A SESSAO MORRE AO FECHAR A ABA
//
// As duas camadas anteriores (cookie de sessao e 30 minutos de inatividade)
// deixavam um buraco: cookie e escopo de NAVEGADOR, nao de aba. Fechar a guia
// do CRM e abrir outra devolvia a sessao sem tela de login. Agora a aba que
// autentica se marca (marcaDaAba.ts), e o boot que encontrar cookie SEM marca
// encerra a sessao no SERVIDOR antes de qualquer outra coisa.
//
// Os testes abaixo cobrem tanto o que a camada tem que fazer quanto os tres
// jeitos classicos de errar isso: deslogar no F5, deslogar ao navegar, e
// falhar ABERTO quando o armazenamento nao esta disponivel.
// ==================================================================

/** Modela ABRIR UMA ABA NOVA. O que separa uma aba da outra, para efeito
 * desta politica, e uma coisa so: `sessionStorage` e por aba e nasce vazio,
 * enquanto o COOKIE e do navegador e chega igual nas duas. jsdom tem uma
 * janela so, entao "abrir aba nova" aqui e limpar o armazenamento antes de
 * montar o App — que e exatamente o estado com que a aba nova chegaria. */
function abaNova() {
  window.sessionStorage.clear()
}

const logoutsPedidos = () => mockPost.mock.calls.filter(c => c[0] === '/api/logout').length

describe('App — aba sem marca nao herda a sessao de outra aba', () => {
  it('encerra a sessao no SERVIDOR e exige login, mesmo com o cookie valido', async () => {
    // `mockTudo` significa que o cookie ainda vale: /api/eu responderia 200.
    // E justamente esse o caso perigoso — o cookie vale, e nao deveria valer
    // NESTA aba.
    mockTudo('admin', 'u-dono')
    abaNova()
    render(<App />)

    expect(await screen.findByLabelText('E-mail')).toHaveValue('')
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()

    // Mostrar a tela de login e esconder o app NAO basta: um cookie que
    // continua valendo no servidor e uma sessao viva esperando quem souber
    // usa-la. Quem apaga a linha e o POST /api/logout.
    expect(mockPost).toHaveBeenCalledWith('/api/logout')

    // E a ORDEM: a verificacao da aba correu antes de qualquer busca
    // autenticada. Nao se carrega dado com um cookie que se vai invalidar na
    // linha seguinte.
    expect(chamadas('/api/eu')).toBe(0)
  })

  it('a aba MARCADA nao encerra nada — o cookie e dela', async () => {
    // A outra metade da regra. Sem este teste, "encerrar sempre" passaria
    // pelo teste de cima e ninguem conseguiria usar o sistema.
    mockTudo('admin', 'u-dono')
    render(<App />)

    await screen.findByLabelText('Período')
    expect(logoutsPedidos()).toBe(0)
  })

  it('logout que falha nao devolve a aba ao app — continua exigindo login', async () => {
    // Falha fechada tambem aqui: se o servidor nao responder, a sessao pode
    // ter sobrevivido no banco, mas quem esta na frente da tela digita a
    // senha do mesmo jeito.
    mockTudo('admin', 'u-dono')
    mockPost.mockRejectedValue(new ErroApi(500, { erro: 'indisponivel' }))
    abaNova()
    render(<App />)

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
  })

  it('sessionStorage indisponivel exige login mesmo com cookie valido (falha fechada)', async () => {
    // Navegador com armazenamento de sites bloqueado: o proprio acesso a
    // `window.sessionStorage` lanca, antes de qualquer leitura. Se a excecao
    // fosse tratada como "esta tudo bem", a politica falharia ABERTA — e
    // falhar aberto aqui e entregar a sessao do dono.
    mockTudo('admin', 'u-dono')
    trocarSessionStorage({ get() { throw new DOMException('acesso negado', 'SecurityError') } })
    render(<App />)

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith('/api/logout')
    expect(chamadas('/api/eu')).toBe(0)
  })
})

describe('App — o que NAO pode deslogar', () => {
  it('recarregar a pagina (F5) nao desloga', async () => {
    // O erro classico desta camada e usar `beforeunload`/`pagehide` para
    // detectar o fechamento da aba: esses eventos disparam identicos no F5, e
    // um F5 acidental derrubaria a sessao no meio de um pedido. Aqui a
    // deteccao e a AUSENCIA DA MARCA no boot — e a marca sobrevive a recarga.
    mockTudo('colaborador', 'u-func')
    abaNova()
    const aba = render(<App />)

    // Entra pela tela de login desta aba: e o login que grava a marca.
    await screen.findByLabelText('E-mail')
    preencherLogin()
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    const logoutsAntesDoF5 = logoutsPedidos()

    // O F5. Recarregar joga fora TODO o estado de JavaScript (por isso
    // desmontar e montar de novo) e PRESERVA o sessionStorage (por isso a
    // marca nao e tocada). E esse par que define o comportamento a provar.
    aba.unmount()
    render(<App />)

    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
    expect(logoutsPedidos()).toBe(logoutsAntesDoF5)
  })

  it('recarregar dez vezes seguidas continua sem deslogar', async () => {
    // A marca nao pode ser de uso unico: quem trabalha o dia inteiro recarrega
    // a pagina varias vezes, e cada recarga passa pelo mesmo boot.
    mockTudo('colaborador', 'u-func')
    let aba = render(<App />)
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })

    for (let i = 0; i < 10; i++) {
      aba.unmount()
      aba = render(<App />)
      await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })
    }
    expect(logoutsPedidos()).toBe(0)
  })

  it('navegar entre telas pelo menu nao desloga', async () => {
    // Trocar de tela e troca de estado em React, nao boot: a verificacao da
    // aba roda UMA vez, na montagem do App. Se ela morasse em algum lugar que
    // reavalia a cada navegacao, o primeiro clique no menu derrubaria a
    // sessao.
    mockTudo('admin', 'u-dono')
    render(<App />)
    await screen.findByLabelText('Período')

    for (const item of ['Fornecedores', 'Produtos', 'Entradas (Compras)', 'Saídas (Vendas)']) {
      fireEvent.click(screen.getByRole('button', { name: item }))
      await screen.findByText(item, { selector: '.shell-header-titulo' })
    }

    expect(logoutsPedidos()).toBe(0)
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })
})

describe('App — quem autentica marca a aba', () => {
  it('login bem-sucedido grava a marca', async () => {
    mockTudo('colaborador', 'u-func')
    abaNova()
    render(<App />)

    await screen.findByLabelText('E-mail')
    expect(abaFoiMarcada()).toBe(false)

    preencherLogin()
    await screen.findByText('Entradas (Compras)', { selector: '.shell-header-titulo' })

    // Sem esta gravacao, o proximo F5 desta mesma aba a trataria como aba
    // estranha e encerraria a sessao que acabou de nascer.
    expect(abaFoiMarcada()).toBe(true)
  })

  it('reautenticar por cima do aviso de sessao expirada tambem marca', async () => {
    mockTudo('colaborador', 'u-func')
    render(<App />)
    await screen.findByLabelText('Período')

    expirarSessaoNoServidor()
    fireEvent.click(screen.getByRole('button', { name: 'Saídas (Vendas)' }))
    await screen.findByText(AVISO_EXPIRADA)

    // A aba perdeu a marca no meio do caminho (dados do site limpos, por
    // exemplo). O segundo caminho de autenticacao do sistema tem que marcar
    // igual ao primeiro: quem entra AQUI e dono de uma sessao nova, e o F5
    // seguinte nao pode derrubar uma sessao que ninguem abandonou.
    window.sessionStorage.clear()
    mockTudo('colaborador', 'u-func')
    preencherLogin()

    await waitFor(() => expect(screen.queryByText(AVISO_EXPIRADA)).not.toBeInTheDocument())
    expect(abaFoiMarcada()).toBe(true)
  })
})

describe('App — a segunda aba derruba a primeira (consequencia aceita)', () => {
  it('a primeira cai no aviso por cima, com o formulario preenchido intacto', async () => {
    // O dono pediu "o mais chato possivel", e isto e o preco: nao ha como
    // distinguir "a mesma pessoa abriu duas abas" de "outra pessoa abriu uma
    // aba", que e o problema inteiro. O que da para garantir e que a primeira
    // aba caia BEM — sem levar junto o que estava digitado.
    mockTudo('admin', 'u-dono')
    const aba1 = render(<App />)
    const em1 = within(aba1.container)
    await em1.findByLabelText('Período')

    // O dono esta no meio de um cadastro: modal aberto, nome ja digitado.
    fireEvent.click(em1.getByRole('button', { name: /Novo cliente/ }))
    fireEvent.change(em1.getByLabelText('Nome do estabelecimento'),
      { target: { value: 'Mercado do Zé' } })

    // O funcionario abre o CRM numa aba nova. Ela nasce sem marca e com o
    // MESMO cookie — cookie e do navegador — entao encerra a sessao no
    // servidor. (A aba 1 nao volta a ler a marca: ela nao faz boot de novo.)
    abaNova()
    const aba2 = render(<App />)
    const em2 = within(aba2.container)
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/logout'))
    expect(await em2.findByLabelText('E-mail')).toHaveValue('')

    // A partir daqui o token esta morto no banco. A aba 1 descobre na
    // primeira requisicao que fizer — aqui, o sinal de presenca.
    expirarSessaoNoServidor()
    const relogio = vi.spyOn(Date, 'now')
      .mockReturnValue(Date.now() + JANELA_DE_AGRUPAMENTO_MS + 1)
    fireEvent.keyDown(document.body)
    relogio.mockRestore()

    // A aba 1 CAI — mas no aviso por cima, nao na tela de login: a arvore
    // continua montada e o que estava digitado continua la, byte por byte.
    expect(await em1.findByText(AVISO_EXPIRADA)).toBeInTheDocument()
    expect(em1.getByLabelText('Nome do estabelecimento')).toHaveValue('Mercado do Zé')
    expect(em1.getByLabelText('Período')).toBeInTheDocument()
  })
})
