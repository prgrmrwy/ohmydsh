import { expect, test } from 'vitest'
import { mapCatalog } from '../src/host/catalog.js'
test('spec Scenario "字段映射"', () => {
  const result = mapCatalog({ data: [
    { id: 'claude/claude-haiku-5-5', display_name: 'Claude Haiku 5.5', reasoning_levels: ['low', 'high'], modalities: { input: ['text', 'image'] }, context_window: 1000000, max_output_tokens: 100 },
    { id: 'opencode-go/kimi-k3', reasoning_levels: ['max'] },
    { id: 'deepseek/deepseek-v4-pro', display_name: '', modalities: { input: ['text'] } },
  ] })
  expect(result.map(m => m.info.name)).toEqual(['Claude Haiku 5.5', 'opencode-go/kimi-k3', 'deepseek/deepseek-v4-pro'])
  expect(result[0]?.info).toMatchObject({ context: { contextWindow: 1000000 }, defaultMaxTokens: 100, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } })
  expect(result[1]?.efforts).toEqual(['max']); expect(result[2]?.info.inputModalities).toEqual(['text'])
})
test('malformed optional numeric metadata is omitted and repeated efforts do not break model validation', () => {
  const [model] = mapCatalog({ data: [{ id: 'a', reasoning_levels: ['high', 'high'], context_window: 2.5, max_output_tokens: 1.5 }] })
  expect(model?.efforts).toEqual(['high'])
  expect(model?.info.context).toBeUndefined()
  expect(model?.info.defaultMaxTokens).toBeUndefined()
})
test('spec Scenario "非法容量值视为缺失"', () => {
  const result = mapCatalog({ data: [0, -1, 2.5, '1000', 9007199254740992].map((v, i) => ({ id: `m${i}`, context_window: v, max_output_tokens: v })) })
  expect(result.map(m => m.info.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  for (const m of result) { expect(m.info).not.toHaveProperty('context'); expect(m.info).not.toHaveProperty('defaultMaxTokens') }
})
test('spec Scenario "畸形条目被丢弃"', () => expect(mapCatalog({ data: [{ name: 'bad' }, { id: 'a' }, { id: 'b' }] })).toHaveLength(2))
