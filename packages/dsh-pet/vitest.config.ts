import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The real Lottie player probes a 2D canvas at module-evaluation time, which
 * throws in jsdom. Tests therefore resolve the import to a stub; the browser
 * entry still imports the real minified light build in production bundles.
 */
const LOTTIE_STUB = fileURLToPath(new URL('./test/fixtures/lottie-stub.ts', import.meta.url))

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^lottie-web\/build\/player\/lottie_light\.min\.js$/, replacement: LOTTIE_STUB },
      // Collaboration integration tests must exercise this checkout, including in lean worktrees.
      { find: /^dsh-collab$/, replacement: fileURLToPath(new URL('../dsh-collab/src/index.ts', import.meta.url)) },
      { find: /^collab-kernel$/, replacement: fileURLToPath(new URL('../collab-kernel/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/inquiry-isolation-source.test.ts', 'test/inquiry-production-local.test.ts', 'test/inquiry-managed-effects.test.ts', 'test/inquiry-production-wiring.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
