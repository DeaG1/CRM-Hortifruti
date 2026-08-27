/**
 * Desconto de salário por falta, como a API devolve
 * (api/src/routes/descontos.ts).
 *
 * DESCONTO NÃO É LANÇAMENTO, e por isso mora num tipo (e numa tabela, e numa
 * rota) próprios em vez de ser mais uma categoria de `Lancamento`: nenhum
 * dinheiro se move quando o dono registra a falta — a empresa vai PAGAR MENOS
 * depois. Como o Financeiro soma `lancamentos.valor` como custo do período,
 * um desconto lançado ali AUMENTARIA o custo da folha e ao mesmo tempo
 * abateria o "a pagar": errado nas duas pontas, com sinais opostos. O
 * raciocínio inteiro está em db/migrations/016_descontos_de_salario.sql.
 */
export interface Desconto {
  id: string
  /** Obrigatório e nunca nulo — um desconto só existe em relação a alguém
   * (coluna `not null`, diferente de `lancamentos.funcionario_id`). */
  funcionario_id: string
  /** ISO aaaa-mm-dd — a data da FALTA, não a do registro. É ela que decide em
   * qual período o desconto abate: falta de março não diminui o salário de
   * agosto só porque foi digitada em agosto. */
  data: string
  /** Texto livre e obrigatório. O motivo é metade do valor do registro: um
   * número abatido do salário sem dizer por quê é um número que o funcionário
   * contesta e o dono não consegue explicar depois. */
  motivo: string
  /** Positivo, como todo dinheiro deste sistema. O sinal está no significado
   * ("quanto abater"), não no número — quem subtrai é `saldoFuncionario`
   * (derive/funcionarios.ts). */
  valor: number
}

/**
 * Valores iniciais ao registrar um desconto. Vive aqui (e não em
 * ModalDesconto.tsx, que consome) pela mesma razão de LANCAMENTO_NOVO_BASE em
 * derive/lancamentos.ts: um arquivo de componente só pode exportar
 * componentes sem quebrar o fast refresh.
 *
 * `data` fica de fora de propósito, igual a LANCAMENTO_NOVO_BASE: é a data de
 * hoje, calculada no componente — não faz sentido "congelar" um `new Date()`
 * num módulo importado uma vez só.
 *
 * `valor: ''` (não 0), mesmo motivo de CLIENTE_NOVO.limite
 * (derive/clientes.ts): campo numérico começa vazio com placeholder, não com
 * 0 pré-escrito — `as number | string` porque o spread ao editar sobrescreve
 * com o número real vindo da API.
 */
export const DESCONTO_NOVO = {
  motivo: '', valor: '' as number | string,
}
