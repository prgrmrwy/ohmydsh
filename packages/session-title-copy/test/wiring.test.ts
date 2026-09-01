import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BADGE_MARKER,
  HINT_LIFETIME_MS,
  HINT_MARKER,
  HINT_TEXT,
  sessionSnippet,
  showCopiedHint,
  styleBadge,
  updateBadge,
  wireBadge,
  type BadgeElementLike,
  type CopyContext,
  type CopyHooks,
} from '../src/client/wiring.js'

interface RecordedListener {
  fn: (event: { stopPropagation(): void }) => void
  capture: boolean
}

/** Fake badge element with a listener registry + attribute/text store. */
function fakeBadge(): {
  badge: BadgeElementLike
  listeners: RecordedListener[]
  click: () => { stopped: boolean }
} {
  const attributes = new Map<string, string>()
  const listeners: RecordedListener[] = []
  let stopped = false
  const badge = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    hasAttributeRef: false,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    textContent: null as string | null,
    addEventListener: (type: string, fn: (event: { stopPropagation(): void }) => void, options?: { capture?: boolean }) => {
      if (type === 'click') listeners.push({ fn, capture: options?.capture ?? false })
    },
    style: { cssText: '' },
  }
  return {
    badge,
    listeners,
    click: () => {
      stopped = false
      for (const l of listeners) {
        if (!l.capture) continue
        l.fn({ stopPropagation: () => { stopped = true } })
      }
      return { stopped }
    },
  }
}

function copyEnv(current: string | undefined): {
  ctx: CopyContext
  hooks: CopyHooks
  copied: string[]
  hints: number
} {
  const copied: string[] = []
  let hints = 0
  return {
    copied,
    get hints() {
      return hints
    },
    get ctx() {
      return { currentSessionId: () => current }
    },
    get hooks() {
      return {
        writeClipboard: async (text: string) => { copied.push(text) },
        showHint: () => { hints += 1 },
      }
    },
  }
}

describe('sessionSnippet', () => {
  it('strips the session- prefix and takes 6 chars', () => {
    expect(sessionSnippet('session-9af69be9-3ee5-4bf7-9522-d68b9dd0c6b1')).toBe('9af69b')
  })

  it('takes the first 6 chars when the id has no prefix', () => {
    expect(sessionSnippet('9af69be9-3ee5-4bf7')).toBe('9af69b')
  })

  it('is capped at 6 chars on short ids', () => {
    expect(sessionSnippet('session-abc')).toBe('abc')
  })
})

describe('wireBadge', () => {
  it('is idempotent: marker and a single capture listener', () => {
    const { badge, listeners } = fakeBadge()
    const env = copyEnv('s-1')
    wireBadge(badge, env.ctx, env.hooks)
    wireBadge(badge, env.ctx, env.hooks)
    expect(badge.getAttribute(BADGE_MARKER)).toBe('')
    expect(listeners.length).toBe(1)
    expect(listeners[0]!.capture).toBe(true)
  })

  it('click copies the FULL current session id and stops propagation', async () => {
    const { badge, click } = fakeBadge()
    const env = copyEnv('session-9af69be9-3ee5-4bf7-9522-d68b9dd0c6b1')
    wireBadge(badge, env.ctx, env.hooks)
    const { stopped } = click()
    expect(stopped).toBe(true)
    await vi.waitFor(() => expect(env.copied).toEqual(['session-9af69be9-3ee5-4bf7-9522-d68b9dd0c6b1']))
    expect(env.hints).toBe(1)
  })

  it('click with no current session id does nothing', async () => {
    const { badge, click } = fakeBadge()
    const env = copyEnv(undefined)
    wireBadge(badge, env.ctx, env.hooks)
    click()
    await Promise.resolve()
    expect(env.copied).toEqual([])
    expect(env.hints).toBe(0)
  })

  it('clipboard rejection is swallowed (no throw, no hint)', async () => {
    const { badge, click } = fakeBadge()
    let hints = 0
    const ctx = { currentSessionId: () => 'session-x' }
    const hooks: CopyHooks = {
      writeClipboard: async () => { throw new Error('denied') },
      showHint: () => { hints += 1 },
    }
    wireBadge(badge, ctx, hooks)
    expect(() => click()).not.toThrow()
    await Promise.resolve()
    expect(hints).toBe(0)
  })
})

describe('updateBadge / styleBadge', () => {
  it('updateBadge sets the visible snippet and the full-id tooltip', () => {
    const { badge } = fakeBadge()
    updateBadge(badge, 'session-9af69be9-3ee5-4bf7-9522-d68b9dd0c6b1')
    expect(badge.textContent).toBe('9af69b')
    expect(badge.getAttribute('title')).toBe('session-9af69be9-3ee5-4bf7-9522-d68b9dd0c6b1')
  })

  it('styleBadge applies button type and inline look', () => {
    const { badge } = fakeBadge()
    styleBadge(badge)
    expect(typeof badge.style?.cssText).toBe('string')
    expect(badge.style?.cssText).toContain('cursor:pointer')
    expect(badge.style?.cssText).toContain('font-size:11px')
  })
})

describe('showCopiedHint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  interface FakeHintEl {
    style: Record<string, string>
    setAttribute(name: string, value: string): void
    textContent: string | null
    remove(): void
    removed: boolean
  }

  function fakeDoc(): {
    doc: {
      body: { appendChild(node: FakeHintEl): void }
      createElement(tag: string): FakeHintEl
    }
    appended: FakeHintEl[]
    created: FakeHintEl[]
  } {
    const appended: FakeHintEl[] = []
    const created: FakeHintEl[] = []
    const doc = {
      body: { appendChild: (node: FakeHintEl) => { appended.push(node) } },
      createElement: () => {
        const el: FakeHintEl = {
          style: {},
          setAttribute: (n: string, v: string) => { (el as unknown as Record<string, unknown>)[n] = v },
          textContent: null,
          remove: () => { el.removed = true },
          removed: false,
        }
        created.push(el)
        return el
      },
    }
    return { doc, appended, created }
  }

  it('positions below the anchor and auto-removes after its lifetime', () => {
    const { doc, appended, created } = fakeDoc()
    const anchor = { getBoundingClientRect: () => ({ left: 120, bottom: 300 }) } as BadgeElementLike
    showCopiedHint(anchor, doc)
    expect(appended.length).toBe(1)
    const el = created[0]!
    expect((el as unknown as Record<string, unknown>)[HINT_MARKER]).toBe('')
    expect(el.style.left).toBe('120px')
    expect(el.style.top).toBe('306px')
    expect(el.textContent).toBe(HINT_TEXT)
    expect(el.removed).toBe(false)
    vi.advanceTimersByTime(HINT_LIFETIME_MS)
    expect(el.style.opacity).toBe('0')
    vi.advanceTimersByTime(300)
    expect(el.removed).toBe(true)
  })

  it('cleanup removes an in-flight hint immediately', () => {
    const { doc, created } = fakeDoc()
    const anchor = { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } as BadgeElementLike
    const cleanup = showCopiedHint(anchor, doc)
    const el = created[0]!
    cleanup()
    expect(el.removed).toBe(true)
  })
})
