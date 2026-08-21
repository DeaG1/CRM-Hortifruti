-- O slug identifica a empresa no subdominio: velasqui.seucrm.com.br
--
-- Formato restrito a minusculas, numeros e hifen porque ele vira rotulo de DNS.
-- Subdominio com acento, espaco ou maiuscula ou nao resolve, ou vira punycode
-- (xn--...) — e o cliente recebe um endereco impossivel de ditar por telefone.
--
-- Alguns valores tambem sao barrados: `www` e `api` colidem com uso reservado,
-- e uma empresa cadastrada com um deles receberia um link que nunca chega ao
-- login. O erro so apareceria no dia em que esse cliente tentasse entrar, e o
-- sintoma nao aponta para a causa.
--
-- O front tambem ignora esses valores (web/src/slugDaEmpresa.ts), mas validar
-- ali sozinho protege apenas quem passa pelo front. Aqui a regra vale para
-- qualquer caminho de escrita — inclusive o cadastro manual, feito hoje direto
-- no banco.

alter table tenants
  add constraint tenants_slug_formato
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$');

alter table tenants
  add constraint tenants_slug_nao_reservado
  check (slug not in ('www', 'api', 'admin', 'assets', 'static', 'public', 'app', 'mail'));
