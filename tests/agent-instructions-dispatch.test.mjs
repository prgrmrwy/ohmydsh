import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const instructions = () => readFileSync(new URL('../instructions/dsh-home.md', import.meta.url), 'utf8')
const skill = () => readFileSync(new URL('../packages/auto-model-routing/skills/subagent-model-routing/SKILL.md', import.meta.url), 'utf8')

// auto-model-routing spec "环境级指令含派发规则且不含模型名": routing happens at creation; the preview is optional.
test('dispatch_rules_present_without_model_names', () => {
  const text = instructions()
  for (const needle of ['子会话派发', '独立评审', '并行', 'route_subagent', '不派发', '本身是子会话时不再向下派发']) assert.ok(text.includes(needle), needle)
  for (const needle of ['官方 fresh 创建工具', '只传用户或 lead 指定', '不需要先调用 `route_subagent`', '暂停委派并询问用户']) assert.ok(text.includes(needle), needle)
  for (const banned of ['必须先调用 `route_subagent`', '全部显式传给']) assert.ok(!text.includes(banned), banned)
  assert.doesNotMatch(text, /\b(claude|gpt)-[\w.-]+/)
  assert.doesNotMatch(text, /\bxhigh\b/)
  assert.doesNotMatch(text, /\bmax\b/)
})

// spec "指令不要求把预览结果当显式参数"
test('preview_results_are_never_required_as_explicit_arguments', () => {
  for (const text of [instructions(), skill()]) {
    assert.ok(!text.includes('返回档位'))
    assert.ok(!text.includes('全部显式传给子会话工具'))
  }
  assert.ok(instructions().includes('可选预览'))
  assert.ok(skill().includes('可选预览'))
})
