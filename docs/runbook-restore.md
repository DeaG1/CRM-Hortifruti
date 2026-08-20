# Runbook de restauração — backup do Postgres (R2)

Este documento existe para o dia em que o banco de produção precisar ser
restaurado de um backup. Nesse dia não vai haver tempo para descobrir as
coisas na hora — leia isto agora, antes de precisar, e reensaie depois de
qualquer mudança relevante de schema ou de policies de RLS.

O sistema guarda a operação inteira de hortifrutis pagantes (clientes,
pedidos, financeiro), com uso de 8h/dia, 6 dias por semana. Um backup que
existe mas nunca foi restaurado com sucesso não é um backup — é uma
suposição. Este runbook foi escrito depois de um ensaio real de ponta a
ponta (seção "Ensaio realizado"), não apenas descrito.

## Onde os backups ficam

- Workflow: `.github/workflows/backup.yml`, roda 5x/dia (08h, 11h, 14h,
  17h, 20h horário de Brasília) via `schedule`, e sob demanda via
  `workflow_dispatch`.
- Destino: bucket R2 (`secrets.R2_BUCKET`), objeto
  `backup-<aaaa-mm-dd-hhmm>.dump` — dump em formato `custom` do `pg_dump`
  (`--format=custom --no-owner --no-privileges`).
- Retenção: 30 dias. Objetos mais antigos são apagados no fim de cada
  execução do workflow.

## Secrets que o workflow consome — o que o parceiro humano precisa criar

Nenhuma dessas credenciais existe nesta sessão. Ninguém deve inventá-las;
esta seção é a lista exata do que falta configurar, com nome e onde obter.

Local: GitHub → repositório → **Settings → Secrets and variables →
Actions → New repository secret**.

| Secret | O que é | Onde obter |
|---|---|---|
| `DATABASE_URL` | Connection string **direta** do Supabase (porta **5432**, host `db.<ref>.supabase.co`) — **não** o pooler (porta 6543, `aws-0-<regiao>.pooler.supabase.com`). Ver armadilha abaixo. | Supabase Dashboard → Project Settings → Database → **Connection string → Direct connection** |
| `R2_ACCOUNT_ID` | ID da conta Cloudflare | Cloudflare Dashboard → R2 → Overview (aparece na barra lateral / na URL) |
| `R2_ACCESS_KEY_ID` | Access Key de um token de API do R2 | Cloudflare Dashboard → R2 → **Manage R2 API Tokens** → Create API token (escopo: Object Read & Write, restrito ao bucket de backup) |
| `R2_SECRET_ACCESS_KEY` | Secret Key do mesmo token | Mostrado uma única vez na criação do token acima — copiar e guardar no gerenciador de secrets do GitHub, não existe forma de recuperar depois |
| `R2_BUCKET` | Nome do bucket R2 dedicado aos backups (ex.: `crm-hortifrutti-backups`) | Criar em Cloudflare Dashboard → R2 → Create bucket |

### Armadilha real: pooler vs. conexão direta

O Supabase oferece duas strings de conexão:

- **Direct connection** (porta 5432): sessão longa e completa, é o que o
  `pg_dump` precisa.
- **Transaction pooler** (porta 6543, PgBouncer em modo transaction):
  recicla a conexão entre statements. `pg_dump` abre uma sessão que
  percorre catálogo e tabelas ao longo de toda a execução — sob esse modo
  de pooling, o dump falha, ou pior, **conclui incompleto sem erro
  óbvio**. Sempre usar a porta 5432 no `DATABASE_URL` deste workflow.

### Notificação de falha (não é secret, mas é obrigatório configurar)

O passo `Avisar se falhou` (`if: failure()`) só grava um `::error::` no
log — ele não avisa ninguém sozinho. O modo de falha clássico de backup é
o job quebrar em silêncio e ninguém notar por semanas, até o dia em que
o backup é preciso. Configurar em:

GitHub → **avatar → Settings → Notifications → Actions** → habilitar
e-mail para "Failed workflows only" (ou equivalente na conta que hospeda
o repositório). Confirmar recebendo pelo menos um e-mail de teste — por
exemplo, disparando `workflow_dispatch` com um `DATABASE_URL` errado de
propósito uma vez, fora do horário de produção.

## Pré-requisitos para restaurar

- `postgresql-client-16` (`pg_dump`/`pg_restore`/`psql` na versão 16, a
  mesma do banco de produção) — ou um container `postgres:16-alpine`,
  que já traz os três binários.
- AWS CLI (`aws s3 ...`) configurado para o endpoint do R2, ou o próprio
  Cloudflare Dashboard para baixar o objeto manualmente.
- Um Postgres de destino (novo projeto Supabase, ou instância local via
  Docker para validação antes de apontar produção para lá).

## Passo a passo

### 1. Baixar o dump do R2

```bash
aws s3 cp "s3://$R2_BUCKET/backup-2026-08-20-1902.dump" ./backup.dump \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

(Ou baixar pelo Cloudflare Dashboard → R2 → bucket → objeto → Download,
se as credenciais de CLI não estiverem à mão no momento do incidente.)

### 2. Subir o Postgres de destino

Para validar o backup antes de apontar produção para ele (fortemente
recomendado — nunca restaurar direto em cima do banco vivo sem antes
confirmar que o dump é bom):

```bash
docker run -d --name crm-restore-verificacao \
  -e POSTGRES_PASSWORD=<senha-temporaria> \
  -e POSTGRES_DB=crm_restore \
  -p 5434:5432 \
  postgres:16-alpine
```

Em produção real, o destino é tipicamente um projeto Supabase novo (ou o
mesmo projeto recriado do zero); o procedimento de `pg_restore` é
idêntico, trocando apenas a connection string.

### 3. Restaurar

```bash
pg_restore -U postgres --no-owner --no-privileges \
  -d crm_restore ./backup.dump
```

`--no-owner --no-privileges` evita que o restore tente recriar owners e
grants amarrados a roles que podem não existir no banco de destino (isso
faria o restore falhar no meio). A consequência é que **role e
privilégios precisam ser recriados manualmente** — próximo passo.

### 4. Recriar o role `app_crm` — não vem no dump

`pg_dump` nunca inclui roles: são objetos de **cluster**, não de banco
(vivem em `pg_authid`, compartilhado entre todos os bancos da instância).
Com `--no-privileges`, os `GRANT`/`REVOKE` também ficam de fora do dump.
Sem este passo a API não autentica e, mesmo autenticando, teria
privilégios errados.

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_crm') then
    create role app_crm login password '<definir-senha-de-producao>';
  end if;
end $$;

grant usage on schema public to app_crm;
grant select, insert, update, delete on all tables in schema public to app_crm;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_crm;

-- tenants: so leitura para a aplicacao (ver db/migrations/003_policy_sessao.sql)
revoke insert, update, delete on tenants from app_crm;

-- resolver_sessao: SECURITY DEFINER de superficie minima (idem)
revoke all on function resolver_sessao(text) from public;
grant execute on function resolver_sessao(text) to app_crm;
```

Este SQL espelha exatamente o que as migrações
`db/migrations/001_tenants_usuarios.sql` e
`db/migrations/003_policy_sessao.sql` fazem na primeira aplicação — é a
mesma fonte da verdade, só reaplicada porque o dump não a carrega.

Depois de criar o role, **confirmar que ele não é superuser nem tem
BYPASSRLS** — um role com BYPASSRLS ignora toda a RLS e reabriria o
mesmo problema que a RLS existe para prevenir:

```sql
select rolname, rolsuper, rolbypassrls, rolcanlogin
from pg_roles where rolname = 'app_crm';
-- esperado: rolsuper = f, rolbypassrls = f, rolcanlogin = t
```

### 5. Conferir se as policies de RLS sobreviveram — o passo que mais se esquece

Este é o passo que quase todo runbook pula. Um restore que traz todos os
dados mas perde a RLS deixa o sistema **aberto entre todos os hortifrutis,
sem nenhum sintoma visível** — ninguém percebe até um cliente ver os
dados de outro.

```sql
select tablename, policyname, qual from pg_policies order by tablename;
```

Esperado — a mesma policy `tenant_isolation`, com o mesmo `qual`, em
`clientes`, `sessoes` e `usuarios`:

```
 tablename |    policyname    |                                         qual
-----------+------------------+--------------------------------------------------------------------------------------
 clientes  | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 sessoes   | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 usuarios  | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
```

E confirmar que a RLS está **ligada e forçada** (a policy sozinha não
basta — sem `relrowsecurity`/`relforcerowsecurity`, o owner da tabela
ainda passa por cima dela):

```sql
select relname, relrowsecurity, relforcerowsecurity from pg_class
  where relname in ('tenants','usuarios','sessoes','clientes');
-- esperado: tenants = f/f (nao tem RLS por design — resolve login antes de haver tenant)
--           usuarios, sessoes, clientes = t/t
```

Se qualquer uma dessas duas consultas não bater com o esperado, **não
reaponte `DATABASE_URL` para este banco**. Investigar antes — o passo 4
(grants) pode ter sido pulado, ou a versão do dump é anterior à migração
que criou a policy.

### 6. Reapontar `DATABASE_URL`

Só depois dos passos 4 e 5 confirmados. Atualizar o secret/variável de
ambiente da API (`DATABASE_URL`) para apontar para o banco restaurado —
usando a **conexão direta**, porta 5432, mesma ressalva da seção de
secrets acima.

### 7. Validar com a suíte de isolamento — a prova final

```bash
cd api
TEST_DATABASE_URL="postgres://app_crm:<senha>@<host>:<porta>/<db>" \
ADMIN_DATABASE_URL="postgres://postgres:<senha>@<host>:<porta>/<db>" \
npx vitest run test/isolamento.test.ts
```

Só considerar o restore utilizável se os 4 testes passarem. Eles cobrem
exatamente o cenário que a seção 5 verifica manualmente (RLS ativa,
isolamento entre tenants, sem vazamento entre transações na mesma
conexão) — mas do ponto de vista da aplicação, com a role real.

## Ensaio realizado — 2026-08-20

Ensaio de ponta a ponta feito localmente (sem R2, por não haver conta
Cloudflare configurada nesta sessão — ver observação no fim). Origem:
container `crmhortifrutti-db-1` (Postgres 16, porta 5433, db `crm_dev`,
6 tenants de teste incluindo `hortifruti-verificacao` com 4 clientes).
Destino: container novo `crm-restore-ensaio` (Postgres 16, porta 5434,
removido ao final do ensaio).

### Tempos medidos

| Etapa | Tempo |
|---|---|
| `pg_dump --format=custom --no-owner --no-privileges` (dump de ~17KB, dataset de teste: 6 tenants, 21 clientes) | **1.26s** |
| Subir o container Postgres de destino (`docker run` + espera por `pg_isready`) | **~8s** (pronto em 5s de polling + overhead de start) |
| `pg_restore --no-owner --no-privileges` | **0.89s** |
| Recriar role `app_crm` + grants | **<1s** |
| Suíte de isolamento (`vitest run test/isolamento.test.ts`, 4 testes) contra o banco restaurado | **693ms** (relatado pelo próprio vitest) |
| **Soma do trabalho ativo (dump → restore → role → RLS conferida → testes verdes)** | **≈ 11s** |

O dataset do ensaio é pequeno (dados de teste das tasks anteriores); em
produção o `pg_dump`/`pg_restore` escalam com o volume de dados — os
demais passos (recriar role, conferir RLS, trocar `DATABASE_URL`, rodar
a suíte) não escalam com volume e permanecem nessa ordem de grandeza.

### Comandos e saída

```
$ time docker exec crmhortifrutti-db-1 pg_dump -U postgres --format=custom \
    --no-owner --no-privileges -d crm_dev -f /tmp/backup-2026-08-20-1902.dump
real  0m1.258s

$ docker run -d --name crm-restore-ensaio -e POSTGRES_PASSWORD=dev \
    -e POSTGRES_DB=crm_restore -p 5434:5432 postgres:16-alpine
# pronto (pg_isready) após 5s

$ time docker exec crm-restore-ensaio pg_restore -U postgres \
    --no-owner --no-privileges -d crm_restore /tmp/backup-2026-08-20-1902.dump
real  0m0.887s
# (nenhum erro reportado)

$ docker exec crm-restore-ensaio psql -U postgres -d crm_restore -f recriar_role_app_crm.sql
DO
GRANT
GRANT
ALTER DEFAULT PRIVILEGES
REVOKE
REVOKE
GRANT
```

**RLS — confirmada sobrevivência ao dump/restore:**

```
$ docker exec crm-restore-ensaio psql -U postgres -d crm_restore -c \
    "select tablename, policyname, qual from pg_policies order by tablename;"

 tablename |    policyname    |                                         qual
-----------+------------------+--------------------------------------------------------------------------------------
 clientes  | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 sessoes   | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 usuarios  | tenant_isolation | (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
(3 rows)

$ docker exec crm-restore-ensaio psql -U postgres -d crm_restore -c \
    "select relname, relrowsecurity, relforcerowsecurity from pg_class
     where relname in ('tenants','usuarios','sessoes','clientes');"

 relname  | relrowsecurity | relforcerowsecurity
----------+----------------+---------------------
 tenants  | f              | f
 clientes | t              | t
 sessoes  | t              | t
 usuarios | t              | t
(4 rows)
```

Idêntico ao banco de origem (conferido antes do dump). Nenhuma policy
perdida, nenhuma flag de RLS revertida.

**Role `app_crm` recriado corretamente, sem privilégios perigosos:**

```
$ docker exec crm-restore-ensaio psql -U postgres -d crm_restore -c \
    "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'app_crm';"

 rolname | rolsuper | rolbypassrls | rolcanlogin
---------+----------+--------------+-------------
 app_crm | f        | f            | t
(1 row)
```

**Dados restaurados intactos** (mesmas contagens do banco de origem,
incluindo `hortifruti-verificacao` com 4 clientes):

```
$ docker exec crm-restore-ensaio psql -U postgres -d crm_restore -c \
    "select tenant_id, count(*) from clientes group by tenant_id order by 1;"

              tenant_id               | count
--------------------------------------+-------
 2daf005e-2677-4216-a3b2-305ee6e2fdcf |     2
 416765ea-71c8-41c8-95a5-8a42d4ea1e09 |     4   -- hortifruti-verificacao
 5fee8f58-03ea-486d-b6e7-700d514b4202 |     2
 8574fef6-934c-479d-a60e-a4e96b4dffef |     9
(4 rows)
```

**Suíte de isolamento verde contra o banco restaurado:**

```
$ TEST_DATABASE_URL="postgres://app_crm:trocar_em_producao@localhost:5434/crm_restore" \
  ADMIN_DATABASE_URL="postgres://postgres:dev@localhost:5434/crm_restore" \
  npx vitest run test/isolamento.test.ts

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  693ms
```

Container temporário `crm-restore-ensaio` (e seu volume anônimo de
dados) removidos ao final do ensaio. O container de origem
`crmhortifrutti-db-1` não foi tocado em nenhum momento.

### O que este ensaio não cobriu (fora do escopo desta sessão)

- **Upload real para o R2**: não há conta Cloudflare nem credenciais
  nesta sessão. O passo "Enviar para o R2" e "Expirar backups com mais
  de 30 dias" do workflow estão escritos e revisados, mas não foram
  executados contra um bucket real. Assim que os secrets da seção
  "Secrets que o workflow consome" existirem, rodar
  `workflow_dispatch` uma vez e repetir este mesmo ensaio baixando o
  dump do R2 em vez do `docker cp` local, para fechar o ciclo completo.
- **Volume de produção**: o dataset do ensaio é pequeno (dados de teste).
  Os tempos de `pg_dump`/`pg_restore` vão crescer com o volume real; os
  demais passos não.

## Quando reensaiar

- Depois de qualquer migração que altere `usuarios`, `sessoes`,
  `clientes` ou suas policies de RLS.
- Depois de qualquer mudança nos grants do role `app_crm`.
- Pelo menos uma vez por trimestre, mesmo sem mudança de schema — para
  garantir que o procedimento (e quem o executa) continua funcionando.
- Assim que os secrets do R2 existirem, para validar o ciclo completo
  incluindo upload e download reais (ver seção anterior).
