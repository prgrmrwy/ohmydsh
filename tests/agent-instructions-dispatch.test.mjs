import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// auto-model-routing spec "子会话派发时机写入环境级指令": the rules live in the environment instructions,
// and model names / effort values stay in the plugin code (their single source).
test('dispatch_rules_present_without_model_names', () => {
  const text = readFileSync(new URL('../instructions/dsh-home.md', import.meta.url), 'utf8')
  for (const needle of ['子会话派发', '独立评审', '并行', 'route_subagent', '不派发', '本身是子会话时不再向下派发']) assert.ok(text.includes(needle), needle)
  assert.doesNotMatch(text, /\b(claude|gpt)-[\w.-]+/)
  assert.doesNotMatch(text, /\bxhigh\b/)
  assert.doesNotMatch(text, /\bmax\b/)
})
