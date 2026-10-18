import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { 'collab-kernel': new URL('../collab-kernel/src/index.ts', import.meta.url).pathname } },
  test: { include: ['test/**/*.test.ts'] },
})
