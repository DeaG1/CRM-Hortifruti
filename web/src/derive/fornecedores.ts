import type { Produto } from './produtos'
import {
  derivarRelatorioCompras, noPeriodo, precoMedioPorKg,
  type EntradaResumo,
} from './relatorios'

export interface Fornecedor {
  id: string
  nome: string
  regiao: string
  contato: string
  /**
   * Produtos vinculados (tabela `fornecedor_produtos`). Só vem preenchido
   * quando o dado veio de `GET /api/fornecedores/:id` (ou de um `PUT` que
   * sincronizou a relação) — `GET /api/fornecedores` (lista) não faz esse
   * join, ver api/src/routes/fornecedores.ts.
   */
  produtos?: Produto[]
}

/**
 * Valores iniciais ao criar um fornecedor. Vive aqui pela mesma razão de
 * PRODUTO_NOVO em derive/produtos.ts (fast refresh — componente só pode
 * exportar componente).
 */
export const FORNECEDOR_NOVO = {
  nome: '', regiao: '', contato: '',
}

// ------------------------------------------------- métricas por fornecedor

/**
 * Limiares do semáforo da variação de preço de compra (a célula "Variação"
 * de cada fornecedor em FornecedoresLista.tsx): oscilação de até 4% conta
 * como ruído, de 4% a 7% pede atenção, e a partir de ±7% o produtor mudou de
 * patamar de preço — é o momento em que o comprador precisa renegociar ou
 * procurar outro.
 *
 * SÃO CONSTANTES HERDADAS DO PROTÓTIPO, NÃO COTAÇÃO DE MERCADO. O protótipo
 * as rotulava como "referência CEASA" e o cartão de resumo desta tela exibia
 * "±7% CEASA" ao lado da média, como se alguém consultasse a CEASA — nada
 * neste sistema consulta. O rótulo saiu junto com o cartão (decisão do dono
 * do produto); os dois números ficaram porque o semáforo da célula precisa de
 * uma régua, e uma régua arbitrária assumida é honesta — uma régua
 * arbitrária vestida de cotação não é.
 */
export const VARIACAO_ATENCAO_PCT = 4
export const VARIACAO_ALERTA_PCT = 7

/**
 * As quatro métricas derivadas de um fornecedor (protótipo, markup 544-547):
 * preço médio, variação, última coleta e aproveitamento.
 *
 * Todas nascem `null` de propósito quando não há base — travessão nunca vira
 * zero. `aproveitPct` é o exemplo que exige cuidado: quem comprou e não
 * perdeu nada tem `100` de aproveitamento MEDIDO (e sai como número),
 * enquanto quem não comprou nada no período não tem aproveitamento nenhum a
 * mostrar (e sai `null`).
 */
export interface MetricasFornecedor {
  /** Coletas (entradas) deste fornecedor no período. 0 = nunca coletou. */
  coletas: number
  /** Data ISO ('AAAA-MM-DD') da coleta mais recente; `null` sem coleta. */
  ultimaColeta: string | null
  /** R$ por quilo — `Σ valor / Σ kg` das coletas. `null` sem quilo na base. */
  precoMedio: number | null
  /**
   * Variação % do preço médio da ÚLTIMA coleta contra a ANTERIOR do mesmo
   * fornecedor. `null` quando a comparação não existe — o caso mais comum
   * sendo fornecedor com uma única coleta: variação é uma comparação entre
   * dois preços, e com um preço só não há o que comparar. Zero aqui
   * significaria "o preço não mudou", uma afirmação medida que não se pode
   * fazer sobre quem só vendeu uma vez. Ver `coletas` para a tela poder
   * explicar QUAL dos casos de `null` é este.
   */
  variacaoPct: number | null
  /** `(kg − perda) / kg` em %. `null` sem quilo na base. */
  aproveitPct: number | null
  /**
   * Itens das coletas deste fornecedor que ficaram fora do peso por não
   * serem convertíveis em quilos (unidade ≠ KG sem `produtos.peso_medio`).
   * Quando > 0, `precoMedio`, `variacaoPct` e `aproveitPct` estão todos
   * calculados sobre quantidade incompleta — o valor em reais do item
   * continua no numerador e o peso dele não entra no denominador, então o
   * preço médio sai para cima e o aproveitamento fica sobre uma base menor
   * que a real. Ver `EntradaResumo.itens_sem_conversao`.
   */
  itensSemConversao: number
}

/**
 * O que a tela precisa saber sobre o conjunto, e não sobre um fornecedor.
 *
 * Hoje é um campo só. Já teve também `variacaoMediaPct`,
 * `fornecedoresComVariacao` e `coletasNoPeriodo`, que existiam para o cartão
 * "Variação de preço de compra" — removido a pedido do dono do produto.
 * Saíram junto: sem o cartão, ninguém os lia.
 */
export interface ResumoFornecedores {
  /**
   * Soma de `itensSemConversao` dos fornecedores exibidos — decide se a nota
   * de rodapé aparece. Difere de propósito de
   * `derivarRelatorioCompras().totais.itensSemConversao`, que também conta os
   * itens de entradas SEM fornecedor: aqui a nota explica as células marcadas
   * na tela, e entrada sem fornecedor não tem célula nenhuma nesta tela.
   */
  itensSemConversao: number
}

/**
 * Ordena as coletas de um fornecedor da mais recente para a mais antiga.
 *
 * O protótipo (2431) ordena só por `data`, contando com a ordem em que as
 * entradas já estavam. Aqui o desempate vai explícito em `numero` (desc,
 * como `GET /api/entradas` já devolve) para a função ser determinística
 * qualquer que seja a ordem de entrada — duas coletas do MESMO dia são
 * comuns (fornecedor que entrega de manhã e de tarde) e sem desempate a
 * variação dependeria da ordem em que o array chegou.
 */
function maisRecentePrimeiro(a: EntradaResumo, b: EntradaResumo): number {
  const porData = String(b.data ?? '').localeCompare(String(a.data ?? ''))
  return porData !== 0 ? porData : String(b.numero ?? '').localeCompare(String(a.numero ?? ''))
}

/** Preço médio de UMA coleta — mesma fórmula (reais ÷ quilos) do preço médio
 * por fornecedor, via `precoMedioPorKg`; muda só o recorte. */
function precoMedioDaColeta(en: EntradaResumo): number | null {
  return precoMedioPorKg(en.valor_total || 0, en.peso_total || 0)
}

/**
 * As quatro métricas por fornecedor da tela de Fornecedores — portado do
 * bloco `// ---- fornecedores ----` do protótipo (design/CRM
 * Hortifruti.dc.html:2419-2458), menos o cartão de resumo de 2436/2457, que
 * o dono do produto mandou remover.
 *
 * Preço médio, perda e aproveitamento NÃO são recalculados aqui: vêm de
 * `derivarRelatorioCompras`, a mesma função que alimenta a aba Compras de
 * Relatórios. É o ponto do exercício — o dono compara o preço do fornecedor
 * nas duas telas e precisa ver o mesmo número. O que esta função acrescenta
 * é o que o relatório de compras não tem: a data da última coleta e a
 * variação entre as duas últimas, que dependem de olhar coleta a coleta e
 * não do agregado do período.
 *
 * Sem React, sem fetch, sem `new Date()` — o período entra por parâmetro
 * (`de`/`ate` vazios = a base inteira, que é o que a tela usa hoje: ela não
 * tem seletor de período).
 */
export function derivarFornecedores(
  fornecedores: Fornecedor[],
  entradas: EntradaResumo[],
  de = '',
  ate = '',
): { porFornecedor: Map<string, MetricasFornecedor>; resumo: ResumoFornecedores } {
  const { linhas } = derivarRelatorioCompras(fornecedores, entradas, de, ate)
  const linhaPorId = new Map(
    linhas.filter(l => l.fornecedorId != null).map(l => [l.fornecedorId as string, l]),
  )

  // Coletas do período agrupadas por fornecedor — o que o agregado por
  // período não guarda e de que a variação/última coleta precisam.
  const coletasPorId = new Map<string, EntradaResumo[]>()
  entradas.forEach(en => {
    if (!en.fornecedor_id) return
    if (!noPeriodo(en.data, de, ate)) return
    const atuais = coletasPorId.get(en.fornecedor_id)
    if (atuais) atuais.push(en)
    else coletasPorId.set(en.fornecedor_id, [en])
  })

  const porFornecedor = new Map<string, MetricasFornecedor>()
  fornecedores.forEach(f => {
    const coletas = (coletasPorId.get(f.id) ?? []).slice().sort(maisRecentePrimeiro)
    const linha = linhaPorId.get(f.id)

    let variacaoPct: number | null = null
    if (coletas.length >= 2) {
      const atual = precoMedioDaColeta(coletas[0])
      const anterior = precoMedioDaColeta(coletas[1])
      // `!anterior` cobre null E 0: sem preço anterior não há divisão
      // possível (protótipo 2437, `if (atual==null || !ant) return null`).
      if (atual != null && anterior) variacaoPct = ((atual - anterior) / anterior) * 100
    }

    porFornecedor.set(f.id, {
      coletas: coletas.length,
      ultimaColeta: coletas.length ? (coletas[0].data ?? null) : null,
      precoMedio: linha?.precoMedio ?? null,
      variacaoPct,
      // `aproveitPct` do relatório é `100 - perdaPct`, e `perdaPct` vira 0
      // quando não há quilo nenhum — o que faria um fornecedor sem base
      // aparecer com 100% de aproveitamento, o número mais elogioso
      // possível, sem ter sido medido. `qtd > 0` é o guard, no ponto de uso,
      // não uma segunda fórmula.
      aproveitPct: linha && linha.qtd > 0 ? linha.aproveitPct : null,
      itensSemConversao: linha?.itensSemConversao ?? 0,
    })
  })

  const metricas = Array.from(porFornecedor.values())

  return {
    porFornecedor,
    resumo: {
      itensSemConversao: metricas.reduce((s, m) => s + m.itensSemConversao, 0),
    },
  }
}
