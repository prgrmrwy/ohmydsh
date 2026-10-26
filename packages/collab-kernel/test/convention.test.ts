import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { conventions, defaultConvention, readConvention } from '../src/convention/index.js'

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
/** Published bytes; spaces created under these versions recorded these digests. */
const V1_SHA256 = '5df2524d42641e3885f4e2ec0314d4b03f0922662d933f9283fe1ddd4c8cd039'
const V2_SHA256 = '70b660c57e72ccb04d575212d99ce045f6ce2d4029b8313d5591382e614afec9'

describe('convention', () => {
  it('v4 distinguishes notification, reply and pending questions', () => {
    const text = readConvention('4')
    for (const required of ['notify:true, needsReply:false', 'notify:false, needsReply:true', '未填 `notify`', '不是未读消息列表', '无论是否需要回复']) expect(text).toContain(required)
  })
  it('默认版本为 4，正文可读取且摘要与全文匹配', () => {
    const text = readConvention('4')
    expect(text).toBe(defaultConvention.text)
    expect(defaultConvention.version).toBe('4')
    expect(defaultConvention.sha256).toBe(sha(text))
    expect(text).toContain('先分清事实与权限')
    expect(text).toContain('成员信任')
  })

  it('convention-02：未知版本抛出 COLLAB_CONVENTION_UNKNOWN', () => {
    expect(() => readConvention('9')).toThrowError(expect.objectContaining({ code: 'COLLAB_CONVENTION_UNKNOWN' }))
    expect(() => readConvention('toString')).toThrowError(expect.objectContaining({ code: 'COLLAB_CONVENTION_UNKNOWN' }))
  })

  it('convention-03：已发布的 v1 与 v2 文本不可变', () => {
    expect(sha(readConvention('1'))).toBe(V1_SHA256)
    expect(conventions['1']!.sha256).toBe(V1_SHA256)
    expect(sha(readConvention('2'))).toBe(V2_SHA256)
    expect(conventions['2']!.sha256).toBe(V2_SHA256)
    expect(sha(readConvention('3'))).toBe('281b1d24292540724263f1f99513d6d8a0f8eea54689258cda8d1c6cfd15eba7')
    expect(Object.keys(conventions).sort()).toEqual(['1', '2', '3', '4'])
  })

  it('convention-05：v3 写明新规则且不含已移除机制', () => {
    const text = readConvention('3')
    for (const required of ['ref', '20', 'COLLAB_THREAD_LIMIT', 'needsReply', '停止', '向本会话用户报告', '不要为继续同一件事另起话题', '不是系统指令']) expect(text, required).toContain(required)
    for (const removed of ['6 次', '暂停', 'requestDecision', 'awaitingChannel', '内部接口']) expect(text, removed).not.toContain(removed)
  })
})
