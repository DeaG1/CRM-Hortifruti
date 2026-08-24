# Auditoria: implementação vs. protótipo

**Data:** 2026-08-24 · **Branch:** `fase0-fundacao` · **Referência:** `design/CRM Hortifruti.dc.html` (2956 linhas)

Este documento é um **inventário**, não um plano de correção. Nada foi consertado.

## Como foi feito

O protótipo foi lido inteiro — markup (linhas 39–1673) e a lógica em `renderVals()`
(linhas 1675–2952), que é onde os valores derivados são calculados. Cada tela do
protótipo foi comparada com a implementação correspondente em `web/src/screens/`
(mais os modais em `web/src/components/` e as derivações em `web/src/derive/`).

Buscar `TODO` no código não encontraria a maior parte disto: código não declara o
que nunca foi escrito. Toda linha de protótipo citada foi verificada individualmente.

**Classificação:**

- **Ausente** — existe no protótipo, não existe na implementação
- **Divergente** — existe nos dois, calcula ou se comporta diferente
- **Silenciado** — a implementação mostra valor fixo (`—`, zero, texto estático) onde o protótipo mostra dado derivado

**Esforço:**

- **baixo** — ligar dado que já vem de uma API que a tela já busca
- **médio** — lógica nova em `derive/`, ou uma busca a mais na tela
- **alto** — precisa de endpoint novo, mudança de contrato de API, ou é transversal a todas as telas

**Base:** commit `a20e9d6`. A tela de **Funcionários** estava sendo reconstruída em
paralelo (modificações não commitadas em `FuncionariosLista.*`, `derive/funcionarios.ts`,
`derive/lancamentos.ts` e `Shell.tsx`); ela foi auditada assim mesmo, para o inventário
ficar completo, mas está marcada e resumida — ver a seção correspondente. Nenhuma outra
tela tinha trabalho em andamento.

Diferenças puramente estéticas (cor, espaçamento, raio de borda) ficaram de fora.
Divergências que o projeto tomou de propósito estão na seção
[Divergências intencionais](#divergências-intencionais-não-são-falhas) e **não contam** como achados.

---

## Resumo

| Tela | baixo | médio | alto | Total |
|---|---:|---:|---:|---:|
| Shell / topbar (transversal) | 1 | 2 | 1 | **4** |
| Saúde do Negócio (Dashboard) | 1 | 1 | 0 | **2** |
| Clientes — lista | 1 | 0 | 0 | **1** |
| Cliente — ficha | 6 | 0 | 0 | **6** |
| Entradas (Compras) | 5 | 1 | 1 | **7** |
| Saídas (Vendas) | 3 | 2 | 2 | **7** |
| Estoque | 1 | 1 | 0 | **2** |
| Fornecedores | 1 | 4 | 0 | **5** |
| Produtos | 2 | 0 | 0 | **2** |
| Funcionários *(em reconstrução)* | 2 | 3 | 0 | **5** |
| Financeiro | 2 | 0 | 0 | **2** |
| Lançamentos | 0 | 0 | 0 | **0** |
| Relatórios (7 abas) | 0 | 1 | 0 | **1** |
| Veículos | — | — | — | **n/a** |
| **Total** | **25** | **15** | **4** | **44** |

Por tipo: **Ausente** 31 · **Divergente** 6 · **Silenciado** 7.

### Telas substancialmente incompletas

- **Fornecedores** — é o segundo caso de "Funcionários": as **quatro** métricas
  derivadas por fornecedor e o cartão de resumo estão todos com `—` fixo ou
  simplesmente não renderizados. A tela virou um cadastro puro. Os números já
  existem calculados em Relatórios ▸ Compras.
- **Saídas (Vendas)** — não tem **nenhum** cartão de resumo (o protótipo tem quatro),
  e faltam duas colunas da tabela. O núcleo (lista, filtros, modal) funciona.

Todas as outras estão dentro do razoável; **Relatórios** e **Financeiro** estão
essencialmente completos e em vários pontos melhores que o protótipo.

---

## Shell / topbar (transversal)

Não é uma tela do protótipo, mas o cabeçalho e a barra lateral carregam dois
controles que afetam todas as telas.

### S-1 · Subtítulos das telas foram encurtados — **Silenciado** — baixo

7 dos 11 subtítulos perderam a parte que explica **o que a tela calcula**.

| Tela | Protótipo (linhas 2136–2145) | `web/src/components/Shell.tsx:21-33` |
|---|---|---|
| Dashboard | "Visão geral da operação — meta vs. realizado" | "Visão geral da operação" |
| Clientes | "*N* ativos · carteira completa e health score" | "Carteira completa e health score" |
| Entradas | "…dos fornecedores — alimenta a Compra de mercadoria" | "Coletas e compras dos fornecedores" |
| Saídas | "…aos minimercados — logística, financeiro e perdas" | "Entregas aos minimercados" |
| Estoque | "Quantidade por produto — entradas − perdas − saídas" | "Quantidade por produto" |
| Fornecedores | "Norte do PR · preços de compra e variação" | "Produtores rurais" |
| Produtos | "Preço, margem e perda — calculados das compras e vendas" | "Preço, margem e perda" |
| ~~Funcionários~~ | "Salários, adiantamentos e valores a pagar" | *restaurado durante esta auditoria* |

Este é exatamente o padrão que motivou a auditoria: o subtítulo de Funcionários foi
encurtado para caber no que foi construído, escondendo a ausência em vez de sinalizá-la
(a reconstrução em curso já o restaurou). Os de **Fornecedores**, **Produtos** e
**Estoque** estão hoje na mesma situação, e pelo mesmo motivo — ver F-1..F-5, P-1, ES-1.

### S-2 · Contagem viva de clientes ativos no menu e no subtítulo — **Ausente** — médio

Protótipo: linha 61 (badge no item de menu) e 2115 (`badge: String(clientes.filter(x=>x.status==='ativo').length)`),
mais o subtítulo em 2137. Implementação: `Shell.tsx` não renderiza badge nenhum e não busca dados.

Médio porque o Shell hoje é puramente estático — precisaria de um `GET /api/clientes`.

### S-3 · Seletor de "Período" global no topbar — **Ausente** — alto

Protótipo: markup 95–101 (o `<select>` está em 97), opções e efeito em 2157–2159
(`periodOptions`, `pedidosPeriodo`, `entradasPeriodo`, `lancPeriodo`).

No protótipo **todas** as telas respeitam o período escolhido. Na implementação só
Financeiro (`FinanceiroTela.tsx:127-138`), Relatórios (`RelatoriosTela.tsx:473-487`) e
Lançamentos têm um filtro próprio; Dashboard, Clientes, Entradas, Saídas, Estoque,
Produtos e Fornecedores somam a base inteira, sempre.

`DashboardTela.tsx:165-167` afirma em comentário que "esta tela nunca teve seletor de
período" — o protótipo contradiz isso.

Consequência real: os KPIs do Dashboard (ticket médio, índice de perdas, inadimplência)
comparam meta contra o acumulado histórico. Conforme a base cresce, todos os
indicadores "amolecem" e param de significar qualquer coisa sobre o mês corrente.

Alto porque é transversal: envolve estado compartilhado no Shell + refiltragem em 7 telas.

### S-4 · Cartão "SALDO EM CAIXA" no topbar (admin) — **Ausente** — médio

Protótipo: markup 103–108; cálculo em 2321–2323
(`vendas pagas − compras pagas − lançamentos`), exposto em 2864.

Não existe em lugar nenhum da implementação (`grep -r "saldoCaixa\|SALDO EM CAIXA" web/src api/src` → 0 resultados).
Os três insumos já vêm de `/api/saidas`, `/api/entradas` e `/api/lancamentos`.

---

## Saúde do Negócio (Dashboard)

Arquivo: `web/src/screens/DashboardTela.tsx` · derivação: `web/src/derive/dashboard.ts`

Tela bem construída: os 4 cartões do topo, os 8 KPIs com semáforo, concentração de
carteira e cenários estão todos ligados a dado real, com `—` honesto e motivo quando
o indicador não é calculável. Dois achados.

### D-1 · As tags dos KPIs perderam a distância até a meta — **Divergente** — baixo

Protótipo: `tag:(nAtivos-35>=0?'+':'')+(nAtivos-35)` (2358) e
`tag:(ticketEntregaReal>=430?'na meta':'-R$'+Math.round(430-ticketEntregaReal))` (2360).

Implementação (`DashboardTela.tsx:129`): a tag é sempre `'na meta' | 'atenção' | 'fora da meta'`.

O usuário vê que está fora da meta mas não vê **por quanto** — a informação que decide
se o problema é urgente ou marginal.

### D-2 · Guia de primeiros passos — **Ausente** — médio

Protótipo: markup 119–150, lógica 2774–2797. Painel com cinco passos na ordem obrigatória
(produto → fornecedor → cliente → entrada → saída), barra de progresso "*N* de 5",
marcação de concluído, e um botão de ação apenas no passo atual. Some sozinho quando os
cinco estão feitos (`guiaAberto = !!passoAtual`, 2794).

Não existe na implementação (`grep -rni "primeiros passos\|passosRows\|guiaAberto" web/src` → 0 resultados).

O Dashboard hoje mostra um estado vazio genérico quando não há clientes
(`DashboardTela.tsx:189-199`) e, com dados parciais, uma parede de `—` sem dizer o que
fazer para preenchê-los.

---

## Clientes — lista

Arquivo: `web/src/screens/ClientesLista.tsx`

Colunas, filtros por status, health score e o travessão no lugar do zero estão fiéis.
Os chips de status, que no protótipo são só contadores, viraram filtros clicáveis —
melhoria, não divergência.

### CL-1 · Falta a dica "Clique numa linha para abrir a ficha" — **Ausente** — baixo

Protótipo: linha 251. A linha é clicável na implementação (`ClientesLista.tsx:224`),
mas nada na tela diz isso — a afordância existe e está invisível.

---

## Cliente — ficha

Arquivo: `web/src/screens/ClienteFicha.tsx`

### CF-1 · "Status de cobrança" mostra o campo de cadastro, não o derivado — **Silenciado** — baixo

Protótipo: `cCobranca = cAtrasados.length>0 ? 'Atrasado' : 'Em dia'` (2223), exibido com
cor em 2249. Implementação: `ClienteFicha.tsx:334` renderiza `{cliente.cobranca || '—'}`.

`cobranca` é uma coluna com `default 'Em dia'` (`db/migrations/004_clientes.sql:14`),
preenchida com `'Em dia'` em `CLIENTE_NOVO` (`web/src/derive/clientes.ts:50`) e
**não exposta em nenhum campo do ModalCliente**. Ou seja: ela diz "Em dia" para todo
cliente, para sempre, inclusive para um cliente com pedidos vencidos — enquanto o
bloco logo acima, na mesma tela, mostra a taxa de inadimplência real dele.

Não é dado faltando; é dado errado com aparência de apurado.

### CF-2 · Métrica "Última compra" — **Ausente** — baixo

Protótipo: 2237 (data do último pedido com status `Entregue`). A tela já monta
`entregasCliente` ordenado por data (`ClienteFicha.tsx:189-191`) — é o primeiro item da lista.

### CF-3 · Métrica "Qtd no período" — **Ausente** — baixo

Protótipo: 2233 (`cVolume` em kg + "*N* entrega(s)"). `GET /api/saidas` já devolve `peso`
por saída (`api/src/routes/saidas.ts:68`); o tipo local `SaidaBruta` (`ClienteFicha.tsx:48-56`)
apenas não o declara.

### CF-4 · As métricas perderam meta e semáforo — **Ausente** — baixo

Protótipo (2234–2238): cada métrica tem um sub-rótulo com a meta e uma cor de semáforo —
"meta R$ 3.500–3.800", "meta ≥ R$ 430", "risco de concentração",
"meta ≤ 1% · *N* atraso(s)". Implementação (`ClienteFicha.tsx:256-275`): só rótulo e valor,
sem meta e sem cor. O número aparece sem a régua que diz se é bom.

### CF-5 · "Histórico de atrasos" no bloco Crédito — **Ausente** — baixo

Protótipo: 2250 — "*N* pedido(s) · R$ *X*" (ou "0 atrasos"), em vermelho quando há atraso.
O bloco de crédito da implementação (`ClienteFicha.tsx:322-342`) tem 4 das 5 linhas.

### CF-6 · "Pedidos recentes" virou "Histórico de entregas" reduzido — **Divergente** — baixo

Protótipo (markup 335–347, dados 2252–2255): número do pedido, data, **quantidade**,
valor e **selo de status**, incluindo pedidos não entregues (últimos 4).

Implementação (`ClienteFicha.tsx:278-294`): data, situação de pagamento e valor, só
`status === 'Entregue'`. Perdem-se o identificador do pedido (para achá-lo em Saídas),
a quantidade e a visibilidade de pedidos pendentes/em rota.

---

## Entradas (Compras)

Arquivos: `web/src/screens/EntradasLista.tsx`, `web/src/components/ModalEntrada.tsx`

O aviso de peso incompleto por falta de peso médio (o `*` e a nota de rodapé) é uma
adição da implementação, não uma divergência — é honestidade que o protótipo não tinha.

### E-1 · Cartão "A pagar ao produtor" — **Ausente** — baixo

Protótipo: `entradaStats` (markup 471, dados 2506) — soma das entradas com `pago !== 'Pago'`,
sub "*N* pendente(s)", vermelho quando > 0.

Implementação (`EntradasLista.tsx:196-223`): os quatro cartões são ENTRADAS, PESO RECEBIDO,
PERDA e VALOR TOTAL. O "A pagar ao produtor" foi substituído por PESO RECEBIDO.

Os campos `pago` e `valor_total` já estão na lista carregada — é uma soma de uma linha.

### E-2 · Cartão de perda mostra kg, não o índice contra a meta — **Divergente** — baixo

Protótipo (2507): "Perda média" em **%**, sub "meta ≤ 10%", com semáforo
(verde ≤10%, âmbar ≤15%, vermelho acima).

Implementação (`EntradasLista.tsx:214-221`): "PERDA (COLETA/TRANSPORTE)" em kg absolutos,
sempre vermelho. Sem a %, não dá para saber se 140 kg é normal ou catastrófico.

### E-3 · Coluna PERDA por entrada em kg, não em % — **Divergente** — baixo

Protótipo: markup 489, cálculo 2510 (`perdaKg/pesoKg*100`) com semáforo em 2515.
Implementação: `EntradasLista.tsx:296-301` mostra `peso(e.perda_kg)`.
`perda_kg` e `peso_total` estão os dois na linha.

### E-4 · Sub-linha "forma · data" sob o chip de pagamento — **Ausente** — baixo

Protótipo: markup 491 (`{{ e.pagInfo }}`), montada em 2517 (`PIX · 10/06`).
Implementação (`EntradasLista.tsx:303-318`): só o `SeletorPagamento`.
`forma_pag` e `data_pag` já vêm na resposta (`EntradasLista.tsx:19-20`).

### E-5 · Modal: coluna "PERDA %" por item e no total — **Ausente** — baixo

Protótipo: cabeçalho 1441, célula 1459 (`it.perdaPct`), total 1473 (`entTotals.perdaPct`),
cálculo em 2284/2306.

Implementação (`ModalEntrada.tsx:450-545`): as colunas são Produto, Unidade, Qtd, R$/UN,
Perda, Subtotal — a % está fora, e o rodapé de totais soma perda em kg sem a %.

### E-6 · Estado vazio não distingue "falta cadastrar antes" — **Ausente** — médio

Protótipo (505–511, lógica 2837–2840): quando não há produto **ou** fornecedor cadastrado,
o estado vazio troca o botão por "Antes de comprar, cadastre *ao menos um produto*"
(linha 510). Implementação (`EntradasLista.tsx:247-259`): mostra sempre "Lançar primeira
entrada", e o modal abre com o select de fornecedor vazio.

### E-7 · Coluna PRODUTOS (o que veio em cada coleta) — **Ausente** — alto

Protótipo: cabeçalho 481, célula 487 (`e.itensTxt` = "Batata 1.500 KG · Cebola 750 KG"),
montada em 2520.

Implementação (`EntradasLista.tsx:262-271`): a coluna foi trocada por MOTIVO (que no
protótipo é uma sub-linha sob os produtos, não uma coluna).

Alto porque `GET /api/entradas` devolve só o cabeçalho agregado
(`api/src/routes/entradas.ts:87-94`, `paraJsonLista`) — os itens só vêm em `GET /:id`.
Precisa de mudança de contrato da rota de lista (ou de um agregado tipo `itens_txt`).

---

## Saídas (Vendas)

Arquivos: `web/src/screens/SaidasLista.tsx`, `web/src/components/ModalSaida.tsx`
Protótipo: seção "PEDIDOS", 405–462 + 2393–2417.

Os filtros duplos (status e pagamento) e o cálculo de "Atrasado" a partir do vencimento
são adições da implementação.

### S-1 · Os quatro cartões de resumo — **Ausente** — baixo

Protótipo: markup 412–419 (`sc-for` em 413), dados 2394–2399:

| Cartão | Conteúdo |
|---|---|
| Pedidos no período | contagem |
| Faturado (entregue) | R$ · "*N* pedidos entregues" |
| **A receber / atrasado** | R$ · "*N* pedido(s) em atraso" |
| Qtd entregue | kg no período |

`SaidasLista.tsx` não tem nenhum bloco de estatísticas — vai direto dos filtros para a
tabela (linha 259). Todos os quatro saem da lista que a tela já carregou.

O impacto maior é o terceiro: **"quanto os minimercados me devem" não aparece em
nenhuma tela do dia a dia** (só em Relatórios ▸ Inadimplentes, que é uma tela de análise).

### S-2 · Coluna RECEB. (dias entre entrega e pagamento) — **Ausente** — baixo

Protótipo: cabeçalho 424, célula 436, dado 2406 (`p.recebDias + ' d'`, colorido por situação).
É o insumo visível do componente "recebimento" do ciclo de caixa.

Implementação (`SaidasLista.tsx:259-268`): a coluna não existe.
`entrega` e `data_pag` já vêm de `GET /api/saidas` — é uma subtração de datas.

### S-3 · Sub-linha "forma · data" sob o chip de pagamento — **Ausente** — baixo

Protótipo: markup 425 (`p.pagInfo`), montada em 2414. Implementação: mostra o vencimento
(`SaidasLista.tsx:304`), nunca a forma nem a data em que foi efetivamente pago.

### S-4 · Estado vazio não distingue "falta cadastrar antes" — **Ausente** — médio

Protótipo: 450–456 (`faltaParaSaida`/`faltaSaidaTxt`, 2839/2841) — "Antes de vender,
cadastre *um produto e um cliente*" (linha 455).
Implementação (`SaidasLista.tsx:179-194`): sempre "Lançar primeira saída".

### S-5 · "Marcar pago" grava a data de hoje sem perguntar — **Divergente** — médio

Protótipo: o botão (linha 439) abre um modal de pagamento (1595–1613) que pede **data**
e **forma**; ao salvar, calcula `recebDias = entrega → dataPag` (2048–2049).

Implementação: o chip da linha faz `PATCH /api/saidas/:id/pag`
(`SaidasLista.tsx:146-159`) e o servidor grava `data_pag = hoje`
(`api/src/routes/saidas.ts:435-452`). Marcar hoje um pagamento recebido há três dias
grava a data errada — e é essa data que alimenta `diasRecebimento` no ciclo de caixa.

Atenuante: o modal completo (`ModalSaida.tsx`) tem os campos `data_pag` e `forma_pag`,
então dá para corrigir depois — se alguém souber que precisa.

### S-6 · Coluna PRODUTOS (itens do pedido) — **Ausente** — alto

Protótipo: cabeçalho 424, célula 430 (`p.itensTxt`), montada em 2403.
Mesma causa e mesmo custo de E-7: a lista de saídas não traz os itens.

### S-7 · Aviso de estoque insuficiente ao montar o pedido — **Ausente** — alto

Protótipo: disponibilidade por item (1282, `it.dispTxt` — "1.240 disp."), caixa de alerta
"⚠ Estoque insuficiente" (1292–1300), cálculo em 2264–2273 e 2285–2297. Note que o
protótipo **permite salvar** — só avisa que o estoque fica negativo.

Implementação: não existe. **Está documentado**: `ModalSaida.tsx:545-600` traz um
comentário longo explicando por que não foi feito (`GET /api/estoque` agrega por
produto+unidade e não sabe excluir os itens do próprio rascunho em edição). É a exceção
que confirma a regra desta auditoria — foi a única ausência registrada em comentário.

---

## Estoque

Arquivo: `web/src/screens/EstoqueLista.tsx` (+ `PerdasLista.tsx` embutida)
Protótipo: 604–666 + 2526–2548.

A tabela de saldo está fiel e melhorada (conversão para kg com marca de incompleto).
A seção de perdas do depósito está no lugar certo (dentro de Estoque, como no protótipo).

### ES-1 · A seção de perdas perdeu título e explicação — **Ausente** — baixo

Protótipo (641–644): título "Perdas no depósito" + "Mercadoria que estragou depois da
compra — **desconta do estoque e entra no índice de perdas**"; e o estado vazio (662)
avisa que "a perda da coleta vai na própria entrada".

Implementação (`PerdasLista.tsx:112-119`): só a legenda "Perdas do depósito, depois que a
mercadoria já entrou · clique numa perda para editar". Some a informação de que este
lançamento tem dois efeitos, e a distinção entre perda de coleta e perda de depósito —
que é a confusão mais provável do usuário nesta tela.

### ES-2 · Cartão "Saídas registradas" — **Ausente** — médio

Protótipo: `estoqueStats` tem três cartões (markup 608, dados 2544–2548):
"Itens com estoque", "Perdas no depósito", "Saídas registradas".

Implementação (`EstoqueLista.tsx:156-162`): só o primeiro. O segundo aparece de outra
forma dentro da `PerdasLista` embutida ("PERDAS REGISTRADAS"); o terceiro não existe.

Médio porque `EstoqueLista` só busca `GET /api/estoque` — precisaria de `/api/saidas`.

---

## Fornecedores

Arquivo: `web/src/screens/FornecedoresLista.tsx` · Protótipo: 519–560 + 2419–2458

**Esta é a tela mais incompleta do sistema.** Todas as métricas derivadas estão com
`—` fixo no código, e uma delas nem é renderizada. O comentário em
`FornecedoresLista.tsx:114-115` diz "Depende das entradas (compras), ainda sem tela nesta
fase" — essa justificativa expirou: `EntradasLista` existe, `GET /api/entradas` devolve
`data`, `fornecedor_id`, `peso_total`, `valor_total` e `perda_kg`, e
`derivarRelatorioCompras` (`web/src/derive/relatorios.ts:664`) **já calcula preço médio,
perda % e aproveitamento por fornecedor** para a aba Compras de Relatórios.

### F-1 · "Última coleta" — **Silenciado** — baixo

Protótipo: markup 546, cálculo 2446 (data máxima das entradas do fornecedor).
Implementação: `FornecedoresLista.tsx:148` → `—` literal.

### F-2 · "Preço médio" de compra — **Silenciado** — médio

Protótipo: markup 544, cálculo 2421–2426/2443 (`Σ valor / Σ kg` das entradas do fornecedor).
Implementação: `FornecedoresLista.tsx:140` → `—` literal.

### F-3 · "Variação" (última compra vs. anterior) — **Silenciado** — médio

Protótipo: markup 545, cálculo 2428–2441 — preço médio da coleta mais recente contra a
anterior do mesmo fornecedor, com semáforo (±7% é a referência CEASA).
Implementação: `FornecedoresLista.tsx:144` → `—` literal.

Este é o número pelo qual a tela existe: é como o comprador percebe que um produtor
começou a subir preço.

### F-4 · Cartão de resumo "Variação de preço de compra" — **Silenciado** — médio

Protótipo: markup 526, cálculo 2436–2437/2456–2457 (média das variações, sub "última
compra vs. anterior · ±7% CEASA").
Implementação: `FornecedoresLista.tsx:111-119` → valor `—`, sub "Sem entradas registradas ainda".

O sub-texto é ativamente enganoso quando **há** entradas registradas.

### F-5 · "Aproveit." (aproveitamento da carga) — **Ausente** — médio

Protótipo: markup 547, cálculo 2447–2449 (`(peso − perda) / peso`).
Implementação (`FornecedoresLista.tsx:137-150`): o card do fornecedor tem 3 blocos de
métrica; o quarto simplesmente não foi escrito.

É a métrica de **qualidade** do fornecedor — quanto da carga dele chega vendável.
Sem ela, o preço médio sozinho leva à decisão errada (o produtor mais barato pode ser
o mais caro depois da perda).

---

## Produtos

Arquivo: `web/src/screens/ProdutosLista.tsx` · Protótipo: 562–602 + 2460–2493

As sete colunas existem e estão ligadas ao agregado real, com travessão honesto e marca
de quantidade incompleta. Dois achados.

### P-1 · "Perda média (realizada)" na linha de rodapé — **Silenciado** — baixo

Protótipo: markup 593–596, cálculo 2473–2477
(`Σ perdaKg / Σ kg` de todos os produtos, com semáforo).

Implementação: `ProdutosLista.tsx:252-262` renderiza a linha de resumo com o rótulo
"Perda média (realizada)" e "MÉDIA →", e um `—` literal na célula do valor. O comentário
diz que "nenhum relatório hoje expõe uma perda média ponderada" — mas
`ProdutoAgregado` (`web/src/derive/relatorios.ts:169-200`) já traz `compra_qtd`,
`perda_coleta_qtd` e `perda_deposito_qtd` por produto, e a tela já carregou o array
inteiro. São duas somas.

### P-2 · Coluna MARGEM mede coisa diferente — **Divergente** — baixo

Protótipo (markup 580, cálculo 2482/2488): margem **por unidade** mais o percentual —
`R$ 1,35 · 42%` (venda média menos compra média, e quanto isso representa do preço de venda).

Implementação (`ProdutosLista.tsx:242-244`): margem **total do período** em R$
(`venda_valor − venda_qtd × compra_media`), sem percentual.

Os dois números são úteis, mas respondem a perguntas diferentes. Esta é a tela onde se
decide preço de venda: o que falta é justamente o "quanto sobra por quilo, e que % é isso".

---

## Funcionários — *em reconstrução por outro agente*

Arquivo: `web/src/screens/FuncionariosLista.tsx` · Protótipo: 668–781 + 2550–2599

Auditada apenas para o inventário ficar completo — os achados abaixo já são conhecidos
e estão sendo corrigidos. O estado descrito é o do **commit `a20e9d6`** (a tela era um
cadastro: nome, cargo, salário, dia de pagamento, próximo pagamento, e
`web/src/derive/funcionarios.ts` não tinha nenhuma função de adiantado/pago/a pagar).

> **Trabalho em andamento no diretório.** Durante esta auditoria, a árvore de trabalho já
> tinha modificações não commitadas em `FuncionariosLista.tsx`, `derive/funcionarios.ts`,
> `derive/lancamentos.ts`, `derive/financeiro.ts`, `FinanceiroTela.tsx` e `Shell.tsx` —
> a reconstrução. **Confira o estado atual antes de agir sobre esta seção**; várias
> destas cinco linhas provavelmente já estão fechadas.

| # | Achado | Tipo | Protótipo | Esforço |
|---|---|---|---|---|
| FU-1 | Quatro cartões de resumo (Funcionários / Folha mensal / Adiantado no período / A pagar) | Ausente | 676; 2594–2599 | baixo |
| FU-2 | Nota de rodapé com a fórmula de "a pagar" e do próximo pagamento | Ausente | 779 | baixo |
| FU-3 | Colunas ADIANTADO / PAGO / A PAGAR | Ausente | 712–723; 2555–2556 | médio |
| FU-4 | Botões "Adiantar" e "Pagar salário" (criam lançamento pré-preenchido) | Ausente | 728–731; 1933–1957 | médio |
| FU-5 | Linha expansível com o histórico de lançamentos do funcionário | Ausente | 736–772; 2558–2564 | médio |

---

## Financeiro

Arquivo: `web/src/screens/FinanceiroTela.tsx` · Protótipo: 783–872

Tela em bom estado: DRE com custos por categoria, ciclo de caixa decomposto nos três
componentes com motivo quando um não é calculável, destaque de lucro, seletor de período
próprio e a lista de lançamentos embutida. Dois achados menores.

### FI-1 · Sub-linha da Receita bruta — **Ausente** — baixo

Protótipo: markup 799, dado 2896 (`finReceitaSub` = "*N* pedido(s) entregue(s) no período").
Implementação (`FinanceiroTela.tsx:166-169`): só o valor. Some a rastreabilidade
("essa receita veio de quantas entregas?").

### FI-2 · Título e dica da seção de lançamentos — **Ausente** — baixo

Protótipo (852–853): "Lançamentos **do período**" + "clique num lançamento para editar".
Implementação (`FinanceiroTela.tsx:148-151`): só "Lançamentos". A linha é clicável e nada diz.

---

## Lançamentos

No protótipo esta tela **não existe separada** — a lista de lançamentos vive dentro de
Financeiro (850–870). A implementação (`web/src/screens/LancamentosLista.tsx`) reproduz
exatamente as cinco colunas (DATA, CATEGORIA, DESCRIÇÃO, FUNCIONÁRIO, VALOR), com as
mesmas 13 categorias (`api/src/routes/lancamentos.ts:16-20` = `LANC_CATS`, protótipo 1917),
e ainda acrescenta um filtro De/Até. A tela é embutida em Financeiro e não aparece no
menu (decisão documentada em `App.tsx:16-17`).

**Nenhum achado.**

---

## Relatórios (7 abas)

Arquivo: `web/src/screens/RelatoriosTela.tsx` · derivação: `web/src/derive/relatorios.ts`
Protótipo: 874–1152 + 2626–2823

A tela mais fiel do sistema. As sete abas existem (Clientes, Inadimplentes, Pedidos,
Compras, Produtos, Perdas, Lançamentos), com os quatro cartões de cada uma, todas as
colunas, os dois painéis das abas Pedidos e Perdas, a exportação CSV com os mesmos
cabeçalhos do protótipo (2804–2821) e o Imprimir/PDF. O filtro De/Até é melhor que o
dropdown fixo do protótipo (que só oferecia abril/maio/junho de 2026).

### R-1 · Linha de inadimplente não abre a ficha do cliente — **Ausente** — médio

Protótipo: `onClick="{{ r.open }}"` na linha (1015), `open: () => this.openCliente(...)` (2735),
e a nota da aba diz "**Clique num cliente para abrir a ficha e o histórico de cobrança**" (1032).

Implementação: as linhas (`RelatoriosTela.tsx:587-600`) não têm `onClick`, e a nota
(`RelatoriosTela.tsx:609`) mantém só a segunda metade da frase (a explicação do "% dele").

Quem vê a lista de quem está devendo não consegue ir dali para o telefone e o histórico
do devedor — tem de ir a Clientes e procurar pelo nome.

Médio porque `App.tsx` não tem hoje navegação entre telas carregando um id
(`onNavegar` recebe só a `Tela`); o módulo de clientes guarda o `clienteId` internamente.

---

## Veículos

**Não existe no protótipo** (`grep -ci "veiculo\|veículo"` no arquivo → 0). É uma tela
acrescentada depois (`web/src/telas.ts:5-7` documenta isso). Fora do escopo desta auditoria.

---

## Divergências intencionais (não são falhas)

Registradas para que ninguém "conserte" de volta:

1. **Login por perfil + senha de teste → login real multi-tenant.**
   Protótipo 1632–1673 e 1705–1713 (`SENHAS = { admin:'admin123', colaborador:'func123' }`,
   com as senhas impressas na tela). Implementação: `web/src/screens/Login.tsx` com
   empresa + e-mail + senha e mensagem de erro genérica para não permitir enumeração.

2. **Alternador Admin/Funcionário na sidebar** (protótipo 76–80) — era uma maquete para
   demonstrar os dois papéis. O papel real vem da sessão (`GET /api/eu`).

3. **"Cliente desde" e "Sequência na rota" na ficha** (protótipo 2243) — no protótipo são
   valores inventados (`'mar/2025'` fixo e `'#' + c.id`). Omitidos com razão; o campo
   E-mail entrou no lugar.

4. **"Histórico de interações" na ficha do cliente** (protótipo 351–364, dados 2256–2260) —
   três interações hardcoded, sem fonte de dado nenhuma. Construir de verdade seria
   **alto** (tabela nova + CRUD). Omissão correta hoje.

5. **Ciclo de caixa: constante fixa de 3 dias → prazo real de pagamento ao produtor.**
   Protótipo: `const cicloPag = 3; // referência do estudo` (2343), e o ciclo **soma**
   os três componentes. Implementação: subtrai o prazo do produtor (CCC padrão) e o mede
   das entradas efetivamente pagas — documentado em `FinanceiroTela.tsx:208-238` e
   `web/src/derive/financeiro.ts`. Correção autorizada, não desvio.

6. **"9 KPIs do estudo"** (protótipo 167) — o protótipo escreve 9 mas renderiza 8
   (array `kpis`, 2355–2364). A implementação escreve `{kpis.length}` e renderiza os
   mesmos 8. A implementação está certa.

7. **Aviso de quantidade não convertível (`*` + nota de rodapé)** — não existe no
   protótipo. É uma adição da implementação (Entradas, Estoque, Produtos, Dashboard,
   Relatórios) para não mostrar soma incompleta como se fechasse.

8. **Chips de status de Clientes viraram filtros clicáveis** (protótipo 242–250: só
   contadores). Melhoria.

---

## Observação de método

Uma única ausência, entre as 44, está registrada em comentário no código: o aviso de
estoque insuficiente no modal de saída (`ModalSaida.tsx:545-600`, achado S-7). Todas as
outras 43 são invisíveis para quem lê só o código.

O caso mais traiçoeiro são as seis com um `—` literal escrito à mão — Fornecedores
F-1..F-4, Produtos P-1 e Cliente-ficha CF-1 (esta última pior ainda: um `'Em dia'` fixo).
Elas *parecem* a convenção de honestidade do projeto ("travessão é melhor que número
inventado") e são, na verdade, uma ligação que nunca foi feita. Duas delas trazem
comentário justificando a espera por um dado que **já existe hoje**
(`FornecedoresLista.tsx:114-115`, `ProdutosLista.tsx:256-260`): a justificativa envelheceu
junto com o código e ninguém voltou para revisá-la.
