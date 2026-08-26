import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FuncionariosLista } from './FuncionariosLista'
import { api, ErroApi } from '../api/client'
import type { Funcionario } from '../derive/funcionarios'
import type { Lancamento } from '../derive/lancamentos'

// Mock so de `api.get/post/put/del` — mantem a classe ErroApi real (o
// componente e os modais fazem `err instanceof ErroApi`, precisa ser o mesmo
// construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  }
})

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockDel = api.del as unknown as ReturnType<typeof vi.fn>

const CATEGORIAS = ['Frete', 'Gasolina', 'Salário', 'Adiantamento de salário']

const funcionario = (over: Partial<Funcionario> = {}): Funcionario => ({
  id: '1', nome: 'João Pereira', cargo: 'Motorista', tel: '(41) 99900-1122',
  salario: 2200, dia_pag: 5, ativo: true, ...over,
})

const lanc = (over: Partial<Lancamento> = {}): Lancamento => ({
  id: 'l1', data: '2026-06-10', categoria: 'Adiantamento de salário',
  descricao: '', valor: 0, funcionario_id: '1', veiculo_id: null, ...over,
})

/** Resolve as tres rotas que a tela busca (/api/funcionarios sozinha, e
 * /api/lancamentos + /categorias no Promise.all que falha isolado). */
function mockCarga(funcionarios: Funcionario[], lancamentos: Lancamento[] = []) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/funcionarios') return Promise.resolve(funcionarios)
    if (rota === '/api/lancamentos') return Promise.resolve(lancamentos)
    if (rota === '/api/lancamentos/categorias') return Promise.resolve(CATEGORIAS)
    return Promise.reject(new Error('rota inesperada: ' + rota))
  })
}

/** Mesma carga, mas com /api/lancamentos fora do ar (o cadastro continua). */
function mockCargaSemLancamentos(funcionarios: Funcionario[]) {
  mockGet.mockImplementation((rota: string) => {
    if (rota === '/api/funcionarios') return Promise.resolve(funcionarios)
    return Promise.reject(new Error('502'))
  })
}

/** O valor exibido logo abaixo de um rotulo de coluna ('ADIANTADO', 'PAGO'…). */
function valorDaColuna(rotulo: string): string {
  const label = screen.getAllByText(rotulo)[0]
  return label.nextElementSibling?.textContent ?? ''
}

/** O cartao de resumo com este titulo (o rotulo "A pagar" tambem aparece na
 * nota de rodape, por isso a busca e restrita aos rotulos de cartao). */
function cartao(titulo: string): HTMLElement {
  const label = screen.getAllByText(titulo).find(el => el.classList.contains('funcionarios-cartao-label'))
  if (!label) throw new Error('cartão não encontrado: ' + titulo)
  return label.parentElement as HTMLElement
}

/** A linha do funcionario e um botao expansivel — o unico com aria-expanded. */
function linhaDe(nome: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(nome), expanded: false })
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPut.mockReset()
  mockDel.mockReset()
})

describe('FuncionariosLista — os quatro estados', () => {
  it('carregando: mostra indicador enquanto a chamada esta pendente', () => {
    mockGet.mockReturnValue(new Promise(() => {})) // nunca resolve nesta suite
    render(<FuncionariosLista />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('erro: mostra alerta quando a API falha por motivo != sessao expirada', async () => {
    mockGet.mockRejectedValue(new Error('falha de rede'))
    render(<FuncionariosLista />)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar os funcionários.')
  })

  it('vazio: mostra "nenhum funcionário cadastrado" quando a API devolve lista vazia', async () => {
    mockCarga([])
    render(<FuncionariosLista />)
    expect(await screen.findByText(/nenhum funcionário cadastrado/i)).toBeInTheDocument()
  })

  it('com dados: lista os funcionarios recebidos', async () => {
    mockCarga([
      funcionario({ id: '1', nome: 'João Pereira' }),
      funcionario({ id: '2', nome: 'Maria Souza' }),
    ])
    render(<FuncionariosLista />)
    expect(await screen.findByText('João Pereira')).toBeInTheDocument()
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
  })
})

describe('FuncionariosLista — sessao expirada (401)', () => {
  it('chama onSessaoExpirada em vez de mostrar a mensagem de erro generica', async () => {
    mockGet.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(<FuncionariosLista onSessaoExpirada={onSessaoExpirada} />)
    // toHaveBeenCalled (nao ...Once): sao duas buscas independentes (cadastro
    // e folha) e as duas levam 401 — mesmo padrao de ClientesLista.test.tsx.
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FuncionariosLista — dados exibidos', () => {
  it('mostra cargo e telefone juntos, salario formatado e status do proximo pagamento', async () => {
    mockCarga([funcionario({ salario: 2200, dia_pag: 5 })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('Motorista · (41) 99900-1122')).toBeInTheDocument()
    expect(valorDaColuna('SALÁRIO')).toBe('R$ 2.200,00')
    expect(screen.getByText('PRÓXIMO PAGAMENTO')).toBeInTheDocument()
  })

  it('funcionario inativo mostra selo "Inativo"', async () => {
    mockCarga([funcionario({ ativo: false })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })

  it('funcionario ativo nao mostra selo "Inativo"', async () => {
    mockCarga([funcionario({ ativo: true })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.queryByText('Inativo')).not.toBeInTheDocument()
  })

  it('mostra a nota de rodape com a formula do "a pagar"', async () => {
    mockCarga([funcionario()])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(
      screen.getByText(/= salário − adiantamentos − salários pagos no período/i),
    ).toBeInTheDocument()
  })
})

describe('FuncionariosLista — as quatro colunas de dinheiro', () => {
  it('salario, adiantado, pago e a pagar com dado real', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2200 })],
      [
        lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 500, data: '2026-06-10' }),
        lanc({ id: 'b', categoria: 'Salário', valor: 1000, data: '2026-06-05' }),
      ],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('SALÁRIO')).toBe('R$ 2.200,00')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 500,00')
    expect(valorDaColuna('PAGO')).toBe('R$ 1.000,00')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 700,00')
  })

  it('funcionario sem lancamento nenhum: zeros medidos (R$ 0,00), nao travessao', async () => {
    mockCarga([funcionario({ id: '1', salario: 2200 })], [])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 0,00')
    expect(valorDaColuna('PAGO')).toBe('R$ 0,00')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 2.200,00')
  })

  it('adiantamento sem salario pago', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2200 })],
      [lanc({ categoria: 'Adiantamento de salário', valor: 500 })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 500,00')
    expect(valorDaColuna('PAGO')).toBe('R$ 0,00')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 1.700,00')
  })

  it('salario pago sem adiantamento: quitado, sem botao de pagar', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2200 })],
      [lanc({ categoria: 'Salário', valor: 2200 })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 0,00')
    expect(valorDaColuna('PAGO')).toBe('R$ 2.200,00')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 0,00')
    expect(screen.getByText('salário do mês quitado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar salário/i })).not.toBeInTheDocument()
  })

  it('adiantou mais que o salario: "a pagar" fica R$ 0,00 (nunca negativo) e o excesso aparece ao expandir', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2000 })],
      [lanc({ categoria: 'Adiantamento de salário', valor: 2300 })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 0,00')
    expect(screen.queryByText(/R\$ -/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar salário/i })).not.toBeInTheDocument()

    fireEvent.click(linhaDe('João Pereira'))
    expect(screen.getByText(/além do salário do período/i)).toHaveTextContent('R$ 300,00')
  })

  it('"Pagar salário" aparece exatamente quando ha a pagar > 0', async () => {
    mockCarga(
      [
        funcionario({ id: '1', nome: 'João Pereira', salario: 2200 }),
        funcionario({ id: '2', nome: 'Maria Souza', salario: 1800 }),
      ],
      [lanc({ id: 'b', categoria: 'Salário', valor: 1800, funcionario_id: '2' })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByRole('button', { name: /pagar salário — joão pereira/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar salário — maria souza/i })).not.toBeInTheDocument()
    expect(screen.getByText('salário do mês quitado')).toBeInTheDocument()
  })
})

describe('FuncionariosLista — os quatro cartoes', () => {
  it('mostra contagem, folha mensal, adiantado no periodo e a pagar', async () => {
    mockCarga(
      [
        funcionario({ id: '1', nome: 'João Pereira', salario: 2200 }),
        funcionario({ id: '2', nome: 'Maria Souza', salario: 1800 }),
      ],
      [
        lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 300, funcionario_id: '1' }),
        lanc({ id: 'b', categoria: 'Salário', valor: 1800, funcionario_id: '2' }),
      ],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(cartao('Funcionários')).toHaveTextContent('2')
    expect(cartao('Funcionários')).toHaveTextContent('cadastrados')
    expect(cartao('Folha mensal')).toHaveTextContent('R$ 4.000,00')
    expect(cartao('Folha mensal')).toHaveTextContent('soma dos salários')
    expect(cartao('Adiantado no período')).toHaveTextContent('R$ 300,00')
    expect(cartao('A pagar')).toHaveTextContent('R$ 1.900,00') // 4000 − 300 − 1800
    expect(cartao('A pagar')).toHaveTextContent('salários − adiantado − pago')
  })
})

// O seletor de periodo desta tela deixou de existir: o recorte agora vem do
// cabecalho global (achado S-3), por prop. Ver o comentario da prop `periodo`
// em FuncionariosLista.tsx para o porque de nao conviverem dois seletores.
describe('FuncionariosLista — periodo global', () => {
  it('so conta os lancamentos do periodo recebido', async () => {
    const dados: Parameters<typeof mockCarga> = [
      [funcionario({ id: '1', salario: 2200 })],
      [
        lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 500, data: '2026-06-10' }),
        lanc({ id: 'b', categoria: 'Adiantamento de salário', valor: 900, data: '2026-05-10' }),
      ],
    ]

    mockCarga(...dados)
    const semRecorte = render(<FuncionariosLista periodo="all" />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 1.400,00')
    // O cartao de resumo sai da MESMA base que a coluna — os dois tem de
    // concordar com o recorte, nao so a tabela.
    expect(cartao('Adiantado no período')).toHaveTextContent('R$ 1.400,00')
    semRecorte.unmount()

    mockCarga(...dados)
    render(<FuncionariosLista periodo="2026-05" />)
    await screen.findByText('João Pereira')
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 900,00')
    expect(valorDaColuna('A PAGAR')).toBe('R$ 1.300,00')
    expect(cartao('Adiantado no período')).toHaveTextContent('R$ 900,00')
    expect(cartao('Adiantado no período')).toHaveTextContent('Maio/2026')
  })

  it('nao tem mais seletor proprio de periodo', async () => {
    mockCarga([funcionario({ id: '1' })], [lanc({ id: 'a', data: '2026-06-10', valor: 100 })])
    render(<FuncionariosLista periodo="all" />)
    await screen.findByText('João Pereira')
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
  })

  it('o CADASTRO nao some num periodo sem folha nenhuma', async () => {
    mockCarga(
      [funcionario({ id: '1' })],
      [lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 500, data: '2026-06-10' })],
    )
    render(<FuncionariosLista periodo="2026-01" />)
    // O funcionario continua listado, so sem adiantamento no periodo.
    expect(await screen.findByText('João Pereira')).toBeInTheDocument()
    expect(valorDaColuna('ADIANTADO')).toBe('R$ 0,00')
  })
})

describe('FuncionariosLista — linha expansivel', () => {
  it('clicar na linha abre o detalhe com dia do pagamento, saldo e historico', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2200, dia_pag: 5 })],
      [
        lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 500, data: '2026-06-10', descricao: 'vale do mês' }),
        lanc({ id: 'b', categoria: 'Salário', valor: 1000, data: '2026-06-05' }),
      ],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.queryByText('todo dia 5')).not.toBeInTheDocument()

    fireEvent.click(linhaDe('João Pereira'))
    expect(screen.getByText('todo dia 5')).toBeInTheDocument()
    expect(screen.getByText('ÚLTIMO SALÁRIO PAGO')).toBeInTheDocument()
    expect(screen.getByText('SALDO A PAGAR')).toBeInTheDocument()
    expect(screen.getByText(/HISTÓRICO/)).toHaveTextContent('2 lançamento(s) no período')
    expect(screen.getByText('vale do mês')).toBeInTheDocument()
  })

  it('funcionario sem lancamento: detalhe diz que nao ha nada no periodo', async () => {
    mockCarga([funcionario({ id: '1' })], [])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(linhaDe('João Pereira'))
    expect(screen.getByText(/Nenhum adiantamento ou salário lançado neste período/i)).toBeInTheDocument()
    expect(screen.getByText('nunca')).toBeInTheDocument()
  })

  it('clicar num lancamento do historico abre o modal de edicao daquele lancamento', async () => {
    mockCarga(
      [funcionario({ id: '1' })],
      [lanc({ id: 'a', categoria: 'Adiantamento de salário', valor: 500, descricao: 'vale do mês' })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(linhaDe('João Pereira'))
    fireEvent.click(screen.getByText('vale do mês'))
    expect(screen.getByRole('dialog', { name: 'Editar lançamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toHaveValue('vale do mês')
  })
})

describe('FuncionariosLista — Adiantar e Pagar salario', () => {
  it('"Adiantar" abre o modal de lancamento com categoria e funcionario ja preenchidos', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira' })], [])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /adiantar — joão pereira/i }))

    expect(screen.getByRole('dialog', { name: 'Novo lançamento' })).toBeInTheDocument()
    expect(screen.getByLabelText('Categoria')).toHaveValue('Adiantamento de salário')
    expect(screen.getByLabelText('Funcionário')).toHaveValue('1')
  })

  it('"Pagar salário" abre o modal com categoria Salário e o valor que falta', async () => {
    mockCarga(
      [funcionario({ id: '1', salario: 2200 })],
      [lanc({ categoria: 'Adiantamento de salário', valor: 200 })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /pagar salário/i }))

    expect(screen.getByLabelText('Categoria')).toHaveValue('Salário')
    expect(screen.getByLabelText('Funcionário')).toHaveValue('1')
    expect(screen.getByLabelText(/valor/i)).toHaveValue(2000)
    expect((screen.getByLabelText(/descrição/i) as HTMLInputElement).value).toMatch(/^Salário — \p{Ll}+$/u)
  })

  it('salvar o adiantamento atualiza as colunas sem refetch', async () => {
    mockCarga([funcionario({ id: '1', salario: 2200 })], [])
    mockPost.mockResolvedValue(lanc({ id: 'novo', categoria: 'Adiantamento de salário', valor: 400 }))
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /adiantar — joão pereira/i }))
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(valorDaColuna('ADIANTADO')).toBe('R$ 400,00'))
    expect(valorDaColuna('A PAGAR')).toBe('R$ 1.800,00')
    expect(mockGet).toHaveBeenCalledTimes(3) // so a carga inicial, nenhum refetch
  })
})

describe('FuncionariosLista — /api/lancamentos fora do ar (falha isolada)', () => {
  it('mantem a lista visivel, poe travessao nas colunas derivadas e avisa', async () => {
    mockCargaSemLancamentos([funcionario({ id: '1', salario: 2200, dia_pag: 5 })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')

    // o cadastro continua todo la
    expect(screen.getByText('Motorista · (41) 99900-1122')).toBeInTheDocument()
    expect(valorDaColuna('SALÁRIO')).toBe('R$ 2.200,00')
    expect(screen.getByText('PRÓXIMO PAGAMENTO')).toBeInTheDocument()

    // e o que dependia de lancamento vira travessao — nunca R$ 0,00
    await waitFor(() => expect(valorDaColuna('ADIANTADO')).toBe('—'))
    expect(valorDaColuna('PAGO')).toBe('—')
    expect(valorDaColuna('A PAGAR')).toBe('—')
    expect(cartao('Adiantado no período')).toHaveTextContent('—')
    expect(cartao('A pagar')).toHaveTextContent('—')
    expect(cartao('Folha mensal')).toHaveTextContent('R$ 2.200,00') // essa nao depende

    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent('Não foi possível carregar os lançamentos da folha')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('nao oferece Adiantar/Pagar sem a lista fechada de categorias, mas mantem Editar', async () => {
    mockCargaSemLancamentos([funcionario({ id: '1' })])
    render(<FuncionariosLista />)
    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: /adiantar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar salário/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editar — joão pereira/i })).toBeInTheDocument()
  })

  it('"último salário pago" fica em travessao, nao "nunca"', async () => {
    mockCargaSemLancamentos([funcionario({ id: '1' })])
    render(<FuncionariosLista />)
    await screen.findByRole('status')
    fireEvent.click(linhaDe('João Pereira'))
    expect(screen.queryByText('nunca')).not.toBeInTheDocument()
    expect(screen.getByText(/lançamentos não puderam ser carregados/i)).toBeInTheDocument()
  })
})

describe('FuncionariosLista — criar', () => {
  it('clicar em "Novo funcionário" abre o modal de criacao', async () => {
    mockCarga([])
    render(<FuncionariosLista />)
    await screen.findByText(/nenhum funcionário cadastrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo funcionário/i }))
    expect(screen.getByRole('dialog', { name: 'Novo funcionário' })).toBeInTheDocument()
  })

  it('salvar no modal acrescenta o funcionario na lista sem refetch', async () => {
    mockCarga([])
    mockPost.mockResolvedValue(funcionario({ id: 'novo', nome: 'Recém-contratado' }))
    render(<FuncionariosLista />)
    await screen.findByText(/nenhum funcionário cadastrado/i)
    fireEvent.click(screen.getByRole('button', { name: /novo funcionário/i }))
    fireEvent.change(screen.getByLabelText(/nome do funcionário/i), { target: { value: 'Recém-contratado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('Recém-contratado')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledTimes(3) // so a carga inicial, nenhum refetch
  })
})

describe('FuncionariosLista — editar', () => {
  it('clicar na linha expande em vez de abrir o modal de edicao', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira' })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(linhaDe('João Pereira'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('DIA DO PAGAMENTO')).toBeInTheDocument()
  })

  it('"Editar" abre o modal preenchido com os dados do funcionario', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira', cargo: 'Motorista' })])
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /editar — joão pereira/i }))
    expect(screen.getByRole('dialog', { name: 'Editar funcionário' })).toBeInTheDocument()
    expect(screen.getByLabelText(/nome do funcionário/i)).toHaveValue('João Pereira')
    expect(screen.getByLabelText(/cargo/i)).toHaveValue('Motorista')
  })

  it('salvar a edicao atualiza a linha na lista', async () => {
    mockCarga([funcionario({ id: '1', nome: 'João Pereira', salario: 2200 })])
    mockPut.mockResolvedValue(funcionario({ id: '1', nome: 'João Pereira', salario: 2500 }))
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /editar — joão pereira/i }))
    fireEvent.change(screen.getByLabelText(/salário mensal/i), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(valorDaColuna('SALÁRIO')).toBe('R$ 2.500,00'))
  })
})

describe('FuncionariosLista — excluir', () => {
  it('excluir com sucesso remove o funcionario da lista', async () => {
    mockCarga([
      funcionario({ id: '1', nome: 'João Pereira' }),
      funcionario({ id: '2', nome: 'Maria Souza' }),
    ])
    mockDel.mockResolvedValue({ ok: true })
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    fireEvent.click(screen.getByRole('button', { name: /editar — joão pereira/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() => expect(screen.queryByText('João Pereira')).not.toBeInTheDocument())
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
  })
})

describe('FuncionariosLista — proximo pagamento', () => {
  it('usa o ultimo lancamento de Salario do funcionario pra calcular a proxima data', async () => {
    // dia_pag 5, ultimo salario pago em 30/05 -> proxima data 05/06
    mockCarga(
      [funcionario({ id: '1', dia_pag: 5 })],
      [lanc({ id: 'l1', data: '2026-05-30', categoria: 'Salário', funcionario_id: '1' })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    expect(screen.getByText('05/06')).toBeInTheDocument()
  })

  it('ignora lancamentos de outros funcionarios ao calcular o ultimo salario pago', async () => {
    mockCarga(
      [funcionario({ id: '1', dia_pag: 5 })],
      [lanc({ id: 'l1', data: '2026-06-20', categoria: 'Salário', funcionario_id: '2' })],
    )
    render(<FuncionariosLista />)
    await screen.findByText('João Pereira')
    // sem lancamento de Salario do funcionario 1: nao pode ser 20/07 (mes
    // seguinte ao lancamento do funcionario 2) — usa o ramo "nunca pago".
    expect(screen.queryByText('20/07')).not.toBeInTheDocument()
  })
})
