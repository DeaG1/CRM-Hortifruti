-- Kill switch quebrado: tenants.ativo = false nunca invalidava sessao viva.
--
-- resolver_sessao (003_policy_sessao.sql) checa s.expira_em > now() e
-- u.ativo = true, mas nunca faz join com tenants. Consequencia: desativar
-- um tenant bloqueia login novo (a query em index.ts filtra
-- "where slug = ... and ativo = true"), mas qualquer cookie de sessao ja
-- emitido continua resolvendo — leitura e escrita — por ate 7 dias
-- (DIAS_SESSAO em api/src/auth.ts), o TTL da sessao.
--
-- Este e o unico mecanismo de corte do produto: cortar um hortifruti por
-- inadimplencia ou fim de contrato precisa ter efeito imediato, nao em ate
-- uma semana.
create or replace function resolver_sessao(p_token text)
returns table (usuario_id uuid, tenant_id uuid, papel text)
language sql
security definer
set search_path = public
as $$
  select s.usuario_id, s.tenant_id, u.papel
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
