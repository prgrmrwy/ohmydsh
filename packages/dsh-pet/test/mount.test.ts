/**
 * Pet's own mount host under `document.body`.
 *
 * Pet leaves the shell's overlay slot so a layout-push sidebar cannot squeeze
 * its containing block. That hands Pet the mount lifecycle the slot used to
 * own, so these tests cover exactly what it now has to get right itself:
 * create once, reuse on reload, and tear down completely.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PET_HOST_ATTRIBUTE } from '../src/client/index.js'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  // Earlier cases in this file apply the bundle without disposing, so their
  // style tags would otherwise accumulate and make a later "is it gone?"
  // assertion read the previous case's leftovers.
  for (const style of document.head.querySelectorAll('style[data-plugin="dsh-pet"]')) {
    style.remove()
  }
})

/**
 * A minimal client context recording the effects a plugin registers.
 *
 * The real `apply` runs several effects; only their disposers matter here, so
 * this collects them rather than emulating cordis.
 */
function fakeContext(): {
  ctx: Record<string, unknown>
  dispose: () => void
} {
  const disposers: (() => void)[] = []
  const ctx = {
    effect: (run: () => (() => void) | void) => {
      const stop = run()
      if (typeof stop === 'function') disposers.push(stop)
    },
    slots: {
      inject: (_name: string, run: () => unknown) => {
        run()
      },
      register: () => () => {},
    },
    sessions: {
      list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
      open: () => {},
    },
    workspaces: {
      list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
    },
    get: () => undefined,
  }
  return {
    ctx: ctx as unknown as Record<string, unknown>,
    dispose: () => {
      for (const stop of disposers.reverse()) stop()
    },
  }
}

function hosts(): Element[] {
  return [...document.querySelectorAll(`[${PET_HOST_ATTRIBUTE}]`)]
}

describe('Pet owns its mount host', () => {
  it('creates exactly one host under document.body', async () => {
    const { apply } = await import('../src/client/index.js')
    const { ctx } = fakeContext()

    apply(ctx as never)

    expect(hosts()).toHaveLength(1)
    expect(hosts()[0]?.parentElement).toBe(document.body)
  })

  it('reuses the existing host instead of stacking a second Pet', async () => {
    const { apply } = await import('../src/client/index.js')
    const first = fakeContext()
    apply(first.ctx as never)

    // An HMR pass or a plugin reload applies the bundle again.
    const second = fakeContext()
    apply(second.ctx as never)

    // Two hosts would render two mascots, both draggable, both dispatching.
    expect(hosts()).toHaveLength(1)
  })

  it('removes the host and unmounts on disposal', async () => {
    const { apply } = await import('../src/client/index.js')
    const { ctx, dispose } = fakeContext()
    apply(ctx as never)
    expect(hosts()).toHaveLength(1)

    dispose()

    // Leaving the node behind would leak an orphaned React root and its
    // listeners on every plugin reload.
    expect(hosts()).toHaveLength(0)
  })

  it('injects its styles into the document head', async () => {
    const { apply } = await import('../src/client/index.js')
    const { ctx, dispose } = fakeContext()

    apply(ctx as never)
    const style = document.head.querySelector('style[data-plugin="dsh-pet"]')
    expect(style).not.toBeNull()
    // The host must not swallow clicks meant for the page underneath.
    expect(style?.textContent).toContain(`[${PET_HOST_ATTRIBUTE}]{pointer-events:none}`)

    dispose()
    expect(document.head.querySelector('style[data-plugin="dsh-pet"]')).toBeNull()
  })
})
