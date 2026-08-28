import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalCliente } from './ModalCliente'
import { api, ErroApi } from '../api/client'
import type { Cliente } from '../derive/clientes'

// Mock so de `api.post/put` — mantem a classe ErroApi real (o componente faz
// `err instanceof ErroApi`, precisa ser o mesmo construtor dos dois lados).
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), put: vi.fn() } }
})

const mockPost = api.post as unknown as ReturnType<typeof vi.fn>
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>
const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

/** O que `GET /api/funcionarios/opcoes` devolve — id e nome, nada mais. */
const OPCOES = [
  { id: 'f-1', nome: 'Ana Souza' },
  { id: 'f-2', nome: 'João da Silva' },
]

const clienteExistente: Cliente = {
  id: 'abc-1',
  nome: 'Mercado Bom Preço',
  resp: 'Sonia',
  cnpj: '11.111.111/0001-11',
  tel: '(41) 99999-0000',
  email: 'contato@bp.com',
  endereco: 'Rua X, 100',
  rota: 'Leste B',
  freq: 'Diária',
  status: 'inadimplente',
  cobranca: 'Atrasado',
  forma: 'Boleto',
  limite: 500,
  prazo: 30,
  tend: '↓',
  obs: 'Cliente antigo',
}

// `papel="admin"` em todos os casos abaixo: eles descrevem o formulario
// SEM os campos de declaracao de autoria — que e exatamente o formulario do
// admin (o login dele e individual, o sistema ja sabe quem e). O que o
// colaborador ve, e o que ele nao consegue salvar sem preencher, esta no
// bloco proprio no fim deste arquivo.

beforeEach(() => {
  mockPost.mockReset()
  mockPut.mockReset()
  mockGet.mockReset()
  // Todo teste ganha a lista carregada; quem precisar de falha sobrescreve.
  mockGet.mockResolvedValue(OPCOES)
})

describe('ModalCliente — criação (valores padrão)', () => {
  it('mostra os valores padrao do formulario ao criar', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/regi[aã]o.*rota/i)).toHaveValue('Sul A')
    expect(screen.getByLabelText(/frequ[eê]ncia/i)).toHaveValue('2×/sem · Seg e Qui')
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('ativo')
    expect(screen.getByLabelText(/forma de pagamento/i)).toHaveValue('PIX')
    // limite comeca vazio (nao 0) — abrir com 0 ja escrito faz quem digita
    // esquecer de apagar o zero primeiro e gravar "0250" em vez de "250"
    // (bug real reportado pelo dono do produto). O placeholder ensina o
    // formato/grandeza esperada no lugar do zero.
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveValue(null)
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveAttribute('placeholder', 'Ex.: 5000')
    // prazo mantem o default 14 — e uma sugestao util (prazo comum de
    // pagamento), nao um zero atrapalhando a digitacao.
    expect(screen.getByLabelText(/prazo de pagamento/i)).toHaveValue(14)
    expect(screen.getByLabelText(/tend[eê]ncia/i)).toHaveValue('→')
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveValue('')
  })

  it('foca o campo nome ao abrir', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveFocus()
  })

  it('titulo do dialogo indica criacao', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
  })
})

describe('ModalCliente — validação de nome', () => {
  it('nome vazio: mostra erro e nao chama a API', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('nome so com espacos: mesma validacao', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('form tem noValidate — quem bloqueia o submit e a validacao em JS, nao o navegador', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    // getByRole('dialog') e a propria div do overlay (ver componente); o
    // <form> e seu unico filho direto — buscamos por tag porque `form` nao
    // tem role/nome acessivel proprio quando ja esta dentro de um dialog.
    const form = screen.getByRole('dialog').querySelector('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('campo nome mantem required (semantica de acessibilidade, aria-required)', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toBeRequired()
  })
})

describe('ModalCliente — validação de limite/prazo não-negativos', () => {
  it('limite negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '-500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Limite não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('prazo negativo: mostra erro inline no campo, nao chama a API', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Y' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Prazo não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('campo prazo tem step="1" — e dias inteiros, o navegador nao deve oferecer fracionario', () => {
    // API real valida inteiro tambem (erroDeCampoInvalido em
    // api/src/routes/clientes.ts) — step aqui e so a primeira camada, para
    // o form noValidate nao deixar "1.5" passar despercebido pela UI.
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/prazo de pagamento/i)).toHaveAttribute('step', '1')
  })

  it('limite e prazo negativos ao mesmo tempo: mostra os dois erros', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Z' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Limite não pode ser negativo.')).toBeInTheDocument()
    expect(screen.getByText('Prazo não pode ser negativo.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('valores validos (inclusive zero) nao disparam erro nenhum', async () => {
    mockPost.mockResolvedValue({ ...clienteExistente, id: 'ok-1', nome: 'Mercado Ok', limite: 0, prazo: 0 })
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText(/n[aã]o pode ser negativo/i)).not.toBeInTheDocument()
  })
})

describe('ModalCliente — envio', () => {
  it('campo limite vazio vira 0 ao enviar, sem disparar erro de negativo', async () => {
    mockPost.mockResolvedValue({ ...clienteExistente, id: 'novo-vazio', nome: 'Mercado Vazio', limite: 0 })
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Vazio' } })
    // nao toca no campo limite — ele comeca vazio (ver teste de valores padrao)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { limite: unknown }
    expect(corpo.limite).toBe(0)
    expect(typeof corpo.limite).toBe('number')
    expect(screen.queryByText(/n[aã]o pode ser negativo/i)).not.toBeInTheDocument()
  })

  it('envia limite e prazo como numero, nao string', async () => {
    mockPost.mockResolvedValue({ ...clienteExistente, id: 'novo-1', nome: 'Mercado Teste' })
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Teste' } })
    fireEvent.change(screen.getByLabelText(/limite de cr[eé]dito/i), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText(/prazo de pagamento/i), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    const corpo = mockPost.mock.calls[0][1] as { limite: unknown; prazo: unknown }
    expect(corpo.limite).toBe(1500)
    expect(corpo.prazo).toBe(7)
    expect(typeof corpo.limite).toBe('number')
    expect(typeof corpo.prazo).toBe('number')
  })

  it('chama onSalvo com o cliente retornado pela API ao criar com sucesso', async () => {
    const criado = { ...clienteExistente, id: 'novo-2', nome: 'Mercado Z' }
    mockPost.mockResolvedValue(criado)
    const onSalvo = vi.fn()
    render(<ModalCliente papel="admin" cliente={null} onSalvo={onSalvo} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith(criado))
  })
})

describe('ModalCliente — 409 (nome duplicado)', () => {
  it('mostra o erro no campo nome, nao como erro generico', async () => {
    mockPost.mockRejectedValue(new ErroApi(409, { erro: 'ja existe um cliente com esse nome' }))
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Repetido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Já existe um cliente com esse nome.')
    // so um alerta na tela — nao aparece tambem a mensagem generica
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('ModalCliente — outros erros', () => {
  it('erro != 409/401 mostra mensagem generica', async () => {
    mockPost.mockRejectedValue(new Error('falha de rede'))
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível salvar. Tente novamente.')
  })

  it('401 chama onSessaoExpirada em vez de mostrar erro de salvar', async () => {
    mockPost.mockRejectedValue(new ErroApi(401, { erro: 'sessao invalida' }))
    const onSessaoExpirada = vi.fn()
    render(
      <ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} onSessaoExpirada={onSessaoExpirada} />,
    )
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado Y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSessaoExpirada).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ModalCliente — edição', () => {
  it('preenche os campos com os dados do cliente existente', () => {
    render(<ModalCliente papel="admin" cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/nome do estabelecimento/i)).toHaveValue('Mercado Bom Preço')
    expect(screen.getByLabelText(/respons[aá]vel/i)).toHaveValue('Sonia')
    expect(screen.getByLabelText(/cnpj/i)).toHaveValue('11.111.111/0001-11')
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('(41) 99999-0000')
    expect(screen.getByLabelText(/e-mail/i)).toHaveValue('contato@bp.com')
    expect(screen.getByLabelText(/endere[cç]o/i)).toHaveValue('Rua X, 100')
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveValue(500)
    expect(screen.getByLabelText(/prazo de pagamento/i)).toHaveValue(30)
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('inadimplente')
    expect(screen.getByLabelText(/observa[cç][oõ]es/i)).toHaveValue('Cliente antigo')
  })

  it('titulo do dialogo indica edicao', () => {
    render(<ModalCliente papel="admin" cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
  })

  it('cliente existente com limite 0 mostra 0, nao vazio — zero gravado e intencional, diferente do vazio inicial', () => {
    render(<ModalCliente papel="admin" cliente={{ ...clienteExistente, limite: 0 }} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByLabelText(/limite de cr[eé]dito/i)).toHaveValue(0)
  })

  it('usa PUT com o id do cliente ao salvar', async () => {
    mockPut.mockResolvedValue(clienteExistente)
    render(<ModalCliente papel="admin" cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith(`/api/clientes/${clienteExistente.id}`, expect.anything()),
    )
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('ModalCliente — fechar', () => {
  it('clicar no fundo (overlay) fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('clicar dentro do formulario nao fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByLabelText(/nome do estabelecimento/i))
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('clicar em Cancelar fecha o modal', () => {
    const onFechar = vi.fn()
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={onFechar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onFechar).toHaveBeenCalledOnce()
  })
})

// =====================================================================
// O COLABORADOR DECLARA QUEM É E POR QUÊ
// =====================================================================
//
// Existe UM login para a equipe inteira: o sistema não tem como saber quem
// digitou. Estes casos cobrem o formulário do colaborador — o que ele vê, e o
// que ele NÃO consegue salvar sem preencher.
//
// Nada aqui é a proteção. Quem recusa é o servidor: `POST`/`PUT` respondem 400
// sem autor e motivo quando a sessão é de colaborador
// (api/test/historico.http.test.ts). Se este formulário fosse a única
// barreira, bastaria chamar a API direto para editar sem rastro.

describe('ModalCliente — declaração de autoria (colaborador)', () => {
  it('mostra os dois campos', async () => {
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(await screen.findByLabelText(/quem está fazendo esta alteração/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo da alteração/i)).toBeInTheDocument()
  })

  it('O CAMPO DE QUEM É ABRE VAZIO — sem nada pré-selecionado', async () => {
    // Se abrisse com um nome já escolhido, todos aceitariam o que está lá e o
    // registro viraria ficção. Precisa ser escolha ativa.
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(await screen.findByLabelText(/quem está fazendo esta alteração/i)).toHaveValue('')
  })

  it('salvar SEM ESCOLHER quem é: bloqueado, e a API não é chamada', async () => {
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: 'cliente novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha quem está fazendo esta alteração.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('salvar SEM MOTIVO: bloqueado, e a API não é chamada', async () => {
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo da alteração.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('motivo só com espaços é o mesmo que motivo em branco', async () => {
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-1' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo da alteração.')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('faltando os dois, os dois erros aparecem juntos', async () => {
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const erros = screen.getAllByRole('alert').map(e => e.textContent)
    expect(erros).toContain('Escolha quem está fazendo esta alteração.')
    expect(erros).toContain('Informe o motivo da alteração.')
  })

  it('com os dois preenchidos, o corpo leva declarado_por e motivo', async () => {
    mockPost.mockResolvedValue({ id: 'c-9' })
    render(<ModalCliente papel="colaborador" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    await screen.findByRole('option', { name: 'Ana Souza' })
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado X' } })
    fireEvent.change(screen.getByLabelText(/quem está fazendo esta alteração/i), { target: { value: 'f-2' } })
    fireEvent.change(screen.getByLabelText(/motivo da alteração/i), { target: { value: '  cliente novo da rota  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      declarado_por: 'f-2',
      // Sem espaços nas pontas: motivo em branco disfarçado não vira registro.
      motivo: 'cliente novo da rota',
    })
  })
})

describe('ModalCliente — o admin não declara nada', () => {
  it('não mostra os dois campos', () => {
    // O login do admin é individual: o sistema já sabe quem é. Pedir que ele
    // digitasse a autoria transformaria um dado conhecido num dado informado.
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.queryByLabelText(/quem está fazendo esta alteração/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/motivo da alteração/i)).not.toBeInTheDocument()
  })

  it('nem busca a lista de funcionários — não pedir o que não vai mostrar', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(mockGet).not.toHaveBeenCalledWith('/api/funcionarios/opcoes')
  })

  it('salva sem declaração nenhuma, e o corpo não leva os campos', async () => {
    mockPost.mockResolvedValue({ id: 'c-9' })
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome do estabelecimento/i), { target: { value: 'Mercado do Dono' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('declarado_por')
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('motivo')
  })
})

describe('ModalCliente — quem lê o histórico', () => {
  it('APARECE para o admin ao editar', () => {
    render(<ModalCliente papel="admin" cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.getByRole('button', { name: /histórico de alterações/i })).toBeInTheDocument()
  })

  it('NÃO aparece para o colaborador', () => {
    render(<ModalCliente papel="colaborador" cliente={clienteExistente} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: /histórico de alterações/i })).not.toBeInTheDocument()
  })

  it('não aparece ao CRIAR, nem para o admin — cadastro que não existe não tem histórico', () => {
    render(<ModalCliente papel="admin" cliente={null} onSalvo={() => {}} onFechar={() => {}} />)
    expect(screen.queryByRole('button', { name: /histórico de alterações/i })).not.toBeInTheDocument()
  })
})
