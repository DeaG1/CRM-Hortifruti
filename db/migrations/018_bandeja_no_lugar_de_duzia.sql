-- 'DZ' (duzia) SAI, 'BDJA' (bandeja) ENTRA — em todas as tabelas que guardam
-- unidade.
--
-- ========================================================================
-- POR QUE: DECISAO DE PRODUTO, NAO CORRECAO DE ERRO
-- ========================================================================
--
-- A lista de unidades da 009 ('KG','CX','UN','DZ','MC') veio do prototipo,
-- nao do balcao. Este hortifruti NAO VENDE POR DUZIA: o que sai daqui em
-- embalagem contavel sai em BANDEJA — morango, tomate cereja, ovo de
-- codorna. 'DZ' nunca foi usada porque o negocio nao a usa, e 'BDJA' faltava
-- porque ninguem perguntou ao dono antes de copiar a lista.
--
-- Quem ler isto daqui a um ano precisa saber que a troca foi DELIBERADA e
-- pedida pelo dono do negocio ("nao trabalho com duzia, trabalho com
-- bandeja"), e nao um engano de digitacao nem um typo herdado. Se um dia
-- alguem quiser 'DZ' de volta, o caminho e outra migration com outra
-- conversa — nao um `git revert` desta.
--
-- E RENOMEACAO PURA, e isso e o que torna a migration segura: 'BDJA' ocupa
-- exatamente o lugar que 'DZ' ocupava. Mesma posicao na lista, mesma
-- semantica de "embalagem contavel", mesmo tratamento em todo o codigo. Nao
-- ha unidade nova convivendo com a antiga e nao ha periodo de transicao —
-- depois daqui 'DZ' nao existe mais. Nenhuma conta muda: nem aqui nem no
-- servidor houve jamais um `case` para 'DZ'. Toda a aritmetica de conversao
-- deste projeto pergunta uma coisa so, `un = 'KG'` ou nao (ver o `case` em
-- api/src/routes/estoque.ts e `qtdEmKg` em web/src/derive/coleta.ts): 'DZ'
-- caia no ramo "converte pelo peso_medio" e 'BDJA' cai no mesmo ramo. Uma
-- bandeja de morango continua pesando o que a coluna `peso_medio` disser.
--
-- ========================================================================
-- A MIGRATION CONVERTE O DADO, NAO SO A RESTRICAO
-- ========================================================================
--
-- HA PRODUTO EM 'DZ' EM PRODUCAO NESTE MOMENTO, e o dono continua cadastrando
-- enquanto isto e escrito — sabendo que viram bandeja depois. Trocar so o
-- CHECK deixaria essas linhas com uma unidade que nao existe mais: invisiveis
-- nos seletores (que so oferecem a lista nova), invalidas na proxima edicao
-- (o CHECK novo rejeitaria o proprio valor que ja estava gravado) e mudas em
-- todo relatorio agrupado por unidade. Por isso o `update` vem antes, e por
-- isso ele e `where un = 'DZ'` — sem contagem esperada, sem lista de ids:
-- converte o que EXISTIR no instante em que rodar, seja 2 linhas ou 40.
--
-- E ALCANCA AS QUATRO TABELAS QUE GUARDAM UNIDADE, nao so `produtos`. Um
-- item ja lancado guarda a unidade DELE (`entrada_itens.un`, `saida_itens.un`,
-- `perdas.un` — a unidade do lancamento, que pode diferir da unidade padrao
-- do cadastro). Converter so o cadastro deixaria 'DZ' orfao no historico de
-- movimento: a tela de Estoque agrupa por (produto, unidade), entao o mesmo
-- morango apareceria em duas linhas que nunca mais se somam, uma em 'DZ' e
-- outra em 'BDJA'. Hoje `entrada_itens` e `saida_itens` nao tem linha em
-- 'DZ' e `perdas` tem — mas isso e um retrato, nao uma garantia: o dono pode
-- lancar uma entrada com esses produtos antes de a migration rodar. Os
-- quatro `update` sao incondicionais de proposito; converter zero linhas e
-- um resultado valido, ficar para tras nao e.
--
-- ========================================================================
-- POR QUE O `no force row level security` EM VOLTA DOS UPDATES
-- ========================================================================
--
-- Esta e a licao da 012, e aqui ela morde de novo. As quatro tabelas tem
-- FORCE ROW LEVEL SECURITY, e FORCE vale ATE PARA O DONO da tabela. A policy
-- filtra por `tenant_id = nullif(current_setting('app.tenant_id', true),
-- '')::uuid`, e uma migration nao roda dentro de sessao de tenant nenhuma —
-- `app.tenant_id` esta vazio, o `nullif` devolve null, e a comparacao nao
-- casa com linha nenhuma.
--
-- O resultado disso NAO E UM ERRO: e `UPDATE 0`. Um papel dono mas sem
-- BYPASSRLS converteria zero linhas, o `insert into schema_migrations` logo
-- em seguida daria certo, e a migration se declararia aplicada com sucesso
-- deixando todo produto do dono em 'DZ' — silenciosamente. (Localmente o
-- `postgres` do container e superuser e passa por cima; e exatamente por
-- isso que o defeito nao apareceria em teste nenhum antes de chegar em
-- producao.)
--
-- `no force` devolve ao DONO a passagem por cima da policy sem tocar em
-- `enable row level security` — as tabelas seguem com RLS ligada para
-- `app_crm` o tempo todo, e o `force` volta antes do fim. Tudo dentro da
-- mesma transacao do runner (db/migrate.mjs envolve cada arquivo num
-- `sql.begin`), entao ou os quatro `force` voltam ou nada disto aconteceu.
-- O gate api/test/cobertura_rls.test.ts reprova o build se algum ficar para
-- tras — ele checa `relforcerowsecurity` tabela por tabela.
--
-- ========================================================================
-- ORDEM E TRAVAS
-- ========================================================================
--
-- O CHECK antigo SAI PRIMEIRO, antes dos updates. Sao duas razoes:
--
--   1. Enquanto ele existir, 'BDJA' e um valor proibido — o `update` de
--      `produtos` morreria no proprio CHECK que veio trocar.
--   2. `drop constraint` toma ACCESS EXCLUSIVE em `produtos` e segura ate o
--      fim da transacao. Dai em diante ninguem mais insere 'DZ' pelas
--      costas da conversao. Como o dono esta cadastrando AGORA, essa janela
--      importa: sem a trava, um produto salvo entre o `update` e o
--      `add constraint` faria a migration inteira falhar na validacao do
--      CHECK novo (alto e visivel, com rollback — mas uma falha evitavel).
--
-- As tres tabelas de item nao tem CHECK para derrubar (ver abaixo), entao
-- elas ganham `lock table` explicito pelo mesmo motivo: fechar a janela em
-- que um lancamento novo em 'DZ' entraria depois do `update` e ficaria
-- orfao. SHARE ROW EXCLUSIVE barra escrita e libera leitura, e a transacao
-- inteira dura milissegundos.
--
-- SOBRE O CHECK QUE NAO EXISTE: so `produtos.un` tem CHECK. `entrada_itens.un`,
-- `saida_itens.un` e `perdas.un` sao `text not null default 'KG'` e aceitam
-- texto livre desde a 009 — verificado em pg_constraint, nao suposto. Nao e
-- escopo desta migration acrescenta-los (seria mudanca de invariante, com
-- discussao propria); fica registrado que a lista de unidades e imposta pelo
-- banco em UM lugar so, e nos outros tres apenas pela UI.
--
-- `alterado_em` NAO e tocado de proposito, em nenhuma tabela. Aquela coluna
-- responde "quando uma pessoa mexeu neste cadastro"; esta troca e uma decisao
-- de esquema que passou por cima de todos de uma vez. Bumpar a data faria 40
-- produtos parecerem editados a mao no mesmo segundo, e apagaria a data real
-- da ultima edicao de cada um. Pelo mesmo motivo nada e gravado em
-- `historico_cadastros` (017): aquele log registra o que uma PESSOA declarou
-- ao salvar pela tela, e nao ha pessoa nem declaracao aqui.

-- ------------------------------------------------------- 1. solta o CHECK
alter table produtos drop constraint produtos_un_check;

-- ------------------------------------------- 2. fecha a janela de escrita
lock table entrada_itens, saida_itens, perdas in share row exclusive mode;

-- ------------------------------------------------- 3. converte o que HOUVER
alter table produtos      no force row level security;
alter table entrada_itens no force row level security;
alter table saida_itens   no force row level security;
alter table perdas        no force row level security;

update produtos      set un = 'BDJA' where un = 'DZ';
update entrada_itens set un = 'BDJA' where un = 'DZ';
update saida_itens   set un = 'BDJA' where un = 'DZ';
update perdas        set un = 'BDJA' where un = 'DZ';

alter table produtos      force row level security;
alter table entrada_itens force row level security;
alter table saida_itens   force row level security;
alter table perdas        force row level security;

-- ---------------------------------------------------- 4. aperta o CHECK novo
-- 'BDJA' entra na posicao exata em que 'DZ' estava — a lista e a mesma, com
-- um nome trocado. O `add constraint` valida as linhas ja gravadas: se
-- sobrasse um 'DZ' em `produtos`, a migration inteira falharia aqui e faria
-- rollback, em vez de deixar dado invalido para tras.
alter table produtos
  add constraint produtos_un_check check (un in ('KG','CX','UN','BDJA','MC'));
