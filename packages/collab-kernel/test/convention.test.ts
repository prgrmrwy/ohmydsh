import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { defaultConvention, readConvention } from '../src/convention/index.js'

describe('convention', () => {
  it('convention-01：版本 1 正文可读取且摘要与全文匹配', () => {
    const text = readConvention('1')
    expect(text).toBe(defaultConvention.text)
    expect(defaultConvention.version).toBe('1')
    expect(defaultConvention.sha256).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    expect(text).toContain('先分清事实与权限')
  })

  it('convention-02：未知版本抛出 COLLAB_CONVENTION_UNKNOWN', () => {
    expect(() => readConvention('9')).toThrowError(expect.objectContaining({ code: 'COLLAB_CONVENTION_UNKNOWN' }))
  })
})
