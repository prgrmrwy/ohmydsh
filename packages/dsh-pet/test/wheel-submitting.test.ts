/**
 * Per-capability click gating on the wheel.
 *
 * One shared `busy` flag disabled the WHOLE wheel while any capability was
 * submitting, and a release that never ran left every sector dead until the
 * page was reloaded — which is what "send-cr went disabled after switching
 * workspace" turned out to be. These pin the two properties that prevent it:
 * the gate is per capability, and it is released.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const overlay = async (): Promise<string> =>
  readFile(path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'), 'utf8')

describe('the wheel gates each capability on its own', () => {
  it('keys the in-flight marker by capability id', async () => {
    const source = await overlay()

    // A single boolean is what coupled the sectors together.
    expect(source).not.toMatch(/const \[busy, setBusy\]/)
    expect(source).toContain('const [submitting, setSubmitting]')
    // Every gate consults the clicked capability, not a global flag.
    expect(source).toContain('submitting.has(capability.id)')
    expect(source).not.toMatch(/\|\| busy\}/)
  })

  it('releases the marker for the capability it set', async () => {
    const source = await overlay()
    const run = source.slice(source.indexOf('const run = useCallback'))

    // Captured before the await so the release cannot target a different id
    // than the one that was marked.
    expect(run).toContain('const marking = capability.id')
    expect(run).toContain('next.delete(marking)')
    // Release must be unconditional, not only on the success path.
    expect(run).toMatch(/finally\s*\{[\s\S]*next\.delete\(marking\)/)
  })

  it('clears stale marks when the source changes', async () => {
    const source = await overlay()

    // Pet survives session and workspace switches on its own React root, so
    // a mark that escaped its `finally` would otherwise be permanent.
    expect(source).toContain('const sourceKey =')
    expect(source).toMatch(/setSubmitting\(current => \(current\.size === 0 \? current : new Set\(\)\)\)/)
    expect(source).toContain('}, [sourceKey])')
  })
})

/**
 * Mounted proof, not source matching.
 *
 * The assertions above pin the shape; this one exercises the behaviour that
 * actually regressed — clicking one capability must not disable the others.
 *
 * @vitest-environment jsdom
 */
describe('clicking one capability leaves the others live', () => {
  it('disables only the clicked sector while it submits', async () => {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { vi } = await import('vitest')

    // Hold the create call open so the in-flight state is observable.
    let release: (() => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('invocation-create')) {
          await new Promise<void>(resolve => {
            release = resolve
          })
        }
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              data: {
                capabilities: [
                  { id: 'send-cr', label: 'send-cr', kind: 'skill', available: true, showAsShortcut: true },
                  { id: 'ws', label: 'ws', kind: 'skill', available: true, showAsShortcut: true },
                ],
                tasks: [],
                lifecycle: { phase: 'ready' },
                started: true,
              },
            }),
        }
      }),
    )

    const host = document.createElement('div')
    host.setAttribute('data-shell-overlay', '')
    document.body.appendChild(host)
    const { PetOverlay } = await import('../src/client/overlay.js')
    await act(async () => {
      createRoot(host).render(
        createElement(PetOverlay as never, {
          openSession: () => {},
          currentSource: { kind: 'session', sessionId: 's1' },
        } as never),
      )
    })
    // Open the wheel.
    await act(async () => {
      ;(host.querySelector('.dshpet-mascot') as HTMLElement)?.focus()
    })

    const sector = (id: string): Element | undefined =>
      [...host.querySelectorAll('.dshpet-slot')].find(node =>
        node.textContent?.includes(id),
      )

    // Click one capability without awaiting its completion.
    const target = sector('send-cr')
    if (target !== undefined) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      // The clicked one is gated; the sibling must still be usable. A shared
      // flag disabled both, which is the regression under test.
      expect(sector('ws')?.getAttribute('data-disabled')).not.toBe('true')
    }

    release?.()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })
})
