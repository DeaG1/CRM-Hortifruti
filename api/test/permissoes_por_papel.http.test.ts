import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

/**
 * O MAPA DE QUEM PODE O QUE, contra o app REAL (src/index.ts).
 *
 * Cada rota ja tem seu proprio arquivo `*.http.test.ts` cobrindo os casos
 * dela. Este aqui existe por um motivo diferente: quando o colaborador ganhou
 * acesso ao cadastro de clientes, produtos e fornecedores, a pergunta que
 * decide se isso e seguranca ou teatro deixou de ser "a tela esconde a
 * coluna?" e passou a ser "a API recusa?". Esconder markup no front nao
 * protege nada — quem quiser abre o navegador e chama o endpoint.
 *
 * Entao o mapa mora num arquivo so, montado contra o app inteiro, e cobre as
 * duas metades:
 *
 *  - o que o colaborador PODE (ler/criar/editar os tres cadastros, e as telas
 *    de movimentacao que sempre foram dele);
 *  - o que ele NAO PODE (excluir os tres cadastros, e todo endpoint de
 *    metrica agregada).
 *
 * A segunda metade e a que importa: qualquer `exigirAdmin` removido por
 * engano de /api/relatorios, /api/lancamentos, /api/funcionarios,
 * /api/veiculos ou /api/descontos quebra AQUI, mesmo que a tela continue
 * escondendo o numero direitinho.
 *
 * A primeira metade tambem tem que existir: sem ela, "proteger" tudo de novo
 * (o erro oposto, que ja aconteceu neste projeto e deixou o colaborador sem
 * conseguir escolher produto ao lancar entrada) passaria despercebido.
 */

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let tokenAdmin: string
let tokenColab: string
let funcionarioId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-permissoes-papel', 'Permissoes por papel')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id

  // Ordem das dependencias: as FKs para produtos sao RESTRICT, entao o que
  // referencia sai antes. Mesmo cuidado de produtos.http.test.ts — lixo de
  // uma execucao interrompida nao pode derrubar a suite no setup.
  await admin`delete from entrada_itens where tenant_id = ${tenantId}`
  await admin`delete from entradas     where tenant_id = ${tenantId}`
  await admin`delete from saida_itens  where tenant_id = ${tenantId}`
  await admin`delete from saidas       where tenant_id = ${tenantId}`
  await admin`delete from perdas       where tenant_id = ${tenantId}`
  await admin`delete from fornecedor_produtos where tenant_id = ${tenantId}`
  await admin`delete from fornecedores where tenant_id = ${tenantId}`
  await admin`delete from produtos    where tenant_id = ${tenantId}`
  await admin`delete from clientes    where tenant_id = ${tenantId}`
  // `historico_cadastros` nao tem FK para os cadastros (017), entao a ordem
  // nao e imposta pelo banco — mas limpar aqui deixa cada execucao partindo
  // de zero. `funcionarios` sai depois dele so por clareza de leitura: a FK do
  // autor e `set null`, nao barra nada.
  await admin`delete from historico_cadastros where tenant_id = ${tenantId}`
  await admin`delete from funcionarios where tenant_id = ${tenantId}`
  await admin`delete from usuarios    where tenant_id = ${tenantId}`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@permissoes-papel.com', ${hash}, 'Admin', 'admin') returning id`
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'colab@permissoes-papel.com', ${hash}, 'Colab', 'colaborador') returning id`

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)

  // O COLABORADOR PRECISA DECLARAR QUEM E ao criar/editar cadastro
  // (historico de alteracoes, migration 017): o autor vem de uma LISTA
  // FECHADA de funcionarios, nunca de texto livre. Sem uma linha em
  // `funcionarios` para escolher, nao ha declaracao possivel.
  const [decl] = await admin`
    insert into funcionarios (tenant_id, nome, salario)
    values (${tenantId}, 'Funcionario Declarante Permissoes', 1500) returning id`
  funcionarioId = decl.id
})

afterAll(async () => {
  await sql?.end()
  await admin?.end()
})

/** Mesmo ExecutionContext minimo dos demais `*.http.test.ts`. */
function contextoDeTeste() {
  const pendentes: Promise<unknown>[] = []
  const exec = {
    waitUntil: (p: Promise<unknown>) => { pendentes.push(p) },
    passThroughOnException: () => {},
  }
  return { exec, aguardar: () => Promise.all(pendentes) }
}

async function pedir(input: string, init?: RequestInit) {
  const { exec, aguardar } = contextoDeTeste()
  const res = await app.request(input, init, { DATABASE_URL: URL }, exec as never)
  await aguardar()
  return res
}

const comoAdmin = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenAdmin}` },
})
const comoColab = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenColab}` },
})

/**
 * TODO endpoint que alimenta um numero escondido do colaborador. Se algum
 * deles parar de exigir admin, a tela pode continuar escondendo a coluna e a
 * informacao estara exposta assim mesmo — este e o teste que pega isso.
 */
const METRICAS_ADMIN_ONLY = [
  // Compra media, venda media, markup, margem e perda por produto: as cinco
  // colunas que a tela de Produtos esconde do colaborador. Sao TODAS deste
  // endpoint.
  '/api/relatorios/produtos',
  // Caixa, resultado e o gasto por veiculo — a mesma classe de dado.
  '/api/lancamentos',
  // Salarios.
  '/api/funcionarios',
  '/api/descontos',
  // Custo por carro no periodo (a tela e admin-only inclusive na leitura).
  '/api/veiculos',
]

/**
 * O que o colaborador JA alcancava antes desta mudanca e continua
 * alcancando. Esta lista e o contrapeso honesto do bloco acima: parte das
 * metricas escondidas nas telas de Clientes e Fornecedores (faturado,
 * ticket, inadimplencia; preco medio, variacao, aproveitamento) e DERIVAVEL
 * destes endpoints. Nao da para proteger por permissao sem tirar dele as
 * telas de Entradas e Saidas, que sao o trabalho dele — o dono sabe e
 * aceitou. O que as telas nao fazem e ENTREGAR o agregado pronto.
 */
const ACESSIVEL_AO_COLABORADOR = [
  '/api/entradas',
  '/api/saidas',
  '/api/estoque',
  '/api/perdas',
  '/api/clientes',
  '/api/produtos',
  '/api/fornecedores',
  // A UNICA EXCECAO dentro de uma rota admin-only, e ela e deliberada: o
  // colaborador precisa escolher QUEM ESTA ALTERANDO de uma lista fechada
  // para poder salvar cadastro (historico, migration 017). `/opcoes` devolve
  // id e nome dos ativos, e nada mais — nunca salario, telefone ou dia de
  // pagamento. `GET /api/funcionarios` continua no bloco admin-only acima, e
  // e o teste que prova que a excecao nao virou porta.
  '/api/funcionarios/opcoes',
]

/**
 * O HISTORICO DE ALTERACOES: so o admin le, e nao ha rota de escrita.
 *
 * Fica num bloco proprio (e nao em METRICAS_ADMIN_ONLY) porque nao e metrica:
 * e supervisao. Aberto a quem e supervisionado, viraria a lista de quem
 * declarou o que — util para combinar versao, nao para conferir.
 */
const HISTORICO_DE_UM_CLIENTE = '/api/historico/cliente/00000000-0000-4000-8000-000000000000'

describe('metricas agregadas continuam admin-only', () => {
  it.each(METRICAS_ADMIN_ONLY)('colaborador -> 403 em GET %s', async (rota) => {
    const res = await pedir(rota, comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it.each(METRICAS_ADMIN_ONLY)('admin -> 200 em GET %s', async (rota) => {
    const res = await pedir(rota, comoAdmin())
    expect(res.status).toBe(200)
  })

  it.each(METRICAS_ADMIN_ONLY)('sem cookie -> 401 em GET %s', async (rota) => {
    const res = await pedir(rota)
    expect(res.status).toBe(401)
  })
})

describe('o que o colaborador le', () => {
  it.each(ACESSIVEL_AO_COLABORADOR)('colaborador -> 200 em GET %s', async (rota) => {
    const res = await pedir(rota, comoColab())
    expect(res.status).toBe(200)
  })

  it('GET /api/funcionarios/opcoes devolve SO id e nome — nunca salario', async () => {
    const res = await pedir('/api/funcionarios/opcoes', comoColab())
    expect(res.status).toBe(200)
    const linhas = await res.json() as Record<string, unknown>[]
    expect(linhas.length).toBeGreaterThan(0)
    for (const linha of linhas) {
      expect(Object.keys(linha).sort()).toEqual(['id', 'nome'])
    }
  })
})

describe('historico de alteracoes: so o admin le, e ninguem escreve por rota', () => {
  it('colaborador -> 403', async () => {
    const res = await pedir(HISTORICO_DE_UM_CLIENTE, comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('sem cookie -> 401', async () => {
    const res = await pedir(HISTORICO_DE_UM_CLIENTE)
    expect(res.status).toBe(401)
  })

  it('admin -> 200', async () => {
    const res = await pedir(HISTORICO_DE_UM_CLIENTE, comoAdmin())
    expect(res.status).toBe(200)
  })

  // Nem o admin edita ou apaga: historico corrigivel depois nao serve de
  // prova. Se alguem acrescentar um PUT/DELETE aqui um dia, isto quebra.
  it.each(['PUT', 'PATCH', 'DELETE', 'POST'])('%s -> 404 (nao existe rota)', async (metodo) => {
    const res = await pedir(HISTORICO_DE_UM_CLIENTE, comoAdmin({ method: metodo }))
    expect(res.status).toBe(404)
  })
})

describe('cadastro: colaborador cria e edita, so o admin exclui', () => {
  /**
   * Um caso por entidade, do jeito que a tela usa: cria, edita, tenta
   * excluir (403), e o admin exclui no fim. O 403 e conferido no BANCO
   * tambem — resposta 403 com a linha apagada seria o pior dos mundos.
   */
  it('clientes', async () => {
    const criado = await pedir('/api/clientes', comoColab({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Mercado Mapa', tel: '44 90000-0000',
        declarado_por: funcionarioId, motivo: 'cliente novo da rota',
      }),
    }))
    expect(criado.status).toBe(201)
    const { id } = await criado.json() as { id: string }

    const editado = await pedir(`/api/clientes/${id}`, comoColab({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resp: 'Dona Maria', declarado_por: funcionarioId, motivo: 'trocou o comprador',
      }),
    }))
    expect(editado.status).toBe(200)
    expect(await editado.json()).toMatchObject({ resp: 'Dona Maria' })

    const negado = await pedir(`/api/clientes/${id}`, comoColab({ method: 'DELETE' }))
    expect(negado.status).toBe(403)
    const [ainda] = await admin`select id from clientes where id = ${id}`
    expect(ainda).toBeDefined()

    const apagado = await pedir(`/api/clientes/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)
  })

  it('produtos', async () => {
    const criado = await pedir('/api/produtos', comoColab({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Beterraba Mapa', un: 'CX', peso_medio: 20,
        declarado_por: funcionarioId, motivo: 'faltava no cadastro',
      }),
    }))
    expect(criado.status).toBe(201)
    const { id } = await criado.json() as { id: string }

    const editado = await pedir(`/api/produtos/${id}`, comoColab({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peso_medio: 22, declarado_por: funcionarioId, motivo: 'pesamos de novo',
      }),
    }))
    expect(editado.status).toBe(200)
    expect(await editado.json()).toMatchObject({ peso_medio: 22 })

    const negado = await pedir(`/api/produtos/${id}`, comoColab({ method: 'DELETE' }))
    expect(negado.status).toBe(403)
    const [ainda] = await admin`select id from produtos where id = ${id}`
    expect(ainda).toBeDefined()

    const apagado = await pedir(`/api/produtos/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)
  })

  it('fornecedores', async () => {
    const criado = await pedir('/api/fornecedores', comoColab({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Sitio Mapa', regiao: 'Norte',
        declarado_por: funcionarioId, motivo: 'produtor novo da feira',
      }),
    }))
    expect(criado.status).toBe(201)
    const { id } = await criado.json() as { id: string }

    const editado = await pedir(`/api/fornecedores/${id}`, comoColab({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contato: '44 97777-0000', declarado_por: funcionarioId, motivo: 'mandou o whatsapp novo',
      }),
    }))
    expect(editado.status).toBe(200)
    expect(await editado.json()).toMatchObject({ contato: '44 97777-0000' })

    const negado = await pedir(`/api/fornecedores/${id}`, comoColab({ method: 'DELETE' }))
    expect(negado.status).toBe(403)
    const [ainda] = await admin`select id from fornecedores where id = ${id}`
    expect(ainda).toBeDefined()

    const apagado = await pedir(`/api/fornecedores/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)
  })
})
