import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App'
import { api, ErroApi } from './api/client'
import { rotuloPeriodo } from './derive/periodo'
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

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPost.mockResolvedValue({ ok: true })
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

describe('App — trocar de usuario sem fechar o navegador', () => {
  it('encerra a sessao no SERVIDOR e volta a um login sem residuo do anterior', async () => {
    mockTudo('admin', 'u-dono')
    render(<App />)

    const seletor = await screen.findByLabelText('Período') as HTMLSelectElement
    fireEvent.change(seletor, { target: { value: seletor.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: 'Fornecedores' }))
    await screen.findByText('Fornecedores', { selector: '.shell-header-titulo' })

    fireEvent.click(screen.getByRole('button', { name: 'Trocar de usuário' }))

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
