-- Resolver a sessao exige ler antes de haver tenant definido.
-- Em vez de abrir a tabela, expomos uma funcao SECURITY DEFINER com
-- superficie minima: recebe um token e devolve no maximo uma linha.
create or replace function resolver_sessao(p_token text)
returns table (usuario_id uuid, tenant_id uuid, papel text)
language sql
security definer
set search_path = public
as $$
  select s.usuario_id, s.tenant_id, u.papel
  from sessoes s
  join usuarios u on u.id = s.usuario_id
  where s.token = p_token
    and s.expira_em > now()
    and u.ativo = true
  limit 1
$$;

revoke all on function resolver_sessao(text) from public;
grant execute on function resolver_sessao(text) to app_crm;

-- tenants nao tem RLS (o login precisa resolve-lo antes de haver tenant),
-- e ate aqui app_crm tinha escrita irrestrita nessa tabela: um bug de
-- aplicacao poderia apagar ou alterar o cadastro de outro hortifruti.
-- A aplicacao so precisa de SELECT ali; criar/editar tenant e operacao
-- administrativa, fora da API.
revoke insert, update, delete on tenants from app_crm;
