import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**'],
    environmentMatchGlobs: [['test/renderer/**', 'jsdom']],
  },
})
