import {
  dataPorExtensoFolha, quantidadeNaUnidade, dinheiroFolha, contagemPorExtenso,
  normalizarCamposFolha, padroesDeCampos,
  type CamposDaFolha, type DefinicaoCampoFolha,
} from './folha'

/**
 * A FOLHA DE CONFERÊNCIA DA CARGA — o que se leva na mão quando o caminhão do
 * produtor encosta, para conferir item a item ANTES de aceitar.
 *
 * ================================ UMA ENTRADA POR FOLHA, NÃO O DIA INTEIRO
 *
 * Foi a decisão que mais mudou o desenho, e ela sai do USO, não da tecnologia.
 *
 * A carga chega POR FORNECEDOR, uma coleta de cada vez. Quem confere está de
 * pé ao lado do caminhão, com o motorista esperando, comparando caixa por
 * caixa contra uma folha. Uma folha "do dia" traria as coletas dos outros
 * produtores — as que já chegaram de manhã e as que ainda vão chegar à
 * tarde — e obrigaria a pessoa a achar o bloco certo no meio das outras,
 * com pressa, na única hora em que errar custa mercadoria aceita a mais ou a
 * menos. E as coletas que ainda não chegaram não têm o que conferir: elas
 * seriam papel impresso para nada.
 *
 * Há um segundo motivo, menos óbvio e mais forte: a folha de conferência é
 * ASSINADA. Ela vira o comprovante daquela coleta, com o nome de quem
 * conferiu e a data. Uma folha com três fornecedores não pode ser assinada
 * por três pessoas em três momentos, nem arquivada na pasta de um deles.
 *
 * O romaneio de Saídas é do outro jeito (um DIA inteiro, vários clientes)
 * e isso não é incoerência: lá o documento acompanha UM caminhão que sai com
 * a carga de todo mundo, então o dia é a unidade certa. Aqui o documento
 * acompanha UMA carga que chega. A unidade da folha é a unidade do evento.
 *
 * =================================== VALORES DESMARCADOS, PELO MESMO MOTIVO
 *
 * Preço unitário, total do item e total da entrada vêm DESMARCADOS, como no
 * romaneio. A folha circula: fica no balcão, passa pela mão do motorista do
 * produtor, é assinada e arquivada. O que ela custou é assunto entre o dono e
 * aquele fornecedor, e não precisa estar à vista de quem entrega. Quem quiser
 * conferir a nota marca as caixas — é a folha dele —, mas o padrão não pode
 * vazar por descuido de quem só clicou em imprimir.
 *
 * Molde de derive/romaneio.ts: funções puras, sem React, sem fetch, sem
 * `new Date()`.
 */

// ============================================ o que sai na folha (escolhível)

export type CampoFolhaEntrada =
  | 'numero' | 'motivo' | 'obs'
  | 'perda'
  | 'precoUnitario' | 'totalItem' | 'totalEntrada'

export type CamposFolhaEntrada = CamposDaFolha<CampoFolhaEntrada>

export const CAMPOS_FOLHA_ENTRADA: readonly DefinicaoCampoFolha<CampoFolhaEntrada>[] = [
  {
    chave: 'numero', rotulo: 'Número da entrada', grupo: 'Entrada', padrao: true,
    ajuda: 'Liga a folha ao lançamento no sistema quando algo não bate.',
  },
  {
    chave: 'motivo', rotulo: 'Motivo', grupo: 'Entrada', padrao: true,
    ajuda: 'O que essa coleta é (compra, acerto, devolução).',
  },
  {
    chave: 'obs', rotulo: 'Observação', grupo: 'Entrada', padrao: true,
    ajuda: 'Costuma ser combinado de entrega ou pendência com o produtor.',
  },
  {
    chave: 'perda', rotulo: 'Perda na coleta (kg)', grupo: 'Conferência', padrao: true,
    ajuda: 'A perda já registrada no transporte. É o que explica a carga chegar '
      + 'menor que o combinado — sem ela a conferência acusa falta que já era conhecida.',
  },
  {
    chave: 'precoUnitario', rotulo: 'Preço unitário', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão: a folha é assinada e circula, e o preço do produtor '
      + 'não precisa estar à vista de quem entrega.',
  },
  {
    chave: 'totalItem', rotulo: 'Total do item', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão, pelo mesmo motivo do preço unitário.',
  },
  {
    chave: 'totalEntrada', rotulo: 'Total da entrada', grupo: 'Preços', padrao: false,
    ajuda: 'Desmarcado por padrão, pelo mesmo motivo do preço unitário.',
  },
]

/**
 * O que sai SEMPRE, sem caixa para desmarcar. O fornecedor e a data são a
 * IDENTIDADE do documento (folha sem eles não pode ser arquivada nem
 * assinada); produto e quantidade na unidade lançada são o que se confere; e
 * o quadradinho é o ponto da folha.
 */
export const CAMPOS_FIXOS_FOLHA_ENTRADA: readonly string[] = [
  'Fornecedor e data da coleta (é o que identifica a folha)',
  'Produto e quantidade na unidade lançada (é o que se confere)',
  'Quadradinho para marcar item conferido',
]

export const CAMPOS_FOLHA_ENTRADA_PADRAO: CamposFolhaEntrada =
  Object.freeze(padroesDeCampos(CAMPOS_FOLHA_ENTRADA)) as CamposFolhaEntrada

export function normalizarCamposEntrada(bruto: unknown): CamposFolhaEntrada {
  return normalizarCamposFolha(CAMPOS_FOLHA_ENTRADA, bruto)
}

// ================================================= o que chega da API

/** Um item de `GET /api/entradas/:id` (api/src/routes/entradas.ts,
 * paraJsonItem). `un` é a unidade em que o item foi LANÇADO. */
export interface ItemEntradaBruto {
  id: string
  produto_id: string
  un: string
  qtd: number
  preco: number
  /** Perda na coleta/transporte, EM QUILOS por contrato — para item de
   * qualquer unidade (ver o comentário de `peso_total` na API). */
  perda_kg: number
}

/** O corpo de `GET /api/entradas/:id`. */
export interface EntradaBruta {
  id: string
  numero: string
  fornecedor_id: string | null
  data: string
  motivo: string
  obs: string
  itens: ItemEntradaBruto[]
}

// ================================================== a folha montada

export interface ItemFolhaEntrada {
  id: string
  produto: string
  /** Sempre presente: "12 CX". Ver `quantidadeNaUnidade`. */
  quantidade: string
  /** `null` quando o campo está desligado. Em quilos, sempre. */
  perda: string | null
  /** `null` quando o campo está desligado OU quando não há preço registrado. */
  precoUnitario: string | null
  total: string | null
}

export interface FolhaEntrada {
  /** `null` quando o campo "Número da entrada" está desligado. */
  numero: string | null
  /** Nunca vazio: `SEM_FORNECEDOR` quando a coleta perdeu o vínculo. */
  fornecedor: string
  /** ISO da data da entrada, como veio. */
  data: string
  /** "sexta-feira, 28/08/2026", ou `null` se a data for inválida. */
  dataPorExtenso: string | null
  motivo: string | null
  obs: string | null
  itens: ItemFolhaEntrada[]
  totalItens: number
  /** `null` quando o campo está desligado ou nenhum item tem preço. */
  total: string | null
  resumo: string
  campos: CamposFolhaEntrada
}

/** Rótulo quando a coleta não tem fornecedor vinculado. Acontece quando o
 * cadastro foi excluído (`entradas.fornecedor_id` é `on delete set null` —
 * migration 014): a coleta sobrevive órfã, e a mercadoria dela chegou do
 * mesmo jeito. Ela aparece com este nome em vez de sair sem cabeçalho. */
export const SEM_FORNECEDOR = 'Sem fornecedor vinculado'

/** Quilos, com uma casa. Usado só na coluna de perda — que é kg por contrato,
 * independente da unidade em que o item foi lançado. */
function pesoKg(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg'
}

/** O que vale como texto preenchido. Campo em branco no cadastro (o default
 * de várias colunas é `''`) não é dado — não ocupa linha na folha. */
function texto(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim()
  return t === '' ? null : t
}

/**
 * Monta a folha de conferência de UMA entrada.
 *
 * A QUANTIDADE VAI NA UNIDADE LANÇADA, e isso é o coração da folha: quem
 * confere no pátio conta CAIXA, não quilo convertido. Uma folha que dissesse
 * "180 kg" para uma carga lançada como 12 CX obrigaria a pessoa a fazer uma
 * conta de cabeça com um peso médio aproximado, na frente do motorista, para
 * decidir se aceita — que é exatamente o erro que 88318ee corrigiu na tela de
 * Estoque.
 *
 * `produtos` é um mapa id → nome, e não vem embutido na resposta da entrada:
 * `GET /api/entradas/:id` devolve `produto_id` cru (é a coluna real). O nome
 * sai de `GET /api/produtos`, que o colaborador já acessa. Produto que não
 * estiver no mapa cai no próprio id — feio, mas rastreável; inventar um nome
 * ou imprimir travessão deixaria quem confere sem saber o que é aquela linha.
 */
export function montarFolhaEntrada(
  entrada: EntradaBruta,
  contexto: { fornecedor: string | null; produtos: ReadonlyMap<string, string> },
  campos: CamposFolhaEntrada,
): FolhaEntrada {
  const brutos = Array.isArray(entrada?.itens) ? entrada.itens : []

  let soma = 0
  const itens: ItemFolhaEntrada[] = brutos.map(i => {
    const totalDoItem = i.qtd * i.preco
    if (Number.isFinite(totalDoItem) && totalDoItem > 0) soma += totalDoItem
    return {
      id: i.id,
      produto: contexto.produtos.get(i.produto_id) ?? i.produto_id,
      quantidade: quantidadeNaUnidade(i.qtd, i.un),
      // A perda é MEDIDA: zero aqui significa "nada se perdeu no transporte",
      // que é informação boa e não ausência. Travessão fica para o que não se
      // pode afirmar (ver `pesoKg`).
      perda: campos.perda ? pesoKg(i.perda_kg ?? 0) : null,
      precoUnitario: campos.precoUnitario ? dinheiroFolha(i.preco) : null,
      total: campos.totalItem ? dinheiroFolha(totalDoItem) : null,
    }
  })

  return {
    numero: campos.numero ? texto(entrada?.numero) : null,
    fornecedor: texto(contexto.fornecedor) ?? SEM_FORNECEDOR,
    data: entrada?.data ?? '',
    dataPorExtenso: dataPorExtensoFolha(entrada?.data),
    motivo: campos.motivo ? texto(entrada?.motivo) : null,
    obs: campos.obs ? texto(entrada?.obs) : null,
    itens,
    totalItens: itens.length,
    // `dinheiroFolha` devolve null com soma zero — entrada em que nenhum item
    // tem preço registrado sai com travessão, nunca "R$ 0,00".
    total: campos.totalEntrada ? dinheiroFolha(soma) : null,
    resumo: contagemPorExtenso(itens.length, 'item a conferir', 'itens a conferir'),
    campos,
  }
}

/**
 * O rótulo de uma entrada no seletor da folha: "ENT-0003 · 20/08 · Sítio
 * Boa Vista". Os três pedaços são o mínimo para escolher a coleta certa sem
 * abrir nenhuma: o número liga ao sistema, a data separa duas coletas do
 * mesmo produtor e o nome é como a pessoa pensa nela.
 */
export function rotuloEntradaNoSeletor(
  numero: string, dataIso: string, fornecedor: string | null,
): string {
  const partes = [texto(numero) ?? 'sem número']
  const dia = String(dataIso ?? '').slice(8, 10)
  const mes = String(dataIso ?? '').slice(5, 7)
  if (dia && mes) partes.push(`${dia}/${mes}`)
  partes.push(texto(fornecedor) ?? SEM_FORNECEDOR)
  return partes.join(' · ')
}
