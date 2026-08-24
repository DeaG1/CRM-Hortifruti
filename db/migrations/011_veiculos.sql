-- Controle de veiculos: cadastro de carros + check-in/check-out (quem
-- pegou qual carro e quando devolveu). Este e o minimo que resolve o
-- problema real do dono do negocio: hoje ninguem sabe quem esta com qual
-- carro quando chega uma multa, o carro volta amassado, ou alguem precisa
-- sair e nao sabe qual esta livre.
--
-- Deliberadamente SEM: quilometragem, combustivel, vinculo com rota ou
-- estado do veiculo. Foram oferecidos ao dono do negocio e recusados —
-- nao sao adicionados aqui.
--
-- Molde: 009_entidades_fase1.sql (tenant_id obrigatorio e indexado, RLS
-- ligada e forcada, policy com using + with check) e 010_fk_com_tenant.sql
-- (FK composta com tenant_id — a verificacao de FK do Postgres ignora RLS,
-- entao uma FK simples deixaria um tenant referenciar funcionario de outro
-- em silencio).

create table veiculos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  placa       text not null,
  modelo      text not null default '',
  marca       text not null default '',
  ano         integer,
  ativo       boolean not null default true,
  obs         text not null default '',
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now()
);
create index on veiculos (tenant_id);
-- Placa unica por tenant, comparada em maiuscula (normalizado com upper(),
-- mesmo raciocinio do `lower(nome)` usado em produtos/fornecedores — so que
-- aqui a normalizacao vai para cima, convencao usual de placa de veiculo).
-- Nome explicito (em vez do nome auto-gerado do Postgres) para
-- respostaDeErroPg identificar esta violacao especifica sem ambiguidade —
-- api/src/routes/veiculos.ts tambem trata violacao do indice parcial de
-- veiculo_usos abaixo, e os dois sao 23505.
create unique index veiculos_placa_unica on veiculos (tenant_id, upper(placa));

-- Chave candidata (tenant_id, id): necessaria para a FK composta de
-- veiculo_usos.veiculo_id abaixo poder existir (mesmo padrao de
-- 010_fk_com_tenant.sql).
alter table veiculos add constraint veiculos_tenant_id_uk unique (tenant_id, id);

create table veiculo_usos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  veiculo_id     uuid not null,
  funcionario_id uuid not null,
  saida_em       timestamptz not null default now(),
  -- Nullable: uso em aberto = ninguem devolveu ainda. E exatamente essa
  -- ausencia que o indice parcial abaixo usa para impedir dois usos abertos
  -- do mesmo carro ao mesmo tempo.
  volta_em       timestamptz,
  obs            text not null default '',
  criado_em      timestamptz not null default now(),
  -- Defesa de integridade: se algum dia uma volta for registrada com data
  -- customizada (nao so `now()`), nao pode ser antes da propria saida. Hoje
  -- a API sempre fecha com `now()` (sempre >= saida_em por construcao),
  -- entao este branch so e alcancavel por insercao direta no banco — mas
  -- fica como ultima linha de defesa, mesmo racional das outras CHECKs
  -- deste projeto.
  constraint veiculo_usos_volta_apos_saida check (volta_em is null or volta_em >= saida_em),
  -- FKs compostas com tenant_id (010_fk_com_tenant.sql): sem isso, um
  -- veiculo_id ou funcionario_id de outro tenant seria aceito em silencio
  -- pela checagem de FK (que roda com privilegio do dono da tabela,
  -- ignorando RLS).
  --
  -- funcionario_id e `restrict` (nao `set null`, ao contrario de
  -- lancamentos.funcionario_id em 009): aqui a coluna e `not null` — nao ha
  -- "sem funcionario" para um uso que ja aconteceu, e apagar o cadastro do
  -- funcionario nao deveria apagar nem esvaziar o registro de quem pegou o
  -- carro. Mesmo racional de veiculo_id: apagar o carro do cadastro nao
  -- deveria apagar o historico de quem o usou (a informacao que justifica a
  -- feature inteira — "quando chega uma multa" pode ser meses depois).
  -- `ativo=false` e o caminho pra "aposentar" um veiculo/funcionario sem
  -- perder o historico.
  constraint veiculo_usos_veiculo_fk
    foreign key (tenant_id, veiculo_id) references veiculos(tenant_id, id) on delete restrict,
  constraint veiculo_usos_funcionario_fk
    foreign key (tenant_id, funcionario_id) references funcionarios(tenant_id, id) on delete restrict
);
create index on veiculo_usos (tenant_id);
create index on veiculo_usos (veiculo_id);
create index on veiculo_usos (funcionario_id);

-- A REGRA CENTRAL DESTA FEATURE: impede o mesmo carro ter dois usos em
-- aberto (volta_em is null) ao mesmo tempo. Indice unico PARCIAL — cobre so
-- as linhas em aberto, entao o historico de usos ja fechados do mesmo
-- veiculo (varios, ao longo do tempo) continua livre para existir.
--
-- Isso torna impossivel o mesmo carro ter dois check-ins abertos por
-- construcao do banco — nao depende de a tela validar nem de duas pessoas
-- nao clicarem "Pegar" ao mesmo tempo. Se dois funcionarios pegarem o mesmo
-- carro no mesmo segundo, o SEGUNDO insert concorrente e recusado pelo
-- proprio Postgres (violacao de unicidade, 23505), e a API converte isso em
-- 409 com mensagem clara (ver respostaDeErroPg em
-- api/src/routes/veiculos.ts) — a tela nunca chega a mostrar dois usos
-- abertos do mesmo carro, porque o banco nunca permite os dois existirem.
create unique index veiculo_usos_aberto_unico on veiculo_usos (veiculo_id) where volta_em is null;

-- ----------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['veiculos', 'veiculo_usos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy tenant_isolation on %I
        using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    $f$, t);
  end loop;
end $$;
