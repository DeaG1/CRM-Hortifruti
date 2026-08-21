import { describe, it, expect } from 'vitest'
import { slugDaEmpresa } from './slugDaEmpresa'

/** Location falso — so os campos que a funcao le. */
const loc = (url: string) => new URL(url) as unknown as Location

describe('slugDaEmpresa', () => {
  describe('subdominio (destino final, com dominio proprio)', () => {
    it('usa o primeiro rotulo como empresa', () => {
      expect(slugDaEmpresa(loc('https://velasqui.seucrm.com.br/'))).toBe('velasqui')
    })

    it('vale em qualquer caminho, nao so na raiz', () => {
      expect(slugDaEmpresa(loc('https://velasqui.seucrm.com.br/clientes'))).toBe('velasqui')
    })

    it('ignora www', () => {
      expect(slugDaEmpresa(loc('https://www.seucrm.com.br/'))).toBe('')
    })

    // .com.br ja tem dois rotulos, entao seucrm.com.br parece ter subdominio
    // numa contagem ingenua de partes. Quem abrisse a raiz do sistema tentaria
    // entrar numa empresa chamada "seucrm", receberia "credenciais invalidas"
    // e nao teria como descobrir o motivo. Este caso pegou o bug antes do deploy.
    it('ignora o dominio sem subdominio', () => {
      expect(slugDaEmpresa(loc('https://seucrm.com.br/'))).toBe('')
    })

    it('reconhece subdominio sobre dominio .com.br', () => {
      expect(slugDaEmpresa(loc('https://velasqui.seucrm.com.br/'))).toBe('velasqui')
    })
  })

  describe('hosts onde o primeiro rotulo NAO e uma empresa', () => {
    // crm-hortifruti.velasqui.workers.dev: 'crm-hortifruti' e o nome do Worker,
    // nao um cliente. Tratar como tenant faria todo login tentar entrar numa
    // empresa inexistente.
    it('nao confunde o nome do Worker em workers.dev', () => {
      expect(slugDaEmpresa(loc('https://crm-hortifruti.velasqui.workers.dev/'))).toBe('')
    })

    it('nao confunde pages.dev', () => {
      expect(slugDaEmpresa(loc('https://algo.qualquer.pages.dev/'))).toBe('')
    })

    it('nao confunde localhost', () => {
      expect(slugDaEmpresa(loc('http://localhost:5173/'))).toBe('')
    })
  })

  describe('query ?e=<slug> (ponte, ate o dominio existir)', () => {
    it('le o slug da query', () => {
      expect(slugDaEmpresa(loc('https://crm-hortifruti.velasqui.workers.dev/?e=velasqui'))).toBe('velasqui')
    })

    it('normaliza para minusculas', () => {
      expect(slugDaEmpresa(loc('https://x.workers.dev/?e=VELASQUI'))).toBe('velasqui')
    })
  })

  describe('caminho NAO identifica empresa', () => {
    // Decisao deliberada: com /velasqui significando empresa e /clientes
    // significando tela, nao ha como distinguir os dois. As rotas do sistema
    // precisam do caminho inteiro.
    it.each(['/clientes', '/financeiro', '/estoque', '/velasqui'])(
      '%s nao e lido como empresa',
      (caminho) => {
        expect(slugDaEmpresa(loc(`https://crm-hortifruti.velasqui.workers.dev${caminho}`))).toBe('')
      },
    )
  })

  describe('precedencia', () => {
    it('subdominio ganha da query', () => {
      expect(slugDaEmpresa(loc('https://real.seucrm.com.br/?e=outra'))).toBe('real')
    })

    it('devolve vazio quando nao ha slug em lugar nenhum', () => {
      expect(slugDaEmpresa(loc('https://crm-hortifruti.velasqui.workers.dev/'))).toBe('')
    })
  })
})
