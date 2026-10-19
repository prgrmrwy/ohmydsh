import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/inquiry-isolation-source.test.ts', 'test/inquiry-production-local.test.ts', 'test/inquiry-managed-effects.test.ts', 'test/inquiry-production-wiring.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
