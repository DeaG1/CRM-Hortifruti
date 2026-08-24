import { useRef, useState, type ChangeEvent } from 'react'
import { valorSelecionavelPagamento, rotuloOpcaoPendente, type SituacaoPagamentoEscolhivel } from '../derive/pagamento'
import './SeletorPagamento.css'

// Mesma paleta que EntradasLista/SaidasLista já usavam pro badge estático
// (PAGO_INFO em EntradasLista.tsx, COR_PAG/BG_PAG em SaidasLista.tsx) — as
// duas telas usam as mesmas três cores, então fica centralizado aqui em vez
// de duplicado nos dois lugares.
const CORES: Record<string, { cor: string; bg: string }> = {
  Pago: { cor: '#3f8f5b', bg: '#e7f1e8' },
  Pendente: { cor: '#c79320', bg: '#f6efd8' },
  Atrasado: { cor: '#c2502f', bg: '#f6e4dc' },
}

interface SeletorPagamentoProps {
  /** Situação a EXIBIR agora (já com "Atrasado" derivado pelo chamador,
   * quando fizer sentido — ver web/src/derive/pagamento.ts). */
  situacao: string
  /** Grava a nova escolha ('Pago' ou 'Pendente') na API. Deve REJEITAR
   * (throw/Promise rejeitada) se a chamada falhar — o seletor reverte
   * sozinho pro valor anterior nesse caso; se resolver, espera-se que quem
   * chamou já tenha atualizado o dado "de verdade" (a linha na lista), que
   * volta pra cá pela prop `situacao` no próximo render. */
  aoEscolher: (nova: SituacaoPagamentoEscolhivel) => Promise<void>
  /** Nome acessível do campo, ex.: "Pagamento da entrada C-1041" — o
   * `<select>` já anuncia o valor selecionado sozinho (nativo), isto só dá
   * contexto de QUAL linha é essa quando navegando por teclado/leitor de
   * tela numa tabela com várias. */
  rotulo: string
}

/**
 * Chip de status de pagamento (Entradas/Saídas), agora um `<select>` nativo
 * editável direto na linha da tabela — troca de "Pendente" pra "Pago" (e
 * vice-versa) sem abrir o modal. Oferece só essas duas opções: "Atrasado" é
 * sempre calculado (derive/pagamento.ts), nunca uma escolha aqui.
 *
 * `<select>` nativo (não um menu customizado) de propósito — funciona por
 * teclado e anuncia o valor atual pro leitor de tela sem nenhum código
 * extra, mesma convenção já usada nos modais (ModalEntrada/ModalSaida).
 */
export function SeletorPagamento({ situacao, aoEscolher, rotulo }: SeletorPagamentoProps) {
  // Sobrepõe `situacao` enquanto uma escolha está em voo ou acabou de
  // falhar — null significa "confia na prop" (o valor de verdade, vindo da
  // lista). Guardamos a ESCOLHA (Pago/Pendente), não uma "situação exibida"
  // computada: é exatamente o que o <option> escolhido tinha como `value`.
  const [otimista, setOtimista] = useState<SituacaoPagamentoEscolhivel | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [falhou, setFalhou] = useState(false)
  // Trava de reentrancia checada de forma SINCRONA — o guard via estado
  // `salvando` sozinho tem uma janela: dois `change` disparados antes do
  // React re-renderizar com `disabled` ainda deixariam a segunda chamada
  // passar. Um ref muda na hora, sem esperar o próximo render.
  const emVooRef = useRef(false)

  const exibida = otimista ?? situacao
  const cores = CORES[exibida] ?? CORES.Pendente
  const valorSelect = valorSelecionavelPagamento(exibida)
  const rotuloPendente = rotuloOpcaoPendente(exibida)

  async function aoMudar(e: ChangeEvent<HTMLSelectElement>) {
    if (emVooRef.current) return // clique duplo rápido: ignora a segunda mudança em voo
    const nova = e.target.value as SituacaoPagamentoEscolhivel
    emVooRef.current = true
    setFalhou(false)
    setOtimista(nova)
    setSalvando(true)
    try {
      await aoEscolher(nova)
      // Sucesso: confia de novo na prop (quem chamou já atualizou o dado
      // real, que chega no próximo render por `situacao`).
      setOtimista(null)
    } catch {
      setOtimista(null) // reverte pro valor anterior (a prop nunca mudou)
      setFalhou(true)
    } finally {
      setSalvando(false)
      emVooRef.current = false
    }
  }

  return (
    <span className="seletor-pagamento-bloco">
      <select
        className="seletor-pagamento"
        style={{ color: cores.cor, background: cores.bg }}
        value={valorSelect}
        onChange={aoMudar}
        onClick={ev => ev.stopPropagation()}
        disabled={salvando}
        aria-label={`${rotulo}: ${exibida}${salvando ? ' (salvando…)' : ''}`}
      >
        <option value="Pendente">{rotuloPendente}</option>
        <option value="Pago">Pago</option>
      </select>
      {falhou && (
        <span className="seletor-pagamento-erro" role="alert">Não foi possível salvar. Tente de novo.</span>
      )}
    </span>
  )
}
