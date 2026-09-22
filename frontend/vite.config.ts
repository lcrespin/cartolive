import { defineConfig } from 'vite'

const apiProxy = {
  '/api': 'http://localhost:3001',
  '/ws': {
    target: 'ws://localhost:3001',
    ws: true,
  },
}

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
})
