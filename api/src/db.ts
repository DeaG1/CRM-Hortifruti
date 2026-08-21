import postgres from 'postgres'

export type Sql = ReturnType<typeof postgres>

/**
 * Mesmo criterio usado pela rota /api/health (src/index.ts) para distinguir
 * o Postgres local do Docker (sem certificado TLS) de um host remoto
 * (Supabase, producao).
 *
 * postgres.js liga TLS so se `ssl` for passado explicitamente ou se a
 * propria connection string trouxer `?sslmode=` — sem isso o padrao e
 * `ssl: false`. api/.dev.vars.example (o arquivo que o parceiro humano
 * copia para configurar producao) chegou a nao trazer `?sslmode=require`;
 * se colado assim num deploy real, credenciais, tokens de sessao, CNPJ e
 * limites de credito atravessariam a internet publica em texto claro entre
 * Cloudflare e Supabase. Por isso a exigencia de TLS mora aqui no codigo,
 * nao so na URL de exemplo — mesmo que alguem esqueca o `?sslmode=`, a
 * conexao continua sendo forcada a exigir TLS para qualquer host que nao
 * seja localhost/127.0.0.1.
 */
const HOST_LOCAL_RE = /^postgres:\/\/[^@]*@(localhost|127\.0\.0\.1)/

export function criarPool(url: string) {
  const local = HOST_LOCAL_RE.test(url)
  return postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    // Local: sem TLS (o Postgres do docker-compose.dev.yml nao oferece
    // certificado). Fora do local: TLS obrigatorio.
    ...(local ? {} : { ssl: 'require' }),
  })
}

export type EnvBanco = {
  DATABASE_URL: string
  HYPERDRIVE?: { connectionString: string }
}

/**
 * Resolve como falar com o banco a partir do ambiente.
 *
 * Em producao, atraves do Hyperdrive. O motivo nao e desempenho, e viabilidade:
 * o plano gratuito do Workers permite 50 subrequests por invocacao, e o
 * handshake TCP+TLS que o postgres.js faz direto contra o Supabase estoura esse
 * teto — a requisicao morre com "Too many subrequests by single Worker
 * invocation" depois de ~18s. Com o Hyperdrive, o Worker fala com um pool que a
 * propria Cloudflare mantem, e o custo de subrequests deixa de existir.
 *
 * Em desenvolvimento nao ha binding de Hyperdrive, entao cai na DATABASE_URL
 * do .dev.vars (o Postgres local do docker-compose).
 *
 * TLS: a connection string do Hyperdrive e interna a Cloudflare e nao passa
 * pela internet publica — quem mantem TLS ate o Supabase e o proprio
 * Hyperdrive, configurado com `?sslmode=require` na origem. Por isso aqui nao
 * se force `ssl`, ao contrario de criarPool.
 */
export function criarPoolDoEnv(env: EnvBanco) {
  const viaHyperdrive = env.HYPERDRIVE?.connectionString
  if (viaHyperdrive) {
    return postgres(viaHyperdrive, { prepare: false, max: 5, idle_timeout: 20 })
  }
  return criarPool(env.DATABASE_URL)
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
