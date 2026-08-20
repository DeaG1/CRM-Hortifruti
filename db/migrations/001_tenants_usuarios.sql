create extension if not exists pgcrypto;

create table tenants (
  id        uuid primary key default gen_random_uuid(),
  slug      text unique not null,
  nome      text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table usuarios (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  email      text not null,
  senha_hash text not null,
  nome       text not null,
  papel      text not null check (papel in ('admin','colaborador')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (tenant_id, email)
);
create index on usuarios (tenant_id);

create table sessoes (
  token      text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);
create index on sessoes (tenant_id);
create index on sessoes (expira_em);

-- Role da aplicacao: sem superuser, sem BYPASSRLS
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_crm') then
    create role app_crm login password 'trocar_em_producao';
  end if;
end $$;

grant usage on schema public to app_crm;
grant select, insert, update, delete on all tables in schema public to app_crm;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_crm;

-- usuarios e sessoes sao isoladas por tenant
alter table usuarios enable row level security;
alter table usuarios force row level security;
create policy tenant_isolation on usuarios
  using      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

alter table sessoes enable row level security;
alter table sessoes force row level security;
create policy tenant_isolation on sessoes
  using      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
