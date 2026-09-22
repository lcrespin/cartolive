import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  esbuild: { target: 'esnext' },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
