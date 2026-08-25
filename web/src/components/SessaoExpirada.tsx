import { Login } from '../screens/Login'
import './SessaoExpirada.css'

interface SessaoExpiradaProps {
  /** Entrou de novo com sucesso — quem chama confere QUEM entrou. */
  onEntrar: () => void
  /** Desistir: encerra de vez e vai para a tela de login limpa. */
  onSair: () => void
}

/**
 * A sessao expirou COM A TELA CHEIA. O que nao pode acontecer aqui e o
 * trabalho digitado sumir.
 *
 * O COMPORTAMENTO ANTIGO, E POR QUE ELE NAO SERVE MAIS
 *
 * Ate aqui, `onSessaoExpirada` era o proprio `sair()`: qualquer 401 zerava
 * `eu`/`tela` e o App voltava a renderizar `<Login />`. Isso DESMONTA a
 * arvore inteira. Com a politica de 7 dias isso quase nunca acontecia — a
 * sessao so caia se o dono clicasse em sair. Com 30 minutos de inatividade
 * passa a ser rotina, e a rotina seria: o funcionario digita um pedido de
 * vinte itens, clica em salvar, e a tela vira o login com tudo perdido e sem
 * uma palavra de aviso. Perder a venda digitada e pior do que o risco que o
 * timeout evita.
 *
 * O QUE FAZ AGORA
 *
 * Este componente e uma CAMADA POR CIMA. O `Shell`, a tela e o modal aberto
 * continuam montados atras dele — React preserva o estado de tudo que nao
 * desmonta, entao o formulario continua preenchido, byte por byte. Quem
 * autentica de novo cai exatamente onde estava e so precisa clicar em salvar
 * de novo.
 *
 * O formulario e o `Login` de verdade, o mesmo da entrada do sistema, e nao
 * uma copia: a mensagem generica de credencial invalida, o campo de empresa
 * que so aparece quando o slug nao veio na URL e o `autoComplete` sao regras
 * que nao podem divergir entre os dois lugares onde se digita senha.
 *
 * "NAO SOU EU" e a saida para o outro caso — o funcionario que encontrou a
 * maquina com a sessao do dono vencida na tela. Ele nao tem a senha do dono e
 * nao deve ficar preso num formulario que so aceita ela: o botao descarta a
 * sessao e leva a tela de login limpa, o mesmo caminho do "Trocar de
 * usuario" do menu. O que estava digitado se perde, mas ai e escolha
 * explicita de quem clicou, avisada na propria linha do botao — nao um
 * descarte silencioso.
 */
export function SessaoExpirada({ onEntrar, onSair }: SessaoExpiradaProps) {
  return (
    <div
      className="sessao-expirada-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sessao-expirada-titulo"
    >
      <div className="sessao-expirada-aviso" role="alert">
        <div className="sessao-expirada-titulo" id="sessao-expirada-titulo">
          Sessão expirada por inatividade
        </div>
        <p className="sessao-expirada-texto">
          Nada do que você digitou foi perdido. Entre de novo e a tela volta
          exatamente como estava — inclusive o formulário aberto.
        </p>
        <button type="button" className="sessao-expirada-desistir" onClick={onSair}>
          Não sou eu — trocar de usuário (descarta o que está na tela)
        </button>
      </div>
      <Login onEntrar={onEntrar} />
    </div>
  )
}
