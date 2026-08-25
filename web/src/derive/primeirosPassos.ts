import type { Tela } from '../telas'

/**
 * GUIA DE PRIMEIROS PASSOS — achado D-2 da auditoria
 * (docs/superpowers/auditoria-vs-prototipo.md, seção "Saúde do Negócio").
 * Portado de design/CRM Hortifruti.dc.html: markup 119-150, lógica 2774-2797.
 *
 * POR QUE ESTE MÓDULO EXISTE
 *
 * O Dashboard num sistema recém-instalado é uma parede de travessões. Cada
 * travessão está tecnicamente certo ("não há base pra medir isso ainda") e
 * nenhum deles diz o que fazer. Pior: a ordem de preenchimento não é livre —
 * não dá pra lançar uma entrada sem produto e sem fornecedor cadastrados,
 * nem uma saída sem cliente e sem estoque. Quem descobre isso tentando é
 * quem desiste. O guia troca "painel vazio e mudo" por "faltam três passos,
 * comece por aqui".
 *
 * Sem React, sem fetch, sem `new Date()`, sem `localStorage` — molde de
 * derive/clientes.ts. Quem lê o armazenamento é preferenciaGuia.ts; quem
 * desenha é DashboardTela.tsx. Aqui só a decisão.
 */

/** Os cinco passos, na ordem obrigatória. A ordem É a regra do negócio. */
export type PassoId = 'produtos' | 'fornecedores' | 'clientes' | 'entradas' | 'saidas'

/**
 * Quanto existe CADASTRADO de cada coisa — a base inteira, nunca um recorte
 * de mês (ver `guiaDePrimeirosPassos`).
 */
export interface ContagensDeCadastro {
  produtos: number
  fornecedores: number
  clientes: number
  entradas: number
  saidas: number
}

export interface PassoDoGuia {
  id: PassoId
  /** '1'…'5' — o número que aparece na bolinha quando o passo está pendente. */
  n: string
  label: string
  hint: string
  /** Rótulo do botão. Só aparece no passo atual (ver `mostrarCta`). */
  cta: string
  /** Para onde o botão leva. */
  tela: Tela
  feito: boolean
  contagem: number
  /** É o primeiro passo pendente — o único que ganha botão e destaque. */
  atual: boolean
  /** '✓' quando feito, o número do passo quando não. */
  marca: string
  /** Texto à direita: só o passo feito diz quantos existem. */
  contagemTexto: string
  mostrarCta: boolean
}

export interface GuiaDePrimeirosPassos {
  /** O painel deve ser desenhado? Ver as três razões para `false` abaixo. */
  aberto: boolean
  titulo: string
  sub: string
  /** 'N de 5'. */
  progresso: string
  /** 0-100, largura da barra. */
  barraPct: number
  feitos: number
  passos: PassoDoGuia[]
}

/** Total de passos — o "5" de "N de 5" e o denominador da barra. */
export const TOTAL_DE_PASSOS = 5

interface DefinicaoDePasso {
  id: PassoId
  label: string
  hint: string
  cta: string
  tela: Tela
  contar: (c: ContagensDeCadastro) => number
}

/**
 * Textos e ordem exatamente como no protótipo (2778-2782). O `cta` é o mesmo
 * rótulo dos botões "＋" das telas de destino, para o usuário reconhecer o
 * botão que vai procurar quando chegar lá.
 *
 * `tela` é a única coisa que NÃO veio do protótipo: lá o botão abria o modal
 * de criação direto (`this.newProduto`), porque o protótipo é um arquivo só
 * com todos os modais no mesmo componente. Aqui cada tela é dona do próprio
 * modal e não existe canal para o Dashboard abrir o modal de outra tela —
 * então o botão NAVEGA até a tela do passo, onde o mesmo botão de criar está
 * à vista. Divergência registrada no relatório da tarefa.
 */
const DEFINICOES: DefinicaoDePasso[] = [
  {
    id: 'produtos',
    label: 'Cadastrar produtos',
    hint: 'Batata, alface… com a unidade padrão',
    cta: 'Cadastrar produto',
    tela: 'produtos',
    contar: c => c.produtos,
  },
  {
    id: 'fornecedores',
    label: 'Cadastrar fornecedores',
    hint: 'Os produtores de quem você compra',
    cta: 'Cadastrar fornecedor',
    tela: 'fornecedores',
    contar: c => c.fornecedores,
  },
  {
    id: 'clientes',
    label: 'Cadastrar clientes',
    hint: 'Os minimercados que você atende',
    cta: 'Cadastrar cliente',
    tela: 'clientes',
    contar: c => c.clientes,
  },
  {
    id: 'entradas',
    label: 'Lançar a primeira entrada',
    hint: 'A compra que abastece o estoque',
    cta: 'Nova entrada',
    tela: 'entradas',
    contar: c => c.entradas,
  },
  {
    id: 'saidas',
    label: 'Lançar a primeira saída',
    hint: 'A venda entregue ao cliente',
    cta: 'Nova saída',
    // A tela de Saídas (Vendas) se chama 'pedidos' em telas.ts — nome antigo
    // preservado ali; o rótulo do menu é "Saídas (Vendas)".
    tela: 'pedidos',
    contar: c => c.saidas,
  },
]

/** Painel fechado — todos os campos preenchidos para o tipo não ter buracos. */
const FECHADO: GuiaDePrimeirosPassos = {
  aberto: false,
  titulo: '',
  sub: '',
  progresso: '',
  barraPct: 0,
  feitos: 0,
  passos: [],
}

/**
 * Monta o guia.
 *
 * PERÍODO: `contagens` tem de vir da base INTEIRA, nunca do recorte do filtro
 * global do cabeçalho. O guia é sobre o estado do CADASTRO ("já existe algum
 * produto?"), não sobre o movimento de um mês — pela mesma razão que a
 * carteira de clientes não é filtrada no Dashboard (ver a prop `periodo` em
 * DashboardTela.tsx). Filtrar faria o guia ressuscitar em janeiro dizendo
 * "cadastre um produto" para quem tem cem produtos e não comprou nada no mês.
 *
 * `contagens: null` = NÃO FOI POSSÍVEL VERIFICAR (a carga dos cadastros
 * falhou). Devolve fechado, e essa é uma decisão consciente: o guia é uma
 * DICA, não uma medida. Um painel dizendo "não consegui verificar seus
 * cadastros" ocupa o lugar mais nobre da tela com uma frase sem ação, e
 * apareceria do nada numa conta madura só porque a rede oscilou — exatamente
 * o ruído que este guia existe para evitar. O que nunca pode acontecer é
 * dizer "cadastre um produto" para quem tem cem e sofreu um erro de rede.
 *
 * `dispensado` = o usuário fechou o painel (ver preferenciaGuia.ts). Fechar
 * é definitivo neste navegador, inclusive se os dados regredirem depois:
 * reabrir sozinho algo que a pessoa fechou de propósito é pior que qualquer
 * dado que ela deixe de ver.
 */
export function guiaDePrimeirosPassos(
  contagens: ContagensDeCadastro | null,
  dispensado = false,
): GuiaDePrimeirosPassos {
  if (!contagens || dispensado) return FECHADO

  const base = DEFINICOES.map((d, i) => {
    const contagem = Math.max(0, Math.trunc(d.contar(contagens) || 0))
    return { def: d, n: String(i + 1), contagem, feito: contagem > 0 }
  })

  const atual = base.find(p => !p.feito)
  const feitos = base.filter(p => p.feito).length

  /**
   * QUANDO O GUIA SOME — E QUANDO ELE VOLTA
   *
   * No protótipo é `guiaAberto = !!passoAtual` (2794): puro reflexo do dado,
   * então apagar um produto anos depois traria o painel de onboarding de
   * volta no meio da operação. Aqui a régua é a ÚLTIMA linha, a primeira
   * saída lançada:
   *
   *   - Nenhuma saída na base  -> ninguém completou o funil ainda: o guia
   *     aparece com os passos que faltam. Cobre tanto o sistema recém-aberto
   *     quanto quem apagou tudo e voltou ao zero — esse REVÊ o guia, que é o
   *     que ele precisa.
   *   - Existe pelo menos uma saída -> a operação já atravessou a cadeia
   *     inteira (produto -> fornecedor -> cliente -> entrada -> saída) pelo
   *     menos uma vez. Se um dia sumirem os produtos, isso é um problema de
   *     operação madura, e quem avisa são os indicadores e o Estoque, não um
   *     painel de primeiros passos reaparecendo do nada.
   *
   * A regra é derivada do próprio dado — não precisa de flag "já concluiu"
   * gravada em lugar nenhum, e por isso vale igual em qualquer navegador,
   * celular ou computador novo, sem depender de storage nem de coluna nova.
   *
   * Consequência: quando o passo 5 está feito, o painel fecha mesmo que
   * falte algum dos quatro anteriores — e o caso "os cinco cumpridos" é um
   * caso particular desse. Por isso o título de "tudo pronto" do protótipo
   * (2795-2796) é inalcançável, lá e aqui: o painel fecha exatamente quando
   * ele seria exibido.
   */
  const graduado = base[TOTAL_DE_PASSOS - 1].feito
  if (graduado || !atual) return FECHADO

  const passos: PassoDoGuia[] = base.map(p => ({
    id: p.def.id,
    n: p.n,
    label: p.def.label,
    hint: p.def.hint,
    cta: p.def.cta,
    tela: p.def.tela,
    feito: p.feito,
    contagem: p.contagem,
    atual: p.n === atual.n,
    marca: p.feito ? '✓' : p.n,
    // Protótipo 2792: 'cadastrado(s)' para os cinco, inclusive entradas e
    // saídas, que são lançamentos e não cadastros. Mantido como está lá —
    // a divergência está registrada no relatório da tarefa.
    contagemTexto: p.feito ? `${p.contagem} cadastrado(s)` : '',
    mostrarCta: !p.feito && p.n === atual.n,
  }))

  return {
    aberto: true,
    titulo: `Próximo passo: ${atual.def.label}`,
    sub: 'Siga a ordem — cada passo depende do anterior.',
    progresso: `${feitos} de ${TOTAL_DE_PASSOS}`,
    barraPct: Math.round((feitos / TOTAL_DE_PASSOS) * 100),
    feitos,
    passos,
  }
}
