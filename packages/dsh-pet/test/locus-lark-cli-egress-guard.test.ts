import { describe, expect, it } from 'vitest'
import {
  LOCUS_LARK_CLI_OUTBOUND_DENIAL,
  locusLarkCliOutboundGuard,
} from '../src/host/locus/lark-cli-egress-guard.js'
import { attestLocusComposition, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES } from '../src/host/locus/composition.js'

describe('Locus danger-full-access Lark CLI mistake-prevention guard', () => {
  it.each([
    'lark-cli im +messages-send --text hi',
    'lark-cli im +messages-reply --text hi',
    'lark-cli im +messages-recall --message-id om_x',
    'lark-cli im +messages-update --text hi',
    'lark-cli im +messages-forward --message-id om_x',
    'lark-cli api POST /im/v1/messages --data x',
    'lark-cli api PATCH /im/v1/messages/om_x --data x',
    'lark-cli   im   +messages-send --text hi',
    'lark-cli im "+messages-send" --text hi',
    // Doc-comment write spellings (pet-locus-doc-comments D8)
    'lark-cli drive +add-reply --comment-id 1 --content x',
    'lark-cli drive +add-comment --url u --content x',
    'lark-cli drive +update-reply --comment-id 1 --reply-id 2 --content x',
    'lark-cli drive +delete-reply --comment-id 1 --reply-id 2',
    'lark-cli drive +resolve-comment --comment-id 1',
    'lark-cli drive +restore-comment --comment-id 1',
    'lark-cli drive +react-reply --reply-id 2 --emoji DONE --action add',
    'lark-cli docs +update --doc d --markdown x',
    'lark-cli docs +create --title t',
    // The /open-apis prefix previously slipped past the api pattern.
    'lark-cli api POST /open-apis/im/v1/messages --data x',
    'lark-cli api POST /open-apis/drive/v1/files/d/comments --data x',
    'lark-cli api POST /drive/v1/files/d/comments/1/replies --data x',
    'lark-cli api PATCH /open-apis/docx/v1/documents/d/blocks/b --data x',
  ])('blocks common direct Lark write: %s', command => {
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } }))
      .toBe(LOCUS_LARK_CLI_OUTBOUND_DENIAL)
  })

  it.each([
    'lark-cli im +messages-list --chat-id oc_x',
    'lark-cli im +chat-messages-list --chat-id oc_x',
    'lark-cli im +chat-get --chat-id oc_x',
    'lark-cli api GET /im/v1/messages --query x',
    'lark-cli drive +batch-query-comments --comment-ids 1',
    'lark-cli drive +list-replies --comment-id 1',
    'lark-cli docs +fetch --doc d --doc-format markdown',
    'lark-cli api GET /open-apis/drive/v1/files/d/comments',
  ])('allows common read command: %s', command => {
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } })).toBeUndefined()
  })

  it('spec Scenario "shell 档直接调用评论或文档写命令": a comment reply, a doc body write and a raw /open-apis IM send all get the finish denial', () => {
    for (const command of [
      'lark-cli drive +add-reply --comment-id c1 --content x',
      'lark-cli docs +update --doc d --markdown x',
      'lark-cli api POST /open-apis/im/v1/messages --data x',
    ]) {
      expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } })).toBe(LOCUS_LARK_CLI_OUTBOUND_DENIAL)
    }
  })

  it('does not inspect non-bash calls or malformed tool arguments', () => {
    expect(locusLarkCliOutboundGuard({ name: 'skill', arguments: { command: 'lark-cli im +messages-send' } })).toBeUndefined()
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: null })).toBeUndefined()
  })

  it('spec Scenario "shell 档误用 lark-cli 发送被拦截"', () => {
    for (const command of [
      'lark-cli im +messages-send --chat-id oc_x --text hi',
      'lark-cli im +messages-reply --message-id om_x --text hi',
      'lark-cli im +messages-recall --message-id om_x',
      'lark-cli im +messages-update --message-id om_x --text hi',
    ]) {
      const denial = locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } })
      expect(denial).toBe(LOCUS_LARK_CLI_OUTBOUND_DENIAL)
    }
    // The denial names the managed finish and asks for finish's own refusal reason.
    expect(LOCUS_LARK_CLI_OUTBOUND_DENIAL).toContain('pet_locus_finish')
    expect(LOCUS_LARK_CLI_OUTBOUND_DENIAL).toMatch(/拒绝原因/)
  })

  it('spec Scenario "shell 档读取当前群不被拦截"', () => {
    for (const command of [
      'lark-cli im +chat-messages-list --chat-id oc_current',
      'lark-cli im +messages-list --chat-id oc_current',
      'lark-cli api GET /open-apis/im/v1/messages --query container_id=oc_current',
    ]) {
      expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } })).toBeUndefined()
    }
  })

  it('spec Scenario "shell 旁路不可达": a read-only child cannot be published with any shell route', () => {
    // The guard is not the boundary for read-only; the published surface is.
    const readOnly = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS]
    expect(readOnly).not.toContain('bash')
    expect(readOnly).not.toContain('skill')
    for (const route of ['bash', 'skill']) {
      expect(attestLocusComposition([...readOnly, route], 'read-only')).toMatchObject({ ok: false, leaks: [route] })
    }
  })
})

