-- O Supabase habilita RLS automaticamente em toda tabela criada no schema
-- `public` — o PostgreSQL local nao faz isso. A migration 001 deixa `tenants`
-- deliberadamente sem RLS, entao o schema diverge entre os dois ambientes.
--
-- O efeito e silencioso e grave: com RLS ligada e nenhuma policy, `app_crm` ve
-- ZERO linhas em `tenants`. E o login comeca justamente resolvendo o slug do
-- hortifruti nessa tabela, antes de existir tenant definido na sessao. Resultado:
-- todo login responde "credenciais invalidas", inclusive os corretos, sem erro
-- nos logs. Confirmado em producao antes deste arquivo existir.
--
-- Em vez de desligar a RLS para igualar ao local, mantemos ligada e liberamos
-- apenas a leitura. Fica mais seguro que o desenho original: se algum dia alguem
-- reconceder INSERT/UPDATE/DELETE em `tenants` por engano, a ausencia de policy
-- de escrita ainda barra a operacao. Sao duas camadas em vez de uma.
--
-- `tenants` guarda slug, nome e status — nao ha dado de negocio de um cliente
-- que outro nao possa ver, e o slug ja e publico por estar na URL.

alter table tenants enable row level security;

drop policy if exists tenants_leitura on tenants;
create policy tenants_leitura on tenants
  for select
  using (true);

-- Sem `force row level security` de proposito: o owner (postgres) precisa
-- administrar a tabela, e criar tenant e operacao administrativa fora da API.
