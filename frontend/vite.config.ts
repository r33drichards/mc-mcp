import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/api/copilotkit': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/api/agent': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['three', '@tweenjs/tween.js', 'socket.io-client'],
  },
})
