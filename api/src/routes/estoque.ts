import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

/**
 * Estoque nao guarda dado proprio — e uma conta:
 *   saldo = entradas − perda na coleta − perdas de deposito − saidas
 *
 * Ported com fidelidade de .superpowers/design-telas/logica-estoque.txt
 * (extraido do prototipo, design/CRM Hortifruti.dc.html:2526-2549). La, o
 * calculo roda no navegador sobre `this.state` inteiro; aqui viraria somar
 * TODO o historico de itens de entrada/saida no cliente so pra exibir uma
 * tabela — nao escala. Por isso, diferente das outras telas desta fase (que
 * calculam no front sobre poucas dezenas de registros), esta soma em SQL,
 * num unico endpoint agregado.
 */

/** Linha crua devolvida pela consulta — numeric do postgres.js vem como
 * string, convertido em paraJson (mesmo padrao de todo o resto da API). */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  peso_medio: string | number
  entrou: string | number
  perda: string | number
  saiu: string | number
}

/**
 * Agrega entradas, perdas de deposito e saidas por produto+unidade em SQL —
 * a soma pesada (todo o historico de itens ja movimentados) fica no banco;
 * o resultado que sai daqui ja e por linha da tabela da tela.
 *
 * `chaves`: uniao dos pares (produto_id, un) que aparecem em QUALQUER uma
 * das tres fontes. Nenhuma das tres pode ser a tabela "esquerda" sozinha —
 * um produto so com perda de deposito (sem nunca ter tido entrada) e
 * igualmente valido no prototipo, e o mesmo vale pras outras duas. Os tres
 * LEFT JOINs seguintes trazem os somatorios de cada fonte para essas
 * chaves — e aqui que "left join + sum" (a tecnica pedida) acontece de
 * fato: uma fonte sem linha para aquela chave simplesmente soma 0
 * (coalesce), em vez de derrubar a chave inteira como um inner join faria.
 *
 * Produto sem NENHUMA movimentacao nao entra em `chaves` e portanto nao
 * aparece no resultado — fidelidade ao prototipo, cujo stockMap so nasce de
 * iterar entradas/perdas/pedidos, nunca da lista de produtos (ver
 * logica-estoque.txt: `entradasRaw.forEach(... if(!stockMap[k]) ...)`, o
 * mapa e criado sob demanda pela movimentacao, nunca pre-populado).
 *
 * Saidas com status Cancelado/Devolvido ficam de fora do "saiu" — mesmo
 * filtro do prototipo (`pedidosRaw.filter(p=>p.status!=='Cancelado'&&
 * p.status!=='Devolvido')`).
 *
 * Unidade agrupa junto com o produto (nao so por produto): o To Do do
 * cliente registra que somar CX e KG na mesma linha torna a quantidade
 * movimentada e o indice de perdas incomparaveis entre produtos — por isso
 * `un` aqui vem do proprio item (entrada_itens.un / perdas.un /
 * saida_itens.un), igual ao prototipo (`skey = it =>
 * String(it.produtoId||it.nome)+'|'+(it.un||'KG')`), nunca de produtos.un
 * (que e so o padrao sugerido ao cadastrar, pode divergir do que foi
 * de fato lancado em cada movimentacao).
 *
 * RLS cuida do isolamento por tenant em cada tabela referenciada — nenhuma
 * dessas queries filtra tenant_id explicitamente porque tudo roda dentro de
 * withTenant (mesmo padrao das outras rotas).
 */
export async function buscarEstoque(sql: Sql, tenantId: string): Promise<LinhaEstoque[]> {
  return withTenant(sql, tenantId, tx => tx<LinhaEstoque[]>`
    with chaves as (
      select produto_id, un from entrada_itens
      union
      select produto_id, un from perdas
      union
      select si.produto_id, si.un
      from saida_itens si
      join saidas s on s.id = si.saida_id
      where s.status not in ('Cancelado', 'Devolvido')
    ),
    ent as (
      select produto_id, un,
        sum(qtd) as entrou,
        sum(perda_kg) as perda_coleta
      from entrada_itens
      group by produto_id, un
    ),
    perd as (
      select produto_id, un,
        sum(qtd) as perda_deposito
      from perdas
      group by produto_id, un
    ),
    said as (
      select si.produto_id, si.un,
        sum(si.qtd) as saiu
      from saida_itens si
      join saidas s on s.id = si.saida_id
      where s.status not in ('Cancelado', 'Devolvido')
      group by si.produto_id, si.un
    )
    select
      p.id as produto_id,
      p.nome,
      k.un,
      p.peso_medio,
      coalesce(ent.entrou, 0) as entrou,
      coalesce(ent.perda_coleta, 0) + coalesce(perd.perda_deposito, 0) as perda,
      coalesce(said.saiu, 0) as saiu
    from chaves k
    join produtos p on p.id = k.produto_id
    left join ent  on ent.produto_id  = k.produto_id and ent.un  = k.un
    left join perd on perd.produto_id = k.produto_id and perd.un = k.un
    left join said on said.produto_id = k.produto_id and said.un = k.un
    order by p.nome, k.un
  `)
}

/**
 * saldo = entrou - perda - saiu (perda ja soma coleta + deposito). Alem do
 * total na unidade lancada, quando `un` nao e KG e o produto tem
 * `peso_medio` cadastrado (>0), expoe tambem o equivalente em KG — sem
 * misturar as duas contas na mesma coluna (`equivalente_kg` e um objeto a
 * parte, nunca substitui entrou/perda/saiu/saldo). Essa e a correcao que o
 * To Do do cliente pede: hoje CX e KG do mesmo produto sao somados juntos e
 * o indice de perdas fica incomparavel; aqui cada `un` fica na sua propria
 * linha (ver `buscarEstoque`), e peso_medio converte pra um numero
 * comparavel entre produtos.
 */
export function paraJson(linha: LinhaEstoque) {
  const entrou = Number(linha.entrou)
  const perda = Number(linha.perda)
  const saiu = Number(linha.saiu)
  const pesoMedio = Number(linha.peso_medio)
  const saldo = entrou - perda - saiu

  const equivalenteKg = linha.un !== 'KG' && pesoMedio > 0
    ? {
        entrou: entrou * pesoMedio,
        perda: perda * pesoMedio,
        saiu: saiu * pesoMedio,
        saldo: saldo * pesoMedio,
      }
    : null

  return {
    produto_id: linha.produto_id,
    nome: linha.nome,
    un: linha.un,
    entrou,
    perda,
    saiu,
    saldo,
    peso_medio: pesoMedio,
    equivalente_kg: equivalenteKg,
  }
}

export const estoque = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Design: estoque e visivel para colaborador (ver web/src/telas.ts,
// ADMIN_ONLY_SCREENS nao inclui 'estoque') — so exigirSessao, sem
// exigirAdmin. Mesmo racional de entradas/saidas/perdas: quem lanca a
// movimentacao precisa poder conferir o saldo resultante.
estoque.use('*', exigirSessao)

estoque.get('/', async (c) => {
  const linhas = await buscarEstoque(c.get('sql'), c.get('tenantId'))
  return c.json(linhas.map(paraJson))
})
