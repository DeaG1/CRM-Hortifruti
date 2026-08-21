-- As sete entidades restantes do CRM, todas seguindo o padrao validado em
-- `clientes` (migration 004): tenant_id obrigatorio e indexado, RLS habilitada
-- E forcada, policy com `using` e `with check`, e o guard `nullif` no
-- current_setting.
--
-- Duas mudancas deliberadas em relacao ao prototipo:
--
-- 1. REFERENCIA POR ID, NAO POR NOME. O prototipo guarda `fornecedor:'Fazenda
--    Boa Terra'` e `cliente:'Mercado Bom Preco'` como texto. Isso funciona em
--    localStorage, mas num banco relacional renomear um fornecedor orfanaria
--    todo o historico dele. Aqui sao foreign keys.
--
-- 2. ITENS EM TABELA PROPRIA. O prototipo guarda `itens:[...]` como array
--    aninhado. Em tabela separada da para somar, agrupar e filtrar por produto
--    em SQL — que e exatamente o que os relatorios de produto e o calculo de
--    estoque precisam fazer.
--
-- `id` continua sendo uuid; o numero de documento do prototipo ('C-1040',
-- '#2041') vira a coluna `numero`, unica por tenant. Duas empresas diferentes
-- podem ter ambas um pedido numero 2041.

-- ---------------------------------------------------------------- produtos
create table produtos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nome        text not null,
  un          text not null default 'KG' check (un in ('KG','CX','UN','DZ','MC')),
  -- Peso medio da embalagem, para converter CX em KG. O To Do do cliente
  -- registra que sem isso caixas e quilos sao somados no mesmo total, e o
  -- indice de perdas fica incomparavel entre produtos. Zero = nao informado.
  peso_medio  numeric(10,3) not null default 0 check (peso_medio >= 0),
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);
create index on produtos (tenant_id);
create unique index on produtos (tenant_id, lower(nome));

-- ----------------------------------------------------------- fornecedores
create table fornecedores (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nome        text not null,
  regiao      text not null default '',
  contato     text not null default '',
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);
create index on fornecedores (tenant_id);
create unique index on fornecedores (tenant_id, lower(nome));

-- Quais produtos cada fornecedor entrega. No prototipo e um array de nomes;
-- aqui e relacao, para o seletor de entrada poder ordenar os produtos do
-- fornecedor escolhido em primeiro lugar sem casar strings.
create table fornecedor_produtos (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  fornecedor_id uuid not null references fornecedores(id) on delete cascade,
  produto_id    uuid not null references produtos(id) on delete cascade,
  primary key (fornecedor_id, produto_id)
);
create index on fornecedor_produtos (tenant_id);

-- ------------------------------------------------------------ funcionarios
create table funcionarios (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  nome        text not null,
  cargo       text not null default '',
  tel         text not null default '',
  salario     numeric(12,2) not null default 0 check (salario >= 0),
  -- Dia do mes em que o salario e pago; o sistema calcula a proxima data e
  -- se esta atrasado a partir daqui.
  dia_pag     integer not null default 5 check (dia_pag between 1 and 28),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);
create index on funcionarios (tenant_id);

-- ---------------------------------------------------- entradas (compras)
create table entradas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  numero       text not null,
  fornecedor_id uuid references fornecedores(id) on delete set null,
  data         date not null,
  -- Perda ocorrida na coleta/transporte, antes de a mercadoria entrar no
  -- deposito. Perda de deposito e outra tabela (`perdas`).
  perda_kg     numeric(12,3) not null default 0 check (perda_kg >= 0),
  motivo       text not null default '' ,
  pago         text not null default 'Pendente' check (pago in ('Pago','Pendente','Atrasado')),
  data_pag     date,
  forma_pag    text not null default '',
  obs          text not null default '',
  criado_em    timestamptz not null default now(),
  alterado_em  timestamptz not null default now()
);
create index on entradas (tenant_id);
create index on entradas (tenant_id, data);
create unique index on entradas (tenant_id, numero);

create table entrada_itens (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  entrada_id uuid not null references entradas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete restrict,
  un         text not null default 'KG',
  qtd        numeric(12,3) not null check (qtd >= 0),
  preco      numeric(12,4) not null check (preco >= 0),
  perda_kg   numeric(12,3) not null default 0 check (perda_kg >= 0)
);
create index on entrada_itens (tenant_id);
create index on entrada_itens (entrada_id);
create index on entrada_itens (produto_id);

-- ------------------------------------------------------ saidas (vendas)
create table saidas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  numero      text not null,
  cliente_id  uuid references clientes(id) on delete set null,
  rota        text not null default '',
  data_pedido date not null,
  entrega     date,
  status      text not null default 'Pendente'
              check (status in ('Pendente','Em rota','Entregue','Cancelado','Devolvido')),
  pag         text not null default 'Pendente'
              check (pag in ('Pago','Pendente','Atrasado','—')),
  -- Vencimento: o To Do pede que passe a ser calculado da entrega + prazo do
  -- cliente. A coluna existe para guardar o valor efetivo, seja calculado ou
  -- ajustado a mao.
  venc        date,
  data_pag    date,
  forma_pag   text not null default '',
  perda_kg    numeric(12,3) not null default 0 check (perda_kg >= 0),
  motivo      text not null default '',
  obs         text not null default '',
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);
create index on saidas (tenant_id);
create index on saidas (tenant_id, entrega);
create index on saidas (cliente_id);
create unique index on saidas (tenant_id, numero);

create table saida_itens (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  saida_id   uuid not null references saidas(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete restrict,
  un         text not null default 'KG',
  qtd        numeric(12,3) not null check (qtd >= 0),
  preco      numeric(12,4) not null check (preco >= 0),
  perda_kg   numeric(12,3) not null default 0 check (perda_kg >= 0)
);
create index on saida_itens (tenant_id);
create index on saida_itens (saida_id);
create index on saida_itens (produto_id);

-- ------------------------------------------- perdas (deposito, pos-entrada)
create table perdas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  data       date not null,
  produto_id uuid not null references produtos(id) on delete restrict,
  un         text not null default 'KG',
  qtd        numeric(12,3) not null check (qtd >= 0),
  motivo     text not null default 'não informado'
             check (motivo in ('vencimento','armazenagem','manuseio','transporte','não informado')),
  obs        text not null default '',
  criado_em  timestamptz not null default now()
);
create index on perdas (tenant_id);
create index on perdas (tenant_id, data);
create index on perdas (produto_id);

-- ------------------------------------------------ lancamentos (financeiro)
create table lancamentos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  data           date not null,
  categoria      text not null,
  descricao      text not null default '',
  valor          numeric(12,2) not null check (valor >= 0),
  -- Preenchido quando a categoria e Salario ou Adiantamento: e o que desconta
  -- do "a pagar" daquele funcionario.
  funcionario_id uuid references funcionarios(id) on delete set null,
  criado_em      timestamptz not null default now(),
  alterado_em    timestamptz not null default now()
);
create index on lancamentos (tenant_id);
create index on lancamentos (tenant_id, data);
create index on lancamentos (funcionario_id);

-- ----------------------------------------------------------------- RLS
-- Toda tabela acima tem tenant_id, entao toda tabela acima leva o conjunto
-- completo. O teste api/test/cobertura_rls.test.ts falha se alguma escapar.
do $$
declare t text;
begin
  foreach t in array array[
    'produtos','fornecedores','fornecedor_produtos','funcionarios',
    'entradas','entrada_itens','saidas','saida_itens','perdas','lancamentos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy tenant_isolation on %I
        using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  end loop;
end $$;
