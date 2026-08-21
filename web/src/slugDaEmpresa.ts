/**
 * Descobre qual empresa esta entrando no sistema.
 *
 * O sistema e um so e atende varias empresas (multi-tenant, isoladas por RLS
 * no banco). Depois do login isso deixa de importar: o tenant passa a vir da
 * sessao, e as telas usam caminhos limpos — /clientes, /financeiro, /estoque.
 * O unico momento que precisa identificar a empresa e o login, quando ainda
 * nao existe sessao.
 *
 * Fontes, em ordem de intencao:
 *
 *   1. subdominio   velasqui.seucrm.com.br   destino final
 *   2. query        ?e=velasqui              ponte, ate o dominio existir
 *   3. nada         -> a tela mostra o campo  cadastro, suporte, teste
 *
 * DELIBERADAMENTE FORA: identificar a empresa pelo primeiro segmento do
 * caminho (/velasqui). Foi implementado e removido — ele colide com as rotas
 * do proprio sistema. Com /velasqui significando empresa e /clientes
 * significando tela, nao ha como distinguir os dois, e uma empresa cadastrada
 * como "estoque" ou "financeiro" quebraria de um jeito que so apareceria no
 * dia em que aquele cliente entrasse. A query string nao tem esse problema
 * porque nunca e confundida com rota.
 *
 * Isto NAO e credencial. O slug e publico por natureza — vai na URL e no
 * historico do navegador — e nao da acesso a nada sozinho. Quem autentica sao
 * e-mail e senha, e o isolamento entre empresas e garantido pela RLS no banco,
 * nunca por esconder o slug.
 */

/** Hosts onde o primeiro rotulo NAO identifica uma empresa. */
const HOSTS_SEM_TENANT = [
  'workers.dev',   // crm-hortifruti.velasqui.workers.dev
  'pages.dev',
  'localhost',
  '127.0.0.1',
]

/**
 * Sufixos de dois rotulos. Sem esta lista, `seucrm.com.br` (3 rotulos) seria
 * lido como tendo o subdominio "seucrm", e quem abrisse o endereco raiz do
 * sistema tentaria entrar numa empresa chamada "seucrm" — que nao existe. O
 * login falharia com "credenciais invalidas" e ninguem entenderia por que.
 */
const SUFIXOS_COMPOSTOS = ['com.br', 'net.br', 'org.br', 'app.br', 'co.uk', 'com.ar']

function doSubdominio(host: string): string {
  if (HOSTS_SEM_TENANT.some(h => host === h || host.endsWith('.' + h))) return ''

  const partes = host.split('.')
  const composto = SUFIXOS_COMPOSTOS.some(s => host.endsWith('.' + s))
  // <empresa>.<dominio>.<tld> = 3, mas <empresa>.<dominio>.com.br = 4
  const minimo = composto ? 4 : 3
  if (partes.length < minimo) return ''

  const primeiro = partes[0]
  return primeiro === 'www' ? '' : primeiro
}

export function slugDaEmpresa(loc: Location = window.location): string {
  return (
    doSubdominio(loc.hostname) ||
    new URLSearchParams(loc.search).get('e') ||
    ''
  ).trim().toLowerCase()
}
