# Infraestrutura — CRM Hortifruti (SaaS multi-tenant)

**Data:** 2026-08-19
**Status:** Aprovado — pendente definição de stack da aplicação
**Escopo:** Infraestrutura, banco de dados, backup e disponibilidade. Não cobre funcionalidades do CRM nem design de interface.

---

## 1. Contexto e restrições

| Restrição | Valor |
|---|---|
| Preço ao cliente | R$150/mês fixo por tenant |
| Usuários simultâneos por tenant | Até 3 |
| Padrão de uso | ~8h/dia, 6 dias/semana (horário comercial) |
| Criticidade | Alta — o negócio do cliente não opera sem o CRM |
| Integrações externas | Nenhuma. Impressão de relatório é client-side |
| Operação | Uma pessoa, sem equipe de infra |
| Meta | Suportar múltiplos tenants ao menor custo possível |

### A restrição que domina todas as outras

Com R$150/mês de receita por tenant, a infra precisa ficar **abaixo de 5% da receita** para o negócio ter margem. Isso elimina qualquer arquitetura com custo por tenant.

Simultaneamente, a carga é trivial: 20 tenants × 3 usuários = 60 usuários simultâneos no pico, gerando ~4-5 requisições por segundo. Uma VPS de 2 vCPU serve isso usando 2-5% da capacidade.

**Conclusão:** o custo é dominado por *quantos serviços são mantidos de pé*, não por capacidade computacional. Toda a arquitetura decorre disso.

---

## 2. Decisões arquiteturais

### D1 — Multi-tenancy compartilhada com Row Level Security

Um único banco, `tenant_id` em toda tabela de negócio, isolamento garantido por RLS do PostgreSQL.

**Rationale:** custo marginal por tenant tende a zero e uma migration atende todos. As alternativas (schema por tenant, banco por tenant) multiplicam custo e operação sem benefício proporcional nesta faixa de preço.

**Por que RLS e não filtro na aplicação:** com RLS, um `SELECT` sem cláusula `WHERE` retorna apenas os dados do tenant da sessão. O isolamento passa a ser garantia do banco, não disciplina do código. Um esquecimento em uma query deixa de ser vazamento de dados entre clientes.

Esta é a decisão de segurança mais importante do sistema.

### D2 — PostgreSQL

Resolve cinco necessidades sem serviço adicional, cada uma das quais custaria R$50-100/mês fixos se terceirizada:

| Necessidade | Recurso |
|---|---|
| Isolamento entre tenants | Row Level Security |
| Campos customizados por cliente | `JSONB` (sem migration por tenant) |
| Busca de clientes e produtos | Full-text search nativo |
| Jobs assíncronos | `SELECT ... FOR UPDATE SKIP LOCKED` |
| Rotinas agendadas | `pg_cron` |

### D3 — Arquitetura em estágios, começando no free tier

O produto ainda não provou que vende. O risco dominante hoje é comercial, não técnico. A infra começa em custo zero e sobe conforme a receita justifica.

Ver seção 4.

### D4 — Regra do Postgres burro (anti lock-in)

**O Supabase é usado exclusivamente como PostgreSQL gerenciado.** Proibido no código da aplicação:

- Supabase Auth
- Supabase Storage
- Supabase Realtime
- Supabase Edge Functions
- Cliente `supabase-js` para acesso a dados

O acesso ao banco é por **conexão PostgreSQL direta**, com migrations próprias versionadas no repositório.

**Rationale:** a viabilidade de todo o plano de migração depende disto. Usando só Postgres, migrar é `pg_dump` seguido de `pg_restore` — uma tarde. Adotando Supabase Auth, a migração passa a exigir reimplementar autenticação; com Storage e Realtime, vira reescrita de partes do produto.

O lock-in não prende de uma vez — prende um pouco por vez, até que migrar nunca seja a prioridade do trimestre.

### D5 — Autenticação própria

Sem Auth0, Clerk ou Supabase Auth.

**Rationale:** provedores de auth cobram por usuário ativo, ou seja, o custo cresce exatamente junto com o que se vende. Com 3 usuários por tenant, seria pagar por assento dentro de um produto de R$150.

Além disso, integrar Supabase Auth com multi-tenancy por subdomínio e RLS exige custom claims e JWT hooks — mais complexo que sessão em cookie com tabela de usuários própria.

### D6 — Impressão no cliente

`window.print()` com stylesheet `@media print`. Não passa pelo servidor.

**Proibido:** gerar PDF no servidor com Chromium headless (Puppeteer/Playwright). Cada instância consome 300-500MB de RAM; dois relatórios simultâneos derrubam uma VPS de 4GB. Se surgir necessidade de PDF como arquivo, usar biblioteca de geração direta.

**Atenção:** se algum cliente usar impressora térmica de cupom (ESC/POS), o layout precisa de CSS com largura de 80mm. Não impacta infraestrutura.

---

## 3. Modelo de dados multi-tenant

### Estrutura

```sql
create table tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,   -- subdomínio: slug.dominio.com.br
  nome       text not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Toda tabela de negócio segue este padrão
create table clientes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  nome       text not null,
  -- demais campos
  criado_em  timestamptz not null default now()
);

create index on clientes (tenant_id);
```

`tenant_id` é obrigatório (`not null`) e indexado em toda tabela de negócio.

### Política de isolamento

Aplicada a **toda** tabela que contenha `tenant_id`:

```sql
alter table clientes enable row level security;
alter table clientes force row level security;

create policy tenant_isolation on clientes
  using      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Três detalhes que não podem ser omitidos:

- **`force row level security`** — sem isso, o dono da tabela ignora a política.
- **`with check`** — sem isso, o isolamento vale para leitura mas não impede gravar linha com `tenant_id` de outro tenant.
- **`current_setting(..., true)`** — o segundo argumento faz retornar `NULL` em vez de erro quando a variável não está definida. Comparação com `NULL` é falsa, então **a ausência de tenant definido nega todo acesso** (fail-closed).

### Role da aplicação

A aplicação conecta com um role dedicado, que **não pode** ser superuser nem ter `BYPASSRLS`:

```sql
create role app_crm login password 'REDACTED';
grant select, insert, update, delete on all tables in schema public to app_crm;
```

Um role com `BYPASSRLS` anula silenciosamente todo o isolamento.

### Resolução do tenant por requisição

1. Requisição chega em `slug.dominio.com.br`
2. Middleware extrai o `slug` e resolve o `tenant_id`
3. Abre transação e executa `SET LOCAL app.tenant_id = '<uuid>'`
4. Todas as queries da transação rodam isoladas

**`SET LOCAL`, nunca `SET`.** O escopo de `SET LOCAL` é a transação; o de `SET` é a conexão. Em pooling por transação (Supavisor porta 6543), um `SET` vazaria o tenant para a próxima requisição que reusasse a conexão — vazamento de dados entre clientes.

### Teste obrigatório de isolamento

Roda em todo deploy. É o teste mais importante do sistema:

```sql
-- Com app.tenant_id = tenant A, dados do tenant B devem ser invisíveis
set local app.tenant_id = '<uuid-tenant-A>';
select count(*) from clientes where tenant_id = '<uuid-tenant-B>';  -- espera 0

-- Gravar para outro tenant deve falhar
insert into clientes (tenant_id, nome) values ('<uuid-tenant-B>', 'x');  -- espera erro
```

O teste cobre toda tabela com `tenant_id`. Uma tabela nova sem política de RLS deve reprovar o build — verificação automática comparando as tabelas com `tenant_id` contra `pg_policies`.

---

## 4. Arquitetura em estágios

### Estágio 0 — Free tier (agora, 1 a 4 clientes)

| Camada | Escolha | Custo |
|---|---|---|
| Front | Cloudflare Pages / Workers | R$0 |
| Banco | Supabase free tier | R$0 |
| Backup | GitHub Actions → Cloudflare R2 | R$0 |
| DNS/CDN | Cloudflare | R$0 |
| Domínio `.com.br` | Registro.br | ~R$3,50/mês |
| **Total** | | **~R$3,50/mês** |

**Cloudflare, não Vercel.** O plano Hobby da Vercel é para uso não-comercial; cobrar mensalidade de cliente o viola e expõe o serviço a suspensão sem mitigação técnica possível. O free tier da Cloudflare permite uso comercial (100 mil requisições/dia — folga larga para 3 usuários por tenant).

**Limites do Supabase free e impacto:**

| Limite | Impacto |
|---|---|
| 500MB de banco | Anos de folga nesta escala |
| Pausa após ~7 dias inativo | Nenhum (uso diário) |
| 2 projetos ativos | Nenhum (1 projeto multi-tenant) |
| Sem backup gerenciado nem PITR | **Coberto pela seção 5** |
| Sem SLA nem suporte | Risco aceito conscientemente — ver seção 7 |

### Estágio 1 — VPS própria (4 a 15 clientes)

Primário em **Oracle Cloud São Paulo** (free tier permanente, 4 vCPU ARM / 24GB, latência ~15ms contra ~120ms de qualquer DC fora do Brasil) ou **Hetzner CAX11** (~R$26/mês).

Docker Compose com quatro serviços: Caddy (TLS automático e roteamento por subdomínio), aplicação, PostgreSQL, sidecar de backup.

Ganho principal sobre o estágio 0: **PITR com WAL archiving contínuo**, que derruba o RPO de horas para ~5 minutos.

Custo: ~R$32/mês.

### Estágio 2 — Standby (15 a 30 clientes)

Segunda máquina com replicação streaming **assíncrona**, promoção manual por script testado. RTO ~10 minutos.

Se primário e standby ficarem em provedores diferentes, a replicação atravessa a internet pública: usar túnel WireGuard ou Tailscale. **Replicação assíncrona**, nunca síncrona — síncrona faria cada commit esperar o RTT.

Custo: ~R$70/mês.

**Failover automático fica fora de escopo deliberadamente.** Feito sem quórum adequado, gera split-brain — dois bancos aceitando escrita e divergindo, o que produz corrupção silenciosa descoberta dias depois, sem backup capaz de desfazer. Fazê-lo corretamente exige Patroni + etcd. Para um operador solo, **failover manual com runbook ensaiado é mais seguro do que failover automático mal configurado**; a diferença entre 10 e 2 minutos de RTO não paga esse risco.

### Estágio 3 — Banco gerenciado (30+ clientes)

Aplicação segue em VPS (stateless, trivial de replicar); PostgreSQL migra para serviço gerenciado com HA. Terceiriza a parte com estado, que é onde alta disponibilidade é difícil de acertar.

Custo: R$150-250/mês (5-8% da receita nesta faixa).

### Gatilhos de migração

| De → Para | Gatilho |
|---|---|
| 0 → 1 | 4 clientes, **ou** limite de 500MB/banda, **ou** primeiro incidente sem suporte |
| 1 → 2 | 15 clientes, **ou** primeiro downtime que gere reclamação real |
| 2 → 3 | 30 clientes, **ou** operação consumindo mais de 4h/mês |

Um gatilho explicitamente **inválido**: "quando chegar o segundo cliente". Dois tenants cabem no free tier exatamente como um; o segundo contrato não muda nada tecnicamente.

### Custo por estágio

| Estágio | R$/mês | Clientes | % da receita |
|---|---|---|---|
| 0 | 3,50 | 1-4 | 0,6-2,3% |
| 1 | 32 | 4-15 | 1,4-5,3% |
| 2 | 70 | 15-30 | 1,6-3,1% |
| 3 | 200 | 30+ | ≤4,4% |

Custo **fixo**, não por tenant: cada cliente novo entra com margem próxima de 100%.

---

## 5. Backup e recuperação

### Estágio 0

`pg_dump` executado por GitHub Actions, destino Cloudflare R2 (10GB gratuitos — comporta o volume desta escala por muito tempo).

**Frequência:** a cada 3 horas durante o expediente, mais um ao encerrar.

```
cron: '0 11,14,17,20,23 * * *'   # UTC → 08,11,14,17,20 BRT
```

**RPO resultante: até 3 horas.**

Isto é uma dívida assumida, não uma solução completa. O uso é de 8h/dia por seis dias — perder 3 horas significa perder um turno de trabalho do cliente. É tolerável com 1 cliente (relacionamento direto, redigitação viável) e deixa de ser com 5. **É o principal motivo do gatilho de saída do estágio 0.**

Requisitos do job de backup:

- Roda no **primeiro dia**, antes de existir dado real
- Retenção: 30 dias
- Falha do job **notifica** (job silenciosamente quebrado é o modo de falha clássico)
- Também acionável manualmente (`workflow_dispatch`)

### Estágio 1 em diante

Backup base diário mais **WAL archiving contínuo** (pgBackRest ou wal-g) para o R2. RPO cai para ~5 minutos a custo praticamente nulo, já que os WAL segments são pequenos.

### Restauração

Um runbook escrito, com o tempo real cronometrado, cobrindo:

1. Provisionar destino
2. Restaurar último base backup
3. Aplicar WAL até o ponto desejado (estágio 1+)
4. Reapontar DNS
5. Validar com o teste de isolamento da seção 3

**Ensaio obrigatório:** uma restauração completa e cronometrada **antes do primeiro cliente entrar em produção**, e repetida a cada trimestre. Backup nunca restaurado não é backup — é a suposição de um.

---

## 6. Deploy

Três práticas que entregam mais disponibilidade que qualquer redundância de hardware, a custo zero. A maior parte do downtime em sistemas pequenos é auto-infligida.

**Blue-green:** versão nova sobe ao lado da antiga; o tráfego só troca depois do healthcheck passar. Elimina o downtime de deploy e de manutenção.

**Migrations compatíveis para trás:** nunca remover coluna no mesmo deploy que remove o uso dela. Separar em dois deploys permite rollback em 30 segundos em vez de restauração de backup.

**Teste de isolamento no pipeline:** o teste da seção 3 bloqueia o deploy se falhar.

---

## 7. Disponibilidade

### Modos de falha, por probabilidade

| # | Falha | Mitigação |
|---|---|---|
| 1 | Internet da loja do cliente caiu | **PWA com modo offline** |
| 2 | Deploy quebrado | Blue-green + migrations reversíveis |
| 3 | Manutenção | Blue-green; janela de domingo e madrugadas |
| 4 | Incidente no provedor / DNS | Backup externo + runbook |
| 5 | Servidor morreu | Restore (estágio 0-1) ou standby (estágio 2) |

Redundância de servidor ataca somente o item 5, o mais raro da lista. A banda larga de um hortifruti cai mais vezes por ano que a infraestrutura de qualquer provedor sério.

### PWA offline — requisito de produto, não de infra

Dado que o negócio do cliente não opera sem o CRM, **o modo offline é a mitigação de maior impacto de toda esta arquitetura**, porque cobre o modo de falha mais frequente e custa R$0 de infraestrutura.

Escopo mínimo recomendado:

- Cache local de clientes, produtos e preços (leitura funciona offline)
- Fila local de pedidos registrados durante a queda, sincronizada ao reconectar
- Indicação visível de estado offline e de itens pendentes de sincronização

Deliberadamente **fora do escopo mínimo**: sincronização bidirecional com resolução de conflitos. Cache de leitura mais fila de escrita entrega a maior parte do valor por uma fração da complexidade.

### Janela de manutenção

Uso de 8h/dia por 6 dias deixa **domingos inteiros e todas as madrugadas** livres para deploy, upgrade de PostgreSQL e ensaio de restore, sem impacto em usuário.

### Risco aceito no estágio 0

Cloudflare Pages e Supabase free tier não oferecem SLA nem suporte. Isto entra em tensão direta com a criticidade declarada do sistema.

O que torna o risco gerenciável com **um** cliente: contato direto com o dono do negócio, e backup próprio no R2 que permite subir em VPS em ~30 minutos. Deixa de ser gerenciável a partir de aproximadamente 5 clientes — daí o gatilho de saída.

**A hora de sair do free tier chega antes do que a vontade de sair.**

---

## 8. Decisões pendentes

| # | Decisão | Impacto |
|---|---|---|
| P1 | **Stack da aplicação** (Node/Next, Laravel, Python…) | Não altera nada nesta spec. Define o container do estágio 1, a estratégia de pooling e o formato das migrations. **Bloqueia o plano de implementação.** |
| P2 | Domínio a registrar | Define os subdomínios por tenant |
| P3 | Escopo do PWA offline | Requisito de produto, entra no roadmap da aplicação |

Sobre P1: dado que o front vai para Cloudflare Pages e o design virá do Claude Design (HTML/React), a escolha natural é **SPA React + API em Cloudflare Workers**, ou **Next.js** via `next-on-pages`. Ambas são compatíveis com o desenho acima; a segunda tem mais atrito no Cloudflare e migra melhor para VPS depois.

---

## 9. Fora de escopo

- Funcionalidades e modelo de dados de negócio do CRM
- Design de interface
- Failover automático de banco (justificativa na seção 4, estágio 2)
- Alta disponibilidade multi-região
- Integrações com WhatsApp, fiscal/NFe, PDV ou ERP — se algum entrar no escopo depois, esta spec precisa ser revisada, pois processos persistentes alteram o dimensionamento
