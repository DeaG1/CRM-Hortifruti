import { describe, it, expect } from 'vitest'
import { slugDoHortifruti } from './slugDoHortifruti'

/** Location falso — só os campos que a funcao le. */
const loc = (url: string) => new URL(url) as unknown as Location

describe('slugDoHortifruti', () => {
  describe('subdominio (destino final, com dominio proprio)', () => {
    it('usa o primeiro rotulo como hortifruti', () => {
      expect(slugDoHortifruti(loc('https://bom-preco.seucrm.com.br/'))).toBe('bom-preco')
    })

    it('ignora www', () => {
      expect(slugDoHortifruti(loc('https://www.seucrm.com.br/'))).toBe('')
    })

    // .com.br ja tem dois rotulos, entao seucrm.com.br parece ter subdominio
    // numa contagem ingenua de partes. Quem abrisse a raiz do sistema tentaria
    // entrar num hortifruti chamado "seucrm", receberia "credenciais
    // invalidas" e nao teria como descobrir o motivo. Este teste pegou
    // exatamente esse bug antes do deploy.
    it('ignora o dominio sem subdominio', () => {
      expect(slugDoHortifruti(loc('https://seucrm.com.br/'))).toBe('')
    })

    it('reconhece subdominio sobre dominio .com.br', () => {
      expect(slugDoHortifruti(loc('https://bom-preco.seucrm.com.br/'))).toBe('bom-preco')
    })
  })

  describe('hosts onde o primeiro rotulo NAO e um hortifruti', () => {
    // crm-hortifruti.velasqui.workers.dev: 'crm-hortifruti' e o nome do Worker,
    // nao um cliente. Tratar como tenant faria todo login tentar entrar num
    // hortifruti inexistente.
    it('nao confunde o nome do Worker em workers.dev', () => {
      expect(slugDoHortifruti(loc('https://crm-hortifruti.velasqui.workers.dev/'))).toBe('')
    })

    it('nao confunde pages.dev', () => {
      expect(slugDoHortifruti(loc('https://algo.qualquer.pages.dev/'))).toBe('')
    })

    it('nao confunde localhost', () => {
      expect(slugDoHortifruti(loc('http://localhost:5173/'))).toBe('')
    })
  })

  describe('caminho /h/<slug> (funciona hoje, sem dominio proprio)', () => {
    it('le o slug do caminho', () => {
      expect(slugDoHortifruti(loc('https://crm-hortifruti.velasqui.workers.dev/h/bom-preco'))).toBe('bom-preco')
    })

    it('ignora o que vem depois do slug', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/h/bom-preco/qualquer/coisa'))).toBe('bom-preco')
    })

    it('decodifica caractere escapado', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/h/bom%20preco'))).toBe('bom preco')
    })

    it('nao confunde outras rotas do app com slug', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/clientes'))).toBe('')
    })
  })

  describe('query ?h=<slug>', () => {
    it('le o slug da query', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/?h=bom-preco'))).toBe('bom-preco')
    })
  })

  describe('precedencia e normalizacao', () => {
    it('subdominio ganha do caminho', () => {
      expect(slugDoHortifruti(loc('https://real.seucrm.com.br/h/outro'))).toBe('real')
    })

    it('caminho ganha da query', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/h/doCaminho?h=daQuery'))).toBe('docaminho')
    })

    it('normaliza para minusculas', () => {
      expect(slugDoHortifruti(loc('https://x.workers.dev/h/BOM-PRECO'))).toBe('bom-preco')
    })

    it('devolve vazio quando nao ha slug em lugar nenhum', () => {
      expect(slugDoHortifruti(loc('https://crm-hortifruti.velasqui.workers.dev/'))).toBe('')
    })
  })
})
