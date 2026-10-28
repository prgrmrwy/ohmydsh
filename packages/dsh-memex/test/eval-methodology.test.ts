import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8')
const rows = () => read('evaluation-methodology-mapping.md').split('\n')
  .map(line => /^\| (M\d+) \| ([^|]+) \| (implemented-selftest|deferred|corrected) \| ([^|]+) \|$/.exec(line))
  .filter((match): match is RegExpExecArray => match !== null)
  .map(([, id, principle, status, reason]) => ({ id: id!, principle: principle!.trim(), status: status!, reason: reason!.trim() }))

it('EVAL-049: 逐原则保留去向', () => {
  const mapping = rows()
  expect(mapping.length).toBeGreaterThanOrEqual(20)
  expect(new Set(mapping.map(row => row.id)).size).toBe(mapping.length)
  for (const row of mapping) expect(row.reason.length).toBeGreaterThan(8)
  for (const forbidden of ['校准', '封存集', '稳定性', '出题', '主题']) {
    const matched = mapping.filter(row => row.principle.includes(forbidden))
    expect(matched.length).toBeGreaterThan(0)
    for (const row of matched) expect(row.status).not.toBe('implemented-selftest')
  }
  for (const corrected of ['相关', '链接', '引文', '先验', '区间', '主题数']) {
    expect(mapping.some(row => row.status === 'corrected' && (row.principle + row.reason).includes(corrected))).toBe(true)
  }
})

it('EVAL-050: 未迁移原文不被删除', () => {
  const original = read('evaluation-methodology.md')
  for (const heading of ['## 2. 证据原则', '## 3. 构造检测原则', '### 3.2 出题', '## 4. 判定', '## 5. 报告', '## 6. 防过拟合', '## 7. 安全与隔离', '## 8. 已撤回的结论']) {
    expect(original).toContain(heading)
  }
  for (const row of rows().filter(row => row.status === 'deferred')) {
    const anchor = /「([^」]+)」/.exec(row.principle)?.[1]
    expect(anchor, row.id).toBeTruthy()
    expect(original, row.id).toContain(anchor!)
  }
})
