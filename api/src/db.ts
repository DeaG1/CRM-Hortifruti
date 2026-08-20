import postgres from 'postgres'

export type Sql = ReturnType<typeof postgres>

export function criarPool(url: string) {
  return postgres(url, { prepare: false, max: 5, idle_timeout: 20 })
}

/**
 * Abre uma transacao com o tenant fixado e executa fn dentro dela.
 * Toda query de negocio precisa passar por aqui — e o unico ponto
 * onde app.tenant_id e definido.
 *
 * SET LOCAL (nao SET): o escopo morre com a transacao, entao a conexao
 * volta limpa para o pool. Com SET, a proxima requisicao a reusar essa
 * conexao herdaria o tenant anterior.
 */
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  }) as Promise<T>
}
