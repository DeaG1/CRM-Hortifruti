import { describe, it, expect } from 'vitest'
import {
  ADMIN_ONLY_SCREENS,
  podeVerMetricasDeCadastro,
  podeExcluirCadastro,
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

describe('as duas decisoes sao independentes', () => {
  // Elas hoje respondem igual, e por isso e tentador escrever uma so. Sao
  // perguntas diferentes: "pode VER o numero" e "pode APAGAR o registro" —
  // se um dia o dono liberar a exclusao para o colaborador, ou esconder
  // metrica de algum admin, quem mudar tem que mexer numa funcao so.
  it('cada uma responde por si, sem chamar a outra', () => {
    expect(podeVerMetricasDeCadastro.length).toBe(1)
    expect(podeExcluirCadastro.length).toBe(1)
  })
})
