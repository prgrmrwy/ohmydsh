import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Client tests render the settings page, so the JSX runtime must match the
  // client build (automatic) rather than esbuild's classic default.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // The change adds tests alongside each module; until the first module lands
    // there is nothing to collect, which must not fail the package's `test` script.
    passWithNoTests: true,
    // The production-runtime test loads the real launcher graph. Its compat
    // packages live outside node_modules, so vite would otherwise inline them
    // and give the test a second dsh-llm instance next to the one the
    // externalized official agent-loop uses (the loop-request WeakSet is
    // per instance). Load them natively, like the Host does.
    server: { deps: { external: [/\/compat-packages\//] } },
  },
})
