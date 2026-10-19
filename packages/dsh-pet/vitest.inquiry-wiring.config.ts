import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const graph = process.env.PET_INQUIRY_LAUNCHER
if (!graph || !graph.startsWith('/') || graph.trim() !== graph) {
  throw new Error('Set PET_INQUIRY_LAUNCHER to the absolute path of an isolated compiled launcher directory before running inquiry wiring tests.')
}
const req = createRequire(resolve(graph, 'package.json'))
const modules = [
  'cordis', 'dsh-agent', 'dsh-session', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt',
  'dsh-session-projection', 'dsh-scope', 'dsh-session-persistence', 'dsh-agent-loop',
  'dsh-storage-domain',
]
const aliases = modules.map((name) => ({
  find: new RegExp(`^@deepseek-ai/${name}$`),
  replacement: req.resolve(`@deepseek-ai/${name}`),
}))
aliases.unshift({ find: /^@deepseek-ai\/cordis-original$/, replacement: req.resolve('@deepseek-ai/cordis') })

export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['test/inquiry-production-wiring.test.ts'], testTimeout: 15_000 },
})
