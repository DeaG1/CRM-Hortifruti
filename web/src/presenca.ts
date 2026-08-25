/**
 * SINAL DE PRESENCA — mantem viva a sessao de quem esta ali, e so de quem
 * esta ali.
 *
 * O PROBLEMA QUE ESTE ARQUIVO EXISTE PARA RESOLVER
 *
 * O servidor derruba a sessao depois de 30 minutos sem requisicao autenticada
 * (MINUTOS_DE_INATIVIDADE, api/src/auth.ts). "Sem requisicao" nao e a mesma
 * coisa que "sem usuario". Um funcionario preenchendo uma saida com vinte
 * itens digita por quarenta minutos sem que o navegador fale com a API nem
 * uma vez: o formulario e todo local ate o clique em salvar. Pela contagem de
 * trafego HTTP ele esta inativo ha quarenta minutos. Pela realidade ele nao
 * parou um segundo. Se a sessao cair nesse clique, ele perde a venda inteira
 * digitada — um prejuizo maior do que o risco que o timeout evita.
 *
 * A CORRECAO E MEDIR PRESENCA, NAO TRAFEGO. Tecla, clique e toque sao prova
 * de que ha alguem na frente da tela. Enquanto houver, a sessao anda para
 * frente. Quem saiu para o almoco nao produz nenhum desses eventos e cai como
 * previsto — que e o objetivo da politica.
 *
 * O ERRO CLASSICO, E POR QUE ESTE CODIGO NAO O COMETE
 *
 * A implementacao obvia e um `setInterval` que pinga a API de tempos em
 * tempos. Isso ANULA A POLITICA INTEIRA: a aba esquecida aberta no balcao,
 * com ninguem por perto, pinga a noite toda e a sessao do dono nunca expira —
 * exatamente o cenario que a mudanca queria fechar, agora com uma renovacao
 * automatica em cima. Aqui NAO HA TIMER NENHUM. O unico caminho que leva a um
 * envio comeca num evento de entrada do usuario. Pagina parada, zero envios.
 *
 * COMO O AGRUPAMENTO FUNCIONA (throttle de borda de subida)
 *
 * Sem freio, digitar viraria uma requisicao por tecla. O freio aqui e a
 * comparacao com o horario do ultimo envio: o primeiro evento depois da
 * janela envia NA HORA e marca o relogio; todos os eventos seguintes dentro
 * da janela nao fazem nada. Sai no maximo um sinal por janela, e ele sai no
 * instante da interacao real — nao depois, em algum timer.
 *
 * Foi escolhido de borda de SUBIDA (envia primeiro, silencia depois) e nao de
 * descida (espera a janela e envia no fim) porque a de descida precisaria de
 * um `setTimeout` pendente, que e um sinal agendado — e sinal agendado e o
 * que a pagina parada nao pode ter.
 *
 * A CONTA DA JANELA, ATE O FIM
 *
 * Janela do cliente 3 minutos; o servidor so grava quando restam menos de 25
 * dos 30 (MINUTOS_RESTANTES_PARA_RENOVAR). Encadeando os dois, uma sessao em
 * uso continuo grava a cada ~6 minutos, e no pior caso a sessao morre ~24
 * minutos depois da ultima interacao real em vez de 30 (a ultima tecla pode
 * cair logo depois de um sinal que nao chegou a renovar nada). Para o
 * objetivo — a maquina compartilhada nao ficar aberta no horario do almoco —
 * 24 ou 30 da no mesmo. O que importa e que os 40 minutos digitando um pedido
 * agora contam como atividade.
 */

/**
 * Os tres eventos, e por que sao estes tres.
 *
 * `keydown` cobre digitacao — o caso que motivou o arquivo. `pointerdown`
 * cobre clique de mouse, toque em tela e caneta de uma vez so (Pointer Events
 * unifica os tres; o Chrome do balcao e os celulares do galpao suportam).
 * `touchstart` fica como rede para navegador antigo que nao emita pointer.
 *
 * DELIBERADAMENTE FORA: `mousemove` e `scroll`. Movimento de mouse nao prova
 * presenca — um mouse encostado numa mesa que treme, ou um gato, geram
 * mousemove; e um unico mousemove acidental seguraria a sessao por mais meia
 * hora. `scroll` e disparado por rolagem programatica (um `scrollIntoView`
 * ao abrir um modal), o que seria o `setInterval` disfarcado. Tecla, clique e
 * toque exigem uma pessoa decidindo alguma coisa.
 */
export const EVENTOS_DE_PRESENCA = ['keydown', 'pointerdown', 'touchstart'] as const

/** Um sinal a cada 3 minutos, no maximo. Ver "A CONTA DA JANELA" acima. */
export const JANELA_DE_AGRUPAMENTO_MS = 3 * 60_000

interface Opcoes {
  /** Relogio injetavel — e o que deixa o agrupamento ser testado sem esperar
   * tres minutos de verdade. O padrao chama `Date.now()` em toda invocacao
   * (nao guarda a referencia), entao um spy em `Date.now` tambem funciona. */
  agora?: () => number
  janelaMs?: number
}

/**
 * Instala os ouvintes e devolve a funcao de limpeza — mesma forma de
 * `instalarGuardaDeScrollNumerico` (campoNumerico.ts), pronta para ser
 * devolvida direto de um `useEffect`.
 *
 * `capture: true` NAO E DETALHE. Os modais do sistema chamam
 * `e.stopPropagation()` no clique do proprio card (ver o `<form onClick>` em
 * ModalSaida.tsx e nos outros nove modais) para que clicar dentro nao feche o
 * modal. React chama `stopPropagation` tambem no evento nativo, e o ouvinte
 * do React mora no container da aplicacao — abaixo de `document`. Ou seja: um
 * ouvinte de borbulhamento em `document` NAO VERIA nenhum clique dado dentro
 * de um modal, que e justo onde os formularios longos vivem. Na fase de
 * captura o evento passa por `document` antes de chegar ao alvo, e nada
 * embaixo consegue impedir isso.
 *
 * `passive: true` diz ao navegador que nenhum destes handlers vai chamar
 * `preventDefault`, entao rolagem e toque nao esperam por eles.
 */
export function instalarSinalDePresenca(
  enviar: () => void,
  { agora = () => Date.now(), janelaMs = JANELA_DE_AGRUPAMENTO_MS }: Opcoes = {},
): () => void {
  // Comeca marcado com o horario da instalacao, e nao com zero, de proposito:
  // a aplicacao acabou de perguntar `GET /api/eu` ao montar, entao a sessao ja
  // esta fresca. Zero aqui faria o primeiro clique da sessao gastar uma
  // requisicao para renovar o que ja tinha 30 minutos pela frente.
  let ultimoEnvio = agora()

  function aoInteragir() {
    const t = agora()
    if (t - ultimoEnvio < janelaMs) return
    ultimoEnvio = t
    enviar()
  }

  const opcoes = { capture: true, passive: true } as const
  for (const evento of EVENTOS_DE_PRESENCA) {
    document.addEventListener(evento, aoInteragir, opcoes)
  }
  return () => {
    for (const evento of EVENTOS_DE_PRESENCA) {
      // O `capture` tem que bater com o da instalacao, senao o navegador nao
      // encontra o ouvinte e a limpeza nao limpa nada.
      document.removeEventListener(evento, aoInteragir, { capture: true })
    }
  }
}
