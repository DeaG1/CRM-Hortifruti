-- Corrige o guard de app.tenant_id nas policies de RLS.
--
-- current_setting('app.tenant_id', true) nao retorna NULL quando o GUC
-- customizado ja foi tocado por SET LOCAL dentro de uma transacao que
-- desde entao terminou (commit ou rollback): o Postgres trata GUCs
-- customizados nao registrados como "placeholder", e o valor de reset
-- para eles e string vazia (''), nao NULL. Sem o nullif, ''::uuid lanca
-- "invalid input syntax for type uuid" em vez de apenas nao bater com
-- nenhuma linha — isso quebra qualquer consulta que reutilize uma
-- conexao do pool ja usada por withTenant() sem passar por ele de novo,
-- quando deveria simplesmente retornar zero linhas.
alter policy tenant_isolation on usuarios
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter policy tenant_isolation on sessoes
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
