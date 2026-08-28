import { useEffect, useState } from 'react'
import { api, ErroApi } from '../api/client'
import type { FuncionarioOpcao } from '../derive/historico'
import './DeclaracaoDeAutoria.css'

interface DeclaracaoDeAutoriaProps {
  /** Id do funcionário escolhido. `''` = ninguém escolhido ainda. */
  autorId: string
  onAutorId: (id: string) => void
  motivo: string
  onMotivo: (motivo: string) => void
  /** Mensagens de validação vindas do modal que hospeda estes campos — quem
   * decide bloquear o submit é ele, não este componente. */
  erroAutor: string
  erroMotivo: string
  onSessaoExpirada?: () => void
}

/**
 * OS DOIS CAMPOS QUE O COLABORADOR PREENCHE A CADA ALTERAÇÃO DE CADASTRO:
 * quem ele é, e por quê.
 *
 * Existe um único login para a equipe inteira neste hortifruti. O sistema não
 * tem como SABER quem está digitando — sabe qual login escreveu, que é outra
 * coisa. Estes dois campos são a única informação disponível sobre autoria, e
 * o texto da tela diz isso na cara: o rótulo é "Quem está fazendo esta
 * alteração?" e o histórico grava "Declarado por", nunca "Editado por".
 *
 * TRÊS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. NADA PRÉ-SELECIONADO. A primeira opção do `<select>` é um placeholder
 *    vazio, e ele começa selecionado. Se o campo abrisse com um nome já
 *    escolhido, todo mundo aceitaria o que está lá e o registro viraria
 *    ficção — o mesmo nome em toda alteração da loja, inclusive nas que ele
 *    não fez. Precisa ser escolha ativa, e por isso o `value=""` inicial não
 *    é "esqueceram de preencher", é o estado correto.
 * 2. LISTA FECHADA, NUNCA TEXTO LIVRE. Vem de `GET /api/funcionarios/opcoes`
 *    (id e nome dos ativos, nada mais — nunca salário). Texto livre viraria
 *    "joão", "Joao" e "jão" na mesma semana, e o rastro de uma pessoa se
 *    fragmentaria em três nomes que nenhuma consulta junta depois.
 * 3. OS DOIS SÃO OBRIGATÓRIOS. Motivo opcional é motivo que ninguém preenche,
 *    e um campo alterado sem motivo é uma linha de log que não responde a
 *    pergunta que o log existe para responder.
 *
 * E A VALIDAÇÃO DE VERDADE NÃO ESTÁ AQUI. O servidor recusa `POST`/`PUT` das
 * três rotas com 400 quando a sessão é de colaborador e falta autor ou motivo
 * (`erroDeDeclaracao`, api/src/historico.ts), e o papel de lá vem do cookie.
 * Este formulário existe para o erro aparecer na hora em vez de depois — se
 * ele fosse a única barreira, bastaria chamar a API direto para editar sem
 * rastro.
 */
export function DeclaracaoDeAutoria(
  { autorId, onAutorId, motivo, onMotivo, erroAutor, erroMotivo, onSessaoExpirada }: DeclaracaoDeAutoriaProps,
) {
  /**
   * `null` = ainda não carregou (ou a carga falhou); `[]` = carregou e a
   * empresa não tem nenhum funcionário ativo. A distinção não é preciosismo:
   * é ela que separa "não deu para perguntar" de "não há ninguém para
   * escolher", e as duas situações pedem mensagens diferentes. Com um `[]`
   * inicial, um 401 no meio do caminho faria a tela afirmar que a empresa
   * está sem equipe cadastrada — uma informação falsa sobre o negócio do
   * usuário, produzida por um erro de rede.
   */
  const [opcoes, setOpcoes] = useState<FuncionarioOpcao[] | null>(null)
  const [erroLista, setErroLista] = useState('')

  useEffect(() => {
    let cancelado = false
    api.get<FuncionarioOpcao[]>('/api/funcionarios/opcoes')
      .then(lista => { if (!cancelado) setOpcoes(lista) })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErroLista(
          'Não foi possível carregar a lista de funcionários. Sem ela não dá para registrar '
          + 'quem está alterando — feche e abra o formulário para tentar de novo.',
        )
      })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  return (
    <div className="declaracao">
      <div className="declaracao-titulo">Registro da alteração</div>
      <p className="declaracao-nota">
        A equipe usa um login só, então o sistema não tem como saber quem está mexendo. O que ficar
        registrado é o que você informar aqui.
      </p>

      <div className="declaracao-campos">
        <div className="modal-campo">
          <label className="modal-rotulo" htmlFor="declaracao-autor">
            Quem está fazendo esta alteração?
          </label>
          <select
            id="declaracao-autor"
            name="declarado_por"
            className="modal-select"
            value={autorId}
            onChange={e => onAutorId(e.target.value)}
            required
          >
            {/* O placeholder é a opção selecionada quando `autorId` é '' — e
                ele NÃO some da lista depois de escolher, para dar como
                desfazer sem fechar o formulário. */}
            <option value="">Selecione…</option>
            {(opcoes ?? []).map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
          {erroAutor && <p className="modal-erro" role="alert">{erroAutor}</p>}
        </div>

        <div className="modal-campo">
          <label className="modal-rotulo" htmlFor="declaracao-motivo">Motivo da alteração</label>
          <input
            id="declaracao-motivo"
            name="motivo"
            className="modal-input"
            value={motivo}
            onChange={e => onMotivo(e.target.value)}
            placeholder="Ex.: cliente ligou avisando o telefone novo"
            required
          />
          {erroMotivo && <p className="modal-erro" role="alert">{erroMotivo}</p>}
        </div>
      </div>

      {/* FALHA ISOLADA: a lista não carregar não derruba o formulário nem
          apaga o que já foi digitado — o aviso entra em role="status" (é
          informação sobre o estado da tela, não um erro do que o usuário
          acabou de fazer) e o resto continua editável. Salvar segue bloqueado
          pela validação de "escolha quem está alterando", que é a resposta
          honesta: sem saber quem, não se grava. */}
      {erroLista && <p className="declaracao-aviso" role="status">{erroLista}</p>}

      {/* Sem funcionários cadastrados não há como declarar nada, e o caminho
          é do admin, não do colaborador. Dizer isso é melhor que um seletor
          vazio sem explicação. */}
      {opcoes?.length === 0 && (
        <p className="declaracao-aviso" role="status">
          Nenhum funcionário ativo cadastrado. Peça ao responsável para cadastrar a equipe em
          Funcionários — sem isso não é possível registrar quem faz as alterações.
        </p>
      )}
    </div>
  )
}
