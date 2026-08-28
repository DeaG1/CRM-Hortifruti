import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool, withTenant } from '../src/db'
import { hashSenha, criarSessao } from '../src/auth'
import { COOKIE_SESSAO } from '../src/middleware/sessao'
import app from '../src/index'

/**
 * O HISTORICO DE ALTERACOES DOS CADASTROS, contra o app REAL (src/index.ts).
 *
 * A pergunta que este arquivo existe para responder nao e "a tela mostra o
 * campo?" — e "a API RECUSA?". Um formulario que exige autor e motivo com um
 * servidor que nao exige e teatro: bastaria chamar
 * `PUT /api/clientes/:id` direto para editar sem deixar rastro. Por isso a
 * maior parte dos casos aqui bate na rota, sem passar perto do front, e
 * varios deles conferem o BANCO depois — resposta 200 com o historico vazio
 * seria o pior dos mundos.
 *
 * O outro eixo e a SOBREVIVENCIA do rastro: excluir o cadastro nao pode
 * apagar o log, e excluir o funcionario declarado nao pode apagar nem
 * esvaziar o nome dele. Um log que perde a evidencia quando alguem e
 * removido nao e log. Ver db/migrations/017_historico_cadastros.sql.
 */

const URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://app_crm:trocar_em_producao@localhost:5433/crm_dev'
const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let sql: ReturnType<typeof criarPool>
let admin: ReturnType<typeof criarPool>
let tenantId: string
let outroTenantId: string
let tokenAdmin: string
let tokenColab: string
let tokenAdminOutro: string
let joaoId: string
let mariaId: string
let funcionarioDeOutroTenantId: string

beforeAll(async () => {
  admin = criarPool(ADMIN)
  sql = criarPool(URL)

  const [t] = await admin`
    insert into tenants (slug, nome) values ('teste-historico-http', 'Historico HTTP')
    on conflict (slug) do update set nome = excluded.nome returning id`
  const [t2] = await admin`
    insert into tenants (slug, nome) values ('teste-historico-http-2', 'Historico HTTP 2')
    on conflict (slug) do update set nome = excluded.nome returning id`
  tenantId = t.id
  outroTenantId = t2.id

  const ambos = [tenantId, outroTenantId]
  // O historico sai primeiro: ele nao tem FK para os cadastros (017), entao a
  // ordem nao e imposta pelo banco — mas limpar antes deixa cada execucao
  // partindo de zero, sem sobra de uma rodada interrompida.
  await admin`delete from historico_cadastros where tenant_id in ${admin(ambos)}`
  // As FKs para `produtos` sao RESTRICT, entao quem referencia sai antes —
  // mesmo cuidado de produtos.http.test.ts. `perdas` aparece aqui porque um
  // dos casos abaixo cria uma de proposito (para provar que a exclusao
  // barrada nao deixa log de exclusao que nao aconteceu).
  await admin`delete from perdas where tenant_id in ${admin(ambos)}`
  await admin`delete from entrada_itens where tenant_id in ${admin(ambos)}`
  await admin`delete from entradas where tenant_id in ${admin(ambos)}`
  await admin`delete from saida_itens where tenant_id in ${admin(ambos)}`
  await admin`delete from saidas where tenant_id in ${admin(ambos)}`
  await admin`delete from fornecedor_produtos where tenant_id in ${admin(ambos)}`
  await admin`delete from fornecedores where tenant_id in ${admin(ambos)}`
  await admin`delete from produtos     where tenant_id in ${admin(ambos)}`
  await admin`delete from clientes     where tenant_id in ${admin(ambos)}`
  await admin`delete from funcionarios where tenant_id in ${admin(ambos)}`
  await admin`delete from usuarios     where tenant_id in ${admin(ambos)}`

  const hash = await hashSenha('segredo123')
  const [uAdmin] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'admin@historico.com', ${hash}, 'Dona Rita', 'admin') returning id`
  // UM login para a equipe inteira — o fato que da origem a feature. Nao ha
  // "conta do Joao": ha a conta 'Equipe', usada por todo mundo no balcao.
  const [uColab] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${tenantId}, 'equipe@historico.com', ${hash}, 'Equipe', 'colaborador') returning id`
  const [uAdmin2] = await admin`
    insert into usuarios (tenant_id, email, senha_hash, nome, papel)
    values (${outroTenantId}, 'admin@historico2.com', ${hash}, 'Outro Dono', 'admin') returning id`

  const [j] = await admin`
    insert into funcionarios (tenant_id, nome, cargo, salario)
    values (${tenantId}, 'Joao da Silva', 'Balconista', 2000) returning id`
  const [m] = await admin`
    insert into funcionarios (tenant_id, nome, cargo, salario, ativo)
    values (${tenantId}, 'Maria Aposentada', 'Ex-balconista', 2000, false) returning id`
  const [f2] = await admin`
    insert into funcionarios (tenant_id, nome, salario)
    values (${outroTenantId}, 'Funcionario da Outra Empresa', 1500) returning id`
  joaoId = j.id
  mariaId = m.id
  funcionarioDeOutroTenantId = f2.id

  tokenAdmin = await criarSessao(sql, uAdmin.id, tenantId)
  tokenColab = await criarSessao(sql, uColab.id, tenantId)
  tokenAdminOutro = await criarSessao(sql, uAdmin2.id, outroTenantId)
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
const comoAdminDoOutroTenant = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, cookie: `${COOKIE_SESSAO}=${tokenAdminOutro}` },
})
const json = (corpo: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
})

type LinhaHistorico = {
  id: string
  entidade: string
  registro_id: string
  registro_nome: string
  acao: string
  autor_origem: string
  autor_nome: string
  autor_funcionario_id: string | null
  motivo: string
  alteracoes: { campo: string; de: string; para: string }[]
  criado_em: string
}

/** Le o historico pela ROTA (nao pelo banco): e o caminho que o dono usa. */
async function historicoDe(entidade: string, id: string): Promise<LinhaHistorico[]> {
  const res = await pedir(`/api/historico/${entidade}/${id}`, comoAdmin())
  expect(res.status).toBe(200)
  return await res.json() as LinhaHistorico[]
}

/** Le direto do banco, ignorando a rota — para os casos em que a pergunta e
 * "a LINHA existe?" e nao "a rota devolve?". */
async function linhasNoBanco(registroId: string) {
  return admin<LinhaHistorico[]>`
    select * from historico_cadastros where registro_id = ${registroId} order by criado_em`
}

// Cada bloco cria os proprios registros: um teste nao pode depender da ordem
// em que outro rodou.
async function criarClienteComoColab(nome: string, extra: Record<string, unknown> = {}) {
  const res = await pedir('/api/clientes', comoColab({
    method: 'POST',
    ...json({ nome, declarado_por: joaoId, motivo: 'cadastro novo da rota', ...extra }),
  }))
  expect(res.status).toBe(201)
  return await res.json() as { id: string; nome: string }
}

// ===================================================================
// 1. A EXIGENCIA VALE NO SERVIDOR
// ===================================================================

describe('colaborador: POST sem autor ou sem motivo e recusado com 400', () => {
  const casos: [string, Record<string, unknown>][] = [
    ['/api/clientes', { nome: 'Sem declaracao 1' }],
    ['/api/produtos', { nome: 'Sem declaracao 2' }],
    ['/api/fornecedores', { nome: 'Sem declaracao 3' }],
  ]

  it.each(casos)('%s sem nada declarado -> 400', async (rota, corpo) => {
    const res = await pedir(rota, comoColab({ method: 'POST', ...json(corpo) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'informe quem esta fazendo esta alteracao' })
  })

  it.each(casos)('%s com autor e sem motivo -> 400', async (rota, corpo) => {
    const res = await pedir(rota, comoColab({
      method: 'POST', ...json({ ...corpo, declarado_por: joaoId }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'informe o motivo da alteracao' })
  })

  it.each(casos)('%s com motivo e sem autor -> 400', async (rota, corpo) => {
    const res = await pedir(rota, comoColab({
      method: 'POST', ...json({ ...corpo, motivo: 'porque sim' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'informe quem esta fazendo esta alteracao' })
  })

  it.each(casos)('%s com motivo so de espacos -> 400 (motivo em branco e motivo ausente)', async (rota, corpo) => {
    const res = await pedir(rota, comoColab({
      method: 'POST', ...json({ ...corpo, declarado_por: joaoId, motivo: '   ' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'informe o motivo da alteracao' })
  })

  it('e nada foi gravado no banco quando a declaracao falta', async () => {
    await pedir('/api/clientes', comoColab({
      method: 'POST', ...json({ nome: 'Fantasma sem declaracao' }),
    }))
    const [linha] = await admin`
      select id from clientes where tenant_id = ${tenantId} and nome = 'Fantasma sem declaracao'`
    expect(linha).toBeUndefined()
  })
})

describe('colaborador: PUT sem autor ou sem motivo e recusado com 400', () => {
  let clienteId: string
  let produtoId: string
  let fornecedorId: string

  beforeAll(async () => {
    const cli = await criarClienteComoColab('Cliente para PUT sem declaracao')
    clienteId = cli.id
    const prod = await pedir('/api/produtos', comoColab({
      method: 'POST',
      ...json({ nome: 'Produto para PUT sem declaracao', declarado_por: joaoId, motivo: 'setup' }),
    }))
    produtoId = (await prod.json() as { id: string }).id
    const forn = await pedir('/api/fornecedores', comoColab({
      method: 'POST',
      ...json({ nome: 'Fornecedor para PUT sem declaracao', declarado_por: joaoId, motivo: 'setup' }),
    }))
    fornecedorId = (await forn.json() as { id: string }).id
  })

  it('PUT /api/clientes/:id sem declaracao -> 400 e o valor NAO muda no banco', async () => {
    const res = await pedir(`/api/clientes/${clienteId}`, comoColab({
      method: 'PUT', ...json({ tel: '44 90000-0000' }),
    }))
    expect(res.status).toBe(400)
    const [linha] = await admin`select tel from clientes where id = ${clienteId}`
    expect(linha.tel).toBe('')
  })

  it('PUT /api/produtos/:id sem declaracao -> 400 e o valor NAO muda no banco', async () => {
    const res = await pedir(`/api/produtos/${produtoId}`, comoColab({
      method: 'PUT', ...json({ peso_medio: 22 }),
    }))
    expect(res.status).toBe(400)
    const [linha] = await admin`select peso_medio from produtos where id = ${produtoId}`
    expect(Number(linha.peso_medio)).toBe(0)
  })

  it('PUT /api/fornecedores/:id sem declaracao -> 400 e o valor NAO muda no banco', async () => {
    const res = await pedir(`/api/fornecedores/${fornecedorId}`, comoColab({
      method: 'PUT', ...json({ regiao: 'Norte' }),
    }))
    expect(res.status).toBe(400)
    const [linha] = await admin`select regiao from fornecedores where id = ${fornecedorId}`
    expect(linha.regiao).toBe('')
  })

  it('PUT so com motivo, sem autor -> 400', async () => {
    const res = await pedir(`/api/clientes/${clienteId}`, comoColab({
      method: 'PUT', ...json({ tel: '44 90000-0000', motivo: 'cliente trocou de numero' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'informe quem esta fazendo esta alteracao' })
  })
})

describe('o autor declarado tem que ser um funcionario cadastrado DESTA empresa', () => {
  it('id que nao e uuid -> 400', async () => {
    const res = await pedir('/api/clientes', comoColab({
      method: 'POST', ...json({ nome: 'Autor invalido 1', declarado_por: 'joão', motivo: 'x' }),
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'quem esta alterando deve ser um funcionario cadastrado' })
  })

  it('uuid de funcionario que nao existe -> 400', async () => {
    const res = await pedir('/api/clientes', comoColab({
      method: 'POST',
      ...json({
        nome: 'Autor invalido 2',
        declarado_por: '00000000-0000-4000-8000-000000000000',
        motivo: 'x',
      }),
    }))
    expect(res.status).toBe(400)
  })

  it('funcionario de OUTRA empresa -> 400 (a RLS nao o enxerga daqui)', async () => {
    const res = await pedir('/api/clientes', comoColab({
      method: 'POST',
      ...json({ nome: 'Autor de outra empresa', declarado_por: funcionarioDeOutroTenantId, motivo: 'x' }),
    }))
    expect(res.status).toBe(400)
    const [linha] = await admin`
      select id from clientes where tenant_id = ${tenantId} and nome = 'Autor de outra empresa'`
    expect(linha).toBeUndefined()
  })

  it('funcionario desativado ainda pode ser declarado: desativar depois nao invalida o registro', async () => {
    const cliente = await criarClienteComoColab('Declarado por quem saiu', {})
    const res = await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ tel: '44 91111-1111', declarado_por: mariaId, motivo: 'ajuste antigo' }),
    }))
    expect(res.status).toBe(200)
    const historico = await historicoDe('cliente', cliente.id)
    expect(historico[0].autor_nome).toBe('Maria Aposentada')
  })
})

// ===================================================================
// 2. COM OS DOIS, GRAVA — E O HISTORICO REGISTRA
// ===================================================================

describe('colaborador com autor e motivo: grava e o historico registra', () => {
  it('POST de cliente gera uma linha "criou" declarada', async () => {
    const cliente = await criarClienteComoColab('Mercado do Zé')
    const historico = await historicoDe('cliente', cliente.id)
    expect(historico).toHaveLength(1)
    expect(historico[0]).toMatchObject({
      entidade: 'cliente',
      registro_id: cliente.id,
      registro_nome: 'Mercado do Zé',
      acao: 'criou',
      autor_origem: 'declarado',
      autor_nome: 'Joao da Silva',
      autor_funcionario_id: joaoId,
      motivo: 'cadastro novo da rota',
      // Criar nao tem "de": o que foi criado E o registro atual. Gravar a
      // linha inteira aqui seria a copia que a modelagem recusa.
      alteracoes: [],
    })
  })

  it('PUT registra CAMPO A CAMPO, de/para, so do que mudou', async () => {
    const cliente = await criarClienteComoColab('Mercearia Campo a Campo', {
      tel: '44 90000-0000', resp: 'Sonia',
    })
    const res = await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT',
      ...json({
        // `resp` vai igual de proposito: nao pode aparecer no de/para.
        resp: 'Sonia',
        tel: '44 98888-8888',
        limite: 5000,
        declarado_por: joaoId,
        motivo: 'cliente trocou de telefone e pediu limite',
      }),
    }))
    expect(res.status).toBe(200)

    const historico = await historicoDe('cliente', cliente.id)
    expect(historico[0].acao).toBe('editou')
    expect(historico[0].motivo).toBe('cliente trocou de telefone e pediu limite')
    const campos = historico[0].alteracoes.map(a => a.campo).sort()
    expect(campos).toEqual(['limite', 'tel'])
    expect(historico[0].alteracoes.find(a => a.campo === 'tel')).toEqual({
      campo: 'tel', de: '44 90000-0000', para: '44 98888-8888',
    })
    // `resp` nao mudou e nao entra. Um log que lista campos que ninguem
    // mexeu e um log que ninguem le.
    expect(campos).not.toContain('resp')
    // `alterado_em` muda em todo PUT e NUNCA e alteracao: se contasse,
    // "PUT que nao muda nada nao gera registro" nunca poderia valer.
    expect(campos).not.toContain('alterado_em')
  })

  it('o mais recente vem primeiro', async () => {
    const cliente = await criarClienteComoColab('Ordem do Historico')
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ rota: 'Norte A', declarado_por: joaoId, motivo: 'primeira' }),
    }))
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ rota: 'Norte B', declarado_por: joaoId, motivo: 'segunda' }),
    }))
    const historico = await historicoDe('cliente', cliente.id)
    expect(historico.map(h => h.motivo)).toEqual(['segunda', 'primeira', 'cadastro novo da rota'])
  })

  it('produto: PUT registra de/para do peso medio', async () => {
    const criado = await pedir('/api/produtos', comoColab({
      method: 'POST',
      ...json({ nome: 'Batata do Historico', un: 'CX', peso_medio: 20, declarado_por: joaoId, motivo: 'novo' }),
    }))
    const { id } = await criado.json() as { id: string }
    const res = await pedir(`/api/produtos/${id}`, comoColab({
      method: 'PUT', ...json({ peso_medio: 22, declarado_por: joaoId, motivo: 'pesamos de novo' }),
    }))
    expect(res.status).toBe(200)
    const historico = await historicoDe('produto', id)
    expect(historico[0].alteracoes).toEqual([
      { campo: 'peso_medio', de: '20.000', para: '22.000' },
    ])
  })

  it('fornecedor: trocar os produtos vinculados TAMBEM entra no rastro, por nome', async () => {
    const [p1] = await admin`
      insert into produtos (tenant_id, nome) values (${tenantId}, 'Cebola Vinculo') returning id`
    const [p2] = await admin`
      insert into produtos (tenant_id, nome) values (${tenantId}, 'Tomate Vinculo') returning id`

    const criado = await pedir('/api/fornecedores', comoColab({
      method: 'POST',
      ...json({ nome: 'Sitio do Vinculo', declarado_por: joaoId, motivo: 'produtor novo' }),
    }))
    const { id } = await criado.json() as { id: string }

    await pedir(`/api/fornecedores/${id}`, comoColab({
      method: 'PUT',
      ...json({ produto_ids: [p1.id], declarado_por: joaoId, motivo: 'ele so entrega cebola' }),
    }))
    await pedir(`/api/fornecedores/${id}`, comoColab({
      method: 'PUT',
      ...json({ produto_ids: [p2.id], declarado_por: joaoId, motivo: 'passou a entregar tomate' }),
    }))

    const historico = await historicoDe('fornecedor', id)
    expect(historico[0].alteracoes).toEqual([
      { campo: 'produtos', de: 'Cebola Vinculo', para: 'Tomate Vinculo' },
    ])
  })

  it('fornecedor: PUT com produto_ids invalido NAO grava o campo nem o historico (escrita parcial)', async () => {
    const criado = await pedir('/api/fornecedores', comoColab({
      method: 'POST',
      ...json({ nome: 'Sitio Parcial', regiao: 'Sul', declarado_por: joaoId, motivo: 'novo' }),
    }))
    const { id } = await criado.json() as { id: string }

    const res = await pedir(`/api/fornecedores/${id}`, comoColab({
      method: 'PUT',
      ...json({
        regiao: 'Norte',
        produto_ids: ['00000000-0000-4000-8000-000000000000'],
        declarado_por: joaoId,
        motivo: 'tentativa',
      }),
    }))
    expect(res.status).toBe(400)
    // Se a regiao tivesse sido gravada e o historico nao, existiria um
    // caminho para editar sem deixar rastro: basta mandar um produto_id que
    // nao existe junto da alteracao.
    const [linha] = await admin`select regiao from fornecedores where id = ${id}`
    expect(linha.regiao).toBe('Sul')
    const historico = await historicoDe('fornecedor', id)
    expect(historico).toHaveLength(1)
    expect(historico[0].acao).toBe('criou')
  })
})

// ===================================================================
// 3. ADMIN NAO DECLARA
// ===================================================================

describe('admin grava sem declarar nada', () => {
  it('POST sem autor nem motivo -> 201, e o historico marca a origem como login', async () => {
    const res = await pedir('/api/clientes', comoAdmin({
      method: 'POST', ...json({ nome: 'Cliente do Dono' }),
    }))
    expect(res.status).toBe(201)
    const { id } = await res.json() as { id: string }

    const historico = await historicoDe('cliente', id)
    expect(historico[0]).toMatchObject({
      acao: 'criou',
      // 'login' e nao 'declarado': o login do dono e individual, o sistema
      // sabe quem e. E a coluna que impede a tela de chamar declaracao de
      // prova.
      autor_origem: 'login',
      autor_nome: 'Dona Rita',
      autor_funcionario_id: null,
      motivo: '',
    })
  })

  it('PUT sem autor nem motivo -> 200', async () => {
    const criado = await pedir('/api/clientes', comoAdmin({
      method: 'POST', ...json({ nome: 'Cliente do Dono para editar' }),
    }))
    const { id } = await criado.json() as { id: string }
    const res = await pedir(`/api/clientes/${id}`, comoAdmin({
      method: 'PUT', ...json({ rota: 'Centro' }),
    }))
    expect(res.status).toBe(200)
    const historico = await historicoDe('cliente', id)
    expect(historico[0].acao).toBe('editou')
    expect(historico[0].autor_origem).toBe('login')
  })

  it('admin que MANDA declarado_por tem o campo ignorado — nao da para atribuir a alteracao a um funcionario', async () => {
    const res = await pedir('/api/clientes', comoAdmin({
      method: 'POST',
      ...json({ nome: 'Tentativa de atribuir', declarado_por: joaoId, motivo: 'foi o Joao' }),
    }))
    expect(res.status).toBe(201)
    const { id } = await res.json() as { id: string }
    const historico = await historicoDe('cliente', id)
    expect(historico[0].autor_origem).toBe('login')
    expect(historico[0].autor_nome).toBe('Dona Rita')
    expect(historico[0].autor_funcionario_id).toBeNull()
    expect(historico[0].motivo).toBe('')
  })
})

// ===================================================================
// 4. PUT QUE NAO MUDA NADA NAO GERA REGISTRO
// ===================================================================

describe('PUT que reenvia os mesmos valores nao gera registro', () => {
  it('nenhuma linha nova, e a resposta continua 200', async () => {
    const cliente = await criarClienteComoColab('Cliente Sem Mudanca', {
      tel: '44 97777-7777', rota: 'Oeste',
    })
    const antes = await historicoDe('cliente', cliente.id)
    expect(antes).toHaveLength(1)

    const res = await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT',
      ...json({
        nome: 'Cliente Sem Mudanca', tel: '44 97777-7777', rota: 'Oeste',
        declarado_por: joaoId, motivo: 'abri para conferir e cliquei salvar',
      }),
    }))
    expect(res.status).toBe(200)

    const depois = await historicoDe('cliente', cliente.id)
    expect(depois).toHaveLength(1)
  })

  it('mas a EXIGENCIA de declarar continua valendo num PUT que nao muda nada', async () => {
    const cliente = await criarClienteComoColab('Cliente Sem Mudanca 2', { rota: 'Leste' })
    const res = await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ rota: 'Leste' }),
    }))
    // O servidor so descobre que nada mudou DEPOIS de comparar as duas
    // versoes; recusar antes e a regra que nao depende do resultado.
    expect(res.status).toBe(400)
  })

  it('numero reenviado com outra grafia (5000 vs "5000") tambem nao conta como alteracao', async () => {
    const cliente = await criarClienteComoColab('Cliente Numero', { limite: 5000 })
    const antes = await historicoDe('cliente', cliente.id)
    const res = await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ limite: '5000', declarado_por: joaoId, motivo: 'reenvio' }),
    }))
    expect(res.status).toBe(200)
    const depois = await historicoDe('cliente', cliente.id)
    expect(depois).toHaveLength(antes.length)
  })
})

// ===================================================================
// 5. SO O ADMIN LE
// ===================================================================

describe('o historico e admin-only na leitura', () => {
  let clienteId: string

  beforeAll(async () => {
    const cliente = await criarClienteComoColab('Cliente da Leitura')
    clienteId = cliente.id
  })

  it('colaborador -> 403', async () => {
    const res = await pedir(`/api/historico/cliente/${clienteId}`, comoColab())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ erro: 'sem permissao' })
  })

  it('sem cookie -> 401', async () => {
    const res = await pedir(`/api/historico/cliente/${clienteId}`)
    expect(res.status).toBe(401)
  })

  it('admin -> 200', async () => {
    const res = await pedir(`/api/historico/cliente/${clienteId}`, comoAdmin())
    expect(res.status).toBe(200)
  })

  it('entidade fora das tres -> 400', async () => {
    const res = await pedir(`/api/historico/funcionario/${clienteId}`, comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'entidade invalida' })
  })

  it('id malformado -> 400, nao 500', async () => {
    const res = await pedir('/api/historico/cliente/nao-e-uuid', comoAdmin())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ erro: 'id invalido' })
  })
})

// ===================================================================
// 6. IMUTAVEL: NAO EXISTE ROTA DE ALTERAR NEM DE APAGAR
// ===================================================================

describe('historico imutavel: nao ha rota de escrita, alteracao nem exclusao', () => {
  let clienteId: string
  let linhaId: string

  beforeAll(async () => {
    const cliente = await criarClienteComoColab('Cliente Imutavel')
    clienteId = cliente.id
    const historico = await historicoDe('cliente', cliente.id)
    linhaId = historico[0].id
  })

  // NEM O ADMIN consegue. O cookie usado aqui e o do dono de proposito: se a
  // rota existisse e so o colaborador fosse barrado, isto passaria como 403 e
  // o teste nao provaria nada sobre imutabilidade.
  const tentativas: [string, string][] = [
    ['PUT', '/api/historico/cliente/'],
    ['PATCH', '/api/historico/cliente/'],
    ['DELETE', '/api/historico/cliente/'],
    ['POST', '/api/historico/cliente/'],
  ]

  it.each(tentativas)('%s %s:id -> 404 (rota inexistente)', async (metodo, prefixo) => {
    const res = await pedir(`${prefixo}${clienteId}`, comoAdmin({
      method: metodo, ...json({ motivo: 'apagar o rastro' }),
    }))
    expect(res.status).toBe(404)
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('%s /api/historico/:id (pela linha) -> 404', async (metodo) => {
    const res = await pedir(`/api/historico/${linhaId}`, comoAdmin({
      method: metodo, ...json({ motivo: 'apagar o rastro' }),
    }))
    expect(res.status).toBe(404)
  })

  it('e a linha continua la depois de todas as tentativas', async () => {
    const historico = await historicoDe('cliente', clienteId)
    expect(historico.map(h => h.id)).toContain(linhaId)
  })
})

// ===================================================================
// 7. O RASTRO SOBREVIVE AO QUE ELE DOCUMENTA
// ===================================================================

describe('excluir o cadastro NAO apaga o historico', () => {
  it('cliente: a exclusao entra no log e as linhas anteriores ficam', async () => {
    const cliente = await criarClienteComoColab('Cliente Que Sera Apagado')
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ tel: '44 95555-5555', declarado_por: joaoId, motivo: 'atualizei o telefone' }),
    }))

    const apagado = await pedir(`/api/clientes/${cliente.id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)

    const [aindaCliente] = await admin`select id from clientes where id = ${cliente.id}`
    expect(aindaCliente).toBeUndefined()

    const historico = await historicoDe('cliente', cliente.id)
    expect(historico.map(h => h.acao)).toEqual(['excluiu', 'editou', 'criou'])
    // O NOME vai gravado como texto no proprio registro de historico: sem
    // isso, depois da exclusao o log seria uma lista de uuid.
    expect(historico.every(h => h.registro_nome === 'Cliente Que Sera Apagado')).toBe(true)
    expect(historico[0].autor_origem).toBe('login')
  })

  it('produto: idem', async () => {
    const criado = await pedir('/api/produtos', comoColab({
      method: 'POST', ...json({ nome: 'Produto Que Sera Apagado', declarado_por: joaoId, motivo: 'novo' }),
    }))
    const { id } = await criado.json() as { id: string }
    const apagado = await pedir(`/api/produtos/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)
    const historico = await historicoDe('produto', id)
    expect(historico.map(h => h.acao)).toEqual(['excluiu', 'criou'])
  })

  it('fornecedor: idem', async () => {
    const criado = await pedir('/api/fornecedores', comoColab({
      method: 'POST', ...json({ nome: 'Fornecedor Que Sera Apagado', declarado_por: joaoId, motivo: 'novo' }),
    }))
    const { id } = await criado.json() as { id: string }
    const apagado = await pedir(`/api/fornecedores/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(apagado.status).toBe(200)
    const historico = await historicoDe('fornecedor', id)
    expect(historico.map(h => h.acao)).toEqual(['excluiu', 'criou'])
  })

  it('produto com movimentacao: a exclusao e barrada e NAO deixa log de exclusao que nao aconteceu', async () => {
    const criado = await pedir('/api/produtos', comoColab({
      method: 'POST', ...json({ nome: 'Produto Com Movimento', declarado_por: joaoId, motivo: 'novo' }),
    }))
    const { id } = await criado.json() as { id: string }
    await admin`
      insert into perdas (tenant_id, data, produto_id, qtd)
      values (${tenantId}, current_date, ${id}, 1)`

    const res = await pedir(`/api/produtos/${id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(409)
    const historico = await historicoDe('produto', id)
    // A transacao inteira e revertida: nada de "excluiu" no log de um
    // produto que continua no cadastro.
    expect(historico.map(h => h.acao)).toEqual(['criou'])
  })
})

describe('excluir o FUNCIONARIO declarado nao apaga o rastro nem esvazia o nome', () => {
  it('o ponteiro vira nulo, o nome fica', async () => {
    const [temporario] = await admin`
      insert into funcionarios (tenant_id, nome, salario)
      values (${tenantId}, 'Pedro Temporario', 1800) returning id`

    const criado = await pedir('/api/clientes', comoColab({
      method: 'POST',
      ...json({ nome: 'Cliente do Pedro', declarado_por: temporario.id, motivo: 'cadastrei na rua' }),
    }))
    expect(criado.status).toBe(201)
    const { id } = await criado.json() as { id: string }

    const antes = await historicoDe('cliente', id)
    expect(antes[0].autor_funcionario_id).toBe(temporario.id)
    expect(antes[0].autor_nome).toBe('Pedro Temporario')

    // Pedro sai da empresa e o dono exclui o cadastro dele.
    const res = await pedir(`/api/funcionarios/${temporario.id}`, comoAdmin({ method: 'DELETE' }))
    expect(res.status).toBe(200)
    const [aindaFuncionario] = await admin`select id from funcionarios where id = ${temporario.id}`
    expect(aindaFuncionario).toBeUndefined()

    const depois = await historicoDe('cliente', id)
    expect(depois).toHaveLength(1)
    // O PONTEIRO some (`set null (autor_funcionario_id)`, 017) — o NOME, nao.
    // Um log que perde a evidencia quando alguem e removido nao e log.
    expect(depois[0].autor_funcionario_id).toBeNull()
    expect(depois[0].autor_nome).toBe('Pedro Temporario')
    expect(depois[0].autor_origem).toBe('declarado')
    expect(depois[0].motivo).toBe('cadastrei na rua')
  })

  it('e a exclusao do funcionario nao e BARRADA pelo historico (nada de restrict)', async () => {
    const [outro] = await admin`
      insert into funcionarios (tenant_id, nome, salario)
      values (${tenantId}, 'Ana Temporaria', 1800) returning id`
    await pedir('/api/produtos', comoColab({
      method: 'POST', ...json({ nome: 'Produto da Ana', declarado_por: outro.id, motivo: 'novo' }),
    }))
    const res = await pedir(`/api/funcionarios/${outro.id}`, comoAdmin({ method: 'DELETE' }))
    // `restrict` aqui reproduziria o bloqueio permanente da 015: linhas que
    // nenhuma tela alcanca travando a exclusao para sempre.
    expect(res.status).toBe(200)
  })
})

// ===================================================================
// 8. ISOLAMENTO ENTRE EMPRESAS
// ===================================================================

describe('isolamento entre dois tenants de verdade', () => {
  it('o admin da outra empresa nao le o historico deste cliente', async () => {
    const cliente = await criarClienteComoColab('Cliente Isolado')
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ rota: 'Sul Z', declarado_por: joaoId, motivo: 'mudou de rota' }),
    }))

    const meu = await historicoDe('cliente', cliente.id)
    expect(meu.length).toBeGreaterThanOrEqual(2)

    const res = await pedir(`/api/historico/cliente/${cliente.id}`, comoAdminDoOutroTenant())
    expect(res.status).toBe(200)
    // Mesmo id, mesma URL, cookie de outra empresa: lista vazia. Nao e 404
    // porque a rota nao sabe (nem deve saber) que o registro existe do outro
    // lado da RLS.
    expect(await res.json()).toEqual([])
  })

  it('a RLS tambem barra a leitura direta da tabela pelo outro tenant', async () => {
    const cliente = await criarClienteComoColab('Cliente Isolado 2')
    const doOutro = await withTenant(sql, outroTenantId, tx =>
      tx`select id from historico_cadastros where registro_id = ${cliente.id}`)
    expect(doOutro).toHaveLength(0)
    const meu = await withTenant(sql, tenantId, tx =>
      tx`select id from historico_cadastros where registro_id = ${cliente.id}`)
    expect(meu).toHaveLength(1)
  })

  it('sem tenant fixado, a tabela inteira e invisivel', async () => {
    const linhas = await sql`select id from historico_cadastros`
    expect(linhas).toHaveLength(0)
  })

  it('nao da para gravar historico para outra empresa', async () => {
    await expect(
      withTenant(sql, tenantId, tx => tx`
        insert into historico_cadastros
          (tenant_id, entidade, registro_id, registro_nome, acao, autor_origem, autor_nome)
        values (${outroTenantId}, 'cliente', gen_random_uuid(), 'Invasor', 'criou', 'login', 'X')`),
    ).rejects.toThrow()
  })
})

// ===================================================================
// 9. O QUE A LINHA GUARDA
// ===================================================================

describe('a linha de historico guarda o que o dono vai perguntar', () => {
  it('data, quem declarou ser, o motivo e o que mudou', async () => {
    const cliente = await criarClienteComoColab('Cliente Completo', { tel: '44 90000-0001' })
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT',
      ...json({ tel: '44 90000-0002', declarado_por: joaoId, motivo: 'cliente ligou avisando' }),
    }))
    const [linha] = await historicoDe('cliente', cliente.id)

    // A data sai do banco ja no fuso de Sao Paulo e formatada como texto —
    // sem Date nem fuso no caminho do JS. Ver o to_char em routes/historico.ts.
    expect(linha.criado_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(linha.autor_nome).toBe('Joao da Silva')
    expect(linha.motivo).toBe('cliente ligou avisando')
    expect(linha.alteracoes).toEqual([
      { campo: 'tel', de: '44 90000-0001', para: '44 90000-0002' },
    ])
  })

  it('o motivo e gravado sem espacos nas pontas', async () => {
    const cliente = await criarClienteComoColab('Cliente Motivo Trim')
    await pedir(`/api/clientes/${cliente.id}`, comoColab({
      method: 'PUT', ...json({ rota: 'Norte X', declarado_por: joaoId, motivo: '   corrigi a rota   ' }),
    }))
    const [linha] = await historicoDe('cliente', cliente.id)
    expect(linha.motivo).toBe('corrigi a rota')
  })

  it('`declarado_por` e `motivo` nao viram colunas do cadastro (sanear ignora o extra)', async () => {
    const cliente = await criarClienteComoColab('Cliente Sem Vazamento')
    const [linha] = await admin<Record<string, unknown>[]>`
      select * from clientes where id = ${cliente.id}`
    expect(linha).not.toHaveProperty('declarado_por')
    expect(linha.obs).toBe('')
  })

  it('a tabela nao tem coluna `alterado_em`: nada aqui e alterado depois', async () => {
    const cliente = await criarClienteComoColab('Cliente Imutabilidade Schema')
    const [linha] = await linhasNoBanco(cliente.id) as unknown as Record<string, unknown>[]
    expect(linha).toBeDefined()
    expect(linha).not.toHaveProperty('alterado_em')
  })
})
