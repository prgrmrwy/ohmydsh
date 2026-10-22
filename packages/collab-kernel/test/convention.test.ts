import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { conventions, defaultConvention, readConvention } from '../src/convention/index.js'

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
/** Published v1 bytes; spaces created before v2 recorded this digest. */
const V1_SHA256 = '5df2524d42641e3885f4e2ec0314d4b03f0922662d933f9283fe1ddd4c8cd039'

describe('convention', () => {
  it('convention-01：默认版本为 2，正文可读取且摘要与全文匹配', () => {
    const text = readConvention('2')
    expect(text).toBe(defaultConvention.text)
    expect(defaultConvention.version).toBe('2')
    expect(defaultConvention.sha256).toBe(sha(text))
    expect(text).toContain('先分清事实与权限')
    expect(text).toContain('成员信任')
    expect(text).toContain('requestDecision')
  })

  it('convention-02：未知版本抛出 COLLAB_CONVENTION_UNKNOWN', () => {
    expect(() => readConvention('9')).toThrowError(expect.objectContaining({ code: 'COLLAB_CONVENTION_UNKNOWN' }))
    expect(() => readConvention('toString')).toThrowError(expect.objectContaining({ code: 'COLLAB_CONVENTION_UNKNOWN' }))
  })

  it('convention-03：已发布的 v1 文本不可变', () => {
    expect(sha(readConvention('1'))).toBe(V1_SHA256)
    expect(conventions['1']!.sha256).toBe(V1_SHA256)
    expect(Object.keys(conventions).sort()).toEqual(['1', '2'])
  })
})
