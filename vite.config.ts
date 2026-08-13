import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/copilotkit': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/llm': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/agent': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/assistant': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/capabilities': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/node-runs': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/runs': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/api/workspace-bindings': {
        target: process.env.BFF_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
