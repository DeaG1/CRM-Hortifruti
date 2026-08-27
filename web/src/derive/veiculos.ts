import { periodoDe } from './periodo'
import { CATEGORIAS_COM_VEICULO_ORDEM, type Lancamento } from './lancamentos'

// ESTE MÓDULO TROCOU DE ASSUNTO. Ele derivava o uso do carro — horas em
// aberto, "há quanto tempo alguém está com ele", o limite de 12h que
// destacava um check-in esquecido. O dono do negócio usou o check-in/check-out
// e concluiu que não serve: o que ele quer ver no carro é quanto ele custa.
//
// Saíram junto com a funcionalidade (não ficaram "por precaução"):
// `UsoAberto`, `UsoHistorico`, `FuncionarioOpcao`, `HORAS_LIMITE_ABERTO`,
// `horasEmAberto`, `usoAntigo`, `formatarHora` e `formatarDataHora` — todas
// existiam só para a lista de uso, e nenhuma tem chamador na tela nova.
// Mesma razão de `periodosComFolha` em derive/funcionarios.ts: código que
// descreve uma tela que não existe mais engana quem lê depois.
//
// O molde do que entrou é derive/funcionarios.ts (saldo + histórico +
// estatísticas do período, com `null` quando os lançamentos não puderam ser
// carregados). É a mesma pergunta — "quanto saiu por causa DESTE aqui, no
// período" — com outro sujeito.

/** Veículo como a API devolve (api/src/routes/veiculos.ts). */
export interface Veiculo {
  id: string
  placa: string
  modelo: string
  marca: string
  ano: number | null
  ativo: boolean
  obs: string
}

/**
 * Valores iniciais ao criar um veículo. Vive aqui (não em ModalVeiculo.tsx,
 * que consome) pela mesma razão de PRODUTO_NOVO em derive/produtos.ts: um
 * arquivo de componente só pode exportar componentes sem quebrar o fast
 * refresh. `ano: ''` (não `null`) porque é o valor que um <input
 * type="number"> controlado espera quando vazio.
 */
export const VEICULO_NOVO = {
  placa: '', modelo: '', marca: '', ano: '' as number | string, ativo: true, obs: '',
}

/** "Fiat Fiorino", ou a placa quando não há marca nem modelo — um nome só
 * para o veículo, usado na lista, no seletor do modal e no rótulo dos botões
 * (duas grafias do mesmo carro em telas vizinhas confundem). */
export function nomeVeiculo(v: Pick<Veiculo, 'placa' | 'marca' | 'modelo'>): string {
  const nome = [v.marca, v.modelo].filter(Boolean).join(' ').trim()
  return nome || v.placa
}

/**
 * A placa de um veículo pelo id, ou `null`. Existe para o histórico do
 * funcionário poder dizer DE QUAL CARRO foi a multa que abateu o salário
 * dele: "Multa R$ 350" sem a placa esconde do dono metade do registro.
 *
 * Os três caminhos que devolvem `null` são coisas diferentes e todos
 * legítimos, e por isso nenhum deles é erro:
 *
 *   - `veiculoId` nulo/vazio: o lançamento não tem carro (a maioria deles, e
 *     também a multa de um carro já excluído do cadastro —
 *     `lancamentos_veiculo_fk` é `on delete set null`);
 *   - `veiculos === null`: a lista não pôde ser carregada. A conta do "a
 *     pagar" não depende dela, então a tela continua de pé sem a placa;
 *   - id que não está na lista: mesma resposta honesta — não se sabe a placa.
 *
 * Nunca inventa texto ("veículo desconhecido"): quem exibe decide o que pôr
 * no lugar, do mesmo jeito que decide entre R$ 0,00 e travessão.
 */
export function placaDeVeiculo(
  veiculos: Pick<Veiculo, 'id' | 'placa'>[] | null,
  veiculoId: string | null | undefined,
): string | null {
  if (!veiculoId || veiculos === null) return null
  const achado = veiculos.find(v => String(v.id) === String(veiculoId))
  return achado ? achado.placa : null
}

/**
 * Lançamentos de um veículo dentro do período, do mais recente pro mais
 * antigo — a mesma lista que alimenta o gasto e o histórico da linha
 * expandida. Espelha `lancamentosDoFuncionario` (derive/funcionarios.ts),
 * inclusive na convenção de `periodo` ('AAAA-MM' ou 'all', derive/periodo.ts).
 *
 * Filtra por `veiculo_id`, NÃO por categoria: a API já garante que só as
 * categorias de CATEGORIAS_COM_VEICULO chegam com veículo preenchido (fora
 * delas o campo é zerado no servidor), e filtrar de novo por categoria aqui
 * esconderia do histórico um lançamento que o banco de fato atribui a este
 * carro — o usuário veria um gasto que não bate com nenhuma linha listada.
 */
export function lancamentosDoVeiculo(
  lancamentos: Lancamento[],
  veiculoId: string,
  periodo: string = 'all',
): Lancamento[] {
  return lancamentos
    .filter(l => String(l.veiculo_id ?? '') === String(veiculoId))
    .filter(l => periodo === 'all' || periodoDe(l.data) === periodo)
    .slice()
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
}

/** Soma o `valor` de uma lista já filtrada (ver `lancamentosDoVeiculo`).
 * Zero é um resultado legítimo: o período foi olhado e não houve gasto. */
export function gastoDoVeiculo(lancamentosDoPeriodo: Lancamento[]): number {
  return lancamentosDoPeriodo.reduce((soma, l) => soma + (Number(l.valor) || 0), 0)
}

/**
 * O mesmo total, aberto por categoria. As chaves são exatamente as de
 * `CATEGORIAS_COM_VEICULO_ORDEM`, sempre todas presentes (zero quando não
 * houve gasto naquela categoria) — quem renderiza não precisa saber se a
 * chave existe, e um cartão ausente e um cartão zerado dizem coisas
 * diferentes.
 *
 * Categoria fora da lista, se algum dia chegar uma com veículo preenchido,
 * NÃO é descartada: entra na chave dela. Assim o total continua sendo a soma
 * das partes, em vez de o rodapé não bater com a conta de cima.
 */
export function gastoPorCategoria(lancamentosDoPeriodo: Lancamento[]): Record<string, number> {
  const saida: Record<string, number> = {}
  for (const categoria of CATEGORIAS_COM_VEICULO_ORDEM) saida[categoria] = 0
  for (const l of lancamentosDoPeriodo) {
    saida[l.categoria] = (saida[l.categoria] ?? 0) + (Number(l.valor) || 0)
  }
  return saida
}

export interface VeiculoDerivado extends Veiculo {
  /**
   * Gasto do período. `null` quando os lançamentos não puderam ser carregados
   * — diferente de `0`, que é um zero MEDIDO (o carro existe, o período foi
   * olhado, não houve gasto). A tela mostra travessão num caso e R$ 0,00 no
   * outro, e travessão nunca vira zero.
   */
  gasto: number | null
  /** Lançamentos do período, mais recente primeiro. `null` = indisponíveis. */
  historico: Lancamento[] | null
}

/**
 * Combina tudo acima para o conjunto de veículos da tela.
 *
 * `lancamentos: null` significa "GET /api/lancamentos falhou" (ou ainda não
 * voltou). O CADASTRO continua saindo inteiro — placa, marca, modelo, ano,
 * ativo — e só o que depende de lançamento vira `null`. `[]` é outra coisa:
 * carregou e não havia nada, então o gasto é zero de verdade.
 *
 * O mesmo vale para um período sem movimento: o carro continua listado. Um
 * carro não deixa de existir porque não abasteceu em julho.
 */
export function derivarVeiculos(
  veiculos: Veiculo[],
  lancamentos: Lancamento[] | null,
  periodo: string = 'all',
): VeiculoDerivado[] {
  return veiculos.map(v => {
    const historico = lancamentos === null ? null : lancamentosDoVeiculo(lancamentos, v.id, periodo)
    return { ...v, historico, gasto: historico === null ? null : gastoDoVeiculo(historico) }
  })
}

/**
 * Os números dos cartões do topo. `null` em vez de 0 nos que dependem de
 * lançamento quando a lista não pôde ser carregada — zero ali seria um dado
 * inventado. Espelha `estatisticasFuncionarios`.
 */
export interface EstatisticasVeiculos {
  /** Quantos veículos cadastrados. Não depende de lançamento nem de período:
   * é contagem de cadastro, igual a "Funcionários" no cartão de lá. */
  quantidade: number
  /** Quantos estão ativos — o cadastro inteiro continua listado, mas
   * aposentar um carro (`ativo = false`) é o caminho para tirá-lo de vista
   * sem apagar a despesa dele. */
  ativos: number
  /** Gasto de TODOS os veículos no período. `null` = lançamentos indisponíveis. */
  gastoPeriodo: number | null
  /** O mesmo, aberto por categoria (chaves de CATEGORIAS_COM_VEICULO_ORDEM).
   * `null` = indisponível — e não um objeto com zeros, que fingiria medição. */
  porCategoria: Record<string, number> | null
}

export function estatisticasVeiculos(
  veiculos: Veiculo[],
  lancamentos: Lancamento[] | null,
  periodo: string = 'all',
): EstatisticasVeiculos {
  const quantidade = veiculos.length
  const ativos = veiculos.filter(v => v.ativo).length
  if (lancamentos === null) {
    return { quantidade, ativos, gastoPeriodo: null, porCategoria: null }
  }
  // Só lançamento COM veículo entra — o total dos cartões tem de ser a soma
  // do que aparece nas linhas, e uma gasolina sem carro atribuído não aparece
  // em linha nenhuma. Ela continua contando no Financeiro, que é onde o custo
  // total do período mora.
  const doPeriodo = lancamentos
    .filter(l => String(l.veiculo_id ?? '') !== '')
    .filter(l => periodo === 'all' || periodoDe(l.data) === periodo)
  return {
    quantidade,
    ativos,
    gastoPeriodo: gastoDoVeiculo(doPeriodo),
    porCategoria: gastoPorCategoria(doPeriodo),
  }
}
