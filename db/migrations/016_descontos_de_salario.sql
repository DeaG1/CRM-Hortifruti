-- DESCONTO DE SALARIO POR FALTA: "X funcionario faltou em Y dia por Z motivo,
-- e isso abate o que ele tem a receber".
--
-- Pedido do dono do negocio, ao lado de "Pagar salario" e "Adiantar" na tela
-- de Funcionarios. Registra tres coisas: a DATA DA FALTA, o MOTIVO e o VALOR
-- descontado.
--
-- ------------------------------------------------------------------------
-- POR QUE UMA TABELA PROPRIA, E NAO UMA CATEGORIA DE `lancamentos`
-- ------------------------------------------------------------------------
--
-- A tentacao obvia era acrescentar 'Desconto de salario' a lista de
-- CATEGORIAS (api/src/routes/lancamentos.ts) e reaproveitar toda a mecanica
-- que ja existe para 'Adiantamento de salario' — mesmo formato (data,
-- valor, funcionario_id), mesmo modal, mesma linha no historico. Seria menos
-- codigo. E estaria errado nas DUAS pontas, com sinais opostos:
--
--  1. UM DESCONTO NAO E UMA SAIDA DE DINHEIRO. Nada se move quando o dono
--     registra a falta — a empresa vai PAGAR MENOS depois. O Financeiro soma
--     `lancamentos.valor` como CUSTO do periodo (derive/financeiro.ts), entao
--     um desconto de R$ 100 lancado ali AUMENTARIA o custo da folha em R$ 100,
--     exatamente ao contrario do que ele faz na realidade.
--  2. E AO MESMO TEMPO abateria R$ 100 do "a pagar" daquele funcionario
--     (derive/funcionarios.ts soma por categoria de folha). Ou seja: o mesmo
--     registro empurraria o custo para cima e a divida para baixo. Os dois
--     numeros ficariam errados, e nenhum dos dois erros apareceria como erro
--     — apareceriam como dinheiro.
--
-- Um `valor` negativo em `lancamentos` "resolveria" o sinal e criaria um
-- problema maior: a coluna tem `check (valor >= 0)` desde a 009, e toda soma
-- do sistema (caixa, resultado do periodo, custo por categoria) assume que
-- lancamento e sempre positivo. Inverter isso para um caso e mexer em todas.
--
-- Desconto e uma REDUCAO DE OBRIGACAO, nao um evento de caixa. O evento de
-- caixa continua sendo um so, e continua sendo um `lancamento`: o salario que
-- o dono paga no fim — ja liquido, porque a tela pre-preenche o valor com o
-- desconto ja abatido. O custo da folha no Financeiro cai sozinho, pelo valor
-- menor do proprio salario pago, sem nenhuma linha nova. Foi por isso que
-- esta tabela nao guarda nenhum vinculo com `lancamentos`: ela nao explica um
-- pagamento, ela muda quanto ele vai ser.

create table descontos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  -- `not null`: um desconto so existe em relacao a alguem. Diferente de
  -- `lancamentos.funcionario_id`, que e nulavel porque uma despesa continua
  -- valendo sem saber de quem era — aqui, sem funcionario, nao sobra
  -- registro nenhum. Isso e o que decide a acao de delete la embaixo.
  funcionario_id uuid not null,
  -- A DATA DA FALTA, nao a data em que o dono lembrou de registrar. E ela que
  -- decide em qual periodo o desconto abate: falta de marco nao pode diminuir
  -- o salario de agosto so porque foi digitada em agosto. Mesma semantica de
  -- `perdas.data` (a perda) e `lancamentos.data` (o pagamento).
  data           date not null,
  -- Texto livre, e OBRIGATORIO (`btrim <> ''`, nao so `not null`). O motivo e
  -- metade do valor do registro: um numero abatido do salario de alguem sem
  -- dizer por que e um numero que o funcionario contesta e o dono nao
  -- consegue explicar tres meses depois. Livre, e nao enum como
  -- `perdas.motivo`, porque as razoes reais nao formam lista fechada
  -- ("faltou", "chegou 3h atrasado", "quebrou uma caixa") — enum aqui so
  -- produziria um "outros" que engole tudo.
  motivo         text not null constraint descontos_motivo_check check (btrim(motivo) <> ''),
  -- Guardado POSITIVO, como todo dinheiro deste banco. O sinal e do
  -- significado da tabela ("quanto abater"), nao do numero — e a conta que
  -- subtrai mora em derive/funcionarios.ts, testada.
  valor          numeric(12,2) not null check (valor >= 0),
  criado_em      timestamptz not null default now(),
  alterado_em    timestamptz not null default now(),

  -- ----------------------------------------------------------------------
  -- FK COMPOSTA COM tenant_id — a licao inteira de 010_fk_com_tenant.sql, e
  -- ela nao e opcional: a verificacao de chave estrangeira do PostgreSQL roda
  -- com os privilegios do DONO da tabela referenciada, e o dono nao esta
  -- sujeito as policies de RLS. Com `references funcionarios(id)`, um
  -- desconto da empresa B apontando para o funcionario da empresa A seria
  -- ACEITO EM SILENCIO — foi exatamente isso que a 010 encontrou (e saneou)
  -- em `lancamentos.funcionario_id`, contra este mesmo banco. Aqui o estrago
  -- seria abater dinheiro do salario de uma pessoa de outra empresa.
  --
  -- A chave candidata `funcionarios_tenant_id_uk (tenant_id, id)` de que esta
  -- FK depende ja existe — criada na 010.
  --
  -- Sem saneamento previo, ao contrario da 010: a tabela nasce agora, vazia,
  -- e nao ha como haver dado que viole a constraint.
  --
  -- ----------------------------------------------------------------------
  -- ON DELETE CASCADE, e a escolha foi entre as tres que o projeto ja usa:
  --
  --  - `set null` (o que `lancamentos.funcionario_id` faz) esta FORA duas
  --    vezes. Primeiro porque `funcionario_id` aqui e `not null` — nao ha
  --    valor para escrever. Segundo, e mais importante, porque a coluna nao
  --    e uma ETIQUETA neste caso: um lancamento sem funcionario ainda e uma
  --    despesa que aconteceu e um dinheiro que saiu; um desconto sem
  --    funcionario nao e nada. Nao tem valor a receber para abater, nao
  --    entra em soma nenhuma, nao pode ser lido. Seria lixo.
  --    (E, se alguem tentasse mesmo assim: `set null` sem lista de colunas
  --    numa FK COMPOSTA tenta zerar tambem o `tenant_id`, que e `not null`, e
  --    o delete morre com 23502 — o defeito real corrigido em
  --    014_fk_set_null_por_coluna.sql. A forma correta seria
  --    `set null (funcionario_id)`, que aqui esbarra no `not null` da coluna.)
  --
  --  - `restrict` (o que `perdas.produto_id` faz) esta FORA porque
  --    reproduziria, letra por letra, o bloqueio permanente que a
  --    015_veiculo_usos_cascade.sql acabou de desfazer: excluir um
  --    funcionario passaria a falhar por causa de linhas que so existem
  --    dentro daquele funcionario, e o unico caminho do produto para
  --    limpa-las e... aquele mesmo funcionario. `restrict` se justifica
  --    quando as linhas CONSTROEM um numero que sobrevive ao cadastro
  --    (estoque, preco medio) e o dono tem como resolver a pendencia por
  --    fora. Nenhuma das duas coisas vale aqui.
  --
  --  - `cascade` e o que resta e o que esta certo: desconto de funcionario
  --    que nao existe mais e lixo, e apaga-lo nao perde historico
  --    FINANCEIRO nenhum — nenhum agregado do sistema le esta tabela alem do
  --    "a pagar" daquele mesmo funcionario, e nenhum dinheiro se moveu por
  --    causa dela. O salario efetivamente pago continua registrado em
  --    `lancamentos`, com o valor liquido que foi pago de fato, e aquela
  --    linha sobrevive a exclusao do cadastro (set null, 014). O caixa e o
  --    resultado do periodo nao mudam de valor porque alguem arrumou o
  --    cadastro da equipe.
  --
  --  E quem quiser PRESERVAR o registro nao deve excluir, deve desativar:
  --  `funcionarios.ativo = false` aposenta a pessoa sem perder nada (009).
  --
  -- Nao ha lista de colunas aqui, ao contrario da 014: aquela lista so existe
  -- para `set null`, que escreve nas colunas da chave. `cascade` apaga a linha
  -- inteira, entao a questao do `tenant_id` not-null nem se coloca — mesma
  -- observacao que a 015 faz sobre as FKs dela.
  constraint descontos_funcionario_fk
    foreign key (tenant_id, funcionario_id) references funcionarios(tenant_id, id)
    on delete cascade
);

create index on descontos (tenant_id);
-- O recorte por periodo da tela e por empresa + data (igual `lancamentos` e
-- `entradas`), e o "a pagar" de uma linha e por funcionario (igual
-- `lancamentos (funcionario_id)`). Sao as duas unicas consultas que existem.
create index on descontos (tenant_id, data);
create index on descontos (funcionario_id);

-- ----------------------------------------------------------------- RLS
-- Tabela com tenant_id leva o conjunto completo: enable + force + policy com
-- `using` E `with check`. O `nullif` no `current_setting` e obrigatorio (002):
-- sem ele, `''::uuid` lanca fora de uma transacao com o tenant fixado, e o
-- erro aparece longe da causa. Formato copiado das tabelas vizinhas em
-- 009_entidades_fase1.sql; o teste api/test/cobertura_rls.test.ts reprova o
-- build se alguma parte faltar.
alter table descontos enable row level security;
alter table descontos force row level security;
create policy tenant_isolation on descontos
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
