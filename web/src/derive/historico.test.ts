import { describe, it, expect } from 'vitest'
import {
  avisoDeDeclaracao, carimboDeHistorico, resumoDaLinha, rotuloDoCampo,
  textoDaAcao, textoDoAutor, valorParaLeitura, VAZIO,
} from './historico'
import { dataBrCurta } from './pagamento'

/**
 * As funções puras do histórico de alterações. Aqui vive a decisão mais
 * delicada da feature inteira: as PALAVRAS. "Declarado por" e "editado por"
 * são frases sobre evidências diferentes, e a diferença só existe se estiver
 * testada — um `?:` no JSX que alguém simplifica depois apaga a distinção sem
 * quebrar nada visível.
 */

describe('carimboDeHistorico', () => {
  it('data e hora no formato brasileiro, com ano', () => {
    expect(carimboDeHistorico('2026-08-28T14:32')).toBe('28/08/2026 14:32')
  })

  it('funciona com o timestamp completo que o Postgres poderia mandar', () => {
    expect(carimboDeHistorico('2026-01-05T09:07:44.123')).toBe('05/01/2026 09:07')
  })

  it('aceita espaço no lugar do T', () => {
    expect(carimboDeHistorico('2026-01-05 09:07')).toBe('05/01/2026 09:07')
  })

  it('sem hora, sai só a data — não uma hora inventada', () => {
    expect(carimboDeHistorico('2026-08-28')).toBe('28/08/2026')
  })

  it('null para ausente ou fora do formato — nunca a string crua na tela', () => {
    expect(carimboDeHistorico(null)).toBeNull()
    expect(carimboDeHistorico(undefined)).toBeNull()
    expect(carimboDeHistorico('')).toBeNull()
    expect(carimboDeHistorico('ontem')).toBeNull()
    expect(carimboDeHistorico('28/08/2026')).toBeNull()
  })

  it('REUSA dataBrCurta: o dia/mês do carimbo é exatamente o que ela devolve', () => {
    // Não é um teste de implementação por preguiça — é o que impede um
    // segundo formatador de data de nascer aqui e divergir do resto do app
    // (derive/pagamento.ts já registra que escrever outro seria a duplicação
    // que ele evitou uma vez).
    for (const iso of ['2026-08-28T14:32', '2026-01-05T09:07', '2026-12-31T23:59']) {
      expect(carimboDeHistorico(iso)!.startsWith(dataBrCurta(iso)!)).toBe(true)
    }
  })

  it('o ANO entra, e é aí que ele se afasta de dataBrCurta de propósito', () => {
    // Em `infoPagamento` o ano é redundante (o pedido é do período em vista).
    // Num log de auditoria não é: "quando isso mudou?" pode ser sobre dois
    // anos atrás, e duas linhas do mesmo dia só se separam pela hora.
    expect(dataBrCurta('2026-08-28T14:32')).toBe('28/08')
    expect(carimboDeHistorico('2026-08-28T14:32')).toContain('2026')
    expect(carimboDeHistorico('2027-08-28T14:32')).not.toBe(carimboDeHistorico('2026-08-28T14:32'))
  })
})

describe('textoDoAutor — a frase que separa declaração de prova', () => {
  it('declarado: "Declarado por"', () => {
    expect(textoDoAutor({ autor_origem: 'declarado', autor_nome: 'João da Silva' }))
      .toBe('Declarado por João da Silva')
  })

  it('login: "Registrado no login de"', () => {
    expect(textoDoAutor({ autor_origem: 'login', autor_nome: 'Dona Rita' }))
      .toBe('Registrado no login de Dona Rita')
  })

  it('NUNCA diz "editado por" nem "autenticado", em nenhuma das duas origens', () => {
    // A equipe usa um login só. Escrever "Editado por João" afirmaria uma
    // autenticação que nunca houve; e mesmo no login individual o que se
    // prova é qual conta estava aberta, não quem estava na cadeira.
    for (const origem of ['declarado', 'login']) {
      const frase = textoDoAutor({ autor_origem: origem, autor_nome: 'Fulano' }).toLowerCase()
      expect(frase).not.toContain('editado por')
      expect(frase).not.toContain('alterado por')
      expect(frase).not.toContain('autenticad')
    }
  })

  it('origem desconhecida cai no lado CAUTELOSO (declarado), nunca no que afirma mais', () => {
    // Se um valor novo aparecer na coluna, a tela erra para o lado de
    // prometer menos. O contrário seria um log que passa a afirmar
    // autenticação por causa de uma string que ninguém reconheceu.
    expect(textoDoAutor({ autor_origem: 'sei-la', autor_nome: 'Fulano' }))
      .toBe('Declarado por Fulano')
  })
})

describe('avisoDeDeclaracao', () => {
  it('aparece quando há pelo menos uma linha declarada', () => {
    const aviso = avisoDeDeclaracao([{ autor_origem: 'login' }, { autor_origem: 'declarado' }])
    expect(aviso).toContain('não verifica quem digitou')
    expect(aviso).toContain('declaração')
  })

  it('não aparece num histórico só de admin — aviso à toa é aviso que ninguém lê', () => {
    expect(avisoDeDeclaracao([{ autor_origem: 'login' }])).toBeNull()
    expect(avisoDeDeclaracao([])).toBeNull()
  })
})

describe('valorParaLeitura', () => {
  it('vazio vira travessão', () => {
    expect(valorParaLeitura('')).toBe(VAZIO)
    expect(valorParaLeitura('   ')).toBe(VAZIO)
    expect(valorParaLeitura(null)).toBe(VAZIO)
    expect(valorParaLeitura(undefined)).toBe(VAZIO)
  })

  it('ZERO NÃO vira travessão — é a metade da regra que se esquece', () => {
    // Um limite de crédito que FOI zerado é a informação inteira daquela
    // linha do log. Some justamente na alteração que o dono ia querer ver.
    expect(valorParaLeitura('0')).toBe('0')
    expect(valorParaLeitura('0.00')).toBe('0.00')
    expect(valorParaLeitura('0,00')).toBe('0,00')
  })

  it('travessão nunca vira zero: o valor ausente não é convertido em número', () => {
    expect(valorParaLeitura('')).not.toBe('0')
  })

  it('qualquer outro valor sai como veio, com espaços internos', () => {
    expect(valorParaLeitura('44 99999-0000')).toBe('44 99999-0000')
    expect(valorParaLeitura('Mercado Bom Preço')).toBe('Mercado Bom Preço')
  })
})

describe('rotuloDoCampo', () => {
  it('usa o rótulo do formulário, por entidade', () => {
    expect(rotuloDoCampo('cliente', 'tel')).toBe('Telefone / WhatsApp')
    expect(rotuloDoCampo('produto', 'peso_medio')).toBe('Peso médio da embalagem (kg)')
    expect(rotuloDoCampo('fornecedor', 'contato')).toBe('Telefone / contato')
  })

  it('`nome` é diferente em cada entidade — é o motivo de o mapa ser por entidade', () => {
    expect(rotuloDoCampo('cliente', 'nome')).toBe('Nome do estabelecimento')
    expect(rotuloDoCampo('produto', 'nome')).toBe('Nome do produto')
    expect(rotuloDoCampo('fornecedor', 'nome')).toBe('Nome do produtor / fazenda')
  })

  it('o campo SINTÉTICO `produtos` do fornecedor tem rótulo', () => {
    // Não é coluna de `fornecedores`: é a relação que o PUT sincroniza. Entra
    // no rastro porque é cadastro que o colaborador edita.
    expect(rotuloDoCampo('fornecedor', 'produtos')).toBe('Produtos fornecidos')
  })

  it('campo desconhecido sai com o nome cru da coluna — a linha NÃO some', () => {
    // Uma coluna nova cujo rótulo ninguém escreveu aparece feia, mas aparece.
    // Esconder seria um log que omite uma alteração que aconteceu.
    expect(rotuloDoCampo('cliente', 'campo_novo_da_api')).toBe('campo_novo_da_api')
    expect(rotuloDoCampo('entidade_nova', 'nome')).toBe('nome')
  })
})

describe('textoDaAcao', () => {
  it('traduz as três ações', () => {
    expect(textoDaAcao('criou')).toBe('Cadastro criado')
    expect(textoDaAcao('editou')).toBe('Cadastro alterado')
    expect(textoDaAcao('excluiu')).toBe('Cadastro excluído')
  })

  it('ação desconhecida sai como veio, pelo mesmo motivo do rótulo', () => {
    expect(textoDaAcao('arquivou')).toBe('arquivou')
  })
})

describe('resumoDaLinha', () => {
  it('conta os campos numa edição', () => {
    expect(resumoDaLinha({ acao: 'editou', alteracoes: [{ campo: 'tel', de: 'a', para: 'b' }] }))
      .toBe('1 campo alterado')
    expect(resumoDaLinha({
      acao: 'editou',
      alteracoes: [
        { campo: 'tel', de: 'a', para: 'b' },
        { campo: 'rota', de: 'c', para: 'd' },
      ],
    })).toBe('2 campos alterados')
  })

  it('criar e excluir não contam campos — a AÇÃO é a informação', () => {
    // `alteracoes` vazio nesses dois casos é afirmação, não lacuna: criar não
    // tem "de", excluir não tem "para".
    expect(resumoDaLinha({ acao: 'criou', alteracoes: [] })).toBe('Cadastro criado')
    expect(resumoDaLinha({ acao: 'excluiu', alteracoes: [] })).toBe('Cadastro excluído')
  })

  it('edição sem campo nenhum (não deveria existir) não vira "0 campos"', () => {
    // O servidor não grava esse registro (`vaiGravar`, api/src/historico.ts).
    // Se um chegar assim mesmo, "0 campos alterados" seria pior que dizer o
    // que a linha diz.
    expect(resumoDaLinha({ acao: 'editou', alteracoes: [] })).toBe('Cadastro alterado')
  })
})
