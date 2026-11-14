import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Local dev: forward /api/* to the FastAPI backend (127.0.0.1 avoids anything else bound to localhost:8000)
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
})
