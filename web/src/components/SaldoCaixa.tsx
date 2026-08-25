import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import {
  calcularCaixa,
  type Caixa,
  type EntradaCaixa,
  type LancamentoCaixa,
  type SaidaCaixa,
} from '../derive/caixa'
import './SaldoCaixa.css'

/**
 * O badge "SALDO EM CAIXA" do cabeçalho (achado S-4 da auditoria; protótipo
 * markup 103-108). SÓ ADMIN — quem monta o Shell decide isso (ver
 * `Shell.tsx`), e a API confirma: `GET /api/lancamentos` exige admin
 * (`exigirAdmin` em api/src/routes/lancamentos.ts), então um colaborador que
 * chegasse a renderizar este componente receberia 403 numa das três fontes e
 * veria travessão — a restrição não é só o badge escondido no front.
 *
 * A ARITMÉTICA NÃO ESTÁ AQUI: `calcularCaixa` (derive/caixa.ts) é quem soma,
 * decide o que conta como "pago" em cada fonte e devolve `null` quando falta
 * alguma. Este componente só busca, exibe e escolhe a cor.
 *
 * TRÊS BUSCAS INDEPENDENTES, e não um `Promise.all`: cada fonte falha
 * sozinha e o aviso diz QUAL falhou. O saldo continua sendo tudo-ou-nada (é
 * `calcularCaixa` que garante isso), mas "não foi possível carregar os
 * lançamentos" é acionável e "não foi possível carregar o caixa" não é.
 *
 * O saldo NÃO recebe o período do cabeçalho de propósito — caixa é posição
 * acumulada até hoje, não fluxo do mês. O rótulo do badge diz "acumulado"
 * justamente para o leitor não esperar que ele siga o seletor ao lado. Ver o
 * cabeçalho de derive/caixa.ts para a justificativa completa.
 *
 * LIMITAÇÃO CONHECIDA, registrada em vez de escondida: as três buscas rodam
 * UMA vez, na montagem do Shell — que é a sessão inteira, já que o Shell não
 * desmonta ao trocar de tela. Marcar uma venda como paga em Saídas não
 * atualiza o badge até a próxima recarga da página. Consertar isso exige um
 * canal de invalidação entre as telas e o Shell (hoje inexistente: cada tela
 * recarrega a si mesma por `versao`), e a alternativa fácil — refazer as três
 * buscas a cada troca de tela — gastaria três requisições por clique de menu
 * para um número que muda algumas vezes por dia.
 */

const VERDE = '#2f5d3f'
const VERMELHO = '#c2502f'
const NEUTRO = '#6a685c'

/** Data de hoje em 'AAAA-MM-DD', componentes LOCAIS (não UTC) — mesmo
 * `hojeIsoLocal()` de ClientesLista/SaidasLista/RelatoriosTela. Fica no
 * componente porque toca `new Date()`; `calcularCaixa` continua pura
 * recebendo a data por parâmetro. */
function hojeIsoLocal(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** R$ arredondado, com o sinal preservado — saldo negativo é informação
 * legítima e aparece como tal ("-R$ 1.200"), nunca zerado nem em travessão:
 * quem está no vermelho precisa ver que está. */
function money(n: number): string {
  const sinal = n < 0 ? '-' : ''
  return `${sinal}R$ ${Math.abs(Math.round(n)).toLocaleString('pt-BR')}`
}

/** O `title` do badge: de onde o número veio, parcela por parcela. */
function explicacao(caixa: Caixa): string {
  return 'Acumulado desde o início — não segue o filtro de período do cabeçalho. '
    + `Recebido dos clientes ${money(caixa.recebido)} `
    + `− pago aos produtores ${money(caixa.pagoAoProdutor)} `
    + `− lançamentos ${money(caixa.lancamentosPagos)}.`
}

interface SaldoCaixaProps {
  /** Sessão expirou (401 da API) — o app volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function SaldoCaixa({ onSessaoExpirada }: SaldoCaixaProps) {
  // `null` = indisponível (ainda carregando OU a busca falhou); `[]` = veio
  // vazio, que é uma medida válida e vale zero. `calcularCaixa` trata os
  // dois de forma diferente — ver derive/caixa.ts.
  const [saidas, setSaidas] = useState<SaidaCaixa[] | null>(null)
  const [entradas, setEntradas] = useState<EntradaCaixa[] | null>(null)
  const [lancamentos, setLancamentos] = useState<LancamentoCaixa[] | null>(null)
  const [falhas, setFalhas] = useState<string[]>([])

  useEffect(() => {
    let cancelado = false

    function registrarFalha(fonte: string) {
      if (!cancelado) setFalhas(fs => (fs.includes(fonte) ? fs : [...fs, fonte]))
    }
    function tratar(fonte: string) {
      return (err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        registrarFalha(fonte)
      }
    }

    api.get<SaidaCaixa[]>('/api/saidas')
      .then(ss => { if (!cancelado) setSaidas(ss) })
      .catch(tratar('vendas'))
    api.get<EntradaCaixa[]>('/api/entradas')
      .then(es => { if (!cancelado) setEntradas(es) })
      .catch(tratar('compras'))
    api.get<LancamentoCaixa[]>('/api/lancamentos')
      .then(ls => { if (!cancelado) setLancamentos(ls) })
      .catch(tratar('lançamentos'))

    return () => { cancelado = true }
  }, [onSessaoExpirada])

  const caixa = calcularCaixa(saidas, entradas, lancamentos, hojeIsoLocal())
  const titulo = caixa
    ? explicacao(caixa)
    : falhas.length > 0
      ? `Saldo indisponível: não foi possível carregar ${falhas.join(', ')}. `
        + 'Um saldo sem uma das três parcelas pareceria o caixa sem ser — por isso travessão, '
        + 'nunca um número parcial.'
      : 'Calculando o saldo em caixa…'

  return (
    <div className="shell-caixa" title={titulo}>
      <span className="shell-caixa-rotulo">SALDO EM CAIXA · ACUMULADO</span>
      <span
        className="shell-caixa-valor"
        role="status"
        style={{ color: caixa ? (caixa.saldo >= 0 ? VERDE : VERMELHO) : NEUTRO }}
      >
        {caixa ? money(caixa.saldo) : '—'}
      </span>
      {falhas.length > 0 && (
        <span className="shell-caixa-aviso">fonte indisponível: {falhas.join(', ')}</span>
      )}
    </div>
  )
}
