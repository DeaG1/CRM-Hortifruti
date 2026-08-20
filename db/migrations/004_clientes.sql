create table clientes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  nome       text not null,
  resp       text not null default '',
  cnpj       text not null default '',
  tel        text not null default '',
  email      text not null default '',
  endereco   text not null default '',
  rota       text not null default '',
  freq       text not null default '',
  status     text not null default 'ativo'
             check (status in ('ativo','negociacao','inadimplente','inativo')),
  cobranca   text not null default 'Em dia',
  forma      text not null default 'PIX',
  limite     numeric(12,2) not null default 0,
  prazo      integer not null default 14,
  tend       text not null default '→' check (tend in ('↑','→','↓')),
  obs        text not null default '',
  criado_em  timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);

create index on clientes (tenant_id);
create unique index on clientes (tenant_id, lower(nome));

alter table clientes enable row level security;
alter table clientes force row level security;
create policy tenant_isolation on clientes
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
