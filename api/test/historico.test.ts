import { describe, it, expect } from 'vitest'
import {
  diferencas, erroDeDeclaracao, tentouDeclarar, textoDoValor, vaiGravar, ENTIDADES_HISTORICO,
} from '../src/historico'

/**
 * As funcoes PURAS do historico de alteracoes, testadas sem banco e sem HTTP.
 * Elas decidem o CONTEUDO do log — o que entra, o que fica de fora, e quando
 * nada e gravado. Um erro aqui e um log que mente em silencio, que e a pior
 * falha possivel num registro de auditoria: ninguem descobre olhando a tela.
 *
 * O caminho de ponta a ponta (rota, permissao, banco, RLS, sobrevivencia a
 * exclusao) esta em test/historico.http.test.ts.
 */

describe('textoDoValor', () => {
  it('numero vira o texto dele', () => {
    expect(textoDoValor(5000)).toBe('5000')
    expect(textoDoValor(0)).toBe('0')
  })

  it('null e undefined viram string vazia — nao "null", nao "0"', () => {
    // Campo em branco e campo em branco. Quem transforma '' em travessao na
    // tela e a camada de exibicao; ZERO nunca pode virar travessao, e
    // travessao nunca pode virar zero.
    expect(textoDoValor(null)).toBe('')
    expect(textoDoValor(undefined)).toBe('')
    expect(textoDoValor(0)).not.toBe('')
  })

  it('string passa inteira, com espacos e acentos', () => {
    expect(textoDoValor('  Mercado Bom Preço ')).toBe('  Mercado Bom Preço ')
  })

  it('booleano vira texto', () => {
    expect(textoDoValor(true)).toBe('true')
    expect(textoDoValor(false)).toBe('false')
  })

  it('Date vira ISO, sem depender do fuso da maquina que roda o teste', () => {
    expect(textoDoValor(new Date(Date.UTC(2026, 7, 28, 12, 0, 0)))).toBe('2026-08-28T12:00:00.000Z')
  })
})

describe('diferencas', () => {
  const CAMPOS = ['nome', 'tel', 'limite'] as const

  it('so os campos que realmente mudaram', () => {
    const antes = { nome: 'Bom Preço', tel: '44 1111', limite: '5000.00' }
    const depois = { nome: 'Bom Preço', tel: '44 2222', limite: '5000.00' }
    expect(diferencas(antes, depois, CAMPOS)).toEqual([
      { campo: 'tel', de: '44 1111', para: '44 2222' },
    ])
  })

  it('nada mudou -> lista vazia (e e isso que impede o registro barulhento)', () => {
    const linha = { nome: 'Bom Preço', tel: '44 1111', limite: '5000.00' }
    expect(diferencas(linha, { ...linha }, CAMPOS)).toEqual([])
  })

  it('campo fora da lista NAO entra, mesmo tendo mudado', () => {
    // `alterado_em` muda em todo PUT. Se entrasse, "PUT que nao muda nada nao
    // gera registro" nunca poderia valer — e `tenant_id` num log de alteracao
    // seria ruido puro.
    const antes = { nome: 'X', tel: '', limite: '0.00', alterado_em: 'A', tenant_id: 'T1' }
    const depois = { nome: 'X', tel: '', limite: '0.00', alterado_em: 'B', tenant_id: 'T1' }
    expect(diferencas(antes, depois, CAMPOS)).toEqual([])
  })

  it('preenchimento de campo vazio: de = "" e para = valor', () => {
    expect(diferencas({ tel: '' }, { tel: '44 3333' }, ['tel'])).toEqual([
      { campo: 'tel', de: '', para: '44 3333' },
    ])
  })

  it('apagar um campo: de = valor e para = ""', () => {
    expect(diferencas({ tel: '44 3333' }, { tel: '' }, ['tel'])).toEqual([
      { campo: 'tel', de: '44 3333', para: '' },
    ])
  })

  it('null -> valor conta como alteracao; null -> null nao', () => {
    expect(diferencas({ tel: null }, { tel: '44 4444' }, ['tel'])).toHaveLength(1)
    expect(diferencas({ tel: null }, { tel: undefined }, ['tel'])).toHaveLength(0)
  })

  it('preserva a ORDEM dos campos declarados, nao a do objeto', () => {
    const antes = { limite: '1.00', nome: 'A', tel: 'x' }
    const depois = { limite: '2.00', nome: 'B', tel: 'y' }
    expect(diferencas(antes, depois, CAMPOS).map(a => a.campo)).toEqual(['nome', 'tel', 'limite'])
  })

  it('numeric do Postgres compara como texto: "5000.00" != "5000.000"', () => {
    // Os dois lados vem da MESMA fonte (a linha antes e a linha depois), entao
    // na pratica a grafia e a mesma. O teste fixa o comportamento: e o TEXTO
    // que o dono vai ler no log, e e ele que decide se houve mudanca.
    expect(diferencas({ limite: '5000.00' }, { limite: '5000.000' }, ['limite'])).toHaveLength(1)
  })
})

describe('erroDeDeclaracao — a exigencia que vale no servidor', () => {
  it('admin nunca precisa declarar', () => {
    expect(erroDeDeclaracao('admin', {})).toBeNull()
  })

  it('admin com declaracao tambem passa (o campo e simplesmente ignorado depois)', () => {
    expect(erroDeDeclaracao('admin', { declarado_por: 'x', motivo: 'y' })).toBeNull()
  })

  it('colaborador sem nada -> erro de autor', () => {
    expect(erroDeDeclaracao('colaborador', {}))
      .toBe('informe quem esta fazendo esta alteracao')
  })

  it('colaborador so com motivo -> erro de autor (o autor e cobrado primeiro)', () => {
    expect(erroDeDeclaracao('colaborador', { motivo: 'porque sim' }))
      .toBe('informe quem esta fazendo esta alteracao')
  })

  it('colaborador so com autor -> erro de motivo', () => {
    expect(erroDeDeclaracao('colaborador', { declarado_por: 'id-1' }))
      .toBe('informe o motivo da alteracao')
  })

  it('motivo so com espacos e o mesmo que motivo ausente', () => {
    // Motivo opcional e motivo que ninguem preenche; motivo em branco e a
    // versao disfarcada disso.
    expect(erroDeDeclaracao('colaborador', { declarado_por: 'id-1', motivo: '   ' }))
      .toBe('informe o motivo da alteracao')
  })

  it('autor so com espacos e o mesmo que autor ausente', () => {
    expect(erroDeDeclaracao('colaborador', { declarado_por: '  ', motivo: 'x' }))
      .toBe('informe quem esta fazendo esta alteracao')
  })

  it('autor que nao e string (numero, objeto, null) e recusado', () => {
    for (const valor of [1, null, {}, [], true]) {
      expect(erroDeDeclaracao('colaborador', { declarado_por: valor, motivo: 'x' }))
        .toBe('informe quem esta fazendo esta alteracao')
    }
  })

  it('colaborador com os dois -> passa', () => {
    expect(erroDeDeclaracao('colaborador', { declarado_por: 'id-1', motivo: 'trocou o telefone' }))
      .toBeNull()
  })

  it('NADA que o corpo mande sobre papel muda a decisao', () => {
    // O papel vem da sessao. Se um campo do corpo pudesse alterar isso,
    // qualquer um editaria sem rastro mandando `papel: 'admin'` junto.
    expect(erroDeDeclaracao('colaborador', { papel: 'admin' }))
      .toBe('informe quem esta fazendo esta alteracao')
    expect(erroDeDeclaracao('colaborador', { admin: true, autor_origem: 'login' }))
      .toBe('informe quem esta fazendo esta alteracao')
  })
})

describe('tentouDeclarar — so a criacao de produto chama isto', () => {
  it('admin: sempre true (login sempre disponivel, nada mudou pra ele)', () => {
    expect(tentouDeclarar('admin', {})).toBe(true)
    expect(tentouDeclarar('admin', { declarado_por: 'x' })).toBe(true)
  })

  it('colaborador sem declarado_por: false — cria sem autor a resolver', () => {
    expect(tentouDeclarar('colaborador', {})).toBe(false)
  })

  it('colaborador com declarado_por vazio ou so espacos: false, mesma regra de ausente', () => {
    expect(tentouDeclarar('colaborador', { declarado_por: '' })).toBe(false)
    expect(tentouDeclarar('colaborador', { declarado_por: '   ' })).toBe(false)
  })

  it('colaborador com declarado_por que nao e string: false', () => {
    for (const valor of [1, null, undefined, {}, [], true]) {
      expect(tentouDeclarar('colaborador', { declarado_por: valor })).toBe(false)
    }
  })

  it('colaborador com declarado_por preenchido: true — quer se declarar, e vai por autorDaAlteracao', () => {
    expect(tentouDeclarar('colaborador', { declarado_por: 'id-1' })).toBe(true)
  })

  it('motivo sozinho, sem declarado_por, NAO conta — quem decide e o autor, nao o motivo', () => {
    expect(tentouDeclarar('colaborador', { motivo: 'um motivo qualquer' })).toBe(false)
  })
})

describe('vaiGravar', () => {
  it('editar sem nenhuma mudanca nao grava', () => {
    expect(vaiGravar('editou', [])).toBe(false)
  })

  it('editar com mudanca grava', () => {
    expect(vaiGravar('editou', [{ campo: 'tel', de: 'a', para: 'b' }])).toBe(true)
  })

  it('criar e excluir gravam mesmo com a lista vazia — a acao E a informacao', () => {
    expect(vaiGravar('criou', [])).toBe(true)
    expect(vaiGravar('excluiu', [])).toBe(true)
  })
})

describe('ENTIDADES_HISTORICO', () => {
  it('sao as tres do pedido do dono, e mais nada', () => {
    // A lista e fechada tambem no CHECK da migration 017. Acrescentar
    // funcionarios ou veiculos aqui e decisao de produto, nao uma string nova
    // aparecendo em producao sem ninguem notar.
    expect([...ENTIDADES_HISTORICO]).toEqual(['cliente', 'produto', 'fornecedor'])
  })
})
