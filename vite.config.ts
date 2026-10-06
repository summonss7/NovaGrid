import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base './' — относительные пути к ассетам, чтобы сборка отдавалась
// и с подкаталога GitHub Pages (https://<owner>.github.io/NovaGrid/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
