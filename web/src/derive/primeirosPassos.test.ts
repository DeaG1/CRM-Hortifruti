import { describe, it, expect } from 'vitest'
import {
  guiaDePrimeirosPassos,
  TOTAL_DE_PASSOS,
  type ContagensDeCadastro,
  type PassoId,
} from './primeirosPassos'

const ZERADO: ContagensDeCadastro = {
  produtos: 0, fornecedores: 0, clientes: 0, entradas: 0, saidas: 0,
}

const contagens = (over: Partial<ContagensDeCadastro> = {}): ContagensDeCadastro =>
  ({ ...ZERADO, ...over })

/** A ordem obrigatória, escrita à mão para o teste não copiar o módulo. */
const ORDEM: PassoId[] = ['produtos', 'fornecedores', 'clientes', 'entradas', 'saidas']

function idDoPassoAtual(c: ContagensDeCadastro): PassoId | null {
  const guia = guiaDePrimeirosPassos(c)
  return guia.passos.find(p => p.atual)?.id ?? null
}

describe('guiaDePrimeirosPassos — sistema zerado', () => {
  it('abre com os cinco passos pendentes, na ordem obrigatória', () => {
    const guia = guiaDePrimeirosPassos(ZERADO)
    expect(guia.aberto).toBe(true)
    expect(guia.passos.map(p => p.id)).toEqual(ORDEM)
    expect(guia.passos.every(p => !p.feito)).toBe(true)
    expect(guia.feitos).toBe(0)
    expect(guia.progresso).toBe('0 de 5')
    expect(guia.barraPct).toBe(0)
  })

  it('o passo atual é o primeiro (produtos) e só ele tem botão', () => {
    const guia = guiaDePrimeirosPassos(ZERADO)
    expect(idDoPassoAtual(ZERADO)).toBe('produtos')
    expect(guia.passos.filter(p => p.mostrarCta).map(p => p.id)).toEqual(['produtos'])
    expect(guia.titulo).toBe('Próximo passo: Cadastrar produtos')
    expect(guia.sub).toBe('Siga a ordem — cada passo depende do anterior.')
  })

  it('nenhum passo pendente anuncia contagem — travessão nunca vira "0 cadastrado(s)"', () => {
    const guia = guiaDePrimeirosPassos(ZERADO)
    expect(guia.passos.map(p => p.contagemTexto)).toEqual(['', '', '', '', ''])
  })

  it('a bolinha do passo pendente traz o número, não o ✓', () => {
    expect(guiaDePrimeirosPassos(ZERADO).passos.map(p => p.marca)).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('guiaDePrimeirosPassos — preenchimento parcial, um estágio de cada vez', () => {
  const estagios: { feito: Partial<ContagensDeCadastro>; proximo: PassoId; progresso: string; pct: number }[] = [
    { feito: { produtos: 3 }, proximo: 'fornecedores', progresso: '1 de 5', pct: 20 },
    { feito: { produtos: 3, fornecedores: 2 }, proximo: 'clientes', progresso: '2 de 5', pct: 40 },
    { feito: { produtos: 3, fornecedores: 2, clientes: 9 }, proximo: 'entradas', progresso: '3 de 5', pct: 60 },
    { feito: { produtos: 3, fornecedores: 2, clientes: 9, entradas: 1 }, proximo: 'saidas', progresso: '4 de 5', pct: 80 },
  ]

  for (const e of estagios) {
    it(`com ${Object.keys(e.feito).join(' + ')} cumpridos, o passo atual é ${e.proximo}`, () => {
      const c = contagens(e.feito)
      const guia = guiaDePrimeirosPassos(c)
      expect(guia.aberto).toBe(true)
      expect(idDoPassoAtual(c)).toBe(e.proximo)
      expect(guia.progresso).toBe(e.progresso)
      expect(guia.barraPct).toBe(e.pct)
      expect(guia.titulo).toBe(`Próximo passo: ${guia.passos.find(p => p.atual)!.label}`)
    })
  }

  it('o passo cumprido vira ✓ e mostra quantos existem', () => {
    const guia = guiaDePrimeirosPassos(contagens({ produtos: 7 }))
    const produtos = guia.passos[0]
    expect(produtos.feito).toBe(true)
    expect(produtos.marca).toBe('✓')
    expect(produtos.contagemTexto).toBe('7 cadastrado(s)')
    expect(produtos.mostrarCta).toBe(false)
  })

  it('o botão aparece SÓ no passo atual, mesmo com passos pendentes depois dele', () => {
    const guia = guiaDePrimeirosPassos(contagens({ produtos: 1 }))
    expect(guia.passos.filter(p => p.mostrarCta).map(p => p.id)).toEqual(['fornecedores'])
    // os passos 4 e 5 continuam pendentes e continuam sem botão: seguir a
    // ordem é a regra que o guia existe para ensinar
    expect(guia.passos.find(p => p.id === 'entradas')!.mostrarCta).toBe(false)
    expect(guia.passos.find(p => p.id === 'saidas')!.mostrarCta).toBe(false)
  })

  it('um passo pulado (fornecedor cadastrado antes do produto) continua sendo o passo 1 o atual', () => {
    // Cumprir fora de ordem é possível na prática (as telas não se travam
    // entre si); o guia continua apontando o primeiro buraco.
    const c = contagens({ fornecedores: 4, clientes: 4 })
    expect(idDoPassoAtual(c)).toBe('produtos')
    expect(guiaDePrimeirosPassos(c).progresso).toBe('2 de 5')
  })

  it('cada passo leva à tela dele', () => {
    const destinos = guiaDePrimeirosPassos(ZERADO).passos.map(p => [p.id, p.tela])
    expect(destinos).toEqual([
      ['produtos', 'produtos'],
      ['fornecedores', 'fornecedores'],
      ['clientes', 'clientes'],
      ['entradas', 'entradas'],
      // "Saídas (Vendas)" se chama 'pedidos' em telas.ts
      ['saidas', 'pedidos'],
    ])
  })

  it('cada passo tem rótulo, dica e botão próprios — nenhum texto vazio', () => {
    for (const p of guiaDePrimeirosPassos(ZERADO).passos) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.hint.length).toBeGreaterThan(0)
      expect(p.cta.length).toBeGreaterThan(0)
    }
  })

  // Termo generico ("cliente"), nao o do primeiro tenant (hortifruti) — o
  // CRM passou a ser vendido para ramos onde "minimercado" nao faz sentido.
  it('a dica do passo de clientes usa o termo genérico "cliente"', () => {
    const passo = guiaDePrimeirosPassos(ZERADO).passos.find(p => p.id === 'clientes')
    expect(passo?.hint).toBe('Os clientes que você atende')
  })
})

describe('guiaDePrimeirosPassos — os cinco cumpridos: o guia some', () => {
  it('fecha quando tudo está cumprido', () => {
    const guia = guiaDePrimeirosPassos(contagens({
      produtos: 12, fornecedores: 4, clientes: 30, entradas: 88, saidas: 210,
    }))
    expect(guia.aberto).toBe(false)
    expect(guia.passos).toEqual([])
  })

  it('a última entrada da contagem é a saída — basta ela para fechar', () => {
    expect(guiaDePrimeirosPassos(contagens({ saidas: 1 })).aberto).toBe(false)
  })
})

describe('guiaDePrimeirosPassos — regressão depois de cumprido', () => {
  it('operação madura que perde todos os produtos NÃO revê o guia', () => {
    // Ele já atravessou a cadeia inteira (há saída lançada). Um zero em
    // produtos agora é problema de operação, e quem avisa são os
    // indicadores e o Estoque — não um painel de onboarding voltando.
    const guia = guiaDePrimeirosPassos(contagens({
      produtos: 0, fornecedores: 4, clientes: 30, entradas: 88, saidas: 210,
    }))
    expect(guia.aberto).toBe(false)
  })

  it('quem perde clientes e entradas, mas ainda tem saída no histórico, também não revê', () => {
    expect(guiaDePrimeirosPassos(contagens({ saidas: 3 })).aberto).toBe(false)
  })

  it('regressão TOTAL a zero revê o guia inteiro, do passo 1', () => {
    const guia = guiaDePrimeirosPassos(ZERADO)
    expect(guia.aberto).toBe(true)
    expect(idDoPassoAtual(ZERADO)).toBe('produtos')
    expect(guia.progresso).toBe('0 de 5')
  })

  it('apagou as saídas mas manteve os cadastros: o guia volta apontando a saída', () => {
    const c = contagens({ produtos: 12, fornecedores: 4, clientes: 30, entradas: 88, saidas: 0 })
    const guia = guiaDePrimeirosPassos(c)
    expect(guia.aberto).toBe(true)
    expect(idDoPassoAtual(c)).toBe('saidas')
    expect(guia.progresso).toBe('4 de 5')
  })
})

describe('guiaDePrimeirosPassos — falha de verificação', () => {
  it('sem contagens (a carga falhou) o guia NÃO aparece', () => {
    const guia = guiaDePrimeirosPassos(null)
    expect(guia.aberto).toBe(false)
    expect(guia.passos).toEqual([])
  })

  it('nunca afirma que falta um passo quando não conseguiu verificar', () => {
    // O defeito que este teste protege: dizer "cadastre um produto" para
    // quem tem cem produtos e sofreu um erro de rede.
    const guia = guiaDePrimeirosPassos(null)
    expect(guia.titulo).toBe('')
    expect(guia.passos.some(p => p.mostrarCta)).toBe(false)
  })
})

describe('guiaDePrimeirosPassos — dispensa manual', () => {
  it('dispensado fecha o painel mesmo com os cinco passos pendentes', () => {
    expect(guiaDePrimeirosPassos(ZERADO, true).aberto).toBe(false)
  })

  it('dispensado fecha em qualquer estágio de preenchimento', () => {
    for (const feitos of [{ produtos: 1 }, { produtos: 1, fornecedores: 1 }, { produtos: 1, fornecedores: 1, clientes: 1, entradas: 1 }]) {
      expect(guiaDePrimeirosPassos(contagens(feitos), true).aberto).toBe(false)
    }
  })

  it('não dispensado é o padrão do parâmetro', () => {
    expect(guiaDePrimeirosPassos(ZERADO).aberto).toBe(guiaDePrimeirosPassos(ZERADO, false).aberto)
  })

  it('a dispensa continua valendo depois de uma regressão a zero', () => {
    // Reabrir sozinho o que a pessoa fechou de propósito é pior que
    // qualquer dado que ela deixe de ver.
    expect(guiaDePrimeirosPassos(ZERADO, true).aberto).toBe(false)
  })
})

describe('guiaDePrimeirosPassos — contagens estranhas', () => {
  it('contagem negativa não conta como passo cumprido', () => {
    const guia = guiaDePrimeirosPassos(contagens({ produtos: -3 }))
    expect(guia.passos[0].feito).toBe(false)
    expect(guia.feitos).toBe(0)
  })

  it('contagem fracionária é truncada antes de virar texto', () => {
    const guia = guiaDePrimeirosPassos(contagens({ produtos: 2.7 }))
    expect(guia.passos[0].contagemTexto).toBe('2 cadastrado(s)')
  })

  it('NaN não cumpre passo nenhum', () => {
    const guia = guiaDePrimeirosPassos(contagens({ produtos: Number.NaN }))
    expect(guia.passos[0].feito).toBe(false)
  })

  it('sempre cinco passos', () => {
    expect(TOTAL_DE_PASSOS).toBe(5)
    expect(guiaDePrimeirosPassos(ZERADO).passos).toHaveLength(TOTAL_DE_PASSOS)
  })
})

describe('guiaDePrimeirosPassos — a barra e o contador andam juntos', () => {
  it('progresso e barra concordam em todos os estágios', () => {
    const acumulando: Partial<ContagensDeCadastro> = {}
    const campos: (keyof ContagensDeCadastro)[] = ['produtos', 'fornecedores', 'clientes', 'entradas']
    let esperado = 0
    for (const campo of campos) {
      acumulando[campo] = 1
      esperado++
      const guia = guiaDePrimeirosPassos(contagens(acumulando))
      expect(guia.feitos).toBe(esperado)
      expect(guia.progresso).toBe(`${esperado} de 5`)
      expect(guia.barraPct).toBe(esperado * 20)
    }
  })
})
