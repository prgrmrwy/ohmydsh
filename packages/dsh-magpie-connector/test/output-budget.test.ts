import { expect, test } from 'vitest'
import { mapCatalog } from '../src/host/catalog.js'
const map = (entry: Record<string, unknown>) => mapCatalog({ data: [{ id: 'm', ...entry }] })[0]!
const budget = (C: number, O: number) => map({ context_window: C, max_output_tokens: O }).info.defaultMaxTokens!

// Mirrors DSH 0.2.0-rc.2 compaction-basic defaults (lib/index.js: DEFAULT_THRESHOLD_RATIO .8, DEFAULT_RETAIN_RATIO .16,
// headroomTokens 65536, resolveCompactSpec). Re-check against the host on every DSH upgrade.
const hostChecks = (C: number, B: number) => {
  const pressure = C - B - 65536
  const threshold = Math.floor(Math.min(C * 0.8, pressure))
  const retain = Math.floor((C - B) * 0.16)
  return { pressure, threshold, retain, passes: pressure > 0 && retain < threshold }
}

test('spec Scenario "适用窗口内满足宿主两项压缩检查"', () => {
  for (const [C, O] of [[104026, 416104], [131072, 65536], [272000, 128000], [500000, 393216], [524288, 524288], [1000000, 512000], [1000000, 393216], [262144, 32768]] as const) {
    const check = hostChecks(C, budget(C, O))
    expect(check.pressure, `${C}/${O}`).toBeGreaterThan(0)
    expect(check.retain, `${C}/${O}`).toBeLessThan(check.threshold)
  }
  // Before this change the full capacity was the budget, which left no pressure budget for these two.
  expect(hostChecks(524288, 524288).pressure).toBe(-65536)
  expect(hostChecks(131072, 65536).pressure).toBe(0)
})
test('spec Scenario "适用窗口以下不保证通过"', () => {
  const result = mapCatalog({ data: [{ id: 'a', context_window: 104025, max_output_tokens: 416100 }, { id: 'b', context_window: 90000, max_output_tokens: 65536 }] })
  expect(result.map(m => [m.info.id, m.info.defaultMaxTokens])).toEqual([['a', 26006], ['b', 22500]])
  for (const m of result) { const check = hostChecks(m.info.context!.contextWindow, m.info.defaultMaxTokens!); expect(check.retain).toBeGreaterThanOrEqual(check.threshold) }
})
test('spec Scenario "大输出模型为压缩保留空间"', () => {
  const m = map({ context_window: 500000, max_output_tokens: 393216 })
  expect(m.info.defaultMaxTokens).toBe(184464)
  expect(m.info.context).toEqual({ contextWindow: 500000 })
  expect(m.outputLimit).toBe(393216)
})
test('spec Scenario "小窗口按四分之一窗口预留"', () => {
  expect(budget(131072, 65536)).toBe(32768)
  expect(budget(272000, 128000)).toBe(70464)
})
test('spec Scenario "网关侧手动设置的输出上限同样收紧"', () => {
  expect(budget(524288, 393216)).toBe(196608)
})
test('one invalid capacity field does not drop the valid one', () => {
  const a = map({ context_window: '1000', max_output_tokens: 4096 })
  expect(a.info).not.toHaveProperty('context'); expect(a.info.defaultMaxTokens).toBe(4096); expect(a.outputLimit).toBe(4096)
  const b = map({ context_window: 500000, max_output_tokens: 0 })
  expect(b.info.context).toEqual({ contextWindow: 500000 }); expect(b.info).not.toHaveProperty('defaultMaxTokens'); expect(b).not.toHaveProperty('outputLimit')
})
test('boundary windows with output equal to the window (Magpie publishes O <= C)', () => {
  expect(hostChecks(104026, budget(104026, 104026)).passes).toBe(true)
  expect(hostChecks(104025, budget(104025, 104025)).passes).toBe(false)
})
test('spec Scenario "输出能力不超过预算时保持不变"', () => {
  expect(budget(1000000, 393216)).toBe(393216)
  expect(budget(262144, 32768)).toBe(32768)
})
test('spec Scenario "缺少上下文窗口时不收紧"', () => {
  const m = map({ max_output_tokens: 4096 })
  expect(m.info.defaultMaxTokens).toBe(4096)
  expect(m.info).not.toHaveProperty('context')
})
test('spec Scenario "缺少最大输出能力时不下发预算"', () => {
  expect(map({ context_window: 500000 }).info).not.toHaveProperty('defaultMaxTokens')
})
