import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Config de teste separada da de dev/build: reaproveita o plugin React do
// vite.config (precisa dele pra transformar JSX nos .test.tsx) e liga o
// jsdom só aqui — os testes de derivarClientes (puros, sem DOM) continuam
// rodando igual, os novos testes de componente ganham `document`/`window`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // `globals: true` só pra expor `afterEach` no escopo global: é o que
      // a limpeza automatica do Testing Library (unmount entre testes)
      // procura. describe/it/expect continuam importados explicitamente
      // de 'vitest' nos arquivos de teste, como ja era.
      globals: true,
    },
  }),
)
