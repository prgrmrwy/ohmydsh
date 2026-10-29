import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateFixture } from '../src/eval/fixtures.js'
import { selftestManifest } from '../src/eval/selftest-manifest.js'

it('publishes exactly three fixed questions with paired conditions and a natural follow-up', () => {
  const source = fileURLToPath(new URL('../fixtures/eval/', import.meta.url))
  expect(existsSync(source), 'fixed selftest resources must be present').toBe(true)
  const files = validateFixture(source, selftestManifest)
  const questions = JSON.parse(files.get('questions.json')!.toString())
  expect(questions.map((q: { id: string }) => q.id)).toEqual(['know', 'stale', 'writeback'])
  expect(questions.every((q: { conditions: string[] }) => q.conditions.join(',') === 'mem,nomem')).toBe(true)
  expect(questions[2].followUp).toBeTruthy()
  // The old claim must be visible without memory; do not require nomem to guess it.
  expect(questions[2].prompt).toContain('当前工作租约是 15 秒')
  expect(questions[2].prompt).toContain('当前配置')
  expect(questions[2].prompt).not.toMatch(/写回|保存|更新记忆/)
  expect(questions[2].requiredFacts).toEqual(['leaseSeconds is 45', 'the previous 15-second statement is stale'])
})
