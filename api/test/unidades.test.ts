import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { criarPool } from '../src/db'

/**
 * O QUE O BANCO ACEITA COMO UNIDADE — FIXADO, PARA QUE MUDAR SEJA DELIBERADO.
 *
 * A lista de unidades nasceu na 009 ('KG','CX','UN','DZ','MC'), copiada do
 * protótipo, e a 018 trocou 'DZ' por 'BDJA': este hortifruti não vende por
 * dúzia, vende por bandeja. Foi decisão do dono do negócio, não conserto de
 * bug.
 *
 * Este teste existe porque a lista mora em DOIS lugares que precisam
 * concordar: o CHECK `produtos_un_check` (aqui) e a constante `UNIDADES` do
 * front (web/src/derive/produtos.ts, fixada em derive/produtos.test.ts). Se
 * divergirem, o `<select>` oferece uma unidade que o servidor rejeita ao
 * salvar — um erro que só aparece na frente do usuário, nunca no CI.
 *
 * Fixar o conjunto obriga quem for mexer a passar por aqui e escrever a
 * migration junto, em vez de acrescentar uma string em produção sem ninguém
 * notar (o mesmo raciocínio do CHECK fechado de `historico_cadastros.entidade`
 * na 017).
 */

const ADMIN = process.env.ADMIN_DATABASE_URL
  ?? 'postgres://postgres:dev@localhost:5433/crm_dev'

let admin: ReturnType<typeof criarPool>

beforeAll(() => { admin = criarPool(ADMIN) })
afterAll(async () => { await admin?.end() })

/** O CHECK de uma coluna, como texto — null quando a coluna não tem CHECK. */
async function checkDaColuna(tabela: string, coluna: string): Promise<string | null> {
  const linhas = await admin<{ definicao: string }[]>`
    select pg_get_constraintdef(con.oid) as definicao
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and con.contype = 'c'
       and rel.relname = ${tabela}
       and pg_get_constraintdef(con.oid) like ${'%' + coluna + '%'}
  `
  return linhas.length === 0 ? null : linhas.map(l => l.definicao).join(' | ')
}

/** As unidades citadas num CHECK, na ordem em que aparecem. */
function unidadesDoCheck(definicao: string): string[] {
  return [...definicao.matchAll(/'([A-Z]+)'::text/g)].map(m => m[1])
}

describe('as unidades que o banco aceita (produtos.un)', () => {
  it('o CHECK existe — sanity, para o teste abaixo não passar por query vazia', async () => {
    // Sem esta prova, um `pg_get_constraintdef` que não achasse nada faria os
    // testes seguintes compararem null com null e ficarem verdes sem medir
    // coisa alguma.
    const definicao = await checkDaColuna('produtos', 'un')
    expect(definicao).not.toBeNull()
    expect(definicao).toContain('CHECK')
  })

  it('aceita exatamente KG, CX, UN, BDJA, MC', async () => {
    const definicao = await checkDaColuna('produtos', 'un')
    expect(unidadesDoCheck(definicao!).sort())
      .toEqual(['BDJA', 'CX', 'KG', 'MC', 'UN'])
  })

  it("nao aceita mais 'DZ' — a duzia saiu na 018", async () => {
    const definicao = await checkDaColuna('produtos', 'un')
    expect(unidadesDoCheck(definicao!)).not.toContain('DZ')
  })

  it('nenhuma linha ficou para tras em DZ, em nenhuma das quatro tabelas', async () => {
    // A 018 converte o DADO, não só a restrição. `produtos` seria pega pelo
    // próprio CHECK; as três tabelas de item não seriam pegas por nada (ver
    // abaixo — elas não têm CHECK), então é aqui que se verifica.
    const [linha] = await admin<{ total: string }[]>`
      select (
          (select count(*) from produtos      where un = 'DZ')
        + (select count(*) from entrada_itens where un = 'DZ')
        + (select count(*) from saida_itens   where un = 'DZ')
        + (select count(*) from perdas        where un = 'DZ')
      )::text as total
    `
    expect(linha.total).toBe('0')
  })
})

describe('as tabelas de item NAO tem CHECK de unidade — registrado, nao suposto', () => {
  // ACHADO, e ele é deliberadamente deixado como está: `entrada_itens.un`,
  // `saida_itens.un` e `perdas.un` são `text not null default 'KG'` desde a
  // 009, sem CHECK nenhum. Aceitam qualquer string.
  //
  // Ou seja: a lista de unidades é imposta pelo BANCO em um lugar só
  // (`produtos.un`); nessas três é disciplina de UI (o `<select>` de
  // web/src/derive/produtos.ts) e nada mais. Uma chamada direta à API com
  // `un: 'XYZ'` grava 'XYZ'.
  //
  // Acrescentar os CHECKs seria mudança de invariante com discussão própria
  // (o que fazer com o dado já gravado que não passasse?), e não é escopo da
  // 018. O teste fixa o estado ATUAL para que, no dia em que alguém os
  // acrescentar, isto falhe e a decisão fique registrada em vez de acontecer
  // de passagem.
  it.each(['entrada_itens', 'saida_itens', 'perdas'])(
    '%s.un aceita texto livre (sem CHECK) — se isto falhar, foi por decisao de alguem',
    async tabela => {
      expect(await checkDaColuna(tabela, 'un')).toBeNull()
    },
  )
})
