import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Front e API na mesma origem em dev: o cookie de sessao (HttpOnly,
  // SameSite=Lax) so viaja sem CORS se as duas parecerem a mesma origem.
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
