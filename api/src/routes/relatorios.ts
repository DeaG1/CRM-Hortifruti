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
 * mais a perda de coleta (entrada_itens.perda_kg) e de depósito (perdas.qtd).
 * `de`/`ate` (opcionais, 'AAAA-MM') filtram cada subconsulta pela data do
 * documento pai — mesmo intervalo usado nos outros seis relatórios
 * (noPeriodo em derive/relatorios.ts), só que calculado em SQL em vez de em
 * memória, porque aqui a soma que ele filtra também está em SQL.
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
      coalesce(perda_dep.qtd, 0) as perda_deposito_qtd
    from produtos p
    left join (
      select ei.produto_id,
             sum(ei.qtd) as qtd,
             sum(ei.qtd * ei.preco) as valor,
             sum(ei.perda_kg) as perda_kg
      from entrada_itens ei
      join entradas e on e.id = ei.entrada_id
      where (${deVal}::text is null or to_char(e.data, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(e.data, 'YYYY-MM') <= ${ateVal})
      group by ei.produto_id
    ) compra on compra.produto_id = p.id
    left join (
      select si.produto_id,
             sum(si.qtd) as qtd,
             sum(si.qtd * si.preco) as valor
      from saida_itens si
      join saidas s on s.id = si.saida_id
      where s.status = 'Entregue'
        and (${deVal}::text is null or to_char(s.entrega, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(s.entrega, 'YYYY-MM') <= ${ateVal})
      group by si.produto_id
    ) venda on venda.produto_id = p.id
    left join (
      select produto_id, sum(qtd) as qtd
      from perdas
      where (${deVal}::text is null or to_char(data, 'YYYY-MM') >= ${deVal})
        and (${ateVal}::text is null or to_char(data, 'YYYY-MM') <= ${ateVal})
      group by produto_id
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
  })))
})
