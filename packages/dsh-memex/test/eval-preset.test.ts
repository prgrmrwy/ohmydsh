import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('the reviewed judge preset contains only native presentation, with no coding loaders', () => {
  const path = fileURLToPath(new URL('../../../presets/memex-eval-judge/agent.cordis.yml', import.meta.url))
  expect(existsSync(path)).toBe(true)
  const text = readFileSync(path, 'utf8')
  expect(text).toContain('@deepseek-ai/dsh-agent-tool-presentation')
  expect(text).toContain('mode: native')
  expect(text.match(/^\s*-?\s*name:/gm)).toHaveLength(1)
  expect(text).not.toMatch(/dsh-(?:tool-bash|tool-read|skill-filesystem|agent-instructions|subagent)/)
})
