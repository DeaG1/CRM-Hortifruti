import {
  quantidadeNaUnidade, dinheiroFolha, dataPorExtensoFolha, contagemPorExtenso,
} from './folha'
import { dataBrCurta, situacaoExibidaSaida } from './pagamento'
import type { LinhaRomaneio, RespostaRomaneio } from './romaneio'

/**
 * A FOLHA DE ENTREGA — a via que O CLIENTE confere e assina ao receber.
 *
 * ===================== ELA NÃO É O ROMANEIO, E A DIFERENÇA É QUEM SEGURA
 *
 * O romaneio (derive/romaneio.ts) é do MOTORISTA: todas as entregas de um dia,
 * agrupadas por cliente, para conferir o caminhão antes de sair. Esta folha é
 * do CLIENTE: UM pedido, o dele, que ele confere item a item na porta e assina
 * reconhecendo o que recebeu.
 *
 * Três consequências saem daí, e todas contrariam o romaneio de propósito:
 *
 *   1. UM PEDIDO POR FOLHA. Não é agrupamento por cliente: é recorte por
 *      pedido. Quem assina reconhece uma entrega, não um dia de entregas — e
 *      duas entregas na mesma folha assinada seriam duas cobranças presas a
 *      uma assinatura só.
 *
 *   2. VALOR ENTRA POR PADRÃO. No romaneio preço vem desmarcado porque a folha
 *      leva vários clientes juntos e um lê o preço do outro (ver
 *      `CAMPOS_ROMANEIO`). Aqui o cliente é UM, o preço é o DELE, e é o que
 *      sustenta a cobrança numa divergência: a assinatura sem valor reconhece
 *      "recebi caixas", não "recebi R$ 1.240,00 em mercadoria".
 *
 *   3. ROTA, STATUS, PERDA E MOTIVO FICAM DE FORA. São gestão, e já estão no
 *      romaneio. Rota especialmente: é logística interna — o cliente não tem o
 *      que fazer com "Sul A", e informação que o leitor não pode usar só
 *      compete por espaço com a que ele precisa conferir.
 *
 * A SITUAÇÃO DE PAGAMENTO ENTRA por um motivo operacional, não decorativo: o
 * motorista decide NA PORTA se recolhe dinheiro. Uma folha que não diz se o
 * pedido já foi pago transforma essa decisão num telefonema, e o telefonema
 * que não acontece vira mercadoria entregue sem cobrança.
 *
 * ============================== CANCELADO E DEVOLVIDO NÃO GANHAM FOLHA
 *
 * E não precisam ser filtrados aqui: `GET /api/saidas/romaneio/:data` já os
 * deixa de fora na consulta (`status not in ('Cancelado','Devolvido')`, o
 * mesmo filtro da CTE `said` de estoque.ts), então nenhum deles chega a este
 * módulo. A decisão é a mesma do romaneio e vale ainda mais forte aqui: uma
 * venda cancelada nunca aconteceu e uma devolvida voltou para a prateleira —
 * imprimir folha de entrega de qualquer uma delas produziria um RECIBO
 * ASSINADO de mercadoria que ninguém entregou, que é exatamente o documento
 * capaz de sustentar uma cobrança errada. Repetir a regra aqui criaria um
 * segundo lugar de onde ela pode divergir; `montarFolhaEntrega` devolve `null`
 * para um pedido que não está na resposta, e a tela diz isso.
 *
 * ================================ QUANTIDADE NA UNIDADE LANÇADA
 *
 * `qtd` + `un` cruas, sem conversão nenhuma para quilos — a mesma regra do
 * romaneio e de 88318ee. O cliente confere CAIXA na porta, e "12 CX" é o que
 * ele consegue contar; "204 kg" não é conferível por ninguém.
 *
 * Molde de derive/romaneio.ts: funções puras, sem React, sem fetch, sem
 * `new Date()` — quem precisa de "hoje" recebe a data por parâmetro.
 */

// ============================================================ o que a folha diz

/** Um item já formatado para a folha de entrega. */
export interface ItemEntrega {
  id: string
  produto: string
  /** Sempre presente: "45 UN" — na unidade em que foi lançado. */
  quantidade: string
  /** `null` quando não há preço registrado (ver `dinheiroFolha`). */
  precoUnitario: string | null
  /** `null` pelo mesmo motivo de `precoUnitario`. */
  total: string | null
}

/**
 * O bloco de pagamento do rodapé — as três coisas que o motorista precisa ler
 * na porta, separadas porque a folha as desenha em pesos diferentes.
 */
export interface PagamentoEntrega {
  /** 'Pendente' | 'Pago' | 'Atrasado' | '—' — DERIVADA (`situacaoExibidaSaida`),
   * nunca o `pag` cru: um pedido pendente com vencimento na semana passada é
   * "Atrasado" mesmo que ninguém tenha trocado o valor gravado. */
  situacao: string
  /** "vence em 05/09/2026 · Boleto" — `''` quando não há nada a acrescentar. */
  detalhe: string
  /** A instrução em caixa alta, que é o que se lê de longe com a folha na mão.
   * É a razão de a situação de pagamento estar nesta folha. */
  aviso: string
}

/** A folha inteira, pronta para o componente imprimir. */
export interface FolhaEntrega {
  pedidoId: string
  /** "#1001" — `null` só se a venda tiver sido gravada sem número. */
  numero: string | null
  cliente: string
  endereco: string | null
  telefone: string | null
  /** ISO do dia da ENTREGA (o dia pedido à API), como veio. */
  dataEntrega: string
  /** "sexta-feira, 28/08/2026", ou `null` se a data for impossível. */
  dataPorExtenso: string | null
  itens: ItemEntrega[]
  totalItens: number
  /** `null` quando nenhum item tem preço registrado — nunca "R$ 0,00". */
  totalPedido: string | null
  pagamento: PagamentoEntrega
}

/** Uma opção do seletor "qual pedido" — ver `pedidosDoDia`. */
export interface OpcaoPedido {
  id: string
  numero: string
  cliente: string
  totalItens: number
}

/** Rótulo do bloco quando a venda perdeu o vínculo com o cadastro
 * (`saidas.cliente_id` é `on delete set null`, migration 014). O mesmo texto
 * do romaneio, pelo mesmo motivo: a mercadoria continua sendo entregue a
 * alguém, e sumir da folha é pior que sair sem nome. */
export const SEM_CLIENTE_ENTREGA = 'Sem cliente vinculado'

/** O que vale como texto preenchido — campo em branco no cadastro (o default
 * de `clientes.endereco` é `''`) não é dado e não ocupa linha na folha. */
function texto(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim()
  return t === '' ? null : t
}

// =========================================================== o pagamento

/**
 * O bloco de pagamento — a parte da folha que muda o que o motorista FAZ.
 *
 * A situação vem de `situacaoExibidaSaida` (derive/pagamento.ts), o mesmo
 * cálculo do chip de Saídas: 'Atrasado' é CALCULADO a partir do vencimento,
 * não escolhido à mão. Duas cópias dessa regra é como as duas telas passam a
 * discordar, e discordar aqui significa uma folha impressa dizendo "Pendente"
 * sobre uma dívida que o sistema já trata como atrasada.
 *
 * O AVISO EM CAIXA ALTA não é enfeite: é a única linha da folha que o
 * motorista precisa ler de longe, com a prancheta numa mão e a caixa na outra.
 * "Pendente" é um estado; "RECEBER NA ENTREGA" é uma instrução, e é instrução
 * que se executa na porta.
 *
 * O vencimento sai por extenso COM ANO (`dataBrCurta` + o ano, igual à data
 * grande do topo — ver `dataPorExtensoFolha`): esta folha é arquivada pelo
 * cliente e "05/09" sozinho num arquivo morto não diz de que ano é.
 */
export function pagamentoDaEntrega(
  pag: string | null | undefined,
  venc: string | null | undefined,
  formaPag: string | null | undefined,
  hojeIso: string,
): PagamentoEntrega {
  const situacao = situacaoExibidaSaida((pag ?? '').trim() || 'Pendente', venc, hojeIso)
  const forma = texto(formaPag)
  const vencimento = dataBrCurta(venc)
  const anoVenc = String(venc ?? '').slice(0, 4)
  const vencCompleto = vencimento && /^\d{4}$/.test(anoVenc) ? `${vencimento}/${anoVenc}` : null

  const partes: string[] = []
  if (situacao !== 'Pago' && vencCompleto) {
    // "venceu" no passado e "vence" no futuro: o tempo verbal é o que faz a
    // linha ser lida como cobrança em atraso sem precisar de outra palavra.
    partes.push(situacao === 'Atrasado' ? `venceu em ${vencCompleto}` : `vence em ${vencCompleto}`)
  }
  if (forma) partes.push(forma)

  const aviso = situacao === 'Pago'
    ? 'JÁ PAGO — NÃO RECEBER NA ENTREGA'
    : situacao === '—'
      // '—' é "não se aplica" (o valor que pedido cancelado/devolvido carrega,
      // ver SaidasLista). Não deveria chegar aqui — a consulta já os exclui —,
      // mas se chegar, a folha não pode mandar cobrar por engano.
      ? 'PAGAMENTO NÃO SE APLICA'
      : 'RECEBER NA ENTREGA'

  return { situacao, detalhe: partes.join(' · '), aviso }
}

// =========================================================== a folha montada

/**
 * Monta a folha de UM pedido a partir da resposta do dia.
 *
 * `null` quando o pedido não está na resposta — e esse caso não é um erro a
 * esconder: acontece quando o pedido foi cancelado, devolvido ou teve a data
 * de entrega mudada enquanto a tela estava aberta. A tela mostra a frase, em
 * vez de imprimir uma folha vazia com a assinatura do cliente no pé.
 *
 * O CLIENTE, O ENDEREÇO E O TELEFONE saem da PRIMEIRA linha do pedido: o join
 * da consulta repete o cadastro em toda linha do mesmo `saida_id`, então
 * qualquer uma serve e a primeira é a que existe sempre.
 */
export function montarFolhaEntrega(
  resposta: RespostaRomaneio,
  pedidoId: string,
  hojeIso: string,
): FolhaEntrega | null {
  const todas = Array.isArray(resposta?.itens) ? resposta.itens : []
  const linhas = todas.filter(l => l && l.saida_id === pedidoId)
  if (linhas.length === 0) return null

  const cabecalho = linhas[0] as LinhaRomaneio
  const itens: ItemEntrega[] = []
  let soma = 0

  for (const linha of linhas) {
    const totalDoItem = linha.qtd * linha.preco
    itens.push({
      id: linha.item_id,
      produto: texto(linha.produto) ?? '—',
      quantidade: quantidadeNaUnidade(linha.qtd, linha.un),
      precoUnitario: dinheiroFolha(linha.preco),
      total: dinheiroFolha(totalDoItem),
    })
    // Item sem preço registrado não derruba o total do pedido: ele soma zero e
    // sai com travessão na própria linha. Somar `NaN` apagaria o total inteiro
    // por causa de uma linha, que é o oposto do que a folha precisa dizer.
    if (Number.isFinite(totalDoItem) && totalDoItem > 0) soma += totalDoItem
  }

  return {
    pedidoId,
    numero: texto(cabecalho.numero),
    cliente: texto(cabecalho.cliente_nome) ?? SEM_CLIENTE_ENTREGA,
    endereco: texto(cabecalho.cliente_endereco),
    telefone: texto(cabecalho.cliente_tel),
    dataEntrega: resposta?.data ?? '',
    dataPorExtenso: dataPorExtensoFolha(resposta?.data),
    itens,
    totalItens: itens.length,
    totalPedido: dinheiroFolha(soma),
    pagamento: pagamentoDaEntrega(
      cabecalho.pag, cabecalho.venc, cabecalho.forma_pag, hojeIso,
    ),
  }
}

/**
 * Os pedidos do dia, para o seletor "de qual pedido é a folha".
 *
 * ORDEM DE ENCONTRO, que é a da consulta (`order by s.numero, i.id`): num
 * seletor procura-se pelo NÚMERO, e a ordem por número é a única que o leitor
 * consegue antecipar. O romaneio ordena por rota e depois por cliente porque
 * ali a ordem é a do caminhão; aqui não há caminhão nenhum, há uma lista para
 * achar um item.
 *
 * O nome do cliente vai junto no rótulo porque o número sozinho não confirma
 * que se escolheu o pedido certo — e a folha errada assinada pelo cliente
 * errado é o defeito caro desta tela.
 */
export function pedidosDoDia(resposta: RespostaRomaneio | null | undefined): OpcaoPedido[] {
  const linhas = Array.isArray(resposta?.itens) ? resposta.itens : []
  const porId = new Map<string, OpcaoPedido>()
  for (const linha of linhas) {
    if (!linha) continue
    const atual = porId.get(linha.saida_id)
    if (atual) {
      atual.totalItens += 1
      continue
    }
    porId.set(linha.saida_id, {
      id: linha.saida_id,
      numero: texto(linha.numero) ?? 'sem número',
      cliente: texto(linha.cliente_nome) ?? SEM_CLIENTE_ENTREGA,
      totalItens: 1,
    })
  }
  return [...porId.values()]
}

/** O rótulo de uma opção do seletor: "#1001 · Mercado Boa Safra (12 itens)". */
export function rotuloDoPedido(opcao: OpcaoPedido): string {
  return `${opcao.numero} · ${opcao.cliente}`
    + ` (${contagemPorExtenso(opcao.totalItens, 'item', 'itens')})`
}

/** A frase de conferência do topo: "12 itens · Pedido #1001". */
export function resumoFolhaEntrega(folha: FolhaEntrega): string {
  const itens = contagemPorExtenso(folha.totalItens, 'item', 'itens')
  return folha.numero ? `${itens} · Pedido ${folha.numero}` : itens
}

// ================================================== UMA FOLHA SÓ, SEMPRE

/**
 * ================== O REQUISITO DURO: UMA FOLHA, SEMPRE — E O QUE ELE CUSTA
 *
 * Palavras do dono: "quando não couber vai ter que caber de alguma forma,
 * qualquer coisa diminua a letra". Ele decidiu; isto implementa.
 *
 * MAS ENCOLHE SÓ QUANDO PRECISA. O maior pedido real dele tem 44 itens e o
 * segundo tem 21 — no volume do dia a dia a folha sai no tamanho confortável
 * que e2e9968 fixou (12px no corpo, quadradinho de 4mm). Encolher tudo por
 * causa do caso raro puniria o uso normal, que é o uso de todo dia.
 *
 * Por isso a redução é MEDIDA, não estimada por contagem de itens: o
 * componente renderiza a folha na geometria do papel, mede a altura contra a
 * altura útil da página e só então decide o corpo de letra. Nome de produto
 * comprido, observação longa e endereço em duas linhas mudam a altura sem
 * mudar a contagem de itens — uma tabela "N itens → tal corpo" erraria em
 * todos esses casos, e erraria em silêncio.
 *
 * ---- ONDE ISTO PARA DE SER LEGÍVEL, E POR QUE O CÓDIGO NÃO PARA ----
 *
 * Existe um ponto em que a letra fica ilegível, e ele não é uma opinião: abaixo
 * de 6px (4,5pt) a folha deixa de ser conferível por quem está de pé na porta
 * de um mercado, e o quadradinho de marcar fica menor que a ponta da caneta.
 * O código NÃO para de encolher — a instrução do dono é explícita —, mas
 * `avisoDeLegibilidade` diz na tela, em cada impressão, em que corpo a folha
 * saiu e a partir de onde ela deixou de servir. Um limite silencioso dentro do
 * código seria a decisão dele tomada por outro; um aviso é a informação que
 * falta para ele decidir de novo.
 *
 * ONDE CADA MARCO CAI, MEDIDO (Chrome headless, PDF contado, catálogo de
 * nomes reais, um cliente com endereço e telefone):
 *
 *     até 24 itens ... 12px, UMA coluna     50 itens ... 10px
 *     25 a 40 itens .. 12px, DUAS colunas   55 itens ....9px
 *     42 itens ...... 11,5px               65 itens ....8px
 *     44 itens ...... 11px  (o maior pedido real do dono)
 *     46 a 48 itens . 10,5px               80 itens ....7px
 *                                          90 itens ....6px  <- o piso
 *                                         100 itens ...5,5px
 *                                         120 itens ...4,5px
 *                                         150 itens ...4px
 *                                         200 itens ...3px
 *
 * OS DOIS PEDIDOS REAIS DELE SAEM INTEIROS: o de 21 itens em 12px e uma
 * coluna; o de 44 em 11px e duas colunas. A folha só deixa de ser conferível
 * A PARTIR DE 91 ITENS — daí para baixo ela continua saindo em uma página,
 * como ele pediu, mas ninguém consegue conferir item a item nela.
 */

/** O corpo confortável — o piso que e2e9968 fixou e que o dia a dia usa. */
export const CORPO_CONFORTAVEL = 12

/** Abaixo disto a folha deixa de ser conferível na prática. NÃO é um limite:
 * o código continua encolhendo, e a tela avisa. Ver o bloco acima. */
export const CORPO_ILEGIVEL = 6

/** O passo da redução. Meio pixel: passo de 1px pularia de "cabe folgado"
 * para "cabe apertado" e desperdiçaria legibilidade num salto. */
export const PASSO_CORPO = 0.5

/**
 * O MENOR CORPO QUE O ALGORITMO CHEGA A PEDIR — e o único limite que existe
 * neste mecanismo, dito aqui em voz alta porque limite silencioso é o que não
 * se pode ter numa promessa como "sempre uma folha só".
 *
 * Ele é meio pixel: o menor valor da própria grade de redução (`PASSO_CORPO`),
 * e não um número escolhido por gosto. A busca precisa de um fim para terminar
 * — sem ele, um conteúdo alto o bastante faria o laço descer para sempre.
 *
 * O QUE ISSO CUSTA, MEDIDO: a folha real gasta aproximadamente 600 unidades de
 * "corpo × itens" (200 itens saem em 3px, 100 em 5,5px, 44 em 11px). Meio
 * pixel dá conta de cerca de 1.200 itens numa página. Acima disso a folha
 * passaria de uma página — e, muito antes disso, ela já deixou de ser legível
 * (ver `CORPO_ILEGIVEL`: isso acontece perto dos 90 itens). Ou seja: o limite
 * existe, e ele mora tão além do ponto em que a folha perde a serventia que
 * nunca é ele quem decide nada.
 */
export const CORPO_MINIMO = PASSO_CORPO

/** A4 retrato menos as margens de `@page folha` (10mm nas laterais, 10mm no
 * topo, 12mm no pé — ver FolhaImpressa.css). */
export const LARGURA_UTIL_MM = 190
export const ALTURA_UTIL_MM = 275

/**
 * A FOLGA. A altura da caixa de página que o Chrome monta é arredondada, e uma
 * folha que mede exatamente a altura útil é uma folha que às vezes vira duas.
 * 2mm custam nada em corpo de letra e compram a diferença entre "mediu certo"
 * e "imprimiu certo" — e o requisito é sobre o PAPEL, não sobre a medição.
 */
export const FOLGA_MM = 2

/** 1mm em px de CSS (que são 1/96 de polegada por definição). */
export const PX_POR_MM = 96 / 25.4

/** A altura, em px de CSS, em que a folha tem de caber. */
export function alturaUtilPx(): number {
  return (ALTURA_UTIL_MM - FOLGA_MM) * PX_POR_MM
}

/** A largura útil da página, em px de CSS — a largura em que a medição precisa
 * acontecer para medir a folha impressa, e não a folha da tela. */
export function larguraUtilPx(): number {
  return LARGURA_UTIL_MM * PX_POR_MM
}

/** O fator de `zoom` que produz um dado corpo de letra. `zoom` (e não
 * `transform: scale`) porque só ele muda o LAYOUT: um `scale` desenharia a
 * folha menor e continuaria ocupando duas páginas. */
export function escalaDoCorpo(corpo: number): number {
  return corpo / CORPO_CONFORTAVEL
}

/** Arredonda para baixo no passo da redução — sempre para BAIXO, porque
 * arredondar para cima é como uma folha "que cabia" vira duas. */
function noPasso(corpo: number): number {
  return Math.floor(corpo / PASSO_CORPO) * PASSO_CORPO
}

/**
 * O CORPO DE LETRA QUE FAZ A FOLHA CABER EM UMA PÁGINA.
 *
 * Recebe `medir` — uma função que renderiza a folha num dado corpo e devolve a
 * altura resultante — e devolve o maior corpo que cabe em `alturaUtil`. É a
 * metade pura do mecanismo: quem toca o DOM é o componente, e isto aqui pode
 * ser testado com um `medir` sintético, sem navegador.
 *
 * ---- POR QUE ESTIMATIVA LINEAR, E NÃO UM PASSO DE CADA VEZ ----
 *
 * `zoom` multiplica TODOS os comprimentos, então a altura é quase linear no
 * corpo: de uma medição sai a estimativa `corpo * alturaÚtil / alturaMedida`,
 * que acerta em uma ou duas voltas mesmo numa folha de 200 itens. Descer de
 * meio em meio pixel a partir de 12 custaria doze medições para chegar em 6, e
 * cada medição é um reflow de uma tabela inteira.
 *
 * O "quase" é o que exige o laço: quando a letra encolhe, um nome de produto
 * que quebrava em duas linhas passa a caber em uma, e a folha encolhe MAIS que
 * o previsto (nunca menos). O laço mede de novo e aceita o resultado; o
 * `corpo - PASSO_CORPO` garante que cada volta desce pelo menos um passo, para
 * a busca não empacar num ponto fixo.
 *
 * ---- ALTURA ZERO NÃO É "CABE" ----
 *
 * Em ambiente sem layout (jsdom, nos testes de componente) toda medição
 * devolve 0. Isso NÃO pode ser lido como "coube com folga": lido assim, um
 * defeito de medição no navegador de verdade viraria uma folha que não encolhe
 * e sai em três páginas, sem nada denunciando. Altura não positiva ou não
 * finita devolve o corpo confortável e não encolhe nada — o comportamento
 * seguro é o do dia a dia, não o do caso raro.
 */
export function corpoQueCabe(
  medir: (corpo: number) => number,
  alturaUtil: number,
  maxVoltas = 12,
): number {
  let corpo = CORPO_CONFORTAVEL
  let altura = medir(corpo)
  if (!Number.isFinite(altura) || altura <= 0) return CORPO_CONFORTAVEL
  if (!Number.isFinite(alturaUtil) || alturaUtil <= 0) return CORPO_CONFORTAVEL
  if (altura <= alturaUtil) return CORPO_CONFORTAVEL

  for (let volta = 0; volta < maxVoltas; volta++) {
    const estimado = noPasso(corpo * (alturaUtil / altura))
    corpo = Math.max(CORPO_MINIMO, Math.min(estimado, corpo - PASSO_CORPO))
    altura = medir(corpo)
    if (!Number.isFinite(altura) || altura <= 0) return corpo
    if (altura <= alturaUtil) return corpo
    if (corpo <= CORPO_MINIMO) return CORPO_MINIMO
  }
  return corpo
}

/**
 * ========================= DUAS COLUNAS ANTES DE ENCOLHER A LETRA
 *
 * Encolher é o último recurso, não o primeiro. Antes dele existe uma folga que
 * não custa legibilidade nenhuma: a folha é A4 RETRATO, e uma linha de item
 * ocupa pouco mais da metade dela. Partir a lista ao meio dobra a capacidade
 * com a MESMA letra — é o que 201e289 já provou no romaneio.
 *
 * A diferença aqui é que a folha de entrega carrega PREÇO e TOTAL por item, e
 * o comentário de `.folha-tabela--duas` (FolhaImpressa.css) diz que, no
 * romaneio, ligar esses dois campos derruba as duas colunas. Então foi MEDIDO
 * de novo, para esta folha, no pedido real de 44 itens do dono (Chrome
 * headless, altura útil 1031,8px):
 *
 *   uma coluna    12px = 1593px    11px = 1468    10px = 1348    9px = 1227
 *   duas colunas  12px = 1132px    11px =  876    10px =  749    9px =  681
 *
 * Ou seja: em uma coluna o pedido dele precisa descer a 7px para caber; em
 * duas, cabe com 11px. Não é a mesma folha menor — é a diferença entre uma
 * folha que se confere e uma que não se lê.
 *
 * O que fez as duas colunas caberem COM preço e total foi estreitar as colunas
 * numéricas e deixá-las quebrar (ver `.folha-entrega .folha-tabela--duas` no
 * CSS): com as larguras do romaneio (118px de quantidade, 110px de valor) a
 * tabela transborda a página — medido, 810px numa folha de 718px.
 *
 * A ESCOLHA CONTINUA SENDO MEDIDA, e não decidida por contagem de itens: duas
 * colunas só entram quando UMA não coube no tamanho confortável, e só ficam se
 * a medição confirmar que elas permitem um corpo MAIOR. Nome de produto muito
 * longo pode quebrar em três linhas em meia folha e piorar tudo — e aí a folha
 * volta para uma coluna sozinha, sem ninguém precisar prever o caso.
 */
export interface PlanoDaFolha {
  /** A lista sai partida ao meio, dois itens por linha impressa. */
  duasColunas: boolean
  /** O corpo de letra a aplicar. */
  corpo: number
  /** O corpo que UMA coluna alcançou — a referência contra a qual duas colunas
   * precisam ser melhores para ficar. */
  corpoUmaColuna: number
  /** A escolha de layout já está fechada para esta folha; da próxima medição
   * em diante só o corpo acompanha (fontes que chegaram depois). */
  decidido: boolean
}

/** O ponto de partida de toda folha: uma coluna, tamanho confortável. */
export const PLANO_INICIAL: PlanoDaFolha = Object.freeze({
  duasColunas: false,
  corpo: CORPO_CONFORTAVEL,
  corpoUmaColuna: CORPO_CONFORTAVEL,
  decidido: false,
})

/**
 * A MÁQUINA DE DECISÃO da folha, em uma função pura: recebe o plano em vigor e
 * a altura já traduzida em corpo de letra (`corpoQueCabe` sobre o que está
 * renderizado), e devolve o próximo plano — ou `null` quando não há mais nada
 * a mudar.
 *
 * Fica aqui, e não no componente, por um motivo prático: em ambiente de teste
 * não existe layout, toda medição devolve zero e o caminho de duas colunas
 * nunca seria exercitado. Separada assim, a decisão inteira é testável com
 * medições sintéticas — e o componente vira o que ele deve ser, um laço de
 * três linhas que aplica o que esta função decidiu.
 *
 * A sequência, para uma folha nova:
 *
 *   1. mede em UMA coluna. Coube no confortável? Acabou — é o dia a dia.
 *   2. não coube: passa a DUAS colunas e mede de novo.
 *   3. duas colunas ficaram piores que uma (nome quebrando em três linhas)?
 *      volta para uma. Senão, fica com duas e com o corpo que elas
 *      alcançaram.
 *
 * Depois disso o layout está decidido e só o corpo continua acompanhando a
 * medição, que é o que faz a chegada tardia das fontes da web corrigir a folha
 * em vez de deixá-la no tamanho errado.
 */
export function proximoPlano(plano: PlanoDaFolha, medido: number): PlanoDaFolha | null {
  if (plano.decidido) {
    return plano.corpo === medido ? null : { ...plano, corpo: medido }
  }

  if (!plano.duasColunas) {
    if (medido >= CORPO_CONFORTAVEL) {
      return { ...plano, corpo: medido, corpoUmaColuna: medido, decidido: true }
    }
    return {
      duasColunas: true,
      corpo: CORPO_CONFORTAVEL,
      corpoUmaColuna: medido,
      decidido: false,
    }
  }

  if (medido < plano.corpoUmaColuna) {
    return {
      duasColunas: false,
      corpo: plano.corpoUmaColuna,
      corpoUmaColuna: plano.corpoUmaColuna,
      decidido: true,
    }
  }
  return { ...plano, corpo: medido, decidido: true }
}

/**
 * O QUE A TELA CONTA AO DONO sobre o tamanho em que a folha saiu.
 *
 * `''` quando a folha saiu no corpo confortável — a tela não avisa sobre o que
 * não aconteceu (a mesma regra de `avisoSemDataEntrega` e `avisoLinhasDeFora`).
 *
 * Duas frases, e a diferença entre elas é a que importa:
 *
 *   - ENCOLHEU E CONTINUA LEGÍVEL: informa, sem alarme. É o comportamento
 *     pedido funcionando.
 *   - ENCOLHEU ABAIXO DO LEGÍVEL: diz o número. O dono pediu para não parar de
 *     encolher, e o código obedece; o que ele não pediu foi para não saber. Um
 *     pedido desse tamanho tem outra saída (dividir em dois pedidos), e essa
 *     escolha é dele — mas só existe se ele souber que chegou lá.
 *
 * Sai na tela, com `data-no-print`: é conversa com quem manda imprimir, não
 * informação para o cliente que assina.
 */
export function avisoDeLegibilidade(corpo: number, totalItens: number): string {
  if (!Number.isFinite(corpo) || corpo >= CORPO_CONFORTAVEL) return ''
  const itens = contagemPorExtenso(totalItens, 'item', 'itens')
  const tamanho = `${String(corpo).replace('.', ',')}px`
  const base = `Este pedido tem ${itens}: para caber numa folha só, a letra encolheu de`
    + ` ${CORPO_CONFORTAVEL}px para ${tamanho}.`
  if (corpo >= CORPO_ILEGIVEL) return base
  return `${base} Abaixo de ${CORPO_ILEGIVEL}px a folha deixa de ser conferível na prática —`
    + ' ela continua saindo em uma página só, como o senhor pediu, mas conferir'
    + ' item a item nesse tamanho não é possível. Dividir o pedido em dois é o'
    + ' que devolve a folha ao tamanho de leitura.'
}
