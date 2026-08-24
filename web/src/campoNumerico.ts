/**
 * Impede que a roda do mouse altere campos numericos.
 *
 * `<input type="number">` responde ao scroll quando esta focado: o usuario
 * clica no preco, rola a pagina para ver o resto do formulario, e o valor
 * muda sem ele perceber. Num sistema que registra dinheiro e quantidade de
 * mercadoria isso e grave — um preco de 3,20 vira 3,25 e o erro so aparece
 * no fechamento do mes, sem ninguem saber de onde veio.
 *
 * A correcao e tirar o foco do campo quando a roda gira sobre ele. Duas
 * alternativas foram descartadas:
 *
 *   - `e.preventDefault()` impediria a mudanca, mas tambem travaria a rolagem
 *     da pagina enquanto o cursor estivesse sobre o campo — troca um problema
 *     por outro, e mais confuso.
 *   - Trocar todos os campos para `type="text"` com validacao manual perderia
 *     o teclado numerico no celular, que importa para quem lanca entrada no
 *     galpao pelo telefone.
 *
 * Com o blur, a pagina rola normalmente e o valor fica intacto. O usuario
 * perde o foco do campo — e exatamente o que ele queria ao rolar a pagina.
 *
 * As setinhas de incremento sao escondidas por CSS em index.css. Elas cabem
 * em ajuste de uma unidade, nao em digitar 1450 quilos.
 */
export function instalarGuardaDeScrollNumerico(): () => void {
  function aoRolar(e: WheelEvent) {
    const alvo = e.target
    if (
      alvo instanceof HTMLInputElement &&
      alvo.type === 'number' &&
      document.activeElement === alvo
    ) {
      alvo.blur()
    }
  }

  // `passive: true` deixa explicito que este handler nunca chama
  // preventDefault — o navegador pode rolar sem esperar por ele.
  document.addEventListener('wheel', aoRolar, { passive: true })
  return () => document.removeEventListener('wheel', aoRolar)
}
