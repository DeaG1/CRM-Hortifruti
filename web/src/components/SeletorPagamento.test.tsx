import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SeletorPagamento } from './SeletorPagamento'

function opcoesDoSeletor() {
  const select = screen.getByRole('combobox') as HTMLSelectElement
  const valores = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
  return { select, valores }
}

describe('SeletorPagamento — nao oferece Atrasado como escolha', () => {
  it('sempre so duas <option>, com value Pendente/Pago (nunca um terceiro valor)', () => {
    render(<SeletorPagamento situacao="Atrasado" aoEscolher={async () => {}} rotulo="Pagamento de teste" />)
    const { valores } = opcoesDoSeletor()
    expect(valores).toEqual(['Pendente', 'Pago'])
  })

  it('situacao Atrasado: option "ainda nao pago" mostra o rotulo Atrasado, mas o value do option continua Pendente', () => {
    render(<SeletorPagamento situacao="Atrasado" aoEscolher={async () => {}} rotulo="Pagamento de teste" />)
    const { select } = opcoesDoSeletor()
    const opcaoPendente = within(select).getByRole('option', { name: 'Atrasado' }) as HTMLOptionElement
    expect(opcaoPendente.value).toBe('Pendente')
    expect(select.value).toBe('Pendente') // selecionado e a opcao "ainda nao pago", so com rotulo trocado
  })

  it('situacao Pendente (nao vencida): option mostra "Pendente" normalmente', () => {
    render(<SeletorPagamento situacao="Pendente" aoEscolher={async () => {}} rotulo="Pagamento de teste" />)
    expect(screen.getByRole('option', { name: 'Pendente' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Atrasado' })).not.toBeInTheDocument()
  })

  it('situacao Pago: selecionado e a opcao Pago', () => {
    render(<SeletorPagamento situacao="Pago" aoEscolher={async () => {}} rotulo="Pagamento de teste" />)
    const { select } = opcoesDoSeletor()
    expect(select.value).toBe('Pago')
  })
})

describe('SeletorPagamento — acessibilidade', () => {
  it('anuncia a situacao atual no aria-label', () => {
    render(<SeletorPagamento situacao="Atrasado" aoEscolher={async () => {}} rotulo="Pagamento da entrada C-1" />)
    expect(screen.getByRole('combobox', { name: /Pagamento da entrada C-1: Atrasado/ })).toBeInTheDocument()
  })
})

describe('SeletorPagamento — troca de valor', () => {
  it('escolher Pago chama aoEscolher com "Pago"', async () => {
    const aoEscolher = vi.fn().mockResolvedValue(undefined)
    render(<SeletorPagamento situacao="Pendente" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Pago' } })
    expect(aoEscolher).toHaveBeenCalledWith('Pago')
  })

  it('escolher Pendente (a partir de Pago) chama aoEscolher com "Pendente"', async () => {
    const aoEscolher = vi.fn().mockResolvedValue(undefined)
    render(<SeletorPagamento situacao="Pago" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Pendente' } })
    expect(aoEscolher).toHaveBeenCalledWith('Pendente')
  })

  it('desabilita o seletor enquanto a chamada esta pendente', async () => {
    let resolver: () => void = () => {}
    const aoEscolher = vi.fn(() => new Promise<void>(resolve => { resolver = resolve }))
    render(<SeletorPagamento situacao="Pendente" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'Pago' } })
    expect(select).toBeDisabled()
    resolver()
    await vi.waitFor(() => expect(select).not.toBeDisabled())
  })

  it('nao dispara uma segunda chamada se mudar de novo enquanto a primeira esta em voo', () => {
    const aoEscolher = vi.fn(() => new Promise<void>(() => {})) // nunca resolve nesta suite
    render(<SeletorPagamento situacao="Pendente" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Pago' } })
    fireEvent.change(select, { target: { value: 'Pendente' } })
    expect(aoEscolher).toHaveBeenCalledTimes(1)
  })

  it('falha da API reverte o seletor pro valor anterior e mostra um aviso', async () => {
    const aoEscolher = vi.fn().mockRejectedValue(new Error('falhou'))
    render(<SeletorPagamento situacao="Pendente" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'Pago' } })

    await screen.findByRole('alert')
    expect(select.value).toBe('Pendente') // reverteu — a prop `situacao` nunca mudou
    expect(select).not.toBeDisabled()
  })

  it('sucesso limpa o valor otimista e nao deixa aviso de erro', async () => {
    const aoEscolher = vi.fn().mockResolvedValue(undefined)
    render(<SeletorPagamento situacao="Pendente" aoEscolher={aoEscolher} rotulo="Pagamento de teste" />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Pago' } })
    await vi.waitFor(() => expect(aoEscolher).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
