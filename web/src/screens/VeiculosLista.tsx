import { useEffect, useState, type FormEvent } from 'react'
import { api, ErroApi } from '../api/client'
import type { Papel } from '../telas'
import {
  type Veiculo, type FuncionarioOpcao, usoAntigo, formatarHora,
} from '../derive/veiculos'
import { ModalVeiculo } from '../components/ModalVeiculo'
import './VeiculosLista.css'

// Molde: ClientesLista.tsx (os quatro estados, cancelado no useEffect,
// ErroApi 401) + FuncionariosLista.tsx (sem "ficha" separada — lista e modal
// de cadastro vivem no mesmo arquivo). Especifico desta tela: as acoes
// "Pegar"/"Devolver" nao sao um CRUD do veiculo, entao tem seu proprio fluxo
// (o seletor de funcionario abaixo), separado do ModalVeiculo de cadastro.
//
// Permissoes (ver api/src/routes/veiculos.ts): cadastrar/editar/excluir o
// veiculo e admin; ler a lista e pegar/devolver e qualquer sessao. Por isso
// esta tela recebe `papel` — e a UNICA tela do produto onde as duas coisas
// coexistem na mesma tela (as outras telas admin-only simplesmente nao
// aparecem pro colaborador, ver ADMIN_ONLY_SCREENS); aqui o colaborador ve a
// MESMA tela, só sem as acoes de gerenciar cadastro.

interface VeiculosListaProps {
  /** Ausente = trata como colaborador (mais restritivo): esconde "Novo
   * veículo" e a edicao do cadastro, que a API rejeitaria com 403 mesmo assim. */
  papel?: Papel
  /** Sessão expirou (401 da API) — a tela volta ao login em vez de mostrar erro. */
  onSessaoExpirada?: () => void
}

export function VeiculosLista({ papel = 'colaborador', onSessaoExpirada }: VeiculosListaProps) {
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [funcionarios, setFuncionarios] = useState<FuncionarioOpcao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  // undefined = modal de cadastro fechado; null = criando; Veiculo = editando
  const [modal, setModal] = useState<Partial<Veiculo> | null | undefined>(undefined)
  // veiculo com o seletor de "Pegar" aberto; undefined = fechado
  const [pegando, setPegando] = useState<Veiculo | undefined>(undefined)
  const [funcionarioEscolhido, setFuncionarioEscolhido] = useState('')
  const [erroPegar, setErroPegar] = useState('')
  const [salvandoPegar, setSalvandoPegar] = useState(false)
  // id do veiculo com "Devolver" em andamento — desabilita o botao so daquela linha.
  const [acaoPendente, setAcaoPendente] = useState<string | null>(null)
  const isAdmin = papel === 'admin'

  useEffect(() => {
    let cancelado = false
    Promise.all([
      api.get<Veiculo[]>('/api/veiculos'),
      // Endpoint enxuto (so id+nome, so ativos) — o colaborador nao tem
      // acesso a GET /api/funcionarios completa (tem salario), mas precisa
      // deste resumo pra escolher quem esta pegando o carro.
      api.get<FuncionarioOpcao[]>('/api/funcionarios/opcoes'),
    ])
      .then(([vs, fs]) => { if (!cancelado) { setVeiculos(vs); setFuncionarios(fs) } })
      .catch((err: unknown) => {
        if (cancelado) return
        if (err instanceof ErroApi && err.status === 401) {
          onSessaoExpirada?.()
          return
        }
        setErro('Não foi possível carregar os veículos.')
      })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [onSessaoExpirada])

  function aoSalvarCadastro(v: Veiculo) {
    setVeiculos(vs => {
      const i = vs.findIndex(x => x.id === v.id)
      if (i >= 0) { const copia = vs.slice(); copia[i] = { ...copia[i], ...v }; return copia }
      return [...vs, { ...v, uso_aberto: v.uso_aberto ?? null }]
    })
    setModal(undefined)
  }

  function aoExcluirCadastro(id: string) {
    setVeiculos(vs => vs.filter(v => v.id !== id))
    setModal(undefined)
  }

  function abrirPegar(v: Veiculo) {
    setPegando(v)
    setFuncionarioEscolhido('')
    setErroPegar('')
  }

  async function confirmarPegar(e: FormEvent) {
    e.preventDefault()
    if (!pegando) return
    if (!funcionarioEscolhido) {
      setErroPegar('Escolha quem está pegando o carro.')
      return
    }
    setSalvandoPegar(true)
    setErroPegar('')
    try {
      const uso = await api.post<{ id: string; funcionario_id: string; saida_em: string }>(
        `/api/veiculos/${pegando.id}/pegar`,
        { funcionario_id: funcionarioEscolhido },
      )
      const nome = funcionarios.find(f => f.id === funcionarioEscolhido)?.nome ?? ''
      const veiculoId = pegando.id
      setVeiculos(vs => vs.map(v => v.id === veiculoId
        ? {
            ...v,
            uso_aberto: {
              id: uso.id, funcionario_id: uso.funcionario_id,
              funcionario_nome: nome, desde: uso.saida_em,
            },
          }
        : v))
      setPegando(undefined)
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      if (err instanceof ErroApi && err.status === 409) {
        setErroPegar('Este veículo acabou de ser pego por outra pessoa.')
      } else {
        setErroPegar('Não foi possível registrar. Tente novamente.')
      }
    } finally {
      setSalvandoPegar(false)
    }
  }

  async function devolver(v: Veiculo) {
    setAcaoPendente(v.id)
    try {
      await api.post(`/api/veiculos/${v.id}/devolver`)
      setVeiculos(vs => vs.map(x => x.id === v.id ? { ...x, uso_aberto: null } : x))
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) {
        onSessaoExpirada?.()
        return
      }
      // 404 (uso ja fechado por outra pessoa, ou corrida com outra devolucao)
      // ou qualquer outro erro: nao muda o estado local — o botao "Devolver"
      // continua ali e a pessoa pode tentar de novo.
    } finally {
      setAcaoPendente(null)
    }
  }

  if (carregando) return <p className="veiculos-estado">Carregando…</p>
  if (erro) return <p className="veiculos-estado veiculos-estado--erro" role="alert">{erro}</p>

  const modalCadastro = modal !== undefined && (
    <ModalVeiculo
      veiculo={modal}
      onSalvo={aoSalvarCadastro}
      onExcluido={aoExcluirCadastro}
      onFechar={() => setModal(undefined)}
      onSessaoExpirada={onSessaoExpirada}
    />
  )

  const dialogoPegar = pegando !== undefined && (
    <div
      className="veiculos-pegar-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Pegar ${pegando.placa}`}
      onClick={() => setPegando(undefined)}
    >
      <form className="veiculos-pegar-card" onClick={e => e.stopPropagation()} onSubmit={confirmarPegar} noValidate>
        <div className="veiculos-pegar-titulo">
          Quem está pegando {[pegando.marca, pegando.modelo].filter(Boolean).join(' ') || `o veículo ${pegando.placa}`}?
        </div>
        <label className="veiculos-pegar-rotulo" htmlFor="veiculo-pegar-funcionario">Funcionário</label>
        <select
          id="veiculo-pegar-funcionario"
          className="veiculos-pegar-select"
          value={funcionarioEscolhido}
          onChange={e => setFuncionarioEscolhido(e.target.value)}
          autoFocus
        >
          <option value="">Selecione…</option>
          {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
        {erroPegar && <p className="veiculos-pegar-erro" role="alert">{erroPegar}</p>}
        <div className="veiculos-pegar-rodape">
          <button type="button" className="veiculos-botao-cancelar" onClick={() => setPegando(undefined)}>
            Cancelar
          </button>
          <button type="submit" className="veiculos-botao-confirmar" disabled={salvandoPegar}>
            {salvandoPegar ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </form>
    </div>
  )

  if (veiculos.length === 0) {
    return (
      <>
        <div className="estado-vazio veiculos-vazio">
          <div className="veiculos-vazio-titulo">Nenhum veículo cadastrado ainda.</div>
          <div className="veiculos-vazio-sub">
            {isAdmin
              ? 'Cadastre os carros da frota para começar a registrar quem pega e devolve cada um.'
              : 'Peça a um administrador para cadastrar a frota.'}
          </div>
          {isAdmin && (
            <button type="button" className="veiculos-botao-novo" onClick={() => setModal(null)}>
              ＋ Novo veículo
            </button>
          )}
        </div>
        {modalCadastro}
      </>
    )
  }

  return (
    <div className="veiculos-lista">
      {isAdmin && (
        <div className="veiculos-topo">
          <div className="veiculos-dica">Clique num veículo para editar o cadastro.</div>
          <button type="button" className="veiculos-botao-novo" onClick={() => setModal(null)}>
            ＋ Novo veículo
          </button>
        </div>
      )}

      <div className="veiculos-tabela">
        <div className="veiculos-linha veiculos-linha--cabecalho">
          <div>VEÍCULO</div>
          <div>PLACA</div>
          <div>STATUS</div>
          <div className="veiculos-col-acao" />
        </div>

        {veiculos.map(v => {
          const uso = v.uso_aberto
          const antigo = uso ? usoAntigo(uso.desde) : false
          return (
            <div
              key={v.id}
              className="veiculos-linha veiculos-linha--dados"
              onClick={isAdmin ? () => setModal(v) : undefined}
              style={isAdmin ? undefined : { cursor: 'default' }}
            >
              <div className="veiculos-celula-nome">
                <div className="veiculos-nome">{[v.marca, v.modelo].filter(Boolean).join(' ') || '—'}</div>
                {!v.ativo && <span className="veiculos-inativo-badge">Inativo</span>}
              </div>
              <div className="veiculos-placa">{v.placa}</div>
              <div>
                {uso ? (
                  <span className={
                    antigo
                      ? 'veiculos-status veiculos-status--antigo'
                      : 'veiculos-status veiculos-status--em-uso'
                  }>
                    Com {uso.funcionario_nome} desde {formatarHora(uso.desde)}
                  </span>
                ) : (
                  <span className="veiculos-status veiculos-status--disponivel">Disponível</span>
                )}
              </div>
              <div className="veiculos-col-acao">
                {uso ? (
                  <button
                    type="button"
                    className="veiculos-botao-devolver"
                    disabled={acaoPendente === v.id}
                    onClick={(e) => { e.stopPropagation(); devolver(v) }}
                  >
                    {acaoPendente === v.id ? 'Devolvendo…' : 'Devolver'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="veiculos-botao-pegar"
                    disabled={!v.ativo}
                    onClick={(e) => { e.stopPropagation(); abrirPegar(v) }}
                  >
                    Pegar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {modalCadastro}
      {dialogoPegar}
    </div>
  )
}
