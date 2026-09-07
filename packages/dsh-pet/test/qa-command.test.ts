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

  it('sees through the mention markup a group trigger carries', () => {
    // A group message arrives as `@_user_1 /bind abc123`; a naive startsWith
    // would never fire and the command would silently never work.
    expect(parseCommand('@_user_1 /bind abc123')).toEqual({ kind: 'bind', prefix: 'abc123' })
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
