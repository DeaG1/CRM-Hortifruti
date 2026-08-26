-- DEFEITO ENCONTRADO: as tres FKs `on delete set null` da 010 nunca
-- funcionaram. Excluir o cadastro referenciado nao zerava o vinculo — dava
-- erro.
--
-- COMO APARECEU: escrevendo `lancamentos.veiculo_id` (013) no molde de
-- `lancamentos.funcionario_id`, o teste "excluir o veiculo zera veiculo_id e
-- preserva o lancamento" falhou com 500. A causa nao era do codigo novo:
--
--   delete from funcionarios where id = <um funcionario com lancamento>
--   ERRO 23502: null value in column "tenant_id" of relation "lancamentos"
--               violates not-null constraint
--
-- Um `ON DELETE SET NULL` sem lista de colunas zera TODAS as colunas da
-- chave estrangeira. Quando a chave e simples (`funcionario_id`), isso e o
-- que se quer. Quando ela e COMPOSTA — e a 010 tornou todas compostas, de
-- proposito, para o tenant entrar na chave e a checagem de FK parar de
-- ignorar RLS — a chave passou a incluir `tenant_id`, que e `not null` em
-- toda tabela deste banco. O `set null` entao tenta zerar o tenant da linha
-- e bate na NOT NULL.
--
-- A 010 nao errou de raciocinio: ela diz explicitamente que preserva "o
-- comportamento de delete original (... set null para vinculo opcional)", e
-- e isso que se queria. O que faltou foi que a sintaxe que expressa esse
-- comportamento MUDA quando a chave vira composta. A forma com lista de
-- colunas — `on delete set null (coluna)` — existe desde o PostgreSQL 15
-- (este projeto roda 16) e zera so a coluna do vinculo.
--
-- O QUE ESTAVA QUEBRADO NA PRATICA, com a API respondendo 500 "erro
-- interno" (nenhuma das tres rotas mapeia 23502):
--
--   - excluir um FUNCIONARIO que ja teve salario ou adiantamento lancado;
--   - excluir um CLIENTE que ja teve venda;
--   - excluir um FORNECEDOR que ja teve entrada.
--
-- Ou seja: exatamente o cadastro com historico — o unico caso em que estas
-- FKs tinham algo a fazer. Enquanto o cadastro nao tinha movimento, o delete
-- passava (nao havia linha a atualizar) e o defeito ficava invisivel.
--
-- Esta correcao NAO e destrutiva e nao muda nenhuma decisao de produto:
-- restaura o comportamento que a 010 descreve e que as rotas ja esperavam.
-- Nenhum dado e apagado ou reescrito aqui — so a acao futura do banco ao
-- excluir um cadastro muda, de "erro" para "zera o vinculo".
--
-- `drop` + `add` porque nao ha `alter constraint` para trocar a acao de
-- delete. A definicao recriada e identica a da 010 exceto pela lista de
-- colunas; as duas rodam na mesma transacao do runner (db/migrate.mjs), de
-- modo que nenhuma janela sem a constraint fica visivel para outra sessao.

alter table lancamentos drop constraint lancamentos_funcionario_fk;
alter table lancamentos add constraint lancamentos_funcionario_fk
  foreign key (tenant_id, funcionario_id) references funcionarios(tenant_id, id)
  on delete set null (funcionario_id);

alter table saidas drop constraint saidas_cliente_fk;
alter table saidas add constraint saidas_cliente_fk
  foreign key (tenant_id, cliente_id) references clientes(tenant_id, id)
  on delete set null (cliente_id);

alter table entradas drop constraint entradas_fornecedor_fk;
alter table entradas add constraint entradas_fornecedor_fk
  foreign key (tenant_id, fornecedor_id) references fornecedores(tenant_id, id)
  on delete set null (fornecedor_id);

-- As demais FKs compostas da 010 nao sao tocadas: `cascade` e `restrict` nao
-- escrevem nas colunas da chave, entao a lista de colunas nao se aplica a
-- elas e o comportamento delas sempre foi o descrito.
