/**
 * Recognising `/bind`, and the two things that recognition must not become:
 * a bypass of the admission gauntlet, or a hijacker of ordinary conversation.
 */

import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/host/qa/command.js'

describe('parsing the bind verb', () => {
  it('reads the prefix from a plain command', () => {
    expect(parseCommand('/bind abc123')).toEqual({ kind: 'bind', prefix: 'abc123' })
  })

  it('sees through the mention a group trigger carries', () => {
    // A group message never starts with the verb; without stripping the
    // mention a naive startsWith never fires.
    expect(parseCommand('@_user_1 /bind abc123')).toEqual({ kind: 'bind', prefix: 'abc123' })
  })

  it('sees through a DISPLAY-NAME mention, which is what real events carry', () => {
    // The regression that shipped: the stripper only knew `@_user_N`, while
    // real inbound bodies carry the bot's display name. The command silently
    // fell through to workspace routing and created a session in the wrong
    // place — the failure looked like "bind ignored my session id".
    expect(parseCommand('@小小芒果 /bind abc123')).toEqual({ kind: 'bind', prefix: 'abc123' })
    expect(parseCommand('@小小芒果 /unbind')).toEqual({ kind: 'unbind' })
  })

  it('handles several leading mentions', () => {
    expect(parseCommand('@小小芒果 @张勇 /bind abc123')).toEqual({
      kind: 'bind',
      prefix: 'abc123',
    })
  })

  it('leaves an @ inside the argument alone', () => {
    // Only LEADING mentions are stripped; the rest of the line is content.
    expect(parseCommand('@小小芒果 /bind abc123')).toEqual({ kind: 'bind', prefix: 'abc123' })
    expect(parseCommand('/bind abc123 @someone')).toEqual({ kind: 'bind', prefix: 'abc123' })
  })

  it('ignores extra words after the prefix', () => {
    expect(parseCommand('/bind abc123 请帮我们答疑')).toEqual({
      kind: 'bind',
      prefix: 'abc123',
    })
  })

  it('reports a missing prefix distinctly', () => {
    expect(parseCommand('/bind')).toEqual({ kind: 'bind-missing-prefix' })
    expect(parseCommand('@_user_1 /bind  ')).toEqual({ kind: 'bind-missing-prefix' })
  })
})

describe('what is NOT a command', () => {
  it('leaves ordinary questions alone', () => {
    expect(parseCommand('构建为什么这么慢').kind).toBe('none')
    expect(parseCommand('@_user_1 abc123 是什么意思').kind).toBe('none')
  })

  it('requires the verb to be a whole token', () => {
    // Prose that merely starts with the same letters is not a command.
    expect(parseCommand('/bindings are hard').kind).toBe('none')
    expect(parseCommand('/binding').kind).toBe('none')
  })

  it('does not fire when the verb appears mid-sentence', () => {
    // Only a leading verb counts; otherwise quoting the command in discussion
    // would trigger it.
    expect(parseCommand('我刚才用了 /bind abc123').kind).toBe('none')
  })
})

describe('parsing the unbind verb', () => {
  it('takes no argument', () => {
    // The group already knows what it is bound to; accepting an argument
    // would invite "unbind someone else's group".
    expect(parseCommand('/unbind')).toEqual({ kind: 'unbind' })
    expect(parseCommand('@_user_1 /unbind')).toEqual({ kind: 'unbind' })
  })

  it('ignores trailing words', () => {
    expect(parseCommand('/unbind 谢谢')).toEqual({ kind: 'unbind' })
  })

  it('is not confused with /bind', () => {
    expect(parseCommand('/bind abc123').kind).toBe('bind')
    expect(parseCommand('/unbind').kind).toBe('unbind')
  })

  it('requires the verb to be a whole token', () => {
    expect(parseCommand('/unbinding').kind).toBe('none')
  })
})
