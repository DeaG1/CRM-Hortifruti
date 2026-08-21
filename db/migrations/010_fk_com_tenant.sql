-- FURO DE ISOLAMENTO: a verificacao de chave estrangeira ignora RLS.
--
-- O PostgreSQL executa a checagem de FK com os privilegios do dono da tabela
-- referenciada, e o dono nao esta sujeito as policies. Consequencia, provada ao
-- vivo contra o banco de desenvolvimento: com `app.tenant_id` apontando para a
-- empresa B, um insert em `lancamentos` referenciando um `funcionarios.id` da
-- empresa A e ACEITO em silencio. A RLS protege select, insert, update e
-- delete — ela nao alcanca a verificacao de integridade referencial.
--
-- O efeito nao e teorico: a despesa de uma empresa passaria a apontar para o
-- funcionario de outra, corrompendo o total "a pagar" daquela pessoa. E o mesmo
-- vale para item de venda apontando produto alheio, venda apontando cliente
-- alheio, e assim por diante — sao onze chaves com a mesma exposicao.
--
-- CORRECAO: incluir o tenant na propria chave. Com
-- `(tenant_id, produto_id) references produtos(tenant_id, id)`, o banco so
-- aceita a referencia se o produto pertencer ao MESMO tenant da linha que o
-- referencia. Deixa de ser uma regra que cada rota precisa lembrar de aplicar e
-- passa a ser impossivel de violar — inclusive por acesso direto ao banco, por
-- script de importacao, ou por uma rota futura escrita distraidamente.
--
-- Colunas nulaveis continuam funcionando: o padrao MATCH SIMPLE dispensa a
-- verificacao quando qualquer coluna da chave e NULL, entao uma venda sem
-- cliente ou um lancamento sem funcionario seguem validos.
--
-- A validacao na aplicacao continua valendo a pena e nao e removida: ela
-- devolve 400 com mensagem util em vez de deixar o banco estourar um 23503.
-- Aqui e a rede embaixo dela.

-- SANEAMENTO ANTES DE PROTEGER.
--
-- Se o furo ja foi explorado — de proposito ou por acidente — existem linhas
-- apontando para registros de outro tenant, e a FK composta se recusa a ser
-- criada sobre dados que a violam. Foi o que aconteceu na primeira tentativa
-- de aplicar esta migration: os proprios testes automatizados haviam gravado
-- lancamentos referenciando funcionarios de outra empresa, sem nenhum erro na
-- hora. Prova de que a exposicao nao era teorica.
--
-- Referencias opcionais (fornecedor, cliente, funcionario) sao zeradas: perder
-- o vinculo e melhor que apontar para dado alheio, e o registro continua
-- valido sem ele. Referencias obrigatorias (itens de entrada e saida) tem a
-- linha inteira removida — um item que aponta produto de outra empresa nao tem
-- leitura correta possivel, e mante-lo corromperia todo calculo de estoque e
-- de preco medio.
--
-- Em producao, rode isto com o banco ja restaurado num ambiente de conferencia
-- antes: se estas queries afetarem muitas linhas, ha um problema de dados que
-- merece investigacao, nao so limpeza.

update entradas e set fornecedor_id = null
 where fornecedor_id is not null
   and not exists (select 1 from fornecedores f
                    where f.id = e.fornecedor_id and f.tenant_id = e.tenant_id);

update saidas s set cliente_id = null
 where cliente_id is not null
   and not exists (select 1 from clientes c
                    where c.id = s.cliente_id and c.tenant_id = s.tenant_id);

update lancamentos l set funcionario_id = null
 where funcionario_id is not null
   and not exists (select 1 from funcionarios f
                    where f.id = l.funcionario_id and f.tenant_id = l.tenant_id);

delete from entrada_itens i
 where not exists (select 1 from produtos p where p.id = i.produto_id and p.tenant_id = i.tenant_id)
    or not exists (select 1 from entradas e where e.id = i.entrada_id and e.tenant_id = i.tenant_id);

delete from saida_itens i
 where not exists (select 1 from produtos p where p.id = i.produto_id and p.tenant_id = i.tenant_id)
    or not exists (select 1 from saidas s where s.id = i.saida_id and s.tenant_id = i.tenant_id);

delete from perdas p
 where not exists (select 1 from produtos pr where pr.id = p.produto_id and pr.tenant_id = p.tenant_id);

delete from fornecedor_produtos fp
 where not exists (select 1 from fornecedores f where f.id = fp.fornecedor_id and f.tenant_id = fp.tenant_id)
    or not exists (select 1 from produtos p     where p.id = fp.produto_id    and p.tenant_id = fp.tenant_id);

delete from sessoes s
 where not exists (select 1 from usuarios u where u.id = s.usuario_id and u.tenant_id = s.tenant_id);

-- Cada tabela referenciada precisa de uma chave candidata (tenant_id, id).
-- Redundante em relacao a PK, mas e o que permite a FK composta existir.
alter table clientes      add constraint clientes_tenant_id_uk      unique (tenant_id, id);
alter table produtos      add constraint produtos_tenant_id_uk      unique (tenant_id, id);
alter table fornecedores  add constraint fornecedores_tenant_id_uk  unique (tenant_id, id);
alter table funcionarios  add constraint funcionarios_tenant_id_uk  unique (tenant_id, id);
alter table entradas      add constraint entradas_tenant_id_uk      unique (tenant_id, id);
alter table saidas        add constraint saidas_tenant_id_uk        unique (tenant_id, id);
alter table usuarios      add constraint usuarios_tenant_id_uk      unique (tenant_id, id);

-- Troca de cada FK simples pela composta, preservando o comportamento de
-- delete original (cascade para itens, restrict para cadastro em uso,
-- set null para vinculo opcional).

alter table entrada_itens drop constraint entrada_itens_entrada_id_fkey;
alter table entrada_itens add constraint entrada_itens_entrada_fk
  foreign key (tenant_id, entrada_id) references entradas(tenant_id, id) on delete cascade;

alter table entrada_itens drop constraint entrada_itens_produto_id_fkey;
alter table entrada_itens add constraint entrada_itens_produto_fk
  foreign key (tenant_id, produto_id) references produtos(tenant_id, id) on delete restrict;

alter table entradas drop constraint entradas_fornecedor_id_fkey;
alter table entradas add constraint entradas_fornecedor_fk
  foreign key (tenant_id, fornecedor_id) references fornecedores(tenant_id, id) on delete set null;

alter table fornecedor_produtos drop constraint fornecedor_produtos_fornecedor_id_fkey;
alter table fornecedor_produtos add constraint fornecedor_produtos_fornecedor_fk
  foreign key (tenant_id, fornecedor_id) references fornecedores(tenant_id, id) on delete cascade;

alter table fornecedor_produtos drop constraint fornecedor_produtos_produto_id_fkey;
alter table fornecedor_produtos add constraint fornecedor_produtos_produto_fk
  foreign key (tenant_id, produto_id) references produtos(tenant_id, id) on delete cascade;

alter table lancamentos drop constraint lancamentos_funcionario_id_fkey;
alter table lancamentos add constraint lancamentos_funcionario_fk
  foreign key (tenant_id, funcionario_id) references funcionarios(tenant_id, id) on delete set null;

alter table perdas drop constraint perdas_produto_id_fkey;
alter table perdas add constraint perdas_produto_fk
  foreign key (tenant_id, produto_id) references produtos(tenant_id, id) on delete restrict;

alter table saida_itens drop constraint saida_itens_produto_id_fkey;
alter table saida_itens add constraint saida_itens_produto_fk
  foreign key (tenant_id, produto_id) references produtos(tenant_id, id) on delete restrict;

alter table saida_itens drop constraint saida_itens_saida_id_fkey;
alter table saida_itens add constraint saida_itens_saida_fk
  foreign key (tenant_id, saida_id) references saidas(tenant_id, id) on delete cascade;

alter table saidas drop constraint saidas_cliente_id_fkey;
alter table saidas add constraint saidas_cliente_fk
  foreign key (tenant_id, cliente_id) references clientes(tenant_id, id) on delete set null;

alter table sessoes drop constraint sessoes_usuario_id_fkey;
alter table sessoes add constraint sessoes_usuario_fk
  foreign key (tenant_id, usuario_id) references usuarios(tenant_id, id) on delete cascade;
