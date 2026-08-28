-- HISTORICO DE ALTERACOES DOS CADASTROS (cliente, produto, fornecedor).
--
-- Pedido do dono do negocio logo depois de 8e872d2, o commit que deu ao
-- colaborador o direito de criar e editar esses tres cadastros: ele quer
-- rastro do que foi mexido.
--
-- ========================================================================
-- O FATO QUE DEFINE A TABELA INTEIRA: EXISTE UM SO LOGIN PARA A EQUIPE
-- ========================================================================
--
-- Este hortifruti tem UMA conta de colaborador, usada por todo mundo que
-- trabalha no balcao (e o motivo de o cookie ter deixado de ser persistente
-- em 478133f: admin e funcionarios dividem o mesmo computador). O servidor,
-- portanto, NAO TEM COMO SABER quem digitou. Ele sabe qual LOGIN escreveu, e
-- isso e outra coisa.
--
-- Entao esta tabela nao registra quem editou. Registra o que a pessoa
-- DECLAROU ao salvar. A diferenca esta materializada em `autor_origem`, que
-- e obrigatoria e so aceita dois valores:
--
--   'declarado' — sessao de colaborador. O nome foi ESCOLHIDO por quem
--                 salvou, de uma lista fechada de funcionarios cadastrados.
--                 Ninguem verificou nada. Vale como declaracao, nao como
--                 prova; se a pessoa mentir, o registro guarda a mentira com
--                 a mesma fidelidade com que guardaria a verdade.
--   'login'     — sessao de admin. O login do dono e individual, entao aqui
--                 o nome vem da propria conta autenticada, nao de um campo
--                 preenchido a mao.
--
-- A coluna existe para que a TELA nunca possa escrever "editado por" onde o
-- banco so tem "declarado por". Chamar declaracao de prova e mentir sobre a
-- propria evidencia — e no dia em que este historico importar (uma cobranca
-- errada, um limite de credito mexido, um preco trocado), o dono precisa
-- saber de que tipo de registro esta falando ANTES de acusar alguem.
--
-- POR QUE ESCOLHA DE LISTA E NAO TEXTO LIVRE: texto livre vira "joão",
-- "Joao" e "jão" na mesma semana, e o rastro de uma pessoa se fragmenta em
-- tres. Quem escolhe da lista de `funcionarios` produz sempre o mesmo id.
--
-- ========================================================================
-- O RASTRO PRECISA SOBREVIVER AO QUE ELE DOCUMENTA
-- ========================================================================
--
-- Este e o requisito que decide as duas referencias abaixo, e ele vale contra
-- o instinto normal deste projeto (FK composta para tudo, ver 010).
--
-- 1. NAO HA FK PARA cliente/produto/fornecedor. `registro_id` e um uuid nu.
--    Com uma FK `on delete cascade`, excluir o cliente apagaria junto o
--    registro de quem mexeu nele — inclusive o registro da propria exclusao.
--    Com `restrict`, o historico passaria a BARRAR a exclusao do cadastro, e
--    a 015 ja mostrou onde isso termina: um bloqueio permanente por causa de
--    linhas que nenhuma tela alcanca. Com `set null (registro_id)` o rastro
--    sobreviveria, mas anonimo — sem saber de qual cliente estava falando,
--    que e a metade util da informacao.
--
--    O preco de nao ter FK e assumido e nomeado: nada no banco impede um
--    `registro_id` que nao existe mais em `clientes`. E exatamente o estado
--    que se QUER depois de uma exclusao — o log continua dizendo "em 12/03
--    fulano alterou o limite do Mercado Bom Preço, e em 20/03 alguem apagou
--    o cadastro". Por isso `registro_nome` e `not null`: o nome vai gravado
--    como TEXTO, no proprio registro de historico, e nao depende de nenhum
--    join para ser lido depois que a linha original sumir.
--
--    (O isolamento entre empresas NAO depende dessa FK: `tenant_id` e a
--    coluna que a RLS filtra, e ela tem FK propria para `tenants`. O que a
--    FK composta da 010 protege e o caso "linha da empresa B apontando para
--    cadastro da empresa A"; aqui esse ponteiro nao e usado para construir
--    numero nenhum, so para agrupar o log de um registro, e a policy ja
--    garante que a leitura nunca cruza empresas.)
--
-- 2. A FK PARA `funcionarios` EXISTE, mas e `on delete set null
--    (autor_funcionario_id)` — e `autor_nome` e `not null` ao lado dela.
--    Excluir o funcionario declarado apaga o PONTEIRO e nao apaga o NOME: o
--    log continua dizendo "declarado por: Joao", mesmo depois de Joao sair
--    da empresa e o cadastro dele ser removido. Um log que perde a evidencia
--    quando alguem e removido nao e log.
--
--    A lista de colunas em `set null (autor_funcionario_id)` NAO e opcional
--    e a licao e a 014: um `set null` sem lista, numa chave COMPOSTA, tenta
--    zerar tambem `tenant_id` (not null) e o delete morre com 23502. Aquele
--    defeito ficou invisivel por 533 testes verdes porque so aparecia quando
--    havia historico — que e, literalmente, o caso desta tabela.
--
--    A chave continua composta (`tenant_id, autor_funcionario_id`) pelo
--    motivo de sempre (010): a checagem de FK do PostgreSQL roda com os
--    privilegios do dono da tabela e ignora RLS, entao uma FK simples
--    aceitaria em silencio um historico da empresa B declarando o
--    funcionario da empresa A.
--
-- ========================================================================
-- IMUTAVEL
-- ========================================================================
--
-- Nao existe rota de PUT nem de DELETE para esta tabela, e nao deve passar a
-- existir: historico corrigivel depois nao serve de prova. As unicas
-- operacoes sao INSERT (feito pelas proprias rotas de cadastro, dentro da
-- mesma transacao da alteracao que ele descreve) e SELECT (admin-only, em
-- api/src/routes/historico.ts).
--
-- SEJAMOS EXATOS SOBRE O QUE ISSO GARANTE: a imutabilidade e do PRODUTO, nao
-- do banco. `app_crm` tem update e delete nesta tabela como tem em todas as
-- outras (o `alter default privileges` da 001), e o `on delete cascade` de
-- `tenant_id` precisa que DELETE continue possivel para que remover uma
-- empresa nao deixe orfaos. O que garante a imutabilidade e a ausencia de
-- caminho de codigo — provada em teste (api/test/historico.http.test.ts
-- exercita PUT/PATCH/DELETE contra as rotas e exige 404). Um trigger
-- append-only seria mais forte e fica registrado como possivel se um dia o
-- acesso direto ao banco deixar de ser so do dono.

create table historico_cadastros (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,

  -- Os TRES cadastros que o colaborador pode mexer, e mais nada. A lista e
  -- fechada no CHECK de proposito: se um dia funcionarios ou veiculos
  -- entrarem aqui, isso e uma decisao de produto que merece migration
  -- propria, nao uma string nova aparecendo em producao sem ninguem notar.
  entidade    text not null
              constraint historico_entidade_check
              check (entidade in ('cliente','produto','fornecedor')),

  -- Sem FK, de proposito — ver o bloco 1 acima.
  registro_id uuid not null,
  -- O nome do cadastro NO MOMENTO do evento. Snapshot, nao join: e o que
  -- sobrevive a exclusao do registro, e tambem o que mostra que o cadastro
  -- se chamava outra coisa quando aquela alteracao foi feita.
  registro_nome text not null,

  acao        text not null
              constraint historico_acao_check
              check (acao in ('criou','editou','excluiu')),

  -- ------------------------------------------------------------ o autor
  autor_origem text not null
               constraint historico_autor_origem_check
               check (autor_origem in ('declarado','login')),
  -- O nome, como TEXTO, sempre. Para 'declarado' e o nome do funcionario
  -- escolhido na lista; para 'login' e o nome da conta de admin autenticada.
  -- `not null` e nao vazio: um registro de autoria sem nome nenhum nao
  -- responde a pergunta que o log existe para responder.
  autor_nome  text not null
              constraint historico_autor_nome_check check (btrim(autor_nome) <> ''),
  -- O ponteiro, que pode virar nulo (funcionario excluido) sem levar o nome
  -- junto. Nulo tambem quando `autor_origem = 'login'`: o admin e uma conta
  -- de `usuarios`, nao necessariamente uma linha de `funcionarios`.
  autor_funcionario_id uuid,

  -- Obrigatorio para o colaborador (validado na API, que e quem conhece o
  -- papel da sessao); '' para o admin, que nao declara nada. Nao ha CHECK de
  -- "nao vazio" aqui justamente porque a regra depende do papel, e papel e
  -- coisa que o banco desta tabela nao ve. Motivo opcional e motivo que
  -- ninguem preenche — por isso a exigencia existe, e por isso ela mora no
  -- servidor e nao so no formulario.
  motivo      text not null default '',

  -- O QUE MUDOU, CAMPO A CAMPO: [{"campo":"tel","de":"44 1","para":"44 2"}].
  -- So os campos que REALMENTE mudaram, com de/para — nao uma copia do
  -- registro inteiro. E a diferenca entre um log que responde "quem mexeu no
  -- limite de credito deste cliente?" em um olhar e um que obriga a comparar
  -- duas versoes campo por campo na mao.
  --
  -- Vazio (`[]`) em 'criou' e 'excluiu', e isso e uma afirmacao, nao uma
  -- lacuna: criar nao tem "de", e o que foi criado E o registro atual;
  -- excluir nao tem "para", e o que se perde esta identificado por
  -- `registro_nome`. Gravar o registro inteiro nos dois casos seria
  -- exatamente a copia que a linha acima recusa.
  alteracoes  jsonb not null default '[]',

  -- So `criado_em`. NAO ha `alterado_em` nesta tabela, ao contrario de todas
  -- as vizinhas, e a ausencia e a declaracao: nada aqui e alterado depois.
  criado_em   timestamptz not null default now(),

  constraint historico_autor_funcionario_fk
    foreign key (tenant_id, autor_funcionario_id) references funcionarios(tenant_id, id)
    on delete set null (autor_funcionario_id)
);

create index on historico_cadastros (tenant_id);
-- A unica consulta de leitura que existe: o historico de UM registro, do mais
-- recente para o mais antigo (api/src/routes/historico.ts). `criado_em desc`
-- entra no indice porque a ordenacao e sempre essa.
create index on historico_cadastros (tenant_id, entidade, registro_id, criado_em desc);
-- Indice do lado referenciante da FK: sem ele, excluir um funcionario faz o
-- Postgres varrer esta tabela inteira para aplicar o `set null`. Mesmo
-- cuidado que `lancamentos (funcionario_id)` (009).
create index on historico_cadastros (autor_funcionario_id);

-- ----------------------------------------------------------------- RLS
-- Tabela com tenant_id leva o conjunto completo: enable + force + policy com
-- `using` E `with check`. O `nullif` no `current_setting` e obrigatorio
-- (002): sem ele, `''::uuid` lanca fora de uma transacao com o tenant
-- fixado, e o erro aparece longe da causa. Formato copiado das tabelas
-- vizinhas (009, 016); o gate api/test/cobertura_rls.test.ts reprova o build
-- se alguma parte faltar.
alter table historico_cadastros enable row level security;
alter table historico_cadastros force row level security;
create policy tenant_isolation on historico_cadastros
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
