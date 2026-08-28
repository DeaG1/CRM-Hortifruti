import { dataBrCurta } from './pagamento'

/**
 * MEMÓRIA DE PREÇO POR CLIENTE — a decisão, isolada da tela.
 *
 * O sistema não guarda tabela de preço: preço de hortifruti muda quase todo
 * dia, e tabela desatualizada é pior que tabela nenhuma, porque parece
 * confiável. O que existe é MEMÓRIA — o que já foi cobrado daquele cliente
 * naquele produto, lido do próprio histórico de saídas
 * (`GET /api/saidas/ultimos-precos/:clienteId`).
 *
 * As três regras que este arquivo carrega, e que a tela só exibe:
 *
 *  1. SEM HISTÓRICO, CAMPO VAZIO. Nunca o preço de outro cliente, nunca uma
 *     média. Sugestão errada num campo de dinheiro é pior que campo vazio: o
 *     vazio faz a pessoa pensar, o número errado faz ela clicar em salvar.
 *
 *  2. A MEMÓRIA SÓ ESCREVE ONDE NINGUÉM DIGITOU. Preencher item novo é
 *     ajudar; sobrescrever o que a pessoa colocou à mão é destruir trabalho.
 *     `precoAutomatico` marca o valor que a própria memória escreveu — só
 *     esse pode ser reescrito ou apagado depois (ver `aplicarMemoriaNaLinha`).
 *
 *  3. PREÇO É POR UNIDADE. "R$ 30,00" de uma caixa e "R$ 30,00" de um quilo
 *     são números diferentes. A memória é indexada por (produto, unidade) e
 *     só preenche uma linha cuja unidade BATE com a da venda lembrada — a
 *     alternativa (preencher assim mesmo) poria um preço de caixa num campo
 *     de quilo, que é justamente o "número errado num campo de dinheiro" que
 *     a regra 1 existe para evitar.
 */

/** Uma linha da resposta de `GET /api/saidas/ultimos-precos/:clienteId`. */
export interface PrecoLembrado {
  produto_id: string
  /** Unidade em que aquela venda foi lançada ('KG','CX','UN','BDJA','MC'
   * — ver `UNIDADES` em derive/produtos.ts, a lista única). */
  un: string
  /** Preço por unidade cobrado naquela venda. A API nunca devolve 0 aqui. */
  preco: number
  /** Data do PEDIDO daquela venda, 'AAAA-MM-DD' — quando o preço foi acordado. */
  data: string
  /** Número da saída. Serve ao desempate (ver `maisRecente`). */
  numero: string
}

/**
 * A memória já indexada para consulta pela tela. Duas visões do MESMO
 * conjunto de linhas, porque preencher e informar são decisões diferentes:
 *
 *  - `porProdutoEUn`: usada para PREENCHER. Só bate quando a unidade da linha
 *    do formulário é a mesma da venda lembrada (regra 3).
 *  - `porProduto`: usada para INFORMAR. Traz a venda mais recente daquele
 *    produto em QUALQUER unidade, para a nota poder dizer "último: R$ 30,00/CX
 *    em 12/08" mesmo numa linha em KG — o usuário fica sabendo que existe
 *    histórico e por que o campo está vazio, em vez de não ver nada.
 */
export interface MemoriaPreco {
  porProdutoEUn: Map<string, PrecoLembrado>
  porProduto: Map<string, PrecoLembrado>
}

/** Memória de um cliente sem nenhuma compra — e também o estado enquanto a
 * busca não respondeu ou falhou. Nos três casos o efeito é o mesmo e é o
 * certo: nada é preenchido. */
export const MEMORIA_VAZIA: MemoriaPreco = {
  porProdutoEUn: new Map(),
  porProduto: new Map(),
}

/** Chave de (produto, unidade) — mesma forma de chave que a API usa no
 * `distinct on` e que `buscarEstoque` (api/src/routes/estoque.ts) usa para
 * agrupar movimentação, pelo mesmo motivo: a unidade lançada faz parte da
 * identidade da linha. */
export function chaveProdutoUn(produtoId: string, un: string): string {
  return produtoId + '|' + un
}

/**
 * Qual das duas vendas é a mais recente. Data primeiro; EMPATE DE DATA
 * DESEMPATA PELO NÚMERO da saída, exatamente a mesma regra do `order by` da
 * consulta (api/src/routes/saidas.ts).
 *
 * Duas vendas para o mesmo cliente no mesmo dia são comuns, e sem desempate
 * explícito o resultado passaria a depender da ordem em que o array chegou —
 * o defeito que já apareceu neste projeto na variação de preço por
 * fornecedor (commit f8e2954, `maisRecentePrimeiro` em derive/fornecedores.ts
 * nasceu dele). As duas pontas usam a MESMA regra de propósito: se
 * divergissem, a nota exibida poderia falar de uma venda e o preenchimento
 * usar outra.
 *
 * Comparação lexicográfica: 'AAAA-MM-DD' ordena igual à ordem cronológica, e
 * `numero` é texto por natureza ('S-0001').
 */
function maisRecente(a: PrecoLembrado, b: PrecoLembrado): PrecoLembrado {
  if (a.data !== b.data) return a.data > b.data ? a : b
  return a.numero >= b.numero ? a : b
}

/**
 * Monta as duas visões a partir da resposta crua da API.
 *
 * Não confia na ordem em que as linhas vieram: `porProdutoEUn` já vem com uma
 * linha por chave da API, mas `porProduto` precisa ESCOLHER entre unidades
 * diferentes do mesmo produto, e essa escolha é feita aqui por `maisRecente`,
 * não pela posição no array.
 */
export function montarMemoriaPreco(linhas: PrecoLembrado[]): MemoriaPreco {
  const porProdutoEUn = new Map<string, PrecoLembrado>()
  const porProduto = new Map<string, PrecoLembrado>()
  for (const linha of linhas) {
    const chave = chaveProdutoUn(linha.produto_id, linha.un)
    const jaTem = porProdutoEUn.get(chave)
    porProdutoEUn.set(chave, jaTem ? maisRecente(jaTem, linha) : linha)

    const doProduto = porProduto.get(linha.produto_id)
    porProduto.set(linha.produto_id, doProduto ? maisRecente(doProduto, linha) : linha)
  }
  return { porProdutoEUn, porProduto }
}

/** O que a memória precisa enxergar de uma linha de item do formulário —
 * tipo raso por consumidor, mesmo padrão de `SaidaParaLimite`
 * (derive/pagamento.ts): não é o `ItemLinha` inteiro de ModalSaida.tsx. */
export interface LinhaComPreco {
  produto_id: string
  un: string
  /** `''` enquanto o campo está vazio — nunca 0 (ver ModalSaida.tsx). */
  preco: number | string
  /** true quando o valor em `preco` foi escrito pela memória e ninguém
   * digitou por cima. É esta marca, e só ela, que autoriza a memória a
   * reescrever ou apagar o campo depois. */
  precoAutomatico: boolean
}

/** Campo de preço "livre para a memória escrever": vazio, ou ocupado por um
 * valor que a própria memória pôs ali. Um `0` gravado (item vindo de uma
 * saída salva) NÃO é vazio — é dado do banco, e não se mexe nele. */
function memoriaPodeEscrever(linha: LinhaComPreco): boolean {
  return linha.precoAutomatico || linha.preco === '' || linha.preco === null || linha.preco === undefined
}

/**
 * Aplica a memória a UMA linha de item, devolvendo a linha resultante.
 *
 * Chamada nos três momentos em que a resposta pode mudar: ao escolher o
 * produto, ao trocar a unidade da linha, e ao trocar o cliente da venda
 * (aí para todas as linhas de uma vez — `aplicarMemoriaNasLinhas`).
 *
 * - Campo digitado à mão (`precoAutomatico === false` e não vazio): devolve a
 *   linha INTACTA, sempre. É a regra 2, e é ela que faz a troca de cliente no
 *   meio do preenchimento não destruir trabalho.
 * - Campo livre + existe memória para (produto, unidade): preenche e marca
 *   `precoAutomatico`.
 * - Campo livre + NÃO existe memória: se havia um valor automático ali (o
 *   preço do cliente ANTERIOR, por exemplo), ele é APAGADO. Deixá-lo seria
 *   pior que não ter preenchido nada — seria mostrar, sob o nome do cliente
 *   novo, um preço que nunca foi cobrado dele.
 */
export function aplicarMemoriaNaLinha<T extends LinhaComPreco>(linha: T, memoria: MemoriaPreco): T {
  if (!memoriaPodeEscrever(linha)) return linha

  const lembrado = memoria.porProdutoEUn.get(chaveProdutoUn(linha.produto_id, linha.un))
  if (lembrado) {
    if (linha.preco === lembrado.preco && linha.precoAutomatico) return linha
    return { ...linha, preco: lembrado.preco, precoAutomatico: true }
  }
  if (!linha.precoAutomatico) return linha
  return { ...linha, preco: '', precoAutomatico: false }
}

/** `aplicarMemoriaNaLinha` em todas as linhas — usada quando o CLIENTE muda,
 * porque aí a memória inteira mudou de dono. Regra única: mesma função, item
 * a item. Quem digitou continua com o que digitou. */
export function aplicarMemoriaNasLinhas<T extends LinhaComPreco>(
  linhas: T[],
  memoria: MemoriaPreco,
): T[] {
  return linhas.map(linha => aplicarMemoriaNaLinha(linha, memoria))
}

/**
 * A nota discreta sob o campo de preço — "último: R$ 4,20/KG em 12/08".
 *
 * A DATA NÃO É ENFEITE: é o que separa "preço de ontem" de "preço de três
 * meses atrás". Um preço antigo preenchido em silêncio faz vender pelo valor
 * errado; com a data à vista quem está no balcão decide. A unidade entra pelo
 * mesmo motivo — sem ela, "R$ 30,00" não diz se é o quilo ou a caixa.
 *
 * `null` quando não há memória nenhuma para o produto: aí não há o que dizer,
 * e a tela não desenha nada (mesma convenção de `infoPagamento`,
 * derive/pagamento.ts — ausência de dado não vira travessão nem texto vazio).
 *
 * Montar a frase aqui, e não na tela, segue `infoPagamento`: a regra do que a
 * nota diz é decisão, não formatação de layout, e mora junto do resto da
 * decisão. `dataBrCurta` vem de derive/pagamento.ts em vez de um segundo
 * formatador de data.
 */
export function notaUltimoPreco(lembrado: PrecoLembrado | null | undefined): string | null {
  if (!lembrado) return null
  const data = dataBrCurta(lembrado.data)
  const valor = 'R$ ' + lembrado.preco.toFixed(2).replace('.', ',')
  const base = `último: ${valor}/${lembrado.un}`
  return data ? `${base} em ${data}` : base
}
