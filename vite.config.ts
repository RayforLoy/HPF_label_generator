import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/HPF_label_generator/',
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
