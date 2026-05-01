import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import honoDevServer from '@hono/vite-dev-server'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    honoDevServer({
      entry: 'src/index.ts',
    }),
    TanStackRouterVite(),
    tailwindcss(),
    react()
  ],
})
