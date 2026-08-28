import { describe, it, expect } from 'vitest'
import { UNIDADES } from './produtos'

/**
 * A LISTA DE UNIDADES FICA FIXADA AQUI, DE PROPÓSITO.
 *
 * Estes testes existem para tornar a próxima mudança das unidades DELIBERADA.
 * Trocar 'DZ' por 'BDJA' (migration 018) foi decisão de produto do dono do
 * negócio, e a lista que a UI oferece tem de continuar sendo a mesma que o
 * banco aceita (`produtos_un_check`) — se as duas divergirem, o usuário vê no
 * `<select>` uma unidade que o servidor rejeita ao salvar, ou deixa de ver
 * uma que ele aceita. Nenhum dos dois dá erro visível em teste de tela.
 *
 * Quem vier mudar unidade vai ter de mudar ESTE arquivo junto, e ao fazê-lo
 * lê o motivo. É o oposto de uma lista que alguém edita de passagem.
 */
describe('UNIDADES — a lista aceita pelo sistema', () => {
  it('é exatamente esta lista, nesta ordem', () => {
    // Mudou? Então mude a migration correspondente no mesmo commit
    // (`produtos_un_check`) e explique o porquê, como a 018 explicou.
    expect(UNIDADES).toEqual(['KG', 'CX', 'UN', 'BDJA', 'MC'])
  })

  it("'DZ' (dúzia) não existe mais — este hortifruti não vende por dúzia", () => {
    // A migration 018 tirou 'DZ' do CHECK e converteu o dado já gravado.
    // Se ela voltar aqui sem voltar lá, o cadastro passa a oferecer uma
    // unidade que o banco recusa.
    expect(UNIDADES).not.toContain('DZ')
  })

  it("'BDJA' (bandeja) ocupa a posição que era da dúzia — é renomeação, não unidade nova", () => {
    // A posição importa porque é a ordem do `<select>`: 'BDJA' é a mesma
    // casa de "embalagem contável" com outro nome, não um item acrescentado
    // no fim da lista.
    expect(UNIDADES[3]).toBe('BDJA')
    expect(UNIDADES).toHaveLength(5)
  })
})

/**
 * O GUARDA DA CONSOLIDAÇÃO.
 *
 * Até a 018 esta lista estava copiada em quatro arquivos (derive/produtos.ts
 * e os três modais de lançamento). Quatro cópias não são quatro fontes: são
 * três chances de uma ficar para trás — e a troca de 'DZ' por 'BDJA' foi
 * exatamente a mudança que provaria isso, porque uma cópia esquecida
 * continuaria oferecendo 'DZ' sem nenhum teste reclamar.
 *
 * Este teste falha se alguém declarar uma lista de unidades PRÓPRIA em vez de
 * importar a daqui. Ele lê o fonte porque é o único jeito de detectar a
 * duplicação: duas listas iguais passam em qualquer teste de comportamento —
 * o defeito só aparece no dia em que elas deixam de ser iguais, que é tarde
 * demais.
 */
describe('a lista de unidades tem uma fonte só', () => {
  // O fonte dos componentes como TEXTO, pelo `?raw` do proprio Vite (nada de
  // `node:fs`: este pacote compila com `types: ["vite/client"]`, sem Node).
  const FONTES = import.meta.glob('../components/*.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>

  const lerFonte = (arquivo: string) => {
    const chave = Object.keys(FONTES).find(k => k.endsWith(arquivo.replace('src/', '')))
    if (!chave) throw new Error(`fonte nao encontrado: ${arquivo}`)
    return FONTES[chave]
  }

  const CONSUMIDORES = [
    'src/components/ModalProduto.tsx',
    'src/components/ModalEntrada.tsx',
    'src/components/ModalSaida.tsx',
    'src/components/ModalPerda.tsx',
  ]

  it.each(CONSUMIDORES)('%s importa UNIDADES de derive/produtos, não declara a sua', arquivo => {
    const fonte = lerFonte(arquivo)

    // Nada de `const UNIDADES = [...]` fora de derive/produtos.ts.
    expect(fonte, `${arquivo} declara a própria lista de unidades`)
      .not.toMatch(/(const|let|var)\s+UNIDADES\s*=/)

    // E o `<select>` de unidade tem de estar lendo a lista compartilhada.
    expect(fonte, `${arquivo} não importa UNIDADES de derive/produtos`)
      .toMatch(/import\s*\{[^}]*\bUNIDADES\b[^}]*\}\s*from\s*'\.\.\/derive\/produtos'/)
  })

  it('nenhum arquivo do front repete a lista literal de unidades', () => {
    // Rede de segurança contra a cópia voltar com outro nome de variável
    // (`UNS`, `OPCOES_UNIDADE`…): o que se procura é a sequência literal.
    const suspeitos = CONSUMIDORES.map(a => ({
      arquivo: a,
      fonte: lerFonte(a),
    })).filter(({ fonte }) => /'KG'\s*,\s*'CX'\s*,\s*'UN'/.test(fonte))

    expect(suspeitos.map(s => s.arquivo)).toEqual([])
  })
})
