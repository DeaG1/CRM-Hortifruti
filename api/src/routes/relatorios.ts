import { Hono } from 'hono'
import { withTenant, type EnvBanco } from '../db'
import { exigirSessao, exigirAdmin, type Vars } from '../middleware/sessao'

/**
 * Suporte de dados para a tela de Relatórios (web/src/derive/relatorios.ts).
 *
 * Seis dos sete relatórios da tela (clientes, inadimplentes, pedidos,
 * compras, perdas por motivo, lançamentos) usam só campos de CABEÇALHO —
 * status, pag, valor, perda_kg, motivo, data... — que já vêm em
 * GET /api/saidas, GET /api/entradas, GET /api/perdas e GET /api/lancamentos.
 * Nenhum deles precisou de rota nova aqui.
 *
 * O relatório de PRODUTOS é diferente: ele soma, por produto, quanto foi
 * COMPRADO e VENDIDO no período — e essa informação só existe nas linhas de
 * `entrada_itens`/`saida_itens`. GET /api/entradas e GET /api/saidas de
 * propósito não trazem os itens na listagem (ver comentário nas duas rotas:
 * a tela de lista não precisa deles, e embuti-los ali seria N+1 de dado que
 * ninguém lê). A única forma de obter os itens pelos endpoints existentes é
 * `GET /:id` de cada linha do período — com 200 vendas + 100 compras no
 * período isso são 300 idas ao banco a ~116ms cada (medido em produção, ver
 * comentário equivalente em fornecedores.ts), quase 35 segundos numa única
 * requisição. Inaceitável.
 *
 * A soma sai daqui: uma única query, dentro de withTenant (RLS garante o
 * isolamento por tenant nas cinco tabelas envolvidas, igual a qualquer outra
 * rota), que já devolve o consolidado por produto — compra_qtd/compra_valor
 * de entrada_itens, venda_qtd/venda_valor de saida_itens (só pedidos
 * Entregues, mesmo filtro que o relatório de clientes usa para "faturado"),
 * mais a perda de coleta e de depósito (perdas.qtd).
 * `de`/`ate` (opcionais, 'AAAA-MM') filtram cada subconsulta pela data do
 * documento pai — mesmo intervalo usado nos outros seis relatórios
 * (noPeriodo em derive/relatorios.ts), só que calculado em SQL em vez de em
 * memória, porque aqui a soma que ele filtra também está em SQL.
 *
 * perda_coleta_qtd usa a MESMA regra de api/src/routes/estoque.ts
 * (buscarEstoque, CTEs entrada_totais/ent — ver o comentário grande lá para
 * o raciocínio completo): por entrada, o maior entre o cabeçalho
 * (entradas.perda_kg) e a soma dos itens dela, nunca a soma dos dois — os
 * dois campos descrevem o MESMO evento de perda na coleta (evidência: o
 * protótipo recalcula o cabeçalho a partir dos itens ao salvar, ver
 * logica-estoque/estoque.ts), só que em granularidades diferentes. Quando o
 * cabeçalho excede a soma dos itens, a diferença é rateada proporcional ao
 * peso (qtd) de cada item, porque o cabeçalho não tem produto_id próprio.
 * Isto existe pra este número BATER com o que a tela de Estoque mostra —
 * antes da correção, os dois já divergiam (aqui só via itens, sem olhar o
 * cabeçalho; lá nem um nem outro).
 *
 * ---- as três quantidades saem EM KG ----
 *
 * compra_qtd, venda_qtd e perda_deposito_qtd somavam `qtd` cru agrupando só
 * por `produto_id`, sem olhar a unidade de cada lançamento. `entrada_itens.un`,
 * `saida_itens.un` e `perdas.un` aceitam as mesmas unidades de `produtos.un`
 * ('KG','CX','UN','BDJA','MC', migrations 009 + 018): um produto comprado ora em caixa
 * ora em quilo tinha os dois somados no mesmo total, e
 * `cm = compra_valor / compra_qtd` (derivarRelatorioProdutos) dividia reais
 * por "caixas mais quilos" — o MESMO defeito de preço médio que
 * api/src/routes/entradas.ts (peso_total) acabou de corrigir nas compras.
 * Aqui pesa ainda mais: esta rota alimenta a tela de Produtos, que é onde o
 * dono decide preço de venda a partir de markup e margem.
 *
 * A regra de conversão é a MESMA das outras duas ocorrências dela no projeto
 * (entradas.ts/peso_total e estoque.ts/paraJson/equivalente_kg), de propósito
 * — três convenções divergentes seriam pior que o bug: lançamento em 'KG'
 * conta `qtd`; em qualquer outra unidade conta `qtd * produtos.peso_medio`
 * (peso de UMA embalagem, em kg), e só quando peso_medio > 0.
 *
 * Produto lançado em unidade não-KG com `peso_medio` = 0 (zero = "não
 * informado") não é convertível e NÃO recebe fator inventado (1 seria
 * mentira: uma caixa não pesa um quilo): o `case` sem `else` vira NULL, `sum`
 * ignora, a contribuição fica FORA do total — e `itens_sem_conversao` conta
 * quantos ficaram, somando as três fontes, para as telas marcarem a linha em
 * vez de exibirem um número silenciosamente incompleto.
 *
 * `perda_coleta_qtd` (entrada_itens.perda_kg + rateio do cabeçalho) NÃO é
 * convertida: é KG por contrato, para item de qualquer unidade — nome da
 * coluna, rótulo em ModalEntrada.tsx ("Perda na coleta/transporte (kg)") e
 * total dos itens no rodapé do mesmo modal. Converter estragaria um número
 * que já está certo. `perdas.qtd` (depósito) é o caso oposto — é uma
 * quantidade na unidade da própria perda, e por isso converte. Como efeito
 * colateral, o `perdaPct` do relatório de produtos (perda / compra_qtd) passa
 * a comparar kg com kg pela primeira vez. O rateio proporcional do cabeçalho
 * (`ei.qtd / et.qtd_itens`) continua sobre as qtd CRUAS: é uma proporção
 * entre itens da mesma entrada, e mexer nela aqui divergiria do rateio
 * idêntico de buscarEstoque — outro conserto, não este.
 *
 * ---- e saem TAMBÉM na unidade em que foram lançadas, quando há uma só ----
 *
 * O kg acima está certo e continua inteiro: `compra_qtd`, `venda_qtd` e
 * `perda_deposito_qtd` saem desta rota byte a byte como saíam, e são a base
 * de toda razão que a tela calcula (preço médio, markup, margem, perda %).
 * O que estava errado era o ALCANCE, o mesmo defeito que a tela de Estoque
 * corrigiu em 88318ee: converter à força também onde não havia mistura
 * nenhuma a reconciliar.
 *
 * Somar caixa com quilo só é um problema quando o MESMO produto foi
 * movimentado em unidades DIFERENTES. Quando todas as compras do período
 * estão numa unidade só, `sum(qtd)` daquela ponta é uma quantidade exata,
 * numa unidade só, e forçá-la a virar kg destrói informação em vez de
 * reconciliá-la: sem `peso_medio` o `case` sem `else` vira NULL, o `sum`
 * ignora e o `coalesce(..., 0)` do select publica 0 — "não sei converter"
 * indistinguível de "não houve movimento". Foi assim que 45 UN de alface
 * apareceram como `0*` nas colunas COMPRADO e VENDIDO da aba Produtos, com a
 * tela de Estoque mostrando `45 UN` para a MESMA mercadoria.
 *
 * Por isso cada uma das duas pontas devolve também `<ponta>_qtd_un` (a mesma
 * soma SEM o `case`) e `<ponta>_un` (a unidade, quando `count(distinct un)`
 * = 1; NULL quando houve mais de uma). Os dois juntos formam
 * `<ponta>_na_unidade` no JSON: um objeto ou `null`, nunca um número solto —
 * quantidade sem unidade não significa nada, e amarrá-los impede que alguém
 * some caixas com quilos por engano. NULL significa exatamente "este produto
 * se moveu em mais de uma unidade nesta ponta, então só o kg reconcilia" (ou
 * "não se moveu nesta ponta").
 *
 * COMPRA E VENDA SÃO PONTAS SEPARADAS de propósito: um produto comprado em CX
 * e vendido em KG tem uma unidade única de cada lado, e cada coluna diz a
 * verdade sobre o que ELA agrega. O que não existe nesse caso é uma unidade
 * comum — por isso nada aqui afirma uma, e por isso as razões que cruzam as
 * duas pontas (markup, margem) continuam saindo do kg e só do kg, na tela
 * (ver derivarRelatorioProdutos em web/src/derive/relatorios.ts).
 *
 * A perda de depósito NÃO ganha par: ela nunca é publicada sozinha — a tela
 * só a mostra somada à perda de coleta, que é kg por contrato. Uma quantidade
 * na unidade lançada não teria onde aparecer, e publicá-la seria contrato sem
 * consumidor.
 *
 * `compra_sem_conversao` e `venda_sem_conversao` são os mesmos contadores que
 * já compunham `itens_sem_conversao`, agora publicados SEPARADOS. O contador
 * somado continua (é ele que marca as razões da linha), mas ele não distingue
 * "não houve compra" de "as compras não converteram" — e essa diferença é a
 * que separa um zero MEDIDO de um zero que é ausência de conversão. Ver
 * `quantidadeRelatada` em web/src/derive/relatorios.ts, que é quem decide.
 */
const PERIODO_RE = /^\d{4}-\d{2}$/

function periodoValido(v: string | undefined): v is string | undefined {
  return v === undefined || PERIODO_RE.test(v)
}

export const relatorios = new Hono<{
  Bindings: EnvBanco
  Variables: Vars
}>()

// Relatórios é tela admin-only no design (ADMIN_ONLY_SCREENS, web/src/telas.ts).
// Diferente de clientes/produtos/fornecedores, aqui não há um colaborador
// que precise ler isto pra preencher um seletor — é só leitura, e expõe
// faturamento, margem e inadimplência agregados: dado sensível o bastante
// pra exigir admin também na leitura, não só na escrita.
relatorios.use('*', exigirSessao, exigirAdmin)

relatorios.get('/produtos', async (c) => {
  const de = c.req.query('de')
  const ate = c.req.query('ate')
  if (!periodoValido(de) || !periodoValido(ate)) {
    return c.json({ erro: 'periodo invalido (use AAAA-MM)' }, 400)
  }
  const deVal = de ?? null
  const ateVal = ate ?? null

  const linhas = await withTenant(c.get('sql'), c.get('tenantId'), tx => tx`
    select
      p.id as produto_id,
      p.nome,
      p.un,
      coalesce(compra.qtd, 0) as compra_qtd,
      coalesce(compra.valor, 0) as compra_valor,
      coalesce(compra.perda_kg, 0) as perda_coleta_qtd,
      coalesce(venda.qtd, 0) as venda_qtd,
      coalesce(venda.valor, 0) as venda_valor,
      coalesce(perda_dep.qtd, 0) as perda_deposito_qtd,
      -- NA UNIDADE LANCADA, exatas — a mesma soma sem o case de conversao,
      -- publicada so quando a ponta inteira esta numa unidade so (uns = 1).
      -- Zero aqui e sempre medicao; ausencia de unidade unica e NULL, nunca
      -- zero. Ver "e saem TAMBEM na unidade em que foram lancadas" no topo.
      coalesce(compra.qtd_un, 0) as compra_qtd_un,
      case when compra.uns = 1 then compra.un_lancada end as compra_un,
      coalesce(venda.qtd_un, 0) as venda_qtd_un,
      case when venda.uns = 1 then venda.un_lancada end as venda_un,
      -- Os mesmos contadores de baixo, agora SEPARADOS por ponta: so eles
      -- distinguem "nao houve compra" (zero medido) de "as compras nao
      -- converteram" (zero que e ausencia). Ver o topo do arquivo.
      coalesce(compra.sem_conversao, 0) as compra_sem_conversao,
      coalesce(venda.sem_conversao, 0) as venda_sem_conversao,
      -- Um contador so, das tres fontes: as cinco metricas por produto
      -- (compra media, venda media, markup, margem, perda %) saem todas de
      -- quantidades deste mesmo produto, entao qualquer lancamento nao
      -- convertivel — de compra, de venda ou de perda — deixa a LINHA
      -- incompleta. Ver o comentario grande no topo do arquivo.
      coalesce(compra.sem_conversao, 0)
        + coalesce(venda.sem_conversao, 0)
        + coalesce(perda_dep.sem_conversao, 0) as itens_sem_conversao
    from produtos p
    left join (
      select ei.produto_id,
             sum(
               case
                 when ei.un = 'KG' then ei.qtd
                 when coalesce(pc.peso_medio, 0) > 0 then ei.qtd * pc.peso_medio
               end
             ) as qtd,
             count(*) filter (
               where ei.un <> 'KG' and coalesce(pc.peso_medio, 0) = 0
             ) as sem_conversao,
             -- A MESMA soma sem o case: a quantidade na unidade em que foi
             -- lancada. So faz sentido quando uns = 1 — com mais de uma
             -- unidade isto somaria caixa com quilo, e e por isso que o
             -- select externo so publica o par quando a unidade e unica.
             sum(ei.qtd) as qtd_un,
             count(distinct ei.un) as uns,
             min(ei.un) as un_lancada,
             sum(ei.qtd * ei.preco) as valor,
             -- Mesma regra de buscarEstoque (api/src/routes/estoque.ts): a
             -- perda do item, mais — so quando o cabecalho da entrada excede
             -- a soma dos itens dela — a fatia proporcional ao peso (qtd)
             -- desse item na diferenca. 'et' (subconsulta logo abaixo) nao
             -- filtra por periodo de proposito: e o total da entrada
             -- INTEIRA, usado so pra comparar com o cabecalho dela, nao pra
             -- decidir o que entra no relatorio (isso quem decide e o
             -- 'where' mais abaixo, sobre e.data).
             sum(
               ei.perda_kg + case
                 when et.qtd_itens > 0
                   then (greatest(e.perda_kg, et.perda_itens) - et.perda_itens) * ei.qtd / et.qtd_itens
                 else 0
               end
             ) as perda_kg
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      join produtos pc on pc.id = ei.produto_id
      join (
        select entrada_id, sum(perda_kg) as perda_itens, sum(qtd) as qtd_itens
        from entrada_itens
        group by entrada_id
      ) et on et.entrada_id = ei.entrada_id
      where (${deVal}::text is null or to_char(e.data, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(e.data, 'YYYY-MM') <= ${ateVal})
      group by ei.produto_id
    ) compra on compra.produto_id = p.id
    left join (
      select si.produto_id,
             sum(
               case
                 when si.un = 'KG' then si.qtd
                 when coalesce(pv.peso_medio, 0) > 0 then si.qtd * pv.peso_medio
               end
             ) as qtd,
             count(*) filter (
               where si.un <> 'KG' and coalesce(pv.peso_medio, 0) = 0
             ) as sem_conversao,
             -- Idem compra: a soma crua e a unidade, para o select externo
             -- publicar o par so quando a venda inteira esta numa unidade so.
             sum(si.qtd) as qtd_un,
             count(distinct si.un) as uns,
             min(si.un) as un_lancada,
             sum(si.qtd * si.preco) as valor
      from saida_itens si
      join saidas s on s.id = si.saida_id
      join produtos pv on pv.id = si.produto_id
      where s.status = 'Entregue'
        and (${deVal}::text is null or to_char(s.entrega, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(s.entrega, 'YYYY-MM') <= ${ateVal})
      group by si.produto_id
    ) venda on venda.produto_id = p.id
    left join (
      -- perdas.qtd e uma quantidade na unidade da propria perda
      -- (perdas.un), nao um kg por contrato como entrada_itens.perda_kg —
      -- por isso ELA converte e aquela nao. buscarEstoque (estoque.ts)
      -- trata as duas do mesmo jeito: agrupa perdas por (produto_id, un).
      select pd.produto_id,
             sum(
               case
                 when pd.un = 'KG' then pd.qtd
                 when coalesce(pp.peso_medio, 0) > 0 then pd.qtd * pp.peso_medio
               end
             ) as qtd,
             count(*) filter (
               where pd.un <> 'KG' and coalesce(pp.peso_medio, 0) = 0
             ) as sem_conversao
      from perdas pd
      join produtos pp on pp.id = pd.produto_id
      where (${deVal}::text is null or to_char(pd.data, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(pd.data, 'YYYY-MM') <= ${ateVal})
      group by pd.produto_id
    ) perda_dep on perda_dep.produto_id = p.id
    where compra.produto_id is not null
       or venda.produto_id is not null
       or perda_dep.produto_id is not null
    order by p.nome
  `)

  // numeric do Postgres vem como string no postgres.js — convertido na
  // borda da API, mesmo padrão de paraJson nas demais rotas.
  return c.json(linhas.map(l => ({
    produto_id: l.produto_id as string,
    nome: l.nome as string,
    un: l.un as string,
    compra_qtd: Number(l.compra_qtd),
    compra_valor: Number(l.compra_valor),
    perda_coleta_qtd: Number(l.perda_coleta_qtd),
    venda_qtd: Number(l.venda_qtd),
    venda_valor: Number(l.venda_valor),
    perda_deposito_qtd: Number(l.perda_deposito_qtd),
    // A quantidade e a unidade viajam JUNTAS ou não viajam: `null` quando o
    // produto se moveu em mais de uma unidade nesta ponta (só o kg
    // reconcilia) ou quando não se moveu nela. Nunca um objeto de zeros —
    // zero com unidade seria uma medição que não houve, e um número sem
    // unidade convidaria a somá-lo com outra coisa. Mesma decisão de `em_kg`
    // em api/src/routes/estoque.ts.
    compra_na_unidade: l.compra_un == null
      ? null
      : { qtd: Number(l.compra_qtd_un), un: l.compra_un as string },
    venda_na_unidade: l.venda_un == null
      ? null
      : { qtd: Number(l.venda_qtd_un), un: l.venda_un as string },
    // count() vem como bigint (string no postgres.js) — mesma conversão na
    // borda que os numeric recebem, igual a paraJsonLista em entradas.ts.
    compra_sem_conversao: Number(l.compra_sem_conversao),
    venda_sem_conversao: Number(l.venda_sem_conversao),
    itens_sem_conversao: Number(l.itens_sem_conversao),
  })))
})
