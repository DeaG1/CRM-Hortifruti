import { Hono } from 'hono'
import { withTenant, type EnvBanco, type Sql } from '../db'
import { exigirSessao, type Vars } from '../middleware/sessao'

/**
 * Estoque nao guarda dado proprio — e uma conta:
 *   saldo = entradas − perda na coleta − perdas de deposito − perda na
 *           entrega − saidas
 *
 * Essa conta sai daqui DUAS vezes, e as duas sao verdade, cada uma no seu
 * alcance:
 *
 *   POR LINHA, na unidade em que a movimentacao foi LANCADA (`un`) — exata,
 *   porque a linha e (produto, un) e ali nao ha mistura de unidades nenhuma.
 *   Ver "cada linha na unidade em que foi lancada".
 *
 *   EM KG, para somar ENTRE linhas (totais da tela, painel, relatorios) —
 *   la a mistura e real e o kg e a unica unidade em que a conta fecha, cada
 *   parcela convertida pela regra da SUA PROPRIA unidade. Ver "tudo em kg
 *   desde a origem".
 *
 * Ate 2026-08-24 nao havia conversao nenhuma e a conta somava unidades
 * diferentes na mesma coluna: `entrou` e `saiu` ficavam na unidade do item,
 * `perda` somava tres unidades (kg da coleta + unidade da perda de deposito +
 * kg da entrega), `saldo` subtraia kg de caixas e `equivalente_kg`
 * multiplicava o bolo inteiro por peso_medio, convertendo DE NOVO as parcelas
 * que ja estavam em kg. Ate 2026-08-26 o conserto daquilo (35f3a2e) valia
 * tambem DENTRO da linha, onde nao havia mistura a resolver — e ali ele
 * apagava a quantidade: sem peso_medio, 45 UN de alface viravam "0".
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
 *
 * A linha carrega as quantidades DUAS VEZES, e as duas sao verdade:
 *
 *   `entrou_un`/`perda_deposito_un`/`saiu_un` — na unidade LANCADA (`un`),
 *   exatas, sem fator nenhum no meio. Sao o que `paraJson` publica como
 *   quantidade da linha. Ver "cada linha na unidade em que foi lancada".
 *
 *   `entrou`/`perda`/`saiu` — EM KG, byte a byte o que esta query devolvia
 *   desde 35f3a2e, para a soma ENTRE linhas (o unico lugar onde a mistura de
 *   unidades e real). `perda` aqui e a soma das TRES perdas; a fatia que
 *   nasce em quilos por contrato sai separada em `perda_contrato_kg`, porque
 *   e justamente ela que nao cabe na unidade da linha quando `un` != 'KG'.
 *
 * peso_medio vem junto so para a leitura em embalagens do front.
 * `itens_sem_conversao` e um count() — bigint, tambem string aqui. */
interface LinhaEstoque {
  produto_id: string
  nome: string
  un: string
  /** `true` quando a linha nasceu de MOVIMENTACAO (entrada, perda ou saida);
   * `false` quando nasceu do CADASTRO — produto que existe em `produtos` e
   * nunca foi movimentado. As duas tem saldo MEDIDO; o que muda e o que o
   * zero delas significa, e so a query sabe de onde a linha veio. Ver a CTE
   * `chaves`. */
  movimentada: boolean
  peso_medio: string | number
  /** EM KG — a soma entre linhas. Ver acima. */
  entrou: string | number
  perda: string | number
  saiu: string | number
  /** NA UNIDADE LANCADA (`un`) — a quantidade da propria linha, exata. */
  entrou_un: string | number
  perda_deposito_un: string | number
  saiu_un: string | number
  /** A perda que nasce EM QUILOS por contrato (coleta + entrega), em kg.
   * Ja esta dentro de `perda`; sai separada porque numa linha em outra
   * unidade ela e a unica parcela que nao cabe na unidade da linha. */
  perda_contrato_kg: string | number
  itens_sem_conversao: string | number
  /** Quantos itens de saida desta linha entram em `saiu` SEM data de entrega
   * — ver "posicao num dia passado" no comentario grande abaixo. `count()`,
   * logo bigint/string aqui. Eles contam em QUALQUER corte (inclusive num
   * anterior a existirem), e por isso a tela precisa poder dizer quantos sao:
   * um numero que muda sem explicacao destroi a confianca na tela inteira. */
  itens_saida_sem_data: string | number
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
  /** A quantidade COMO FOI LANCADA, na unidade `un` da propria movimentacao.
   * Exata: um lancamento tem uma unidade so, e nada aqui e somado a nada. */
  qtd: string | number
  /** A mesma quantidade em quilos, ou `null` quando nao ha fator. Leitura
   * secundaria — nunca substitui `qtd`. */
  qtd_kg: string | number | null
  referencia: string
  total: string | number
}

/**
 * Agrega entradas, perdas de deposito e saidas por produto+unidade em SQL —
 * a soma pesada (todo o historico de itens ja movimentados) fica no banco;
 * o resultado que sai daqui ja e por linha da tabela da tela.
 *
 * `movimentadas`: uniao dos pares (produto_id, un) que aparecem em QUALQUER
 * das tres fontes. Nenhuma das tres pode ser a tabela "esquerda" sozinha —
 * um produto so com perda de deposito (sem nunca ter tido entrada) e
 * igualmente valido no prototipo, e o mesmo vale pras outras duas. Os tres
 * LEFT JOINs seguintes trazem os somatorios de cada fonte para essas
 * chaves — e aqui que "left join + sum" (a tecnica pedida) acontece de
 * fato: uma fonte sem linha para aquela chave simplesmente soma 0
 * (coalesce), em vez de derrubar a chave inteira como um inner join faria.
 *
 * ---- e o produto que nunca se moveu ----
 *
 * Ate 2026-08-28 `chaves` era SO essa uniao, e produto cadastrado e nunca
 * movimentado nao aparecia — fidelidade ao prototipo, cujo stockMap so nasce
 * de iterar entradas/perdas/pedidos, nunca da lista de produtos (ver
 * logica-estoque.txt: `entradasRaw.forEach(... if(!stockMap[k]) ...)`, o mapa
 * e criado sob demanda pela movimentacao, nunca pre-populado).
 *
 * Numa tela de ESTOQUE isso e o avesso do util: de 21 produtos cadastrados
 * apareciam 4, e o que sumia era justamente o que o dono mais precisa ver —
 * o que ele NAO TEM. "Nao esta na lista" e indistinguivel de "nao existe".
 *
 * Entao a uniao das tres fontes virou a CTE `movimentadas`, e `chaves`
 * passou a ser ela MAIS `cadastro`: os produtos de `produtos` sem
 * movimentacao nenhuma. O saldo deles e zero, e esse zero e MEDICAO (nada
 * entrou, nada saiu) — nunca travessao, que continua reservado para "nao ha
 * como saber".
 *
 * A UNIDADE da linha de cadastro e `produtos.un`, porque nao existe chave
 * (produto, un) para ela: nada foi lancado. Produto movimentado em mais de
 * uma unidade continua com uma linha por unidade e NAO ganha uma linha de
 * cadastro por cima — `cadastro` exige `not exists` em `movimentadas` para o
 * produto INTEIRO, sem olhar a unidade. Sem isso, um produto cadastrado em KG
 * e movimentado em UN ganharia uma segunda linha "KG zerada": mercadoria
 * inventada numa unidade em que ninguem lancou nada.
 *
 * `chaves.movimentada` viaja ate a tela (ver `paraJson`) porque os dois
 * saldos zero significam coisas diferentes — um acabou (teve entrada, saiu
 * tudo), o outro nunca foi comprado. Deduzir isso dos numeros seria
 * adivinhacao: entrou 0 / saiu 0 tambem descreve uma entrada de quantidade
 * zero. So a query sabe de qual metade a linha veio.
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
 * que o selo da tela mostra e, desde 2026-08-26, a unidade em que a
 * quantidade da linha e PUBLICADA (ver paraJson). Colapsar as linhas de um
 * mesmo produto num total unico em kg continua sendo possivel, mas e outra
 * decisao: mudaria a forma da tela e a chave de linha, e desfaria justamente
 * a garantia de que dentro de uma linha nao ha mistura de unidades.
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
 * `else`, entao vira NULL, `sum` ignora, e a contribuicao fica FORA da conta
 * EM QUILOS; o contador diz quantos ficaram. Como `chaves` agrupa por
 * (produto_id, un), o fator e constante dentro de uma linha: ou a linha
 * inteira converte, ou nenhuma das tres quantidades dela converte. Ou seja,
 * `itens_sem_conversao > 0` e exatamente `un <> 'KG' e peso_medio = 0` — e
 * por isso ele decide a linha toda, nunca uma celula so.
 *
 * ---- cada linha na unidade em que foi lancada ----
 *
 * Ate 2026-08-26 as quantidades PUBLICADAS eram so as tres de cima, em kg, e
 * uma linha nao convertivel saia com 0 em entrou/perda/saiu/saldo — o
 * `coalesce(..., 0)` transformava "nao sei converter" em "nao ha nada".
 * Quatro linhas de 45, 45, 18 e 30 UN de alface, escarola e rucula (produtos
 * cadastrados em KG, peso_medio 0) apareciam como quatro zeros com asterisco:
 * 138 unidades de mercadoria real exibidas como deposito vazio.
 *
 * A regra de somar em kg (203fb28, f6374ac, 35f3a2e, e2ce7d5) esta certa e
 * NAO foi desfeita — ela continua inteira nas colunas `entrou`/`perda`/`saiu`
 * deste select, que e o que a soma ENTRE linhas usa. O que estava errado era o
 * ALCANCE dela. Somar caixas com quilos so acontece quando se somam LINHAS
 * DIFERENTES; DENTRO de uma linha nao ha mistura nenhuma, porque a chave e
 * (produto_id, un) — `ei.un`, `pd.un` e `si.un` sao constantes ali por
 * construcao do `group by`. `sum(ei.qtd)` de uma linha e uma quantidade exata
 * numa unidade so, e converte-la a forca destroi informacao em vez de
 * reconcilia-la: sem peso_medio o resultado nao e "aproximado", e ausente, e
 * ausencia virou zero.
 *
 * Ha ainda um erro de dominio no caso real: alface e rucula se vendem por
 * unidade ou maco, nao por quilo. "Quantos quilos de alface" nao e so
 * impossivel sem peso medio — e a pergunta errada para esses produtos.
 *
 * Por isso a query passou a devolver TAMBEM `entrou_un`, `perda_deposito_un`
 * e `saiu_un`: as mesmas tres somas, sem o `case` de conversao. Elas nao
 * podem ficar NULL nem "fora da conta" — nao ha conta, so a quantidade que
 * alguem digitou. Zero ali e medicao (ninguem lancou nada, ou entrou e saiu
 * tudo), nunca falta de fator.
 *
 * A UNICA parcela que nao cabe na unidade da linha e a perda que nasce EM
 * QUILOS por contrato (entrada_itens.perda_kg + saida_itens.perda_kg + o
 * rateio do cabecalho). Ela sai isolada em `perda_contrato_kg`, e `paraJson`
 * a soma na perda da linha SO quando `un = 'KG'` — la ela ja esta na unidade
 * da linha, e o resultado e identico ao de antes desta mudanca. Fora de KG
 * ela viaja separada, em quilos, em vez de ser dividida pelo peso_medio: essa
 * divisao e o fator inverso que 35f3a2e recusou com razao, e escondê-la
 * dentro do numero principal seria repetir o erro na direcao contraria.
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
 * parametro de PERIODO, e nao devem ganhar um.
 *
 * ---- posicao num dia passado (`posicaoEm`) ----
 *
 * O que as duas funcoes ganharam, e coisa diferente: um CORTE NO TEMPO, nao
 * um intervalo. `posicaoEm` = 'AAAA-MM-DD' responde "como o deposito estava
 * no fim daquele dia" — tudo que aconteceu DESDE SEMPRE ATE aquela data,
 * inclusive ela. Nao e "o movimento de junho" (isso e o filtro global, que
 * continua fora daqui): recortar por mes daria saldo negativo em todo mes de
 * venda forte e ignoraria o que sobrou do mes anterior. E por ser corte, e
 * nao intervalo, ele nao tem limite inferior — nao existe `de`.
 *
 * `posicaoEm = null` (o default, e o que a tela manda quando esta em hoje) e
 * SEM CORTE: a query sai byte a byte com o mesmo resultado de antes desta
 * mudanca. "Voltar para hoje" e literalmente voltar ao comportamento de
 * sempre, e nenhum caminho da tela paga por uma funcionalidade que nao usou.
 *
 * A COMPARACAO E `<=`, INCLUSIVA. "Posicao em 15/08" inclui o que se moveu
 * NO dia 15/08 — o dia inteiro ja aconteceu quando se olha para tras. Um `<`
 * faria a entrada do proprio dia escolhido sumir, o erro classico que so
 * aparece quando a movimentacao cai exatamente na borda.
 *
 * CADA FONTE PELA SUA PROPRIA DATA — as mesmas de 4bee3f0, sem reabrir:
 *   entrada -> entradas.data     (a coleta)
 *   perda   -> perdas.data       (a baixa no deposito)
 *   saida   -> saidas.entrega    (a mercadoria sai quando e ENTREGUE)
 *
 * O corte da entrada e por ENTRADA, nao por item: `entradas.data` vale para
 * a entrada inteira, entao ela entra ou sai do corte como um todo. Por isso
 * a CTE `entrada_totais` (que so compara o cabecalho com a soma dos itens
 * DELA MESMA) continua sem filtro: o join com `ent`, ja recortado, decide
 * quais entradas contam, e filtrar de novo la dentro seria um no-op — mesmo
 * racional do `et` sem periodo em relatorios.ts.
 *
 * SAIDA SEM `entrega` — O CASO DIFICIL. Ela desconta do saldo (4bee3f0: so
 * Cancelado/Devolvido saem da conta) mas nao tem data, entao nao ha como
 * dizer se ja tinha saido em 15/08. As duas saidas possiveis eram exclui-la
 * da posicao historica ou inclui-la sempre; a escolha e INCLUIR SEMPRE
 * (`s.entrega is null or s.entrega <= posicaoEm`), por tres motivos:
 *
 *   1. Excluir quebraria a unica invariante que sustenta a tela: a posicao
 *      em hoje tem de ser identica a posicao atual. Com exclusao, a MESMA
 *      data daria dois numeros diferentes conforme o usuario tivesse
 *      escolhido hoje no seletor ou apenas aberto a tela — o pior resultado
 *      possivel para a confianca no numero.
 *   2. Incluir mantem a DIFERENCA entre duas datas correta: a saida sem data
 *      e uma constante presente em todos os cortes, entao o delta entre
 *      15/08 e hoje continua sendo exatamente a movimentacao datada entre as
 *      duas. Excluindo, o delta ficaria contaminado so na borda.
 *   3. A saida EXISTE e, pelo proprio modelo do projeto, a mercadoria dela ja
 *      saiu do deposito — o que falta e a data, nao o fato. Exclui-la de um
 *      corte afirmaria "ainda nao tinha saido", que e justamente o tipo de
 *      data inventada que 4bee3f0 recusou a produzir.
 *
 * O preco e real: essa saida aparece tambem em cortes anteriores a ela ter
 * sido registrada. Por isso `itens_saida_sem_data` sai em cada linha — a tela
 * marca a linha e explica, em vez de deixar um numero mudar sem motivo
 * visivel. O HISTORICO nao a lista (e uma lista de datas, e ela nao tem),
 * exatamente como ja acontecia antes deste corte.
 *
 * PRODUTO QUE AINDA NAO EXISTIA NA DATA nao vira "0 kg" — a linha NAO NASCE.
 * Isso vale nas duas metades de `chaves`, por caminhos diferentes:
 *
 *   MOVIMENTADAS: o corte ja derruba a movimentacao posterior, e sem
 *   movimentacao ate a data a chave nao aparece.
 *
 *   CADASTRO: o corte compara `produtos.criado_em::date <= posicaoEm`.
 *   Listar numa posicao de agosto um produto cadastrado em setembro
 *   AFIRMARIA ALGO FALSO SOBRE O PASSADO — diria "em 15/08 este produto
 *   estava zerado no deposito" de um produto que em 15/08 nao existia. Zero
 *   e uma medicao, e ninguem mediu o que ainda nao tinha sido cadastrado.
 *
 * O CORTE POR `criado_em` VALE SO PARA A LINHA DE CADASTRO, de proposito.
 * Movimentacao datada ANTES do corte e prova direta de que a mercadoria
 * estava la naquele dia, e essa prova vence `criado_em`: lancamento
 * retroativo e comum (a entrada de agosto registrada em setembro), e
 * `criado_em` diz quando o REGISTRO nasceu, nao quando o produto passou a
 * existir no negocio. Filtrar tambem as linhas movimentadas por `criado_em`
 * esconderia mercadoria que comprovadamente estava no deposito. `criado_em`
 * so decide onde nao ha nenhuma outra evidencia — a linha que nao tem
 * movimentacao alguma para se apoiar.
 *
 * `criado_em` e `timestamptz` e o corte e um dia de calendario, entao a
 * comparacao usa `::date` no fuso da sessao do banco. Na borda — produto
 * cadastrado na virada da meia-noite — isso pode deslocar a linha em um dia;
 * e a mesma aproximacao que o projeto ja aceita ao gravar as datas de
 * movimentacao como `date` a partir do calendario do navegador, e o dano
 * possivel e uma linha de saldo zero a mais ou a menos numa posicao
 * historica, nunca uma quantidade errada.
 *
 * RLS cuida do isolamento por tenant em cada tabela referenciada — nenhuma
 * dessas queries filtra tenant_id explicitamente porque tudo roda dentro de
 * withTenant (mesmo padrao das outras rotas).
 */
export async function buscarEstoque(
  sql: Sql,
  tenantId: string,
  /** Corte no tempo: 'AAAA-MM-DD' = a posicao no FIM daquele dia (inclusivo);
   * `null` = a posicao atual, sem corte nenhum. Ver "posicao num dia passado"
   * no comentario acima. */
  posicaoEm: string | null = null,
): Promise<LinhaEstoque[]> {
  return withTenant(sql, tenantId, tx => tx<LinhaEstoque[]>`
    with movimentadas as (
      -- As chaves (produto, unidade) que tiveram MOVIMENTACAO ate o corte. O
      -- corte entra AQUI tambem, e nao so nas somas: unidade em que nada se
      -- moveu ate a data escolhida nao nasce como linha movimentada.
      select ei.produto_id, ei.un
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      where (${posicaoEm}::date is null or e.data <= ${posicaoEm}::date)
      union
      select pd.produto_id, pd.un
      from perdas pd
      where (${posicaoEm}::date is null or pd.data <= ${posicaoEm}::date)
      union
      select si.produto_id, si.un
      from saida_itens si
      join saidas s on s.id = si.saida_id
      where s.status not in ('Cancelado', 'Devolvido')
        and (${posicaoEm}::date is null
             or s.entrega is null
             or s.entrega <= ${posicaoEm}::date)
    ),
    cadastro as (
      -- O produto CADASTRADO e nunca movimentado. Nao existe chave
      -- (produto, un) para ele em fonte nenhuma, entao a unidade e a do
      -- CADASTRO (produtos.un) — a unica que existe.
      --
      -- O not-exists NAO compara a unidade, de proposito: produto
      -- cadastrado em KG e movimentado em UN ja tem a sua linha (UN), e uma
      -- segunda linha "KG zerada" seria mercadoria inventada numa unidade em
      -- que ninguem lancou nada. A linha de cadastro so existe quando NAO HA
      -- MOVIMENTACAO NENHUMA daquele produto.
      --
      -- criado_em corta so AQUI: movimentacao anterior a data ja prova que a
      -- mercadoria estava la, mesmo que o cadastro tenha sido digitado
      -- depois. Ver "posicao num dia passado" no comentario acima.
      select p.id as produto_id, p.un
      from produtos p
      where (${posicaoEm}::date is null or p.criado_em::date <= ${posicaoEm}::date)
        and not exists (
          select 1 from movimentadas m where m.produto_id = p.id
        )
    ),
    chaves as (
      -- union all, nao union: as duas metades sao disjuntas por
      -- construcao (cadastro so aceita produto sem NENHUMA linha em
      -- movimentadas). A coluna diz de qual metade a linha veio — e e ela
      -- que deixa a tela distinguir "acabou" de "nunca foi comprado".
      select produto_id, un, true as movimentada from movimentadas
      union all
      select produto_id, un, false as movimentada from cadastro
    ),
    entrada_totais as (
      -- Por ENTRADA (nao por produto): soma dos itens dela mesma, usada na
      -- CTE 'ent' logo abaixo so pra decidir se o cabecalho
      -- (entradas.perda_kg) acrescenta alguma perda que os itens ainda nao
      -- mostram. Ver o comentario grande acima ("perda na coleta") pro
      -- raciocinio completo.
      --
      -- SEM CORTE DE DATA, de proposito: e o total da entrada INTEIRA, e a
      -- entrada entra ou sai do corte como um todo (entradas.data vale para
      -- ela toda). Quem decide o que conta e o where de 'ent' logo abaixo;
      -- filtrar aqui seria no-op. Mesmo racional do 'et' de relatorios.ts.
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
        -- A MESMA soma sem o case: a quantidade na unidade LANCADA. Nao ha
        -- case porque nao ha o que decidir — ei.un e constante dentro do
        -- group by, entao isto e uma soma de numeros da mesma unidade. Ver
        -- "cada linha na unidade em que foi lancada" no comentario acima.
        sum(ei.qtd) as entrou_un,
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
      -- Corte inclusivo (<=): a coleta do proprio dia escolhido conta.
      where (${posicaoEm}::date is null or e.data <= ${posicaoEm}::date)
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
        -- Idem: pd.un e constante dentro do group by, entao a perda de
        -- deposito TAMBEM tem uma quantidade exata na unidade da linha. E a
        -- unica das tres perdas que tem — as outras duas nascem em kg.
        sum(pd.qtd) as perda_deposito_un,
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
      where (${posicaoEm}::date is null or pd.data <= ${posicaoEm}::date)
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
        -- Idem entrou_un: si.un e constante dentro do group by.
        sum(si.qtd) as saiu_un,
        count(*) filter (
          where si.un <> 'KG' and coalesce(ps.peso_medio, 0) = 0
        ) as sem_conversao,
        sum(si.perda_kg) as perda_entrega,
        -- Quantos itens desta linha entram em 'saiu' SEM data de entrega.
        -- Eles contam em QUALQUER corte (ver "saida sem entrega" acima), e
        -- este contador e o que permite a tela dizer isso em vez de deixar
        -- um numero mudar sem explicacao. Nao depende de posicaoEm de
        -- proposito: o que a tela precisa saber e quantos sao, esteja ela
        -- olhando hoje ou 15/08.
        count(*) filter (where s.entrega is null) as itens_saida_sem_data,
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
        -- Saida sem entrega entra em TODO corte, inclusive num anterior a
        -- ela existir — a mercadoria ja saiu, so nao se sabe quando, e
        -- exclui-la afirmaria "ainda nao tinha saido". Ver o comentario
        -- grande acima para os tres motivos; itens_saida_sem_data (logo
        -- acima) e o que faz a tela dizer isso.
        and (${posicaoEm}::date is null
             or s.entrega is null
             or s.entrega <= ${posicaoEm}::date)
      group by si.produto_id, si.un
    )
    select
      p.id as produto_id,
      p.nome,
      k.un,
      -- De qual metade de chaves a linha veio. Numa linha de cadastro os
      -- tres LEFT JOINs abaixo nao casam com nada e todas as somas caem no
      -- coalesce 0 — que ali e MEDICAO, nao ausencia de dado.
      k.movimentada,
      p.peso_medio,
      -- EM KG, para a soma ENTRE linhas. Identicas ao que esta query devolve
      -- desde 35f3a2e — o coalesce aqui e o de "esta fonte nao tem linha para
      -- esta chave", nao o de "nao sei converter": quando a linha nao
      -- converte, quem diz isso e itens_sem_conversao, e paraJson entao NAO
      -- publica leitura em quilos nenhuma (ver la).
      coalesce(ent.entrou, 0) as entrou,
      coalesce(ent.perda_coleta, 0) + coalesce(perd.perda_deposito, 0)
        + coalesce(said.perda_entrega, 0) as perda,
      coalesce(said.saiu, 0) as saiu,
      -- NA UNIDADE LANCADA, exatas: a quantidade da propria linha. Zero aqui
      -- e sempre medicao (nenhum lancamento, ou entrou e saiu tudo) — nunca
      -- "faltou peso medio". Ver "cada linha na unidade em que foi lancada".
      coalesce(ent.entrou_un, 0) as entrou_un,
      coalesce(perd.perda_deposito_un, 0) as perda_deposito_un,
      coalesce(said.saiu_un, 0) as saiu_un,
      -- A fatia da perda que nasce EM QUILOS por contrato (coleta + entrega).
      -- Ja esta somada em perda; sai separada porque e a unica parcela que
      -- nao cabe na unidade da linha quando un <> 'KG'.
      coalesce(ent.perda_coleta, 0) + coalesce(said.perda_entrega, 0)
        as perda_contrato_kg,
      -- Um contador so, das tres fontes: entrou, perda e saiu desta linha
      -- saem todos das mesmas embalagens, entao um lancamento nao
      -- convertivel — de entrada, de perda de deposito ou de saida — deixa a
      -- LINHA inteira incompleta, nunca uma celula so. Mesmo padrao de
      -- relatorios.ts (GET /api/relatorios/produtos).
      coalesce(ent.sem_conversao, 0) + coalesce(perd.sem_conversao, 0)
        + coalesce(said.sem_conversao, 0) as itens_sem_conversao,
      coalesce(said.itens_saida_sem_data, 0) as itens_saida_sem_data,
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
 * saldo = entrou - perda - saiu, NA UNIDADE EM QUE A LINHA FOI LANCADA
 * (`un`), com a mesma conta em quilos ao lado (`em_kg`) quando ha como
 * converte-la.
 *
 * ---- por que a quantidade da linha vem na unidade lancada ----
 *
 * A linha da tabela E (produto, unidade lancada) — a chave do `group by` em
 * `buscarEstoque`. Dentro dela nao existe caixa somada com quilo: `ei.un`,
 * `pd.un` e `si.un` sao constantes por construcao. A quantidade lancada e
 * exata e nao ambigua ali, e forca-la a virar kg nao reconcilia nada — sem
 * peso_medio ela simplesmente desaparecia, e o `coalesce` do select
 * transformava a ausencia em 0. Foi assim que 45 UN de alface viraram "0 *"
 * na tela, quatro vezes seguidas, com 138 unidades no deposito.
 *
 * Zero continua sendo zero DE VERDADE: produto que entrou 45 e saiu 45 sai
 * daqui com saldo 0 e `itens_sem_conversao` 0 — medicao, sem marca nenhuma.
 * O que nao pode e ausencia de conversao virar zero, e e so isso que muda.
 *
 * O MESMO vale para a linha de CADASTRO (produto nunca movimentado): as tres
 * somas sao 0 porque nada foi lancado, e o saldo dela e zero MEDIDO, nao
 * travessao. `movimentada: false` e o que permite a tela dizer "nunca
 * comprado" em vez de "acabou" — os dois zeros sao iguais no numero e
 * diferentes no significado. `em_kg` dessa linha sai `{0,0,0,0}` e nao
 * `null`: zero de qualquer unidade sao zero quilos exatos, sem fator nenhum
 * no meio, entao ela entra no total sem tirar nada dele.
 *
 * ---- e por que o kg continua existindo, e continua obrigatorio ----
 *
 * Somar CX com KG so acontece ENTRE linhas, e la o kg e a unica unidade em
 * que a conta fecha — todo o raciocinio de 203fb28/f6374ac/35f3a2e/e2ce7d5
 * segue valendo, intacto, e a query continua produzindo aquelas somas. O que
 * mudou e o alcance: elas viajam em `em_kg`, para os totais da tela, os
 * indicadores do painel e os relatorios.
 *
 * `em_kg` e `null` — nao um objeto de zeros — quando a linha nao converte
 * (`itens_sem_conversao > 0`, que numa linha e exatamente
 * `un <> 'KG' e peso_medio = 0`). Null e o que faz o consumidor ter de
 * decidir o que dizer; zero deixaria ele somar silenciosamente e voltar a
 * afirmar um total que ignora a mercadoria. E o que substituiu
 * `equivalente_un`: aquilo era a quantidade em kg DIVIDIDA pelo peso_medio,
 * uma aproximacao do numero que agora chega exato como `entrou`/`saiu`.
 *
 * ---- a perda e a unica que nao cabe inteira na unidade da linha ----
 *
 * Das cinco parcelas, duas nascem EM QUILOS por contrato para item de
 * qualquer unidade (entrada_itens.perda_kg + o rateio do cabecalho, e
 * saida_itens.perda_kg). Numa linha em KG elas ja estao na unidade da linha e
 * entram na perda como sempre entraram — por isso uma linha em KG sai daqui
 * com os MESMOS quatro numeros de antes desta mudanca, e ha teste disso.
 *
 * Fora de KG elas nao cabem, e nao sao divididas pelo peso_medio: essa
 * divisao e o fator inverso que 35f3a2e recusou com razao. Viajam em
 * `perda_fora_da_unidade`, em quilos, para a tela poder dizer que a perda e o
 * saldo daquela linha deixam esses quilos de fora — a informacao que uma
 * divisao inventada esconderia dentro do numero principal.
 */
export function paraJson(linha: LinhaEstoque) {
  const pesoMedio = Number(linha.peso_medio)
  const itensSemConversao = Number(linha.itens_sem_conversao ?? 0)
  const ehKg = linha.un === 'KG'

  // ---- a quantidade da linha, na unidade lancada. Exata, sempre.
  const entrou = Number(linha.entrou_un)
  const saiu = Number(linha.saiu_un)
  const perdaContratoKg = Number(linha.perda_contrato_kg)
  // Numa linha em KG a perda de contrato JA esta na unidade da linha: soma
  // normalmente, e o resultado e identico ao de antes. Fora de KG, sai a
  // parte para `perda_fora_da_unidade` em vez de virar um fator inventado.
  const perda = Number(linha.perda_deposito_un) + (ehKg ? perdaContratoKg : 0)
  const perdaForaDaUnidade = ehKg ? 0 : perdaContratoKg
  const saldo = entrou - perda - saiu

  // ---- a mesma conta em quilos, para somar ENTRE linhas. Ver acima por que
  // e `null`, e nao um objeto de zeros, quando a linha nao converte.
  const entrouKg = Number(linha.entrou)
  const perdaKg = Number(linha.perda)
  const saiuKg = Number(linha.saiu)
  const emKg = itensSemConversao > 0
    ? null
    : { entrou: entrouKg, perda: perdaKg, saiu: saiuKg, saldo: entrouKg - perdaKg - saiuKg }

  return {
    produto_id: linha.produto_id,
    nome: linha.nome,
    un: linha.un,
    // A linha veio de movimentacao ou do cadastro. `!== false` porque so a
    // query produz esta coluna, e dela ela vem sempre: `undefined` seria um
    // chamador montando a linha na mao, e a leitura conservadora ali e
    // "movimentada" — o comportamento de antes desta coluna existir.
    movimentada: linha.movimentada !== false,
    entrou,
    perda,
    saiu,
    saldo,
    peso_medio: pesoMedio,
    perda_fora_da_unidade: perdaForaDaUnidade,
    em_kg: emKg,
    // count() vem como bigint (string no postgres.js) — mesma conversao na
    // borda que os numeric recebem, igual a entradas.ts/saidas.ts.
    itens_sem_conversao: itensSemConversao,
    // Idem: bigint do count(). Ver "saida sem entrega" em buscarEstoque —
    // a tela usa este numero para explicar por que a posicao historica
    // carrega uma saida que nao da para posicionar no tempo.
    itens_saida_sem_data: Number(linha.itens_saida_sem_data ?? 0),
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
 * `qtd` e a quantidade COMO FOI LANCADA, na unidade `un` da propria
 * movimentacao. Uma movimentacao e UM lancamento: tem uma unidade so e nao e
 * soma de nada, entao aqui nao existe nem a possibilidade de misturar
 * unidades — a quantidade e exata e sempre existe. E o numero que o
 * historico mostra.
 *
 * `qtd_kg` e a leitura secundaria, na convencao de quilos que a soma entre
 * linhas usa: KG conta direto, outra unidade multiplica por
 * `produtos.peso_medio`, e lancamento nao convertivel (unidade != KG com
 * peso_medio = 0) vira NULL — o mesmo `case` sem `else` da agregacao, pelo
 * mesmo motivo: uma caixa nao pesa um quilo. NULL aqui significa "este
 * lancamento e um dos `itens_sem_conversao` da linha", e o historico
 * simplesmente NAO mostra quilos nessa movimentacao. Ate 2026-08-26 ele
 * mostrava "—*" no lugar da quantidade, ou seja, apagava da tela um
 * lancamento de 45 UN que estava gravado e era exato.
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
  /** O MESMO corte de `buscarEstoque` (ver "posicao num dia passado" la), pelo
   * mesmo motivo: um historico que mostrasse movimentacoes posteriores a data
   * escolhida contradiria o saldo exibido logo acima dele, na mesma tela. */
  posicaoEm: string | null = null,
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
        ei.qtd as qtd,
        case
          when ei.un = 'KG' then ei.qtd
          when coalesce(pe.peso_medio, 0) > 0 then ei.qtd * pe.peso_medio
        end as qtd_kg,
        e.numero as referencia
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      join produtos pe on pe.id = ei.produto_id
      where (${posicaoEm}::date is null or e.data <= ${posicaoEm}::date)

      union all

      select
        si.produto_id, si.un,
        'saida' as tipo,
        s.entrega as data,
        s.criado_em as criado_em,
        si.id as item_id,
        si.qtd as qtd,
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
        -- Aqui NAO ha o ramo "entrega is null" que a agregacao tem: saida sem
        -- entrega ja ficava fora do historico antes deste corte (sem data,
        -- nao ha o que listar numa lista de datas nem por onde ordenar). A
        -- quantidade dela continua no saldo — e o que itens_saida_sem_data
        -- faz a tela explicar.
        and (${posicaoEm}::date is null or s.entrega <= ${posicaoEm}::date)

      union all

      select
        pd.produto_id, pd.un,
        'perda' as tipo,
        pd.data as data,
        pd.criado_em as criado_em,
        pd.id as item_id,
        pd.qtd as qtd,
        case
          when pd.un = 'KG' then pd.qtd
          when coalesce(pp.peso_medio, 0) > 0 then pd.qtd * pp.peso_medio
        end as qtd_kg,
        pd.motivo as referencia
      from perdas pd
      join produtos pp on pp.id = pd.produto_id
      where (${posicaoEm}::date is null or pd.data <= ${posicaoEm}::date)
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
      qtd, qtd_kg, referencia, total
    from ordenado
    where pos <= ${limite}
    order by produto_id, un, pos
  `)
}

/**
 * numeric -> number e bigint -> number na borda, igual a `paraJson`.
 *
 * `qtd` (na unidade `un` da movimentacao) e o numero do historico: um
 * lancamento e um so, com uma unidade so, e por isso e sempre exato.
 * `qtd_kg` e a leitura secundaria e mantem `null` (lancamento nao convertivel
 * em quilos) em vez de virar 0 — zero seria uma quantidade medida, e esta nao
 * foi. O que o `null` significa e "nao ha leitura em quilos desta
 * movimentacao", nunca "nao ha movimentacao".
 */
export function paraJsonMovimentacao(linha: LinhaMovimentacao) {
  return {
    produto_id: linha.produto_id,
    un: linha.un,
    tipo: linha.tipo,
    data: linha.data,
    qtd: Number(linha.qtd ?? 0),
    qtd_kg: linha.qtd_kg === null || linha.qtd_kg === undefined ? null : Number(linha.qtd_kg),
    referencia: linha.referencia ?? '',
    total: Number(linha.total ?? 0),
  }
}

/**
 * `?posicao_em=AAAA-MM-DD` — o corte no tempo das duas rotas. O nome NAO e
 * `de`/`ate` de proposito: aquele par (relatorios.ts) e um INTERVALO de meses
 * ligado ao filtro de periodo global, e esta tela continua fora dele. Aqui e
 * um PONTO no tempo, e o nome tem de deixar isso obvio para quem ler a URL.
 */
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Ausente e valido (= sem corte, a posicao atual). Presente tem de ser uma
 * data que EXISTE no calendario — o regex sozinho aceita '2026-02-31', que
 * derrubaria o `::date` da query com erro de banco (500) por causa de uma
 * entrada do usuario, que e 400. O round-trip por Date.UTC so devolve os
 * mesmos tres numeros quando o dia existe de fato.
 */
function posicaoValida(v: string | undefined): v is string | undefined {
  if (v === undefined) return true
  if (!DATA_RE.test(v)) return false
  const [ano, mes, dia] = v.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

/** O corte pedido na URL, ou `undefined` quando nao ha nenhum. String vazia
 * (`?posicao_em=`) conta como ausente: e o que um formulario manda quando o
 * campo foi limpo, e "sem data" e exatamente "sem corte". */
function corteDaUrl(v: string | undefined): string | undefined {
  return v ? v : undefined
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
  const em = corteDaUrl(c.req.query('posicao_em'))
  if (!posicaoValida(em)) {
    return c.json({ erro: 'posicao_em invalida (use AAAA-MM-DD)' }, 400)
  }
  const linhas = await buscarEstoque(c.get('sql'), c.get('tenantId'), em ?? null)
  return c.json(linhas.map(paraJson))
})

/**
 * O historico de movimentacao de TODAS as linhas de uma vez — ver
 * `buscarMovimentacoesEstoque` para o porque de ser uma consulta so e sob
 * demanda. Mesma exigencia de sessao da listagem (o router inteiro): quem ve
 * o saldo ve quando ele mexeu.
 *
 * Aceita o MESMO `?posicao_em=` da listagem — a tela manda o corte nas duas
 * buscas, senao o historico contradiria o saldo logo acima dele.
 */
estoque.get('/movimentacoes', async (c) => {
  const em = corteDaUrl(c.req.query('posicao_em'))
  if (!posicaoValida(em)) {
    return c.json({ erro: 'posicao_em invalida (use AAAA-MM-DD)' }, 400)
  }
  const linhas = await buscarMovimentacoesEstoque(c.get('sql'), c.get('tenantId'), em ?? null)
  return c.json(linhas.map(paraJsonMovimentacao))
})
