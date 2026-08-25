import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  instalarSinalDePresenca,
  JANELA_DE_AGRUPAMENTO_MS,
  EVENTOS_DE_PRESENCA,
} from './presenca'

// Relogio falso para o arquivo inteiro. Nao e so conveniencia de nao esperar
// tres minutos: `vi.advanceTimersByTime` tambem EXECUTA qualquer timer
// pendente, e e isso que da valor ao teste da pagina parada — se alguem
// trocar este desenho por um `setInterval` que pinga sozinho, o timer roda
// dentro do avanco e o teste quebra.
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const MINUTO = 60_000

/** Um evento que sobe pela arvore, como os de verdade. Nao usa
 * `new PointerEvent`/`new TouchEvent` de proposito: o jsdom nao traz os dois
 * construtores, e o codigo sob teste nunca olha para o conteudo do evento. */
function disparar(tipo: string, alvo: EventTarget = document.body) {
  alvo.dispatchEvent(new Event(tipo, { bubbles: true }))
}

describe('sinal de presenca — atividade real mantem a sessao viva', () => {
  it('uma tecla depois da janela manda o sinal', () => {
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar('keydown')

    expect(enviar).toHaveBeenCalledOnce()
  })

  it.each(EVENTOS_DE_PRESENCA)('%s conta como presenca', (evento) => {
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar(evento)

    expect(enviar).toHaveBeenCalledOnce()
  })

  it('o evento e visto mesmo dentro de um modal que corta o borbulhamento', () => {
    // Os dez modais do sistema chamam `e.stopPropagation()` no clique do
    // proprio card (ver o <form onClick> em ModalSaida.tsx) para que clicar
    // dentro nao feche o modal. Um ouvinte de borbulhamento em `document`
    // nunca veria esse clique — e o modal e justamente onde ficam os
    // formularios longos que este mecanismo existe para proteger. Por isso a
    // escuta e na fase de CAPTURA. Este teste morre se alguem tirar o
    // `capture: true`.
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    const modal = document.createElement('div')
    document.body.appendChild(modal)
    modal.addEventListener('pointerdown', e => e.stopPropagation())
    const campo = document.createElement('input')
    modal.appendChild(campo)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar('pointerdown', campo)

    expect(enviar).toHaveBeenCalledOnce()
    modal.remove()
  })
})

describe('sinal de presenca — a pagina parada nao fala com o servidor', () => {
  it('uma hora inteira sem ninguem na frente da tela nao gera sinal nenhum', () => {
    // O CORACAO DA POLITICA. Um `setInterval` pingando sozinho manteria viva
    // a sessao do dono na maquina do balcao a noite inteira — anularia a
    // mudanca de seguranca por completo. `advanceTimersByTime` executa
    // qualquer timer que exista, entao este teste so passa enquanto nao
    // houver nenhum.
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(60 * MINUTO)

    expect(enviar).not.toHaveBeenCalled()
  })

  it('mexer o mouse e rolar a pagina NAO contam como presenca', () => {
    // Deliberadamente fora (ver o comentario em EVENTOS_DE_PRESENCA): um
    // mousemove acidental — mesa que treme, gato — seguraria a sessao por
    // mais meia hora, e `scroll` sai de rolagem programatica.
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar('mousemove')
    disparar('scroll')
    disparar('mouseover')

    expect(enviar).not.toHaveBeenCalled()
  })

  it('depois da limpeza, digitar nao manda mais nada', () => {
    const enviar = vi.fn()
    const limpar = instalarSinalDePresenca(enviar)

    limpar()
    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar('keydown')

    expect(enviar).not.toHaveBeenCalled()
  })
})

describe('sinal de presenca — agrupamento', () => {
  it('digitar um pedido inteiro manda UM sinal por janela, nao um por tecla', () => {
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    // Alguem preenchendo o campo de observacoes de uma saida.
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(200)
      disparar('keydown')
    }

    // 200 teclas em 40 segundos: uma janela so.
    expect(enviar).toHaveBeenCalledOnce()
  })

  it('dentro da janela nao repete; passada a janela, manda de novo', () => {
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS + 1)
    disparar('keydown')
    expect(enviar).toHaveBeenCalledTimes(1)

    // Ainda dentro da janela do primeiro sinal.
    vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS - 1000)
    disparar('keydown')
    expect(enviar).toHaveBeenCalledTimes(1)

    // Passou.
    vi.advanceTimersByTime(2000)
    disparar('keydown')
    expect(enviar).toHaveBeenCalledTimes(2)
  })

  it('quarenta minutos digitando um pedido longo mantem o sinal saindo', () => {
    // O caso que motivou o arquivo: o formulario nao fala com a API enquanto
    // e preenchido, entao SO este mecanismo mantem a sessao viva. Uma tecla
    // por minuto durante 40 minutos tem que produzir sinal em todas as
    // janelas de 3 minutos — nunca um silencio de 30, que derrubaria a
    // sessao e perderia a venda inteira no clique de salvar.
    const enviar = vi.fn()
    const emQueMinuto: number[] = []
    instalarSinalDePresenca(() => { enviar(); emQueMinuto.push(minuto) })

    let minuto = 0
    for (; minuto < 40; minuto++) {
      vi.advanceTimersByTime(MINUTO)
      disparar('keydown')
    }

    expect(enviar.mock.calls.length).toBeGreaterThanOrEqual(13)
    // Nenhum intervalo entre sinais chega perto dos 30 minutos da politica.
    const intervalos = emQueMinuto.map((m, i) => m - (emQueMinuto[i - 1] ?? 0))
    expect(Math.max(...intervalos)).toBeLessThanOrEqual(3)
  })

  it('o primeiro clique logo depois de abrir o app nao gasta requisicao', () => {
    // Montar o app ja fez um `GET /api/eu`: a sessao acabou de ser renovada e
    // tem a janela inteira pela frente. Se o relogio comecasse em zero, o
    // primeiro clique de todo mundo mandaria um sinal inutil.
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar)

    vi.advanceTimersByTime(MINUTO)
    disparar('keydown')

    expect(enviar).not.toHaveBeenCalled()
  })

  it('a janela e configuravel e e ela que manda (nao um numero solto no meio do codigo)', () => {
    const enviar = vi.fn()
    instalarSinalDePresenca(enviar, { janelaMs: 10_000 })

    vi.advanceTimersByTime(9_000)
    disparar('keydown')
    expect(enviar).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2_000)
    disparar('keydown')
    expect(enviar).toHaveBeenCalledOnce()
  })

  it('o relogio injetado e o que vale — nao ha outra fonte de tempo escondida', () => {
    const enviar = vi.fn()
    let relogio = 1_000_000
    instalarSinalDePresenca(enviar, { agora: () => relogio })

    // O relogio do vitest anda; o injetado nao. Nada deve sair.
    vi.advanceTimersByTime(10 * MINUTO)
    disparar('keydown')
    expect(enviar).not.toHaveBeenCalled()

    relogio += JANELA_DE_AGRUPAMENTO_MS + 1
    disparar('keydown')
    expect(enviar).toHaveBeenCalledOnce()
  })
})
