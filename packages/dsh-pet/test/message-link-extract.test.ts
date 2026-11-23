/**
 * Feishu message-link extraction (change `locus-read-referenced-chats`, D2).
 *
 * The link a child may follow is taken by the Host from the PLATFORM body of a
 * message already proven to be in the entrance chat; the model never writes a
 * URL. What is pinned here is which strings count as a message link: https
 * only, no userinfo, an exact host allowlist, the exact path, exactly one
 * non-empty token, deduplicated in order of appearance, no count cap.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MESSAGE_LINK_HOSTS,
  extractMessageLinksFromRaw,
  extractMessageLinksFromText,
} from '../src/host/locus/message-link.js'

const L1 = 'https://applink.larkoffice.com/client/message/link/open?token=AAAAAAAAAAAAAAAAAAAAAA%3D'
const L2 = 'https://applink.feishu.cn/client/message/link/open?token=BBBBBBBBBBBBBBBBBBBBBB%3D'

function post(...paragraphs: readonly Record<string, unknown>[][]): string {
  return JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs })
}

describe('message link extraction', () => {
  it('extracts, dedupes and numbers links from text and post href', () => {
    // spec Scenario "多个链接按出现顺序编号": L1 in an href, a web link, L2 in text, L1 again.
    const content = post(
      [{ tag: 'a', text: '这条', href: L1 }],
      [{ tag: 'text', text: '参考 https://example.com/page 以及' }],
      [{ tag: 'text', text: `看下${L2}，还有` }, { tag: 'a', text: '再一次', href: L1 }],
    )
    expect(extractMessageLinksFromRaw('post', content)).toEqual([L1, L2])

    // A plain text message: the measured shape — the link sits inside `text`.
    expect(extractMessageLinksFromRaw('text', JSON.stringify({ text: `@_user_1 能看到这个视频不${L1}` })))
      .toEqual([L1])

    // Other message types carry no link the Host follows.
    expect(extractMessageLinksFromRaw('image', JSON.stringify({ image_key: 'img_x' }))).toEqual([])
    // Unparseable content is no links, not a throw.
    expect(extractMessageLinksFromRaw('text', 'This message was recalled')).toEqual([])


    // Formatted-text adapter (history line / prompt text), trailing punctuation trimmed.
    expect(extractMessageLinksFromText(`见 [这条](${L2})。另外 ${L1}.`)).toEqual([L2, L1])
    expect(DEFAULT_MESSAGE_LINK_HOSTS).toEqual(['applink.feishu.cn', 'applink.larkoffice.com'])
  })

  it('12 links are all numbered and linkIndex 12 resolves the twelfth', () => {
    // No count cap: every link is numbered in order of first appearance.
    const many = Array.from({ length: 12 }, (_, i) =>
      `https://applink.feishu.cn/client/message/link/open?token=T${String(i).padStart(2, '0')}`)
    const extracted = extractMessageLinksFromRaw('text', JSON.stringify({ text: many.join(' ') }))
    expect(extracted).toEqual(many)
    expect(extracted[11]).toBe(many[11])
    expect(extractMessageLinksFromText(many.join(' '))).toEqual(many)
  })

  it('percent-encoded token is extracted byte for byte', () => {
    const extracted = extractMessageLinksFromRaw('text', JSON.stringify({ text: `见 ${L1} 与 ${L2}` }))
    expect(extracted).toEqual([L1, L2])
    expect(extracted[0]).toContain('%3D')
  })

  it('rejects foreign host, userinfo, http and empty or duplicate token', () => {
    const rejected = [
      'https://evil.example/client/message/link/open?token=x',
      'https://user@applink.larkoffice.com.evil.example/client/message/link/open?token=x',
      'https://user:pw@applink.larkoffice.com/client/message/link/open?token=x',
      'https://applink.larkoffice.com.evil.example/client/message/link/open?token=x',
      'http://applink.larkoffice.com/client/message/link/open?token=x',
      'https://applink.larkoffice.com/client/message/link/open?token=',
      'https://applink.larkoffice.com/client/message/link/open',
      'https://applink.larkoffice.com/client/message/link/open?token=a&token=b',
      'https://applink.larkoffice.com/client/chat/open?openChatId=oc_x',
      'https://applink.larkoffice.com/client/message/link/openx?token=x',
    ]
    for (const url of rejected) {
      expect(extractMessageLinksFromRaw('text', JSON.stringify({ text: url })), url).toEqual([])
      expect(extractMessageLinksFromRaw('post', post([{ tag: 'a', text: 't', href: url }])), url).toEqual([])
      expect(extractMessageLinksFromText(url), url).toEqual([])
    }
    // The allowlist is exact and configurable.
    expect(extractMessageLinksFromText(L1, ['applink.feishu.cn'])).toEqual([])
    expect(extractMessageLinksFromText(L2, ['applink.feishu.cn'])).toEqual([L2])
  })
})
