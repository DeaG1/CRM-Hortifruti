import { dataBrCurta } from './pagamento'

/**
 * O ROMANEIO DE ENTREGAS — a folha que o motorista leva na mão para conferir
 * o caminhão antes de sair.
 *
 * Molde de derive/clientes.ts e derive/estoque.ts: funções puras, sem React,
 * sem fetch, sem `new Date()`. O componente (screens/RomaneioEntregas.tsx)
 * exibe; o agrupamento por cliente, a ordem de leitura, a formatação de
 * número e a escolha do que sai na folha moram todos aqui, onde dá para
 * testá-los sem montar tela nem subir banco.
 *
 * ================================ A DATA É A DE ENTREGA — E É O EIXO DE TUDO
 *
 * `saidas.entrega`, nunca `data_pedido`: o romaneio existe para o momento em
 * que a mercadoria SOBE NO CAMINHÃO. O projeto já tinha fixado essa escolha
 * para movimentação de estoque (4bee3f0, e a CTE `said` de
 * api/src/routes/estoque.ts, que usa `max(s.entrega)` como data da saída);
 * aqui ela é seguida, não reaberta.
 *
 * A separação por dia é garantida ANTES daqui, pela forma da rota
 * (`GET /api/saidas/romaneio/:data` — a data é parâmetro obrigatório, não
 * filtro opcional, então não existe resposta "de todos os dias" a ser
 * confundida com a de um dia). O que sobra para este módulo é a outra metade
 * do mesmo risco: dizer a data de volta, por extenso e sem ambiguidade, para
 * que a folha na mão do motorista nunca seja a do dia errado sem que ele
 * perceba. Ver `dataPorExtensoRomaneio`.
 *
 * ======================= SAÍDA SEM DATA DE ENTREGA NÃO PERTENCE A DIA NENHUM
 *
 * Esta é a consequência que precisa de tratamento visível, e não de um
 * silêncio educado. Uma venda com `entrega` nula não cai no romaneio de hoje,
 * nem no de ontem, nem no de nenhum outro dia: ela simplesmente não existe
 * para esta tela. Some do processo, e ninguém descobre até o cliente ligar
 * cobrando.
 *
 * Ela NÃO é jogada num dia arbitrário (isso seria carga fantasma no caminhão
 * de alguém). Em vez disso ela é CONTADA e NOMEADA — ver `avisoSemDataEntrega`
 * —, do mesmo jeito que `avisoSaidasSemData` (derive/estoque.ts) faz com o
 * mesmo dado do outro lado do sistema. A regra do projeto vale aqui inteira:
 * ausência não vira zero, e número que muda sem explicação destrói a
 * confiança na tela.
 *
 * ========================================== QUANTIDADE NA UNIDADE LANÇADA
 *
 * `qtd` + `un` cruas, sem conversão nenhuma para quilos — o motorista confere
 * CAIXA no pátio, não quilo convertido, e alface se vende por unidade ou maço
 * ("quantos quilos de alface" nem é a pergunta certa). É a mesma correção que
 * 88318ee fez na tela de Estoque: dentro de UM lançamento não existe mistura
 * de unidades a reconciliar, então converter à força só destrói informação. E
 * a unidade vai COLADA ao número (`quantidadeRomaneio`), pelo motivo daquele
 * commit: é o único rótulo que não pode divergir do valor, porque viaja no
 * mesmo lugar.
 */

// ================================================== o que a API devolve

/**
 * Uma linha crua de `GET /api/saidas/romaneio/:data` — um ITEM de uma saída
 * do dia, com o cabeçalho do pedido e o cadastro do cliente repetidos pelo
 * join. É de propósito que a API devolva plano e o agrupamento aconteça aqui:
 * a montagem da folha é regra de leitura, não de consulta.
 */
export interface LinhaRomaneio {
  saida_id: string
  numero: string
  /**
   * O status do pedido. A folha NÃO o imprime — 'Cancelado' e 'Devolvido' já
   * ficaram de fora na consulta, e para o motorista a diferença entre
   * 'Pendente' e 'Em rota' não muda nada do que ele confere no pátio.
   *
   * Ele viaja mesmo assim porque é o que torna o filtro VERIFICÁVEL de fora:
   * o teste da API afirma quais status chegaram, em vez de afirmar só quais
   * números não chegaram. Um filtro que ninguém consegue observar é um filtro
   * em que se acredita.
   */
  status: string
  obs: string
  /** Rota do PEDIDO (`saidas.rota`) — pode estar vazia. */
  rota: string
  cliente_id: string | null
  cliente_nome: string | null
  cliente_endereco: string | null
  cliente_tel: string | null
  /** Rota do CADASTRO do cliente (`clientes.rota`). */
  cliente_rota: string | null
  item_id: string
  produto: string
  /** A unidade em que o item foi LANÇADO ('KG','CX','UN','DZ','MC'). */
  un: string
  qtd: number
  /** Preço por unidade da linha. `0` significa "ninguém preencheu" neste
   * projeto (ver `preco > 0` em GET /ultimos-precos, api/src/routes/saidas.ts). */
  preco: number
}

/** Quantas saídas não pertencem a dia nenhum, e quais — ver `avisoSemDataEntrega`. */
export interface SemDataEntrega {
  /** Total exato, mesmo quando `numeros` vem truncada. */
  total: number
  /** Os números dos pedidos, até 50 (a API limita). */
  numeros: string[]
}

/** O corpo inteiro de `GET /api/saidas/romaneio/:data`. */
export interface RespostaRomaneio {
  data: string
  itens: LinhaRomaneio[]
  sem_data_entrega: SemDataEntrega
}

// ============================================ o que sai na folha (escolhível)

/**
 * As chaves dos campos OPCIONAIS da folha. O que NÃO está aqui é fixo por
 * decisão, não por esquecimento — ver `CAMPOS_FIXOS_ROMANEIO`.
 */
export type CampoRomaneio =
  | 'endereco' | 'telefone' | 'rota'
  | 'numero' | 'obs'
  | 'precoUnitario' | 'totalItem' | 'totalPedido'

/** A escolha do usuário: um booleano por campo opcional. */
export type CamposRomaneio = Record<CampoRomaneio, boolean>

/** Um campo oferecido no painel "O que sai na folha". */
export interface DefinicaoCampoRomaneio {
  chave: CampoRomaneio
  rotulo: string
  /** Em que bloco da folha ele aparece — vira o agrupamento do painel. */
  grupo: 'Cliente' | 'Pedido' | 'Preços'
  /** Marcado ao abrir pela primeira vez (e sempre que a preferência gravada
   * não puder ser lida). */
  padrao: boolean
  /** Por que ele vem (ou não vem) marcado — texto mostrado ao usuário. */
  ajuda: string
}

/**
 * O que a folha oferece, na ordem em que o painel mostra.
 *
 * ---- PREÇO VEM DESMARCADO, E ISSO É REGRA, NÃO GOSTO ----
 *
 * O romaneio é UMA folha com VÁRIOS clientes. Com preço impresso, o cliente
 * que der uma olhada na prancheta enquanto assina lê o preço do vizinho — e
 * preço por cliente é negociado, não tabelado. O dono pode marcar quando
 * quiser (é a folha dele, e conferir valor faturado é um uso legítimo), mas o
 * padrão não pode vazar por descuido de quem só clicou em imprimir.
 *
 * Os três campos de preço são independentes de propósito: querer o total do
 * pedido para conferir a nota fiscal não obriga a expor o preço unitário de
 * cada item.
 */
export const CAMPOS_ROMANEIO: readonly DefinicaoCampoRomaneio[] = [
  {
    chave: 'endereco', rotulo: 'Endereço do cliente', grupo: 'Cliente', padrao: true,
    ajuda: 'Onde entregar. Quem dirige precisa disso na folha, não no celular.',
  },
  {
    chave: 'telefone', rotulo: 'Telefone do cliente', grupo: 'Cliente', padrao: true,
    ajuda: 'Para ligar quando não acha o local ou não tem ninguém para receber.',
  },
  {
    chave: 'rota', rotulo: 'Rota', grupo: 'Cliente', padrao: true,
    ajuda: 'A rota do pedido; quando ela está vazia, a do cadastro do cliente.',
  },
  {
    chave: 'numero', rotulo: 'Número do pedido', grupo: 'Pedido', padrao: true,
    ajuda: 'Liga a linha da folha ao pedido no sistema quando algo não bate.',
  },
  {
    chave: 'obs', rotulo: 'Observação do pedido', grupo: 'Pedido', padrao: true,
    ajuda: 'Costuma ser instrução de entrega ("entregar pelos fundos").',
  },
  {
    chave: 'precoUnitario', rotulo: 'Preço unitário', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão: a folha tem vários clientes, e um lê o preço do outro.',
  },
  {
    chave: 'totalItem', rotulo: 'Total do item', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão, pelo mesmo motivo do preço unitário.',
  },
  {
    chave: 'totalPedido', rotulo: 'Total do pedido', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão, pelo mesmo motivo do preço unitário.',
  },
]

/**
 * O que sai SEMPRE, sem caixa para desmarcar — e por quê. O painel mostra
 * esta lista ao usuário para a escolha ser honesta: "escolha o que sai" com
 * quatro coisas saindo em silêncio seria meia verdade.
 *
 * Nome do cliente e a CHAVE do agrupamento: sem ele a folha vira uma pilha de
 * itens sem dono. Produto e quantidade são o que se confere — uma folha de
 * conferência sem eles não confere nada. E o quadradinho é o ponto da folha:
 * o motorista risca item por item no pátio.
 */
export const CAMPOS_FIXOS_ROMANEIO: readonly string[] = [
  'Nome do cliente (é como a folha agrupa)',
  'Produto e quantidade na unidade lançada (é o que se confere)',
  'Quadradinho para marcar item conferido',
]

/** A escolha inicial — e a de segurança: é para cá que se cai quando a
 * preferência gravada não pode ser lida ou está corrompida. Note que preço
 * está desmarcado nela, então nenhuma falha de armazenamento vaza preço. */
export const CAMPOS_ROMANEIO_PADRAO: CamposRomaneio = Object.freeze(
  Object.fromEntries(CAMPOS_ROMANEIO.map(c => [c.chave, c.padrao])),
) as CamposRomaneio

/**
 * Transforma QUALQUER COISA numa escolha de campos válida.
 *
 * A entrada vem de `JSON.parse` de uma string do `localStorage`, que é
 * território hostil: pode ser `null`, um número, um array, um objeto de uma
 * versão anterior do app (com um campo que já não existe, ou faltando um que
 * passou a existir), ou lixo que uma extensão deixou. Nada disso pode virar
 * exceção nem um objeto meio preenchido cujo `undefined` a tela leia como
 * "marcado" por acidente.
 *
 * A regra: chave desconhecida é DESCARTADA, chave faltando ou com valor
 * não-booleano cai no PADRÃO daquele campo. Isso dá duas garantias que
 * importam: acrescentar um campo novo ao app não invalida a preferência
 * gravada de ninguém (o campo novo entra com o padrão dele), e nenhum lixo
 * gravado consegue LIGAR um campo de preço — só um `true` booleano na chave
 * certa liga, e o padrão dele é `false`.
 */
export function normalizarCampos(bruto: unknown): CamposRomaneio {
  const objeto = (typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto))
    ? bruto as Record<string, unknown>
    : {}
  const campos = {} as CamposRomaneio
  for (const def of CAMPOS_ROMANEIO) {
    const valor = objeto[def.chave]
    campos[def.chave] = typeof valor === 'boolean' ? valor : def.padrao
  }
  return campos
}

// ================================================== formatação de número

/**
 * "45 UN", "10,5 CX", "30 KG" — a quantidade com a UNIDADE COLADA.
 *
 * A unidade não vira cabeçalho de coluna e não desce para uma legenda: uma
 * folha com clientes que compram em caixa e em quilo teria um cabeçalho
 * mentindo na maioria das linhas. É a decisão de 88318ee ("ROTULOS DAS
 * COLUNAS"), aplicada à folha impressa pelo mesmo motivo.
 *
 * Até três casas (a precisão de `saida_itens.qtd`, numeric(12,3)) e sem casas
 * forçadas: "45 UN", não "45,000 UN". Quantidade não finita vira travessão —
 * nunca `0`, que afirmaria "nada a carregar" onde a verdade é "não sei
 * quanto".
 */
export function quantidadeRomaneio(qtd: number, un: string): string {
  if (!Number.isFinite(qtd)) return '—'
  const numero = qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  const unidade = (un ?? '').trim()
  return unidade ? `${numero} ${unidade}` : numero
}

/**
 * "R$ 12,50". `null` quando NÃO HÁ VALOR a dizer — e as duas situações que
 * levam a isso são a mesma coisa neste projeto:
 *
 *   - não finito: não dá para afirmar valor nenhum;
 *   - `<= 0`: o modal de saída grava 0 quando o campo de preço fica vazio
 *     (ver `salvar` em ModalSaida.tsx e o `preco > 0` de
 *     GET /ultimos-precos), então zero aqui quase sempre significa "ninguém
 *     preencheu", não "vendido de graça".
 *
 * `null` vira travessão na folha, nunca "R$ 0,00" — que afirmaria um preço
 * medido de zero. Sempre duas casas: numa folha que pode ir para conferência
 * de nota, "R$ 12,5" é uma ambiguidade cara.
 */
export function dinheiroRomaneio(valor: number): string | null {
  if (!Number.isFinite(valor) || valor <= 0) return null
  return 'R$ ' + valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

const DIAS_DA_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
]

/**
 * A DATA GRANDE DA FOLHA: "sexta-feira, 28/08/2026".
 *
 * Romaneio do dia errado na mão do motorista é PIOR que romaneio nenhum: sem
 * folha ele pergunta; com a folha errada ele confere confiante e sai com a
 * carga trocada. Por isso a data sai por extenso e com o dia da semana junto
 * — o dia da semana é a redundância que faz o erro saltar aos olhos de quem
 * pegou a folha de ontem por engano ("mas hoje é sexta").
 *
 * `dataBrCurta` (derive/pagamento.ts) faz o DD/MM — o formatador único do
 * projeto, reaproveitado aqui pelo mesmo motivo que `notaUltimoPreco` o
 * reaproveitou: escrever um segundo formatador de data seria a duplicação que
 * aquele arquivo já evitou uma vez. O ano é acrescentado aqui porque, ao
 * contrário da sub-linha de pagamento, esta folha vira papel e pode ser
 * arquivada — "28/08" sozinho num arquivo morto não diz de que ano é.
 *
 * O dia da semana sai de `Date.UTC` + tabela de nomes, e não de
 * `toLocaleDateString('pt-BR', { weekday })`: a tabela é determinística em
 * qualquer runtime (o teste não depende de ICU instalado) e o `Date.UTC` não
 * tem fuso para escorregar um dia. `null` para data ausente ou impossível
 * (30/02, mês 13) — nunca uma data inventada e nunca a string crua vazando
 * para a folha.
 */
export function dataPorExtensoRomaneio(iso: string | null | undefined): string | null {
  const curta = dataBrCurta(iso)
  if (!curta) return null
  const texto = String(iso)
  const ano = Number(texto.slice(0, 4))
  const mes = Number(texto.slice(5, 7))
  const dia = Number(texto.slice(8, 10))
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  // Round-trip: 2026-02-30 vira 02/03 no Date, e os componentes deixam de
  // bater. Data impossível não pode virar uma data plausível na folha.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null
  }
  return `${DIAS_DA_SEMANA[d.getUTCDay()]}, ${curta}/${ano}`
}

/**
 * A frase sobre as vendas que não pertencem a dia nenhum. `''` quando não há
 * nenhuma — a tela não avisa sobre o que não aconteceu (mesma regra de
 * `avisoLinhasDeFora` e `avisoSaidasSemData`, derive/estoque.ts).
 *
 * A frase diz três coisas, e nenhuma delas é decorativa: QUANTAS são (o
 * tamanho do buraco), que elas não saem em romaneio NENHUM (não é "não saem
 * hoje" — é o problema inteiro), e ONDE se resolve (Saídas, campo Entrega).
 * Os números dos pedidos vêm junto porque "3 vendas sem data" manda procurar;
 * "#1042, #1043, #1044" manda corrigir.
 */
export function avisoSemDataEntrega(semData: SemDataEntrega | null | undefined): string {
  const total = Number(semData?.total ?? 0)
  if (!Number.isFinite(total) || total <= 0) return ''
  const um = total === 1
  const numeros = (semData?.numeros ?? []).filter(n => typeof n === 'string' && n.trim() !== '')
  const lista = numeros.length === 0
    ? ''
    : numeros.length < total
      ? ` (${numeros.join(', ')} e mais ${total - numeros.length})`
      : ` (${numeros.join(', ')})`
  return `${um ? '1 venda está' : `${total} vendas estão`} sem data de entrega${lista}`
    + ` e por isso não ${um ? 'aparece' : 'aparecem'} em romaneio nenhum — nem neste dia,`
    + ' nem em outro. Abra Saídas, edite'
    + ` ${um ? 'o pedido' : 'cada pedido'} e preencha a data de entrega.`
}

// ================================================== a folha montada

/** Um item já formatado para a folha. */
export interface ItemRomaneio {
  id: string
  produto: string
  /** Sempre presente: "45 UN". Ver `quantidadeRomaneio`. */
  quantidade: string
  /** `null` quando o campo está desligado OU quando não há preço registrado. */
  precoUnitario: string | null
  /** `null` pelos mesmos dois motivos de `precoUnitario`. */
  total: string | null
}

/** Um pedido dentro do bloco de um cliente. */
export interface PedidoRomaneio {
  id: string
  /** `null` quando o campo "Número do pedido" está desligado. */
  numero: string | null
  /** `null` quando o campo está desligado ou a observação está vazia. */
  obs: string | null
  itens: ItemRomaneio[]
  /** `null` quando o campo está desligado ou nenhum item tem preço. */
  total: string | null
}

/** Um bloco da folha: um cliente e tudo que vai para ele naquele dia. */
export interface GrupoRomaneio {
  /** `null` só quando a venda perdeu o vínculo com o cadastro. */
  clienteId: string | null
  cliente: string
  endereco: string | null
  telefone: string | null
  rota: string | null
  pedidos: PedidoRomaneio[]
  /** Quantos itens este cliente tem no total — o motorista confere contra a
   * pilha antes de olhar item a item. */
  totalItens: number
}

/** A folha inteira, pronta para o componente imprimir. */
export interface Romaneio {
  /** ISO da data pedida, como veio. */
  data: string
  /** "sexta-feira, 28/08/2026", ou `null` se a data for inválida. */
  dataPorExtenso: string | null
  grupos: GrupoRomaneio[]
  totalClientes: number
  totalPedidos: number
  totalItens: number
  /** A escolha em vigor, para o componente decidir as COLUNAS a partir da
   * mesma fonte que decidiu os valores. */
  campos: CamposRomaneio
  /** A frase sobre vendas sem data de entrega; `''` quando não há. */
  avisoSemData: string
}

/** Rótulo do bloco quando a venda não tem cliente vinculado. Acontece quando
 * o cadastro foi excluído (`saidas.cliente_id` é `on delete set null` —
 * migration 014): a venda sobrevive órfã, e a mercadoria dela continua no
 * caminhão. Ela aparece com este nome em vez de sumir da folha. */
export const SEM_CLIENTE = 'Sem cliente vinculado'

/** Texto sem acento e em caixa alta, só para ORDENAR. Determinístico em
 * qualquer runtime, ao contrário de `localeCompare` com locale, que depende
 * do ICU instalado. */
function chaveDeOrdem(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

/** O que vale como texto preenchido. Campo em branco no cadastro (o default
 * de `clientes.endereco` é `''`) não é dado — não ocupa linha na folha. */
function texto(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim()
  return t === '' ? null : t
}

/**
 * Monta a folha: linhas planas da API + escolha de campos → blocos por
 * cliente, prontos para imprimir.
 *
 * ---- A ORDEM DE LEITURA É A ORDEM DO CAMINHÃO ----
 *
 * Os blocos saem por ROTA e, dentro dela, por nome do cliente. É a ordem em
 * que a carga é conferida e entregue; ordenar por número de pedido faria o
 * motorista pular de bairro em bairro e voltar. Cliente sem rota vai para o
 * fim (não se sabe onde encaixá-lo), e o bloco sem cliente vinculado vai
 * depois de todos — é a exceção, e exceção no meio da folha atrapalha a
 * conferência.
 *
 * ---- POR QUE UM BLOCO POR CLIENTE, E NÃO POR PEDIDO ----
 *
 * Quem recebe é o cliente. Dois pedidos para o mesmo mercado descem na mesma
 * parada, e separá-los em dois blocos distantes faria o motorista descarregar
 * duas vezes ou esquecer o segundo. Os pedidos continuam identificados DENTRO
 * do bloco (quando o campo "Número do pedido" está ligado), porque é por
 * pedido que se resolve divergência no sistema depois.
 *
 * ---- ESTA FUNÇÃO NÃO FILTRA STATUS, E ISSO É DE PROPÓSITO ----
 *
 * 'Cancelado' e 'Devolvido' já ficam de fora na consulta
 * (`api/src/routes/saidas.ts`, GET /romaneio/:data), com o MESMO
 * `not in ('Cancelado','Devolvido')` da CTE `said` de estoque.ts. Repetir a
 * regra aqui criaria dois lugares onde ela pode divergir — e o lugar certo
 * dela é o que impede o dado de sair do banco, não o que o esconde depois de
 * já ter viajado até o navegador.
 */
export function montarRomaneio(
  resposta: RespostaRomaneio,
  campos: CamposRomaneio,
): Romaneio {
  const linhas = Array.isArray(resposta?.itens) ? resposta.itens : []

  // Ordem de encontro preservada (a API já devolve por número de pedido e id
  // de item), então os itens de um pedido saem na ordem em que foram
  // gravados — a mesma que o modal mostra.
  const porCliente = new Map<string, GrupoRomaneio>()
  const porPedido = new Map<string, PedidoRomaneio>()
  // O acumulador do total de cada pedido vive fora do objeto exposto: ele é
  // um número em construção, e o objeto carrega o texto já formatado.
  const somaDoPedido = new Map<string, number>()
  // A rota que ORDENA cada grupo, guardada À PARTE de `grupo.rota` (que é
  // `null` quando o usuário desmarcou o campo): a ordem da folha não pode
  // mudar conforme o que se escolheu imprimir — o caminhão é carregado na
  // mesma ordem dos dois jeitos.
  const rotaDeOrdem = new Map<GrupoRomaneio, string>()

  for (const linha of linhas) {
    const chaveCliente = linha.cliente_id ?? SEM_CLIENTE
    let grupo = porCliente.get(chaveCliente)
    if (!grupo) {
      grupo = {
        clienteId: linha.cliente_id ?? null,
        cliente: texto(linha.cliente_nome) ?? SEM_CLIENTE,
        endereco: campos.endereco ? texto(linha.cliente_endereco) : null,
        telefone: campos.telefone ? texto(linha.cliente_tel) : null,
        // Rota do PEDIDO primeiro, do CADASTRO como reserva: a do pedido é a
        // decisão daquela entrega (pode ter sido remanejada), a do cadastro é
        // a de sempre. Nenhuma das duas, nada — não se inventa rota.
        rota: campos.rota ? (texto(linha.rota) ?? texto(linha.cliente_rota)) : null,
        pedidos: [],
        totalItens: 0,
      }
      porCliente.set(chaveCliente, grupo)
      rotaDeOrdem.set(grupo, (linha.rota || '').trim() || (linha.cliente_rota ?? '').trim())
    }

    let pedido = porPedido.get(linha.saida_id)
    if (!pedido) {
      pedido = {
        id: linha.saida_id,
        numero: campos.numero ? texto(linha.numero) : null,
        obs: campos.obs ? texto(linha.obs) : null,
        itens: [],
        total: null,
      }
      porPedido.set(linha.saida_id, pedido)
      somaDoPedido.set(linha.saida_id, 0)
      grupo.pedidos.push(pedido)
    }

    const totalDoItem = linha.qtd * linha.preco
    pedido.itens.push({
      id: linha.item_id,
      produto: texto(linha.produto) ?? '—',
      quantidade: quantidadeRomaneio(linha.qtd, linha.un),
      precoUnitario: campos.precoUnitario ? dinheiroRomaneio(linha.preco) : null,
      total: campos.totalItem ? dinheiroRomaneio(totalDoItem) : null,
    })
    grupo.totalItens += 1
    if (Number.isFinite(totalDoItem) && totalDoItem > 0) {
      somaDoPedido.set(linha.saida_id, (somaDoPedido.get(linha.saida_id) ?? 0) + totalDoItem)
    }
  }

  if (campos.totalPedido) {
    for (const [id, pedido] of porPedido) {
      // `dinheiroRomaneio` devolve null com soma zero — pedido em que nenhum
      // item tem preço registrado sai com travessão, nunca "R$ 0,00".
      pedido.total = dinheiroRomaneio(somaDoPedido.get(id) ?? 0)
    }
  }

  const grupos = [...porCliente.values()].sort((a, b) => {
    const semClienteA = a.clienteId === null ? 1 : 0
    const semClienteB = b.clienteId === null ? 1 : 0
    if (semClienteA !== semClienteB) return semClienteA - semClienteB
    // A rota usada para ORDENAR é a do dado, não a exibida: desmarcar o campo
    // "Rota" muda o que se lê, não a ordem em que a carga está no caminhão.
    const rotaA = chaveDeOrdem(rotaDeOrdem.get(a) ?? '')
    const rotaB = chaveDeOrdem(rotaDeOrdem.get(b) ?? '')
    if (rotaA !== rotaB) {
      if (rotaA === '') return 1
      if (rotaB === '') return -1
      return rotaA < rotaB ? -1 : 1
    }
    const nomeA = chaveDeOrdem(a.cliente)
    const nomeB = chaveDeOrdem(b.cliente)
    return nomeA === nomeB ? 0 : (nomeA < nomeB ? -1 : 1)
  })

  return {
    data: resposta?.data ?? '',
    dataPorExtenso: dataPorExtensoRomaneio(resposta?.data),
    grupos,
    totalClientes: grupos.length,
    totalPedidos: porPedido.size,
    totalItens: linhas.length,
    campos,
    avisoSemData: avisoSemDataEntrega(resposta?.sem_data_entrega),
  }
}

/**
 * A frase de conferência do topo da folha: "3 clientes · 4 pedidos · 12
 * itens". O motorista bate isso contra a pilha ANTES de conferir item a item
 * — se são 12 itens e ele separou 11, descobre no pátio, não na porta do
 * cliente.
 *
 * Singular e plural escritos por extenso, sem "(s)": a folha é impressa e
 * lida com pressa, e "1 cliente(s)" é o tipo de detalhe que faz o leitor
 * duvidar do resto do documento.
 */
export function resumoRomaneio(romaneio: Romaneio): string {
  const um = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`
  return [
    um(romaneio.totalClientes, 'cliente', 'clientes'),
    um(romaneio.totalPedidos, 'pedido', 'pedidos'),
    um(romaneio.totalItens, 'item', 'itens'),
  ].join(' · ')
}

/**
 * O dia vizinho de uma data ISO — o que os botões ◀ / ▶ da tela fazem.
 *
 * Existe para o dono percorrer o HISTÓRICO de romaneios (reimprimir a folha
 * de ontem, conferir a de terça) sem digitar data nenhuma. Digitar é onde o
 * erro de dia nasce, e o dia errado na mão do motorista é o risco central
 * desta tela inteira.
 *
 * `Date.UTC` + `setUTCDate` atravessa fim de mês, ano bissexto e virada de
 * ano sozinho, e o UTC evita o escorregão de um dia que o horário local
 * produziria em fusos com verão. Data inválida volta INTACTA em vez de virar
 * uma data qualquer: navegar a partir de lixo não pode produzir um dia
 * plausível.
 */
export function diaVizinho(iso: string | null | undefined, passo: number): string {
  const texto = String(iso ?? '')
  if (!dataPorExtensoRomaneio(texto)) return texto
  const d = new Date(Date.UTC(
    Number(texto.slice(0, 4)), Number(texto.slice(5, 7)) - 1, Number(texto.slice(8, 10)),
  ))
  d.setUTCDate(d.getUTCDate() + passo)
  return d.toISOString().slice(0, 10)
}
