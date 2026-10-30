import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./test/client-support/primitives-stub.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node' },
})
