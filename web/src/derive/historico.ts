import { dataBrCurta } from './pagamento'

/**
 * Formatação e leitura do histórico de alterações dos cadastros (cliente,
 * produto, fornecedor).
 *
 * Tudo aqui é função pura, testada à parte — o componente só exibe o que
 * estas funções respondem. É a regra do projeto, e neste caso ela tem um
 * motivo extra: as palavras deste módulo são a diferença entre um log honesto
 * e um log que acusa alguém. "Declarado por" e "editado por" são frases
 * diferentes sobre evidências diferentes, e quem decide qual sai na tela é
 * `textoDoAutor` aqui embaixo, com teste, não um `?:` perdido no JSX.
 */

/** As três entidades que têm histórico. Espelha `ENTIDADES_HISTORICO` na API
 * e o CHECK de `historico_cadastros` (migration 017). */
export type EntidadeHistorico = 'cliente' | 'produto' | 'fornecedor'

/** Um campo que mudou, com de/para, como a API grava em `alteracoes`. */
export interface AlteracaoHistorico {
  campo: string
  de: string
  para: string
}

/** Uma linha, como chega de `GET /api/historico/:entidade/:id`. */
export interface RegistroHistorico {
  id: string
  entidade: string
  registro_id: string
  /** Nome do cadastro NO MOMENTO do evento — snapshot, não join. É o que
   * sobrevive à exclusão do registro. */
  registro_nome: string
  acao: string
  /** 'declarado' (colaborador escolheu um nome) ou 'login' (admin
   * autenticado). A coluna que impede a tela de chamar declaração de prova. */
  autor_origem: string
  autor_nome: string
  /** Vira `null` quando o funcionário declarado é excluído — o NOME acima
   * continua. Ver `on delete set null (autor_funcionario_id)` na 017. */
  autor_funcionario_id: string | null
  motivo: string
  alteracoes: AlteracaoHistorico[]
  /** 'AAAA-MM-DDTHH:MM', já no fuso de São Paulo (formatado pelo Postgres). */
  criado_em: string
}

/** Item do seletor "quem está fazendo esta alteração" — `GET
 * /api/funcionarios/opcoes` devolve exatamente estes dois campos, e nada
 * mais (nunca salário). */
export interface FuncionarioOpcao {
  id: string
  nome: string
}

/**
 * O carimbo de data e hora de uma linha: '28/08/2026 14:32'.
 *
 * REUSA `dataBrCurta` (derive/pagamento.ts) para o dia/mês em vez de
 * reescrever um formatador de data — aquele arquivo já registra que escrever
 * um segundo seria a duplicação que ele evitou uma vez.
 *
 * O ANO E A HORA ENTRAM, e é aqui que este carimbo se afasta de propósito do
 * `dataBrCurta` puro. Lá o ano fica de fora porque a sub-linha acompanha um
 * pedido do período em vista, onde o ano é redundante. Num log de auditoria
 * não é: a pergunta "quando isso mudou?" pode ser sobre dois anos atrás, e
 * duas alterações no mesmo dia só se distinguem pela hora.
 *
 * `null` para data ausente ou fora do formato — nunca uma data inventada nem
 * a string crua vazando para a tela, mesma regra de `dataBrCurta`.
 */
export function carimboDeHistorico(iso: string | null | undefined): string | null {
  const diaMes = dataBrCurta(iso)
  if (!diaMes) return null
  const texto = String(iso)
  // `dataBrCurta` só devolve não-nulo quando o texto começa com AAAA-MM-DD,
  // então os quatro primeiros caracteres são o ano.
  const ano = texto.slice(0, 4)
  const hora = texto.match(/[T ](\d{2}):(\d{2})/)
  return hora ? `${diaMes}/${ano} ${hora[1]}:${hora[2]}` : `${diaMes}/${ano}`
}

/**
 * Rótulo humano de cada campo, POR ENTIDADE.
 *
 * Por entidade, e não um mapa único, porque `nome` significa coisas
 * diferentes em cada uma — "Nome do estabelecimento", "Nome do produto",
 * "Nome do produtor". Um rótulo genérico ("Nome") seria pior em três telas
 * para economizar duas linhas aqui.
 *
 * Os textos são os mesmos dos formulários (ModalCliente/ModalProduto/
 * ModalFornecedor), de propósito: o admin lê no log o nome do campo que o
 * colaborador viu na hora de mexer.
 */
const ROTULOS: Record<EntidadeHistorico, Record<string, string>> = {
  cliente: {
    nome: 'Nome do estabelecimento',
    resp: 'Responsável / comprador',
    cnpj: 'CNPJ / CPF',
    tel: 'Telefone / WhatsApp',
    email: 'E-mail',
    endereco: 'Endereço',
    rota: 'Região / rota',
    freq: 'Frequência de entrega',
    status: 'Status',
    forma: 'Forma de pagamento',
    limite: 'Limite de crédito',
    prazo: 'Prazo de pagamento (dias)',
    tend: 'Tendência',
    obs: 'Observações',
    // `cobranca` é campo fantasma (ver derive/clientes.ts): nenhuma tela o
    // escreve. Fica no mapa porque a API ainda o trafega — se um dia mudar,
    // o log tem que saber dizer o nome dele em vez de mostrar a coluna crua.
    cobranca: 'Situação de cobrança (campo antigo)',
  },
  produto: {
    nome: 'Nome do produto',
    un: 'Unidade padrão',
    peso_medio: 'Peso médio da embalagem (kg)',
  },
  fornecedor: {
    nome: 'Nome do produtor / fazenda',
    regiao: 'Região',
    contato: 'Telefone / contato',
    // Campo SINTÉTICO: não é coluna de `fornecedores`, é a relação
    // `fornecedor_produtos` que o PUT sincroniza. Entra no rastro porque é
    // cadastro que o colaborador edita — deixá-lo de fora permitiria trocar
    // tudo que um produtor entrega sem registro nenhum.
    produtos: 'Produtos fornecidos',
  },
}

/**
 * O rótulo do campo, ou o nome cru da coluna quando ele não está no mapa.
 *
 * O fallback é deliberado e é o comportamento honesto: uma coluna nova na API
 * cujo rótulo ninguém escreveu ainda aparece como `nome_da_coluna`, feia mas
 * presente. Esconder a linha seria um log que omite uma alteração que
 * aconteceu — o único desfecho pior que um rótulo feio.
 */
export function rotuloDoCampo(entidade: string, campo: string): string {
  const mapa = ROTULOS[entidade as EntidadeHistorico]
  return mapa?.[campo] ?? campo
}

/** Travessão para valor vazio — e SÓ para vazio. */
export const VAZIO = '—'

/**
 * O valor de um lado do de/para, pronto para a tela.
 *
 * Vazio vira travessão; QUALQUER outra coisa sai como veio, inclusive '0'.
 * A regra do projeto tem as duas metades e as duas importam aqui: travessão
 * nunca vira zero (um limite que não existia não pode virar "R$ 0") e zero
 * nunca vira travessão (um limite que FOI zerado é a informação inteira
 * daquela linha do log — some justamente na alteração que o dono ia querer
 * ver).
 */
export function valorParaLeitura(v: string | null | undefined): string {
  const texto = String(v ?? '')
  return texto.trim() === '' ? VAZIO : texto
}

/**
 * O que aconteceu, em português. Ação desconhecida sai como veio, pelo mesmo
 * motivo do fallback de `rotuloDoCampo`.
 */
export function textoDaAcao(acao: string): string {
  if (acao === 'criou') return 'Cadastro criado'
  if (acao === 'editou') return 'Cadastro alterado'
  if (acao === 'excluiu') return 'Cadastro excluído'
  return acao
}

/**
 * QUEM — e esta é a função mais importante do arquivo.
 *
 * 'declarado' → "Declarado por Fulano". A palavra é essa e não outra. O
 * sistema NÃO SABE que foi o Fulano: existe um login para a equipe inteira,
 * e o que há é um nome que a pessoa escolheu de uma lista ao salvar. Escrever
 * "Editado por Fulano" seria afirmar uma autenticação que nunca houve —
 * chamar declaração de prova é mentir sobre a própria evidência, e no dia em
 * que este log importar (um limite de crédito mexido, um preço trocado) o
 * dono precisa saber que tipo de registro tem na mão ANTES de acusar alguém.
 *
 * 'login' → "Registrado no login de Fulana". Aqui o sistema sabe: a conta de
 * admin é individual. Também não diz "editado por", e por um motivo mais
 * modesto — o que se prova é qual conta estava aberta, não quem estava na
 * cadeira. É menos do que "autenticado" e é o que dá para afirmar.
 */
export function textoDoAutor(registro: Pick<RegistroHistorico, 'autor_origem' | 'autor_nome'>): string {
  if (registro.autor_origem === 'login') return `Registrado no login de ${registro.autor_nome}`
  return `Declarado por ${registro.autor_nome}`
}

/**
 * O aviso de rodapé do painel, que explica a diferença uma vez para todas as
 * linhas. `null` quando não há nenhuma linha declarada — um aviso sobre
 * declaração num histórico só de admin seria ruído, e ruído é o que faz um
 * aviso deixar de ser lido.
 */
export function avisoDeDeclaracao(registros: readonly Pick<RegistroHistorico, 'autor_origem'>[]): string | null {
  if (!registros.some(r => r.autor_origem === 'declarado')) return null
  return 'Os nomes marcados como "Declarado por" foram informados por quem salvou, '
    + 'escolhidos de uma lista de funcionários. A equipe usa um único login, então '
    + 'o sistema não verifica quem digitou — isto é uma declaração, não uma comprovação.'
}

/**
 * Resumo de uma linha para leitura corrida: "3 campos alterados", "Cadastro
 * criado". `alteracoes` vazio em 'criou'/'excluiu' é afirmação, não lacuna —
 * ver o comentário da coluna na migration 017.
 */
export function resumoDaLinha(registro: Pick<RegistroHistorico, 'acao' | 'alteracoes'>): string {
  if (registro.acao !== 'editou') return textoDaAcao(registro.acao)
  const n = registro.alteracoes.length
  if (n === 0) return textoDaAcao(registro.acao)
  return n === 1 ? '1 campo alterado' : `${n} campos alterados`
}
