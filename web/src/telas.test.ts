import { describe, it, expect } from 'vitest'
import {
  ADMIN_ONLY_SCREENS,
  podeVerMetricasDeCadastro,
  podeExcluirCadastro,
  podeVerHistoricoCadastro,
  precisaDeclararAutoria,
  precisaDeclararAutoriaAoSalvarProduto,
  type Tela,
} from './telas'

/**
 * A decisão de papel mora aqui, em função pura, e não espalhada em
 * `papel === 'admin'` dentro do JSX de cinco telas. Este arquivo é o teste
 * dela — as telas só exibem o que estas três coisas respondem.
 */

/** As três telas de cadastro que o colaborador passou a ver. */
const CADASTROS: Tela[] = ['clientes', 'produtos', 'fornecedores']

/** As telas que CONTINUAM restritas — a metade que ninguém pode afrouxar sem
 * querer junto com a outra. */
const RESTRITAS: Tela[] = ['dashboard', 'financeiro', 'relatorios', 'funcionarios', 'veiculos']

/** O trabalho do colaborador desde sempre. */
const OPERACAO: Tela[] = ['entradas', 'pedidos', 'estoque']

describe('ADMIN_ONLY_SCREENS', () => {
  it('nao contem mais clientes, produtos nem fornecedores', () => {
    for (const tela of CADASTROS) {
      expect(ADMIN_ONLY_SCREENS).not.toContain(tela)
    }
  })

  it('continua restringindo painel, Financeiro, Relatorios, Funcionarios e Veiculos', () => {
    for (const tela of RESTRITAS) {
      expect(ADMIN_ONLY_SCREENS).toContain(tela)
    }
  })

  it('nao restringe as telas de operacao (entradas, saidas, estoque)', () => {
    for (const tela of OPERACAO) {
      expect(ADMIN_ONLY_SCREENS).not.toContain(tela)
    }
  })

  // Lista fechada: um valor novo entrando aqui sem intencao (ou uma das cinco
  // saindo) e exatamente o tipo de mudanca silenciosa que abre uma tela de
  // dinheiro para quem nao deveria ve-la.
  it('e exatamente estas cinco telas', () => {
    expect([...ADMIN_ONLY_SCREENS].sort()).toEqual([...RESTRITAS].sort())
  })
})

describe('podeVerMetricasDeCadastro', () => {
  it('admin ve as metricas', () => {
    expect(podeVerMetricasDeCadastro('admin')).toBe(true)
  })

  // O que fica escondido: markup, margem, faturado, inadimplencia, health
  // score, preco medio de compra, aproveitamento... — ver o comentario da
  // funcao para a lista por tela e para o que isso NAO e (permissao).
  it('colaborador nao ve as metricas', () => {
    expect(podeVerMetricasDeCadastro('colaborador')).toBe(false)
  })
})

describe('podeExcluirCadastro', () => {
  it('admin exclui', () => {
    expect(podeExcluirCadastro('admin')).toBe(true)
  })

  it('colaborador nao exclui', () => {
    expect(podeExcluirCadastro('colaborador')).toBe(false)
  })
})

describe('precisaDeclararAutoria', () => {
  // O fato que obriga isto a existir: ha UM login para a equipe inteira. O
  // sistema nao tem como SABER quem digitou — sabe qual login escreveu, que e
  // outra coisa. Entao o colaborador declara.
  it('colaborador declara quem e e por que', () => {
    expect(precisaDeclararAutoria('colaborador')).toBe(true)
  })

  // E nao e cortesia com o dono: o login dele e individual. Pedir que ele
  // preenchesse um campo de autoria transformaria um dado que o servidor
  // CONHECE num dado digitado — pior, nao melhor.
  it('admin nao declara nada', () => {
    expect(precisaDeclararAutoria('admin')).toBe(false)
  })
})

describe('precisaDeclararAutoriaAoSalvarProduto', () => {
  // A MUDANÇA: criar produto deixou de exigir declaração. Este é o teste que
  // pega uma regressão que reintroduzisse a exigência na criação — e também
  // o teste sensível à mutação inversa: se alguém trocar `editando` por
  // `!editando` aqui (ou em `precisaDeclararAutoriaAoSalvarProduto`), a
  // criação passaria a EXIGIR e a edição passaria a DISPENSAR — o oposto do
  // pedido do dono.
  it('colaborador CRIANDO produto: nao precisa declarar (a mudanca deste commit)', () => {
    expect(precisaDeclararAutoriaAoSalvarProduto('colaborador', false)).toBe(false)
  })

  it('colaborador EDITANDO produto: continua precisando declarar', () => {
    expect(precisaDeclararAutoriaAoSalvarProduto('colaborador', true)).toBe(true)
  })

  it('admin nunca declara, criando ou editando', () => {
    expect(precisaDeclararAutoriaAoSalvarProduto('admin', false)).toBe(false)
    expect(precisaDeclararAutoriaAoSalvarProduto('admin', true)).toBe(false)
  })

  it('e a composicao de precisaDeclararAutoria com o estado de edicao — nao uma regra nova', () => {
    for (const papel of ['admin', 'colaborador'] as const) {
      for (const editando of [true, false]) {
        expect(precisaDeclararAutoriaAoSalvarProduto(papel, editando))
          .toBe(precisaDeclararAutoria(papel) && editando)
      }
    }
  })
})

describe('podeVerHistoricoCadastro', () => {
  it('admin le o historico', () => {
    expect(podeVerHistoricoCadastro('admin')).toBe(true)
  })

  // Log de supervisao aberto a quem e supervisionado vira a lista de quem
  // declarou o que — util para combinar versao, nao para conferir.
  it('colaborador nao le o historico', () => {
    expect(podeVerHistoricoCadastro('colaborador')).toBe(false)
  })
})

describe('declarar e ler historico sao decisoes OPOSTAS, nao a mesma invertida', () => {
  // Hoje elas sao complementares para os dois papeis que existem, e por isso
  // e tentador escrever uma so e usar `!` na outra. Sao perguntas diferentes:
  // "tem que dizer quem e" e "pode ler o que os outros disseram". Um papel
  // futuro (um gerente, por exemplo) poderia declarar E ler, e ai um `!`
  // teria escondido o historico dele sem ninguem pedir.
  it('cada uma responde por si, sem chamar a outra', () => {
    expect(precisaDeclararAutoria.length).toBe(1)
    expect(podeVerHistoricoCadastro.length).toBe(1)
  })

  it('o par admin/colaborador e o esperado hoje', () => {
    expect([precisaDeclararAutoria('admin'), podeVerHistoricoCadastro('admin')]).toEqual([false, true])
    expect([precisaDeclararAutoria('colaborador'), podeVerHistoricoCadastro('colaborador')]).toEqual([true, false])
  })
})

describe('as decisoes de papel sao independentes', () => {
  // Elas hoje respondem igual, e por isso e tentador escrever uma so. Sao
  // perguntas diferentes: "pode VER o numero" e "pode APAGAR o registro" —
  // se um dia o dono liberar a exclusao para o colaborador, ou esconder
  // metrica de algum admin, quem mudar tem que mexer numa funcao so.
  it('cada uma responde por si, sem chamar a outra', () => {
    expect(podeVerMetricasDeCadastro.length).toBe(1)
    expect(podeExcluirCadastro.length).toBe(1)
  })
})
