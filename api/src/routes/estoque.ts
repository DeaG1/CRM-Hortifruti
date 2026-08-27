import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

/**
 * Estoque nao guarda dado proprio — e uma conta:
 *   saldo = entradas − perda na coleta − perdas de deposito − perda na
 *           entrega − saidas
 *
 * TODAS as parcelas dessa conta saem EM KG, cada uma convertida pela regra
 * que corresponde a SUA PROPRIA unidade — ver "tudo em kg desde a origem"
 * mais abaixo. Ate 2026-08-24 nao era assim: `entrou` e `saiu` ficavam na
 * unidade do item, `perda` somava tres unidades diferentes na mesma coluna
 * (kg da coleta + unidade da perda de deposito + kg da entrega), `saldo`
 * subtraia kg de caixas e `equivalente_kg` multiplicava o bolo inteiro por
 * peso_medio, convertendo DE NOVO as parcelas que ja estavam em kg.
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
 * string, convertido em paraJson (mesmo padrao de todo o resto da API).
 * `entrou`/`perda`/`saiu` ja saem EM KG da propria query; peso_medio vem
 * junto so para a leitura secundaria em embalagens (`equivalente_un`).
 * `itens_sem_conversao` e um count() — bigint, tambem string aqui. */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  peso_medio: string | number
  entrou: string | number
  perda: string | number
  saiu: string | number
  itens_sem_conversao: string | number
  /** Datas da movimentacao mais recente de cada uma das TRES fontes, ja em
   * texto 'AAAA-MM-DD' (ver `to_char` na query). `null` quando aquela fonte
   * nunca movimentou esta linha — nunca uma data inventada, nunca a de hoje.
   * Qual das tres e "a ultima movimentacao" e decidido no front por
   * `ultimaMovimentacao` (web/src/derive/estoque.ts), funcao pura e testada:
   * aqui so saem os tres maximos crus. */
  ultima_entrada: string | null
  ultima_saida: string | null
  ultima_perda: string | null
}

/** Uma movimentacao do historico por item — ver `buscarMovimentacoesEstoque`. */
interface LinhaMovimentacao {
  produto_id: string
  un: string
  tipo: string
  data: string
  qtd_kg: string | number | null
  referencia: string
  total: string | number
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
 * Unidade agrupa junto com o produto (nao so por produto): `un` aqui vem do
 * proprio item (entrada_itens.un / perdas.un / saida_itens.un), igual ao
 * prototipo (`skey = it => String(it.produtoId||it.nome)+'|'+(it.un||'KG')`),
 * nunca de produtos.un (que e so o padrao sugerido ao cadastrar, pode
 * divergir do que foi de fato lancado em cada movimentacao). O motivo
 * original era o To Do do cliente ("somar CX e KG na mesma linha torna a
 * quantidade movimentada e o indice de perdas incomparaveis"), que a
 * conversao para kg resolve por si; o que a chave (produto, un) ainda diz —
 * e por isso continua — e EM QUE UNIDADE a movimentacao foi lancada, que e o
 * que o selo da tela mostra e o que permite a leitura secundaria em
 * embalagens (`equivalente_un`, em paraJson). Colapsar as linhas de um mesmo
 * produto num total unico em kg passou a ser possivel, mas e outra decisao:
 * mudaria a forma da tela e a chave de linha, sem corrigir numero nenhum.
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
 * ---- tudo em kg desde a origem ----
 *
 * As cinco parcelas da conta nascem em unidades diferentes, e por isso NAO
 * podem receber o mesmo tratamento:
 *
 *   entrada_itens.qtd  -> unidade do ITEM  (entrada_itens.un)  -> CONVERTE
 *   entrada_itens.perda_kg -> KG por contrato                  -> nao converte
 *   perdas.qtd         -> unidade da PERDA (perdas.un)         -> CONVERTE
 *   saida_itens.qtd    -> unidade do ITEM  (saida_itens.un)    -> CONVERTE
 *   saida_itens.perda_kg -> KG por contrato                    -> nao converte
 *
 * `un` nessas tres tabelas aceita 'KG','CX','UN','DZ','MC' (migration 009).
 * A regra de conversao e a MESMA das outras tres ocorrencias dela no projeto
 * (entradas.ts/peso_total, saidas.ts/peso e relatorios.ts/produtos), de
 * proposito — nao existe uma quarta variante: lancamento em 'KG' conta
 * `qtd`; em qualquer outra unidade conta `qtd * produtos.peso_medio` (peso de
 * UMA embalagem, em kg), e so quando peso_medio > 0.
 *
 * As duas colunas `perda_kg` (item de entrada e item de saida) sao KG por
 * contrato para item de QUALQUER unidade — nome da coluna, rotulo do
 * cabecalho em ModalEntrada.tsx ("Perda na coleta/transporte (kg)") e total
 * do rodape do mesmo modal ("{totalPerda} kg"). Converte-las estragaria um
 * numero que ja esta certo. `perdas.qtd` e o caso oposto (quantidade na
 * unidade da propria perda) e por isso converte — mesma leitura de
 * relatorios.ts.
 *
 * itens_sem_conversao: lancamento em unidade nao-KG cujo produto tem
 * peso_medio = 0 ("nao informado", ver migration 009) nao e convertivel e
 * NAO recebe fator inventado — uma caixa nao pesa um quilo. O `case` nao tem
 * `else`, entao vira NULL, `sum` ignora, e a contribuicao fica FORA da conta;
 * o contador diz quantos ficaram, para a tela marcar a linha em vez de
 * exibir um saldo silenciosamente incompleto. Como `chaves` agrupa por
 * (produto_id, un), o fator e constante dentro de uma linha: ou a linha
 * inteira converte, ou nenhuma das tres quantidades dela converte e sobram
 * so as parcelas que ja eram kg (as duas perda_kg) — dai a tela marcar a
 * LINHA toda, nunca uma celula so.
 *
 * O rateio proporcional (`ei.qtd / et.qtd_itens`, logo abaixo) NAO foi
 * convertido, de proposito. Ele nao e uma quantidade: e um PESO RELATIVO
 * entre os itens da mesma entrada, aplicado a uma diferenca que ja esta em
 * kg (cabecalho e itens sao os dois perda_kg) — o resultado sai em kg com ou
 * sem conversao. E a conversao tambem nao se cancela numerador com
 * denominador: `et.qtd_itens` soma os itens da entrada INTEIRA, produtos
 * diferentes com peso_medio diferentes, entao converter mudaria a
 * DISTRIBUICAO do excedente entre os produtos daquela entrada (nao o total
 * rateado, que continua sendo o mesmo). Trocar peso-em-embalagens por
 * peso-em-quilos como criterio de rateio e uma decisao separada desta, que
 * f6374ac deliberadamente nao tomou e que precisaria ser tomada aqui e no
 * rateio identico de relatorios.ts ao mesmo tempo, sob pena de as duas telas
 * divergirem de novo.
 *
 * ---- quando a linha mexeu pela ultima vez ----
 *
 * As tres datas (`ultima_entrada`, `ultima_saida`, `ultima_perda`) NAO
 * custam consulta nova: sao um `max(...)` dentro das MESMAS tres CTEs que ja
 * varrem essas tabelas para somar as quantidades. Nenhum join, nenhuma
 * varredura e nenhum endpoint a mais — a agregacao ja passava por cada
 * linha; passou a levar a maior data junto.
 *
 * DE QUE COLUNA SAI A DATA DE CADA FONTE:
 *
 *   entrada -> entradas.data   (a coleta; not null)
 *   perda   -> perdas.data     (a baixa no deposito; not null)
 *   saida   -> saidas.ENTREGA  (nao data_pedido; NULLABLE — ver abaixo)
 *
 * `saidas.entrega`, e nao `saidas.data_pedido`, porque a mercadoria sai do
 * deposito quando e ENTREGUE — `data_pedido` e quando o preco foi acordado
 * (a propria saidas.ts diz isso na memoria de preco: "e quando o preco foi
 * acordado"). Todo o resto do projeto ja le o fluxo de saida por `entrega`,
 * nunca por `data_pedido`: receita e custo do periodo
 * (derive/financeiro.ts, `noPeriodo(saidas, periodo, s => s.entrega)`),
 * dias de recebimento (`data_pag − entrega`), ultima compra do cliente e
 * ticket (derive/clientes.ts), os relatorios de vendas/inadimplencia
 * (derive/relatorios.ts) e o recorte em SQL do relatorio de produtos
 * (relatorios.ts, `to_char(s.entrega, 'YYYY-MM')`). Usar data_pedido aqui
 * faria a tela de giro discordar de todas elas — e mentir: um pedido
 * lancado em maio e entregue em agosto teria "saido" em maio.
 *
 * `entrega` e nullable, e NAO ha fallback para `data_pedido`. Saida ainda
 * sem data de entrega registrada nao produz data de movimentacao nenhuma
 * (o `max` ignora NULL) — mesma leitura de `diasRecebimento` e
 * `ultimaCompraCliente`, que tratam entrega ausente como "ainda nao
 * aconteceu" em vez de substituir por outra data. A QUANTIDADE dessa saida
 * continua descontada do saldo (fidelidade ao prototipo, que so exclui
 * Cancelado/Devolvido); o que falta e saber QUANDO, e "nao sei" se diz com
 * travessao, nao com a data do pedido.
 *
 * MESMO FILTRO DE STATUS DA QUANTIDADE. `max(s.entrega)` mora dentro da CTE
 * `said`, que ja tem `where s.status not in ('Cancelado','Devolvido')` —
 * entao a data herda o filtro de graca, e nao ha como as duas divergirem
 * numa alteracao futura sem que alguem mexa nessa linha de proposito. Sem
 * isso, a tela diria "saiu ontem" de mercadoria que nunca saiu.
 *
 * PERDA E MOVIMENTACAO. `ultima_perda` sai da CTE `perd` (tabela `perdas`, a
 * baixa de deposito) porque perda tambem tira mercadoria do estoque e tem
 * data propria. Ficam de fora as outras duas perdas — a de coleta
 * (entrada_itens.perda_kg + rateio do cabecalho) e a de entrega
 * (saida_itens.perda_kg): elas nao sao eventos com data propria, acontecem
 * DENTRO de uma entrada ou de uma saida, na mesma data que ja esta em
 * `ultima_entrada`/`ultima_saida`. Emiti-las a parte duplicaria o mesmo
 * evento no historico.
 *
 * `to_char(..., 'YYYY-MM-DD')` em vez de devolver a coluna `date` crua: o
 * postgres.js entrega `date` como objeto `Date` do JS, que o JSON.stringify
 * do Hono serializa como timestamp UTC completo
 * ("2026-08-20T00:00:00.000Z") — e converter de volta com `toISOString()`
 * troca o dia em fuso positivo. O Postgres formata a data como ela e, sem
 * fuso no meio, e sem precisar de um segundo formatador de data no
 * TypeScript (mesmo motivo de `to_char(s.entrega, 'YYYY-MM')` em
 * relatorios.ts).
 *
 * O FILTRO DE PERIODO GLOBAL CONTINUA SEM SE APLICAR. Ver o comentario de
 * EstoqueLista.tsx e o commit eae52e0: saldo e POSICAO, nao fluxo, e a tela
 * declara isso numa nota. "Ultima movimentacao" tem exatamente a mesma
 * natureza — recortada por julho, responderia "a ultima vez que mexeu em
 * julho", que nao e a pergunta e faria um item parado desde maio parecer
 * nunca movimentado. Por isso nenhuma das duas funcoes deste arquivo aceita
 * parametro de periodo, e nao devem ganhar um.
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
      -- entrou: EM KG, pela unidade do ITEM (entrada_itens.un). Item nao
      -- convertivel vira NULL e sai da soma, contado em sem_conversao.
      select ei.produto_id, ei.un,
        sum(
          case
            when ei.un = 'KG' then ei.qtd
            when coalesce(pe.peso_medio, 0) > 0 then ei.qtd * pe.peso_medio
          end
        ) as entrou,
        count(*) filter (
          where ei.un <> 'KG' and coalesce(pe.peso_medio, 0) = 0
        ) as sem_conversao,
        -- perda_coleta de cada item = a perda que ele mesmo registrou, mais
        -- (quando o cabecalho da entrada excede a soma dos itens) a fatia
        -- proporcional ao peso (qtd) desse item na diferenca. Quando o
        -- cabecalho nao excede a soma dos itens (inclusive quando e 0, o
        -- default), o 'case' abaixo some e o resultado e exatamente a perda
        -- do proprio item — comportamento identico ao de antes da correcao.
        -- Ja esta EM KG e nao converte: as duas perda_kg (cabecalho e item)
        -- sao kg por contrato, e ei.qtd / et.qtd_itens e um peso relativo
        -- entre itens da mesma entrada, nao uma quantidade. Ver o comentario
        -- grande acima ("tudo em kg desde a origem") pro raciocinio completo.
        sum(
          ei.perda_kg + case
            when et.qtd_itens > 0
              then (greatest(e.perda_kg, et.perda_itens) - et.perda_itens) * ei.qtd / et.qtd_itens
            else 0
          end
        ) as perda_coleta,
        -- A coleta mais recente desta linha. Um max na CTE que ja estava
        -- varrendo estas mesmas linhas — sem consulta nova. entradas.data
        -- e not null, entao toda linha com entrada tem esta data.
        to_char(max(e.data), 'YYYY-MM-DD') as ultima_entrada
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      join entrada_totais et on et.entrada_id = ei.entrada_id
      join produtos pe on pe.id = ei.produto_id
      group by ei.produto_id, ei.un
    ),
    perd as (
      -- perda de deposito: EM KG, pela unidade da PROPRIA PERDA (perdas.un)
      -- — e uma quantidade, nao um kg por contrato como as duas perda_kg.
      select pd.produto_id, pd.un,
        sum(
          case
            when pd.un = 'KG' then pd.qtd
            when coalesce(pp.peso_medio, 0) > 0 then pd.qtd * pp.peso_medio
          end
        ) as perda_deposito,
        count(*) filter (
          where pd.un <> 'KG' and coalesce(pp.peso_medio, 0) = 0
        ) as sem_conversao,
        -- Perda de deposito e movimentacao de verdade: tira mercadoria e tem
        -- data propria (perdas.data, not null). As perdas de coleta e de
        -- entrega nao entram aqui — acontecem dentro de uma entrada/saida, na
        -- data que ja esta em ultima_entrada/ultima_saida.
        to_char(max(pd.data), 'YYYY-MM-DD') as ultima_perda
      from perdas pd
      join produtos pp on pp.id = pd.produto_id
      group by pd.produto_id, pd.un
    ),
    said as (
      -- saiu: EM KG, pela unidade do ITEM (saida_itens.un). perda_entrega e
      -- kg por contrato e nao converte.
      select si.produto_id, si.un,
        sum(
          case
            when si.un = 'KG' then si.qtd
            when coalesce(ps.peso_medio, 0) > 0 then si.qtd * ps.peso_medio
          end
        ) as saiu,
        count(*) filter (
          where si.un <> 'KG' and coalesce(ps.peso_medio, 0) = 0
        ) as sem_conversao,
        sum(si.perda_kg) as perda_entrega,
        -- ENTREGA, nao data_pedido: a mercadoria sai do deposito quando e
        -- entregue (ver "quando a linha mexeu pela ultima vez" acima). Mora
        -- DENTRO desta CTE de proposito, para herdar o mesmo
        -- where s.status not in ('Cancelado','Devolvido') que a quantidade
        -- — data e quantidade nunca podem discordar sobre o que saiu.
        -- max ignora NULL, entao saida ainda sem entrega registrada nao
        -- inventa data: a linha cai no travessao se nao houver outra fonte.
        to_char(max(s.entrega), 'YYYY-MM-DD') as ultima_saida
      from saida_itens si
      join saidas s on s.id = si.saida_id
      join produtos ps on ps.id = si.produto_id
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
      coalesce(said.saiu, 0) as saiu,
      -- Um contador so, das tres fontes: entrou, perda e saiu desta linha
      -- saem todos das mesmas embalagens, entao um lancamento nao
      -- convertivel — de entrada, de perda de deposito ou de saida — deixa a
      -- LINHA inteira incompleta, nunca uma celula so. Mesmo padrao de
      -- relatorios.ts (GET /api/relatorios/produtos).
      coalesce(ent.sem_conversao, 0) + coalesce(perd.sem_conversao, 0)
        + coalesce(said.sem_conversao, 0) as itens_sem_conversao,
      -- SEM coalesce, de proposito: fonte que nunca movimentou esta linha sai
      -- NULL e vira travessao na tela. Um coalesce para 'hoje' ou para a
      -- epoch afirmaria uma movimentacao que ninguem registrou.
      ent.ultima_entrada,
      said.ultima_saida,
      perd.ultima_perda
    from chaves k
    join produtos p on p.id = k.produto_id
    left join ent  on ent.produto_id  = k.produto_id and ent.un  = k.un
    left join perd on perd.produto_id = k.produto_id and perd.un = k.un
    left join said on said.produto_id = k.produto_id and said.un = k.un
    order by p.nome, k.un
  `)
}

/**
 * saldo = entrou - perda - saiu, TUDO EM KG (perda ja soma coleta +
 * deposito + entrega — ver o comentario grande em `buscarEstoque` pra como
 * cada uma entra nessa soma na unidade dela, e por que coleta usa o MAIOR
 * entre cabecalho e itens da entrada, nao a soma dos dois).
 *
 * ---- por que o kg virou o numero principal, e `equivalente_kg` sumiu ----
 *
 * Ate 2026-08-24 as quatro colunas ficavam na unidade lancada e `equivalente_kg`
 * era um objeto a parte com as mesmas quatro multiplicadas por peso_medio.
 * Nenhuma das duas leituras estava certa: `perda` somava kg (coleta e
 * entrega) com a unidade da perda de deposito na MESMA coluna, `saldo`
 * subtraia isso de caixas, e `equivalente_kg` multiplicava o bolo inteiro,
 * convertendo DE NOVO as duas parcelas que ja eram kg — 11 kg + 4 CX de 8 kg
 * saiam como "15" e como "120 kg", quando a verdade sao 43 kg.
 *
 * O kg nao e uma preferencia estetica: e a UNICA unidade em que essa conta
 * fecha. Duas das cinco parcelas (as duas `perda_kg`) nascem em quilos por
 * contrato, para item de qualquer unidade — nao existe versao delas "em
 * caixas" que nao seja inventada. Um saldo na unidade lancada exigiria
 * dividir esses quilos pelo peso_medio, ou seja, exatamente o fator inverso:
 * a mesma aproximacao, so que escondida dentro do numero principal.
 *
 * Logo `equivalente_kg` deixou de fazer sentido como campo separado: seria
 * uma copia identica de entrou/perda/saiu/saldo. O que NAO some e a
 * distincao que a tela mostrava — um numero exato na unidade da conta e uma
 * leitura aproximada na outra unidade. Ela continua, invertida:
 * `equivalente_un` traz as mesmas quatro quantidades divididas pelo
 * peso_medio, para quem esta na camara fria contando caixas ("≈ 9,6 CX"), e
 * e null exatamente nas mesmas linhas em que `equivalente_kg` era null (un
 * = 'KG', onde nao ha nada a converter, ou peso_medio = 0, onde nao ha fator
 * — e nesse segundo caso `itens_sem_conversao` ja marcou a linha inteira).
 * Mesmo fator, mesma condicao, direcao oposta: o exato passa a ser o
 * principal e o aproximado o secundario, que e a hierarquia correta.
 */
export function paraJson(linha: LinhaEstoque) {
  const entrou = Number(linha.entrou)
  const perda = Number(linha.perda)
  const saiu = Number(linha.saiu)
  const pesoMedio = Number(linha.peso_medio)
  const saldo = entrou - perda - saiu

  const equivalenteUn = linha.un !== 'KG' && pesoMedio > 0
    ? {
        entrou: entrou / pesoMedio,
        perda: perda / pesoMedio,
        saiu: saiu / pesoMedio,
        saldo: saldo / pesoMedio,
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
    equivalente_un: equivalenteUn,
    // count() vem como bigint (string no postgres.js) — mesma conversao na
    // borda que os numeric recebem, igual a entradas.ts/saidas.ts.
    itens_sem_conversao: Number(linha.itens_sem_conversao ?? 0),
    // As tres datas ja saem como texto 'AAAA-MM-DD' da propria query
    // (`to_char`) — nao ha Date nem fuso no caminho, entao passam direto.
    // `?? null` normaliza o `undefined` que o LEFT JOIN nunca produz mas que
    // um chamador de teste montando a linha na mao poderia.
    ultima_entrada: linha.ultima_entrada ?? null,
    ultima_saida: linha.ultima_saida ?? null,
    ultima_perda: linha.ultima_perda ?? null,
  }
}

/**
 * Quantas movimentacoes por (produto, unidade) o historico devolve — as mais
 * recentes. O teto existe porque o corpo da resposta e proporcional a
 * (linhas da tela x este numero): um item com anos de giro diario teria
 * centenas de movimentacoes, e ninguem abre um historico para rolar ate
 * 2024. `total` (abaixo) diz quantas existem de verdade, para a tela nunca
 * truncar em silencio.
 */
export const LIMITE_HISTORICO = 12

/**
 * O historico por item: as datas de cada entrada, saida e perda daquela
 * linha da tela, para acompanhar o giro.
 *
 * ---- por que UMA consulta para a tela inteira, e nao uma por item ----
 *
 * O desenho obvio — buscar o historico do item quando ele e expandido —
 * custa uma requisicao por expansao. Numa tela com dezenas de produtos (e
 * cada produto podendo ter mais de uma linha, uma por unidade lancada), quem
 * esta conferindo o giro abre varios: sao dezenas de invocacoes do Worker,
 * dezenas de `withTenant` (cada transacao custou ~594ms medidos em producao
 * — ver o comentario no fim de src/db.ts) e dezenas de idas ao banco, todas
 * para montar a mesma tabela. Este projeto roda em Cloudflare Workers, onde
 * o custo por invocacao nao e teorico: foi o teto de subrequisicoes por
 * invocacao que obrigou a adotar o Hyperdrive (ver `criarPoolDoEnv`).
 *
 * Entao esta funcao devolve o historico de TODAS as linhas de uma vez, e a
 * tela busca UMA vez — na primeira expansao — e reusa para todas as
 * seguintes. O custo passa a ser O(1) na quantidade de itens expandidos, em
 * vez de O(n).
 *
 * ---- e por que sob demanda, e nao junto de GET /api/estoque ----
 *
 * Duas razoes, as duas de custo:
 *
 *   1. Quem so abre a tela para ver os saldos — o caso comum — nao paga
 *      nada: nenhuma requisicao a mais, nenhum byte a mais no corpo do
 *      agregado. Junto da listagem, todo mundo pagaria o historico inteiro
 *      sempre, expandindo ou nao.
 *   2. ISOLACAO DE FALHA. Junto da listagem, um erro no historico derrubaria
 *      os saldos — o numero que o funcionario abre a tela para ver.
 *      Separado, ele cai sozinho: a tabela continua inteira, com as
 *      quantidades e a ultima movimentacao (que vem do agregado, nao daqui),
 *      e um aviso diz o que faltou. Mesmo padrao da segunda busca de
 *      ClientesLista/FornecedoresLista.
 *
 * ---- o que entra, e com que data ----
 *
 * As mesmas tres fontes e as mesmas datas da agregacao (ver o comentario
 * grande de `buscarEstoque`), inclusive o filtro de status das saidas e a
 * escolha de `entrega` em vez de `data_pedido`. Duas consequencias diretas:
 * saida Cancelada/Devolvida nao aparece no historico (nunca saiu), e saida
 * sem `entrega` tambem nao (`where s.entrega is not null`) — sem data, nao
 * ha o que listar num historico que E uma lista de datas, e o `order by`
 * nao teria por onde ordena-la.
 *
 * `qtd_kg` segue a convencao de quilos de toda a tela: KG conta direto,
 * outra unidade multiplica por `produtos.peso_medio`, e lancamento nao
 * convertivel (unidade != KG com peso_medio = 0) vira NULL — o mesmo `case`
 * sem `else` da agregacao, pelo mesmo motivo: uma caixa nao pesa um quilo, e
 * inventar fator e pior que marcar a linha. NULL aqui significa exatamente
 * "este lancamento e um dos `itens_sem_conversao` da linha".
 *
 * ---- ordem e desempate ----
 *
 * `data desc` primeiro (mais recente no topo, igual ao historico de
 * FuncionariosLista), depois `criado_em desc` e por fim `id desc`. O
 * desempate e explicito porque DUAS MOVIMENTACOES NO MESMO DIA sao comuns
 * (o fornecedor que entrega de manha e de tarde; a mesma rota com duas
 * saidas) e `data` sozinha deixaria a ordem por conta do plano de execucao,
 * que pode mudar entre carregamentos — o defeito exato que f8e2954 corrigiu
 * em `maisRecentePrimeiro` (derive/fornecedores.ts). `criado_em` e
 * timestamptz e desempata pelo que foi registrado depois, que e a leitura
 * certa dentro do mesmo dia; `id` fecha o caso de dois registros gravados no
 * mesmo instante, so para a ordem ser total e estavel.
 *
 * `total` (count sobre a mesma particao) viaja em cada linha para a tela
 * poder dizer "12 de 47" em vez de truncar calada.
 */
export async function buscarMovimentacoesEstoque(
  sql: Sql,
  tenantId: string,
  limite: number = LIMITE_HISTORICO,
): Promise<LinhaMovimentacao[]> {
  return withTenant(sql, tenantId, tx => tx<LinhaMovimentacao[]>`
    with mov as (
      select
        ei.produto_id, ei.un,
        'entrada' as tipo,
        e.data as data,
        e.criado_em as criado_em,
        ei.id as item_id,
        case
          when ei.un = 'KG' then ei.qtd
          when coalesce(pe.peso_medio, 0) > 0 then ei.qtd * pe.peso_medio
        end as qtd_kg,
        e.numero as referencia
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      join produtos pe on pe.id = ei.produto_id

      union all

      select
        si.produto_id, si.un,
        'saida' as tipo,
        s.entrega as data,
        s.criado_em as criado_em,
        si.id as item_id,
        case
          when si.un = 'KG' then si.qtd
          when coalesce(ps.peso_medio, 0) > 0 then si.qtd * ps.peso_medio
        end as qtd_kg,
        s.numero as referencia
      from saida_itens si
      join saidas s on s.id = si.saida_id
      join produtos ps on ps.id = si.produto_id
      where s.status not in ('Cancelado', 'Devolvido')
        and s.entrega is not null

      union all

      select
        pd.produto_id, pd.un,
        'perda' as tipo,
        pd.data as data,
        pd.criado_em as criado_em,
        pd.id as item_id,
        case
          when pd.un = 'KG' then pd.qtd
          when coalesce(pp.peso_medio, 0) > 0 then pd.qtd * pp.peso_medio
        end as qtd_kg,
        pd.motivo as referencia
      from perdas pd
      join produtos pp on pp.id = pd.produto_id
    ),
    ordenado as (
      select mov.*,
        row_number() over (
          partition by produto_id, un
          order by data desc, criado_em desc, item_id desc
        ) as pos,
        count(*) over (partition by produto_id, un) as total
      from mov
    )
    select
      produto_id, un, tipo,
      to_char(data, 'YYYY-MM-DD') as data,
      qtd_kg, referencia, total
    from ordenado
    where pos <= ${limite}
    order by produto_id, un, pos
  `)
}

/**
 * numeric -> number e bigint -> number na borda, igual a `paraJson`.
 * `qtd_kg` mantem `null` (lancamento nao convertivel em quilos) em vez de
 * virar 0: zero seria uma quantidade medida, e esta nao foi.
 */
export function paraJsonMovimentacao(linha: LinhaMovimentacao) {
  return {
    produto_id: linha.produto_id,
    un: linha.un,
    tipo: linha.tipo,
    data: linha.data,
    qtd_kg: linha.qtd_kg === null || linha.qtd_kg === undefined ? null : Number(linha.qtd_kg),
    referencia: linha.referencia ?? '',
    total: Number(linha.total ?? 0),
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

/**
 * O historico de movimentacao de TODAS as linhas de uma vez — ver
 * `buscarMovimentacoesEstoque` para o porque de ser uma consulta so e sob
 * demanda. Mesma exigencia de sessao da listagem (o router inteiro): quem ve
 * o saldo ve quando ele mexeu.
 */
estoque.get('/movimentacoes', async (c) => {
  const linhas = await buscarMovimentacoesEstoque(c.get('sql'), c.get('tenantId'))
  return c.json(linhas.map(paraJsonMovimentacao))
})
