import { describe, expect, it } from 'vitest'
import {
  LOCUS_LARK_CLI_OUTBOUND_DENIAL,
  locusLarkCliOutboundGuard,
} from '../src/host/locus/lark-cli-egress-guard.js'

describe('Locus shell-tier Lark CLI mistake-prevention guard', () => {
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
  ])('blocks common direct Lark write: %s', command => {
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } }))
      .toBe(LOCUS_LARK_CLI_OUTBOUND_DENIAL)
  })

  it.each([
    'lark-cli im +messages-list --chat-id oc_x',
    'lark-cli im +chat-messages-list --chat-id oc_x',
    'lark-cli im +chat-get --chat-id oc_x',
    'lark-cli api GET /im/v1/messages --query x',
  ])('allows common read command: %s', command => {
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: { command } })).toBeUndefined()
  })

  it('does not inspect non-bash calls or malformed tool arguments', () => {
    expect(locusLarkCliOutboundGuard({ name: 'skill', arguments: { command: 'lark-cli im +messages-send' } })).toBeUndefined()
    expect(locusLarkCliOutboundGuard({ name: 'bash', arguments: null })).toBeUndefined()
  })
})
