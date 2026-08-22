import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

/**
 * Estoque nao guarda dado proprio — e uma conta:
 *   saldo = entradas − perda na coleta − perdas de deposito − perda na
 *           entrega − saidas
 *
 * Ported com fidelidade de .superpowers/design-telas/logica-estoque.txt
 * (extraido do prototipo, design/CRM Hortifruti.dc.html:2526-2549). La, o
 * calculo roda no navegador sobre `this.state` inteiro; aqui viraria somar
 * TODO o historico de itens de entrada/saida no cliente so pra exibir uma
 * tabela — nao escala. Por isso, diferente das outras telas desta fase (que
 * calculam no front sobre poucas dezenas de registros), esta soma em SQL,
 * num unico endpoint agregado.
 *
 * CORRECAO AUTORIZADA PELO CLIENTE (destoa do prototipo, de proposito):
 * o prototipo (stockMap, logica-estoque.txt) so desconta `it.perdaKg` (item
 * de entrada) e `pe.qtd` (perdas de deposito) — nunca `en.perdaKg`
 * (cabecalho da entrada) nem a perda registrada no item de uma saida. A
 * fidelidade original ficou incompleta: as duas perdas de fora sao
 * mercadoria real que sai do deposito e nao volta. O dono do negocio
 * revisou e autorizou a correcao — ver comentario em `ent`/`said` abaixo
 * para cada uma.
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
 * Saidas com status Cancelado/Devolvido ficam de fora do "saiu" (e, pelo
 * mesmo motivo, da perda-na-entrega abaixo) — mesmo filtro do prototipo
 * (`pedidosRaw.filter(p=>p.status!=='Cancelado'&&p.status!=='Devolvido')`):
 * um pedido cancelado/devolvido nunca saiu de fato do deposito, entao nao
 * ha o que descontar dele em nenhuma das duas colunas.
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
 * ---- perda na coleta: cabecalho (entradas.perda_kg) x item (entrada_itens.perda_kg) ----
 *
 * O prototipo tem os dois campos (entrada.perdaKg no cabecalho, it.perdaKg
 * em cada item), mas NUNCA soma um em cima do outro: no save da entrada
 * (design/CRM Hortifruti.dc.html:2037, bloco `M === 'entrada'` de
 * `saveDraft`) o cabecalho e RECALCULADO a partir dos itens sempre que a
 * entrada tem itens (e ela sempre tem, e obrigatorio) —
 * `d.perdaKg = d.itens.reduce((s,i)=>s+(+i.perdaKg||0),0)`. Ou seja: no
 * prototipo, cabecalho e soma-dos-itens sao SEMPRE o mesmo numero, so
 * exposto em duas granularidades (a entrada inteira vs. por produto). Os
 * relatorios (api/src/routes/relatorios.ts, web/src/derive/relatorios.ts)
 * confirmam essa leitura: nunca somam os dois — usam o cabecalho onde so
 * precisam do total da entrada (relatorio de compras/perdas por motivo) e
 * a soma dos itens onde precisam de atribuicao por produto (relatorio de
 * produtos), tratando-os como a MESMA informacao, nunca como duas perdas
 * independentes.
 *
 * A API portada (entradas.ts) NAO reproduz esse recalculo — o cabecalho e
 * um campo do formulario editavel independente dos itens (ver
 * ModalEntrada.tsx, "Perda na coleta/transporte (kg)"), entao os dois
 * numeros podem divergir na pratica (ex.: colaborador so preenche o total
 * do cabecalho e nunca abre o detalhe por item — provavelmente o caso mais
 * comum no dia a dia). Por isso a correcao NAO soma `entradas.perda_kg` ao
 * que ja vinha de `entrada_itens.perda_kg`: pela evidencia acima, os dois
 * descrevem o MESMO evento de perda na coleta, so em granularidades
 * diferentes, e somar contaria a mesma perda duas vezes (deixando o saldo
 * MENOR que a realidade — o erro inverso do que existia antes, e pior:
 * acusaria falta de mercadoria que esta na prateleira).
 *
 * A regra adotada (CTEs `entrada_totais` + `ent`, abaixo): por ENTRADA
 * (nao por produto — o cabecalho nao tem produto_id, so a entrada como um
 * todo), a perda de coleta "de verdade" e o MAIOR entre o cabecalho e a
 * soma dos itens, nunca a soma dos dois:
 *   - cabecalho == soma dos itens (o caso normal, fiel ao que o prototipo
 *     sempre produzia): nada muda, o maior e a propria soma dos itens.
 *   - cabecalho > soma dos itens (colaborador so preenceu o total, ou
 *     itens somam menos que o total por engano): a diferenca e uma perda
 *     real que os itens ainda nao mostram. Como o cabecalho nao diz DE QUAL
 *     produto, a diferenca e distribuida entre os itens daquela entrada
 *     proporcionalmente ao peso (qtd) de cada um — a aproximacao mais
 *     defensavel pra "onde" a perda de transporte aconteceu, na ausencia de
 *     qualquer outro dado que aponte um produto especifico.
 *   - cabecalho < soma dos itens: o maior e a soma dos itens (cabecalho
 *     nao acrescenta nada) — este e o caso de dupla contagem que a correcao
 *     evita.
 * Entrada sem NENHUM item (impossivel via API, que exige >=1 item — so
 * ocorreria com um insert direto no banco por fora da API) fica de fora:
 * sem item nenhum para ratear, o cabecalho dela e ignorado, mesma limitacao
 * que ja existia pra qualquer perda sem produto atribuido.
 *
 * ---- perda na entrega (saida_itens.perda_kg) ----
 *
 * Sem redundancia equivalente: `saidas.perda_kg` (cabecalho da saida)
 * existe no schema mas nao tem controle nenhum em ModalSaida.tsx hoje (o
 * formulario nao expoe um campo pra ele), entao nunca e usado aqui. So
 * `saida_itens.perda_kg` entra na conta — mercadoria que SAIU do deposito
 * (ja contada em `qtd`/"saiu") mas nao chegou ao cliente (perdida no
 * trajeto). E um numero a mais, nao uma fatia de `qtd`: o que foi carregado
 * no caminhao = qtd (chegou, faturado) + perda_kg (nao chegou) — mesma
 * logica de entrada_itens (qtd = o que entrou no deposito, perda_kg = o
 * que se perdeu antes de entrar). Por isso soma direto, sem risco de dupla
 * contagem com `saiu`.
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
    entrada_totais as (
      -- Por ENTRADA (nao por produto): soma dos itens dela mesma, usada na
      -- CTE 'ent' logo abaixo so pra decidir se o cabecalho
      -- (entradas.perda_kg) acrescenta alguma perda que os itens ainda nao
      -- mostram. Ver o comentario grande acima ("perda na coleta") pro
      -- raciocinio completo.
      select entrada_id,
        sum(perda_kg) as perda_itens,
        sum(qtd) as qtd_itens
      from entrada_itens
      group by entrada_id
    ),
    ent as (
      select ei.produto_id, ei.un,
        sum(ei.qtd) as entrou,
        -- perda_coleta de cada item = a perda que ele mesmo registrou, mais
        -- (quando o cabecalho da entrada excede a soma dos itens) a fatia
        -- proporcional ao peso (qtd) desse item na diferenca. Quando o
        -- cabecalho nao excede a soma dos itens (inclusive quando e 0, o
        -- default), o 'case' abaixo some e o resultado e exatamente a perda
        -- do proprio item — comportamento identico ao de antes da correcao.
        sum(
          ei.perda_kg + case
            when et.qtd_itens > 0
              then (greatest(e.perda_kg, et.perda_itens) - et.perda_itens) * ei.qtd / et.qtd_itens
            else 0
          end
        ) as perda_coleta
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      join entrada_totais et on et.entrada_id = ei.entrada_id
      group by ei.produto_id, ei.un
    ),
    perd as (
      select produto_id, un,
        sum(qtd) as perda_deposito
      from perdas
      group by produto_id, un
    ),
    said as (
      select si.produto_id, si.un,
        sum(si.qtd) as saiu,
        sum(si.perda_kg) as perda_entrega
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
      coalesce(ent.perda_coleta, 0) + coalesce(perd.perda_deposito, 0)
        + coalesce(said.perda_entrega, 0) as perda,
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
 * saldo = entrou - perda - saiu (perda ja soma coleta + deposito + entrega —
 * ver o comentario grande em `buscarEstoque` pra como cada uma entra nessa
 * soma, e por que coleta usa o MAIOR entre cabecalho e itens da entrada, nao
 * a soma dos dois). Alem do total na unidade lancada, quando `un` nao e KG
 * e o produto tem `peso_medio` cadastrado (>0), expoe tambem o equivalente em KG — sem
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
