/**
 * Descobre qual hortifruti esta entrando, sem obrigar o atendente a digitar
 * isso todo dia.
 *
 * O sistema e um so e atende varios hortifrutis (multi-tenant, isolados por
 * RLS no banco), entao o login precisa saber de quem e a sessao. Pedir num
 * campo de formulario funciona, mas e ruido diario e fonte de erro de digitacao
 * — cada cliente recebe um link proprio e o campo desaparece da tela.
 *
 * As fontes sao tentadas em ordem de intencao mais forte para mais fraca:
 *
 *   1. subdominio  bomprecoo.seucrm.com.br   (destino final, exige dominio proprio)
 *   2. caminho     /h/bom-preco              (funciona hoje, sem dominio)
 *   3. query       ?h=bom-preco              (compatibilidade com link antigo)
 *   4. nada        -> a tela mostra o campo  (cadastro novo, suporte, teste)
 *
 * O item 1 ja esta aqui de proposito: quando o dominio proprio existir, basta
 * apontar o DNS curinga e os links de subdominio passam a funcionar sozinhos,
 * sem mexer neste arquivo nem quebrar os links de caminho ja salvos pelos
 * clientes nos favoritos.
 *
 * Isto NAO e credencial. O slug e publico por natureza (vai na URL, aparece no
 * historico do navegador) e nao da acesso a nada sozinho — quem autentica sao
 * e-mail e senha, e o isolamento entre hortifrutis e garantido pela RLS no
 * banco, nunca por esconder o slug.
 */

/** Hosts onde o primeiro rotulo NAO identifica um hortifruti. */
const HOSTS_SEM_TENANT = [
  'workers.dev',   // crm-hortifruti.velasqui.workers.dev
  'pages.dev',
  'localhost',
  '127.0.0.1',
]

/**
 * Sufixos de dois rotulos. Sem esta lista, `seucrm.com.br` (3 rotulos) seria
 * lido como tendo o subdominio "seucrm", e quem abrisse o endereco raiz do
 * sistema tentaria entrar num hortifruti chamado "seucrm" — que nao existe.
 * O login falharia com "credenciais invalidas" e ninguem entenderia por que.
 */
const SUFIXOS_COMPOSTOS = ['com.br', 'net.br', 'org.br', 'app.br', 'co.uk', 'com.ar']

function doSubdominio(host: string): string {
  if (HOSTS_SEM_TENANT.some(h => host === h || host.endsWith('.' + h))) return ''

  const partes = host.split('.')
  const composto = SUFIXOS_COMPOSTOS.some(s => host.endsWith('.' + s))
  // <tenant>.<dominio>.<tld> = 3, mas <tenant>.<dominio>.com.br = 4
  const minimo = composto ? 4 : 3
  if (partes.length < minimo) return ''

  const primeiro = partes[0]
  return primeiro === 'www' ? '' : primeiro
}

function doCaminho(pathname: string): string {
  const m = pathname.match(/^\/h\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export function slugDoHortifruti(loc: Location = window.location): string {
  return (
    doSubdominio(loc.hostname) ||
    doCaminho(loc.pathname) ||
    new URLSearchParams(loc.search).get('h') ||
    ''
  ).trim().toLowerCase()
}
