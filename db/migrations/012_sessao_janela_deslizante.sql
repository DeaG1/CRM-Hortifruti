-- Sessao passa de prazo fixo de 7 dias para janela deslizante de inatividade.
--
-- O QUE MUDA
--
--   antes: expira_em = login + 7 dias, fixo. Cookie persistente em disco.
--   agora: expira_em = ultima atividade + 30 minutos. Cookie de sessao.
--
-- POR QUE: admin e funcionarios usam o MESMO computador. Com cookie de 7 dias
-- gravado em disco, o funcionario abria o navegador e caia na sessao do dono
-- (Financeiro, salarios, margem). A metade "cookie de sessao" mora em
-- api/src/index.ts; esta migration cuida da metade que vive no banco.
--
-- Nota para quem vier pela migration 006: ela cita "DIAS_SESSAO em
-- api/src/auth.ts" ao explicar o TTL de uma semana. Essa constante nao existe
-- mais — virou MINUTOS_DE_INATIVIDADE, no mesmo arquivo. O texto de 006 fica
-- como esta: e o registro de um bug daquele momento, nao a descricao do
-- estado atual.

-- ---------------------------------------------------------------- resolver
-- resolver_sessao passa a devolver TAMBEM quanto tempo falta para a sessao
-- vencer. Sem isso, o middleware precisaria de uma segunda consulta so para
-- decidir se renova — uma ida a mais ao banco em TODA requisicao autenticada,
-- que e exatamente o custo que a politica de renovacao existe para evitar
-- (o Worker tem teto de subrequisicoes por invocacao; ver criarPoolDoEnv em
-- api/src/db.ts).
--
-- `drop` antes de `create`: mudar a lista de colunas de um RETURNS TABLE nao
-- passa por `create or replace` ("cannot change return type of existing
-- function"). A definicao abaixo e a da migration 006 (com os tres predicados
-- — validade, usuario ativo, tenant ativo) mais a coluna nova.
--
-- `double precision`, nao `numeric`: o postgres.js entrega numeric como
-- STRING em JavaScript, e `'1500' < 1500` compara lexicograficamente. float8
-- chega do outro lado como number.
drop function if exists resolver_sessao(text);

create function resolver_sessao(p_token text)
returns table (
  usuario_id uuid,
  tenant_id uuid,
  papel text,
  segundos_restantes double precision
)
language sql
security definer
set search_path = public
as $$
  select s.usuario_id, s.tenant_id, u.papel,
         extract(epoch from (s.expira_em - now()))::double precision
  from sessoes s
  join usuarios u on u.id = s.usuario_id
  join tenants t on t.id = s.tenant_id
  where s.token = p_token
    and s.expira_em > now()
    and u.ativo = true
    and t.ativo = true
  limit 1
$$;

revoke all on function resolver_sessao(text) from public;
grant execute on function resolver_sessao(text) to app_crm;

-- ---------------------------------------------------------------- renovar
-- Empurra o vencimento para agora + a janela. Chamada pelo middleware
-- (api/src/middleware/sessao.ts) so quando ja falta menos que o limiar.
--
-- SECURITY DEFINER, e nao um UPDATE comum passando por withTenant, por dois
-- motivos:
--
--   1. `sessoes` tem FORCE ROW LEVEL SECURITY. Um UPDATE sem
--      `set_config('app.tenant_id', ...)` nao falha: ele afeta ZERO linhas em
--      silencio. A sessao expiraria no meio do expediente e nao haveria nada
--      nos logs. Este projeto ja perdeu tempo com bloqueio silencioso de RLS
--      duas vezes (a busca de usuarios no login, e a policy de tenants da
--      migration 007 — esta confirmada em producao). Uma funcao SECURITY
--      DEFINER nao entra nessa classe de erro.
--   2. Custo. withTenant abre transacao: BEGIN, set_config, UPDATE, COMMIT.
--      Sao quatro idas ao banco (~116ms cada em producao) e quatro
--      subrequisicoes do Worker, contra uma.
--
-- Superficie minima, igual a resolver_sessao: recebe o token (que ja e a
-- credencial de quem esta chamando) e nada mais. Nao devolve dado nenhum.
--
-- Que SECURITY DEFINER de fato passa pela RLS forcada desta tabela nao e
-- suposicao: resolver_sessao usa exatamente o mesmo desenho (SECURITY
-- DEFINER lendo `sessoes` sem app.tenant_id definido) e roda em producao
-- desde a migration 003. Se o dono da funcao fosse barrado pelo FORCE, ela
-- devolveria zero linhas e NINGUEM conseguiria autenticar. Como o login
-- funciona, o dono passa — e o mesmo vale para este update.
--
-- `and expira_em > now()` NAO e redundante: entre o resolver_sessao que
-- autorizou a requisicao e este update, a sessao pode ter vencido. Sem o
-- predicado, uma requisicao lenta RESSUSCITARIA uma sessao ja expirada.
--
-- p_minutos vem como parametro em vez de 30 fixo aqui: a janela tem um dono
-- so, `MINUTOS_DE_INATIVIDADE` em api/src/auth.ts. Um segundo lugar para
-- mudar e o lugar que alguem esquece.
create or replace function renovar_sessao(p_token text, p_minutos int)
returns void
language sql
security definer
set search_path = public
as $$
  update sessoes
     set expira_em = now() + make_interval(mins => p_minutos)
   where token = p_token
     and expira_em > now()
$$;

revoke all on function renovar_sessao(text, int) from public;
grant execute on function renovar_sessao(text, int) to app_crm;

-- ------------------------------------------------- corte das sessoes velhas
-- TODO MUNDO ENTRA DE NOVO UMA VEZ, e isso e o ponto.
--
-- As sessoes ja emitidas carregam expira_em de ate 7 dias no futuro, gravado
-- pela politica antiga. Se ficassem, a mudanca de seguranca nao valeria para
-- ninguem que ja estava logado — durante uma semana o cookie do dono
-- continuaria abrindo Financeiro na maquina do balcao, que e exatamente o
-- problema que motivou tudo isto. Deploy sem esta linha e deploy que nao
-- corrige nada ate a ultima sessao antiga vencer sozinha.
--
-- TRUNCATE, e nao `delete from sessoes`. Nao e preferencia: `sessoes` tem
-- FORCE ROW LEVEL SECURITY, e FORCE vale ate para o DONO da tabela. Um DELETE
-- rodado por um papel sem BYPASSRLS e sem app.tenant_id definido nao da erro
-- — apaga zero linhas e a migration se declara aplicada com sucesso. TRUNCATE
-- nao passa por RLS (a checagem e de privilegio na tabela, nao por linha),
-- entao ou funciona ou falha alto. Nenhuma tabela referencia sessoes por FK,
-- entao nao ha cascata a considerar.
truncate table sessoes;
