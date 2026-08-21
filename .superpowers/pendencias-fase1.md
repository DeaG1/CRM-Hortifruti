# Pendências a consolidar quando os agentes de tela terminarem

## N+1 em FornecedoresLista
`GET /api/fornecedores` não devolve os produtos vinculados (só `GET /:id` devolve),
então a tela busca o detalhe de cada fornecedor em paralelo. Com 30 fornecedores são
31 requisições, e cada ida ao banco custa ~116ms medidos.
**Correção:** agregar os vínculos no `GET /` da API (um `left join` com
`array_agg`), e a tela passa a fazer uma requisição só.

## DELETE de produto em uso devolve 500
FK é `restrict` (correto — apagar produto usado orfanaria histórico), mas o SQLSTATE
23503 não está mapeado em `respostaDeErroPg`. Cai no `onError` genérico.
**Correção:** mapear 23503 para 409 com mensagem "este produto tem movimentação e não
pode ser excluído".

## `dataParaTexto` duplicado
Dois agentes escreveram independentemente a mesma conversão (coluna `date` volta como
objeto `Date` e serializa como timestamp ISO, quebrando o formato que a própria API
exige na entrada). Está em `lancamentos.ts` e `saidas.ts`.
**Correção:** extrair para helper compartilhado — é contrato de API, não detalhe de rota.
