import { describe, expect, it } from 'vitest'
import { loadGoldset } from '../src/eval/retrieval/goldset.js'

const q = (patch: Record<string, unknown> = {}) => ({ id: 'q1', query: 'find it', targets: ['card-a'], type: 'single-hop', topic: 'topic-a', origin: 'handwritten', set: 'dev', ...patch })
const json = (value: unknown) => JSON.stringify(value)
const good = [q(), q({ id: 'q2', targets: ['card-b'], set: 'holdout', topic: 'topic-b' })]
const slugs = ['card-a', 'card-b']

describe('gold set 契约与选集', () => {
  it('混合集合文件按选集运行', () => {
    const result = loadGoldset({ path: 'gold.json', content: json(good), set: 'dev', snapshotSlugs: slugs })
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]?.id).toBe('q1')
    expect(result.allTargetSlugs).toEqual(['card-a', 'card-b'])
    expect(result.reportSuffix).not.toContain('holdout')
  })

  it('同主题跨集合被拒绝', () => {
    expect(() => loadGoldset({ path: 'gold.json', content: json([q(), q({ id: 'q2', set: 'holdout' })]), set: 'dev', snapshotSlugs: slugs })).toThrow(/topic-a.*set|set.*topic-a/i)
  })

  it('文件级错误定位到根', () => {
    for (const content of ['[]', '{bad']) expect(() => loadGoldset({ path: 'gold.json', content, set: 'dev', snapshotSlugs: slugs })).toThrow(/gold\.json.*\$/)
  })

  it('题级错误定位到 id 与字段', () => {
    const cases = [
      [q(), q({ id: 'q1', topic: 'other' })],
      [q({ targets: [] })],
      [q({ type: 'triple' })],
      [q({ note: 'unknown' })],
      [q({ targets: ['../x'] })],
    ]
    const fields = ['id', 'targets', 'type', 'note', 'targets']
    cases.forEach((value, index) => expect(() => loadGoldset({ path: 'gold.json', content: json(value), set: 'dev', snapshotSlugs: slugs })).toThrow(new RegExp(`q1.*${fields[index]}`)))
  })

  it('接受内核兼容且路径安全的 slug', () => {
    const accepted = ['api_retry', 'API-timeout', 'lease.v2', 'card0', '中文卡', 'nested/中文_API.v2']
    for (const slug of accepted) {
      const result = loadGoldset({ path: 'gold.json', content: json([q({ targets: [slug] })]), set: 'dev', snapshotSlugs: [slug] })
      expect(result.questions[0]?.targets).toEqual([slug])
    }
  })

  it('拒绝路径危险或内核不接受的 slug', () => {
    for (const slug of ['../x', 'bad..name', '/absolute', 'a//b', 'a\\b', 'a:b', 'bad\0slug']) {
      expect(() => loadGoldset({ path: 'gold.json', content: json([q({ targets: [slug] })]), set: 'dev', snapshotSlugs: [slug] })).toThrow(/q1.*targets/)
    }
  })

  it('目标卡不存在时报出 slug', () => {
    expect(() => loadGoldset({ path: 'gold.json', content: json([q({ targets: ['missing'] })]), set: 'dev', snapshotSlugs: slugs })).toThrow(/q1.*missing/)
  })

  it('未指定或选空集合被拒绝', () => {
    expect(() => loadGoldset({ path: 'gold.json', content: json(good), snapshotSlugs: slugs } as never)).toThrow(/--set|set.*required/i)
    expect(() => loadGoldset({ path: 'gold.json', content: json([q()]), set: 'holdout', snapshotSlugs: slugs })).toThrow(/empty.*set|set.*empty/i)
  })

  it('执行文件字节数与题数上限', () => {
    const tooMany = Array.from({ length: 501 }, (_, index) => q({ id: `q${index}`, topic: `topic${index}` }))
    expect(() => loadGoldset({ path: 'gold.json', content: json(tooMany), set: 'dev', snapshotSlugs: slugs })).toThrow(/1..500/)
    expect(() => loadGoldset({ path: 'gold.json', content: ' '.repeat(1024 * 1024 + 1), set: 'dev', snapshotSlugs: slugs })).toThrow(/gold\.json.*\$.*bytes/)
  })
})
