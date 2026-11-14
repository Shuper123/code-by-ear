import { defineConfig } from 'vitest/config'
import { buildInfo } from './scripts/build_info.mjs'

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
