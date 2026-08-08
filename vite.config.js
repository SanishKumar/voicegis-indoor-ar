import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 3000,
    open: true,
    // Required for deviceorientation on mobile (HTTPS)
    // Uncomment for mobile testing:
    // https: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
