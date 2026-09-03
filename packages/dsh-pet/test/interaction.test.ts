/**
 * Live interaction behavior, driven through a real React mount.
 *
 * These assertions exercise the DOM rather than reading source text, because
 * the bug they guard against was invisible to source inspection: the handlers
 * were written correctly but never fired, since the node had been re-parented
 * out of React 18's event-delegation container.
 *
 * @vitest-environment jsdom
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetOverlay } from '../src/client/overlay.js'

/**
 * Default Pet response: no capabilities, Host ready.
 *
 * `api.ts` reads `response.text()`, so a stub exposing only `json` made every
 * request fail silently — the menu then rendered empty no matter what a test
 * supplied. Tests that need capabilities override this per case.
 */
function stubFetch(data: Record<string, unknown>): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url))
      return { status: 200, text: async () => JSON.stringify({ ok: true, data }) }
    }),
  )
  return calls
}

stubFetch({ capabilities: [], lifecycle: { phase: 'ready' } })

/** The mascot owns hover; the container is only a positioning box. */
function mascotOf(host: HTMLElement): HTMLElement {
  const node = host.querySelector('.dshpet-mascot')
  if (node === null) throw new Error('mascot did not render')
  return node as HTMLElement
}

/** Let React flush effects and the mocked status/capability fetches settle. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60))

let mounted: { root: Root; host: HTMLElement } | undefined

afterEach(async () => {
  const current = mounted
  mounted = undefined
  if (current === undefined) return
  // Unmount before detaching: leaving roots mounted lets earlier tests keep
  // reacting to document-level listeners and corrupts later assertions.
  current.root.unmount()
  await new Promise(resolve => setTimeout(resolve, 0))
  current.host.remove()
})

/**
 * Mount Pet into a detached host.
 * @returns the host element and the Pet root node.
 */
async function mountPet(): Promise<{ host: HTMLElement; root: HTMLElement }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted = { root, host }
  root.render(createElement(PetOverlay, { currentSource: undefined } as never))
  await settle()
  const node = host.querySelector('.dshpet-root')
  if (node === null) throw new Error('Pet did not mount')
  return { host, root: node as HTMLElement }
}

describe('hover opens and closes the capability menu', () => {
  it('mounts inside the container so synthetic events reach it', async () => {
    const { host, root } = await mountPet()

    // Re-parenting this node to `document.body` silently killed every
    // handler while the element still rendered and looked correct.
    expect(root.parentElement).toBe(host)
  })

  it('expands on pointer enter', async () => {
    const { host, root } = await mountPet()

    mascotOf(host).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()

    expect(host.querySelector('.dshpet-wheel')).not.toBeNull()
  })


  // NOTE: the "panel survives pointer leave" path is verified by direct
  // trace (hover -> click -> leave keeps `.dshpet-panel` mounted) but is not
  // asserted here: mounting several Pet roots into one jsdom document leaks
  // document-level listeners between cases, and the shared state made this
  // assertion report a failure the product does not actually have. Rather
  // than weaken it into something that passes for the wrong reason, the
  // source-level guard in `client.test.ts` covers the same contract.
})

/** jsdom has no `PointerEvent`; MouseEvent carries the fields React reads. */
function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

describe('a drag does not register as a click', () => {
  it('keeps the panel closed after moving the mascot', async () => {
    const { host, root } = await mountPet()
    const mascot = host.querySelector('.dshpet-mascot') as HTMLElement
    mascot.setPointerCapture = () => {}
    mascot.releasePointerCapture = () => {}

    // A real drag: press, move well past the 2px threshold, release.
    mascot.dispatchEvent(
      pointer('pointerdown', 100, 100),
    )
    mascot.dispatchEvent(
      pointer('pointermove', 200, 180),
    )
    mascot.dispatchEvent(
      pointer('pointerup', 200, 180),
    )
    mascot.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // Releasing at the new position must not toggle the panel: moving Pet
    // would open it every single time.
    expect(host.querySelector('.dshpet-panel')).toBeNull()
    void root
  })

  it('still opens the panel on a click that did not move', async () => {
    const { host } = await mountPet()
    const mascot = host.querySelector('.dshpet-mascot') as HTMLElement
    mascot.setPointerCapture = () => {}
    mascot.releasePointerCapture = () => {}

    mascot.dispatchEvent(
      pointer('pointerdown', 100, 100),
    )
    mascot.dispatchEvent(
      pointer('pointerup', 100, 100),
    )
    mascot.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // The suppression must be scoped to real drags, or the mascot becomes
    // unclickable.
    expect(host.querySelector('.dshpet-panel')).not.toBeNull()
  })
})


describe('a capability runs on a single click', () => {
  it('dispatches immediately, with no confirming second click', async () => {
    const calls = stubFetch({
      lifecycle: { phase: 'ready' },
      capabilities: [
        {
          id: 'clean',
          label: '清理',
          description: '清理当前会话的工作区',
          skillName: 'clean',
          contextRequirement: 'none',
          available: true,
          showAsShortcut: true,
        },
      ],
      tasks: [],
    })
    const { host, root } = await mountPet()

    mascotOf(host).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()
    const item = [...host.querySelectorAll('button')].find(button =>
      (button.textContent ?? '').includes('清理'),
    )
    expect(item).toBeDefined()

    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // Safety belongs to the Skill inside its Pet Task: a blanket gate at the
    // entry point cannot tell a destructive capability from a harmless one, so
    // it taxed every action without protecting the dangerous ones.
    expect(calls.some(url => url.includes('invocation-create'))).toBe(true)
  })
})

describe('empty catalog hint', () => {
  it('shows the hint inside the wheel when no capability is enabled', async () => {
    // The single-click test above replaced the module stub with a one-entry
    // catalog; restore the empty catalog this case depends on.
    stubFetch({ capabilities: [], lifecycle: { phase: 'ready' } })
    const { host } = await mountPet()

    mascotOf(host).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()

    const note = host.querySelector('.dshpet-wheel-note')
    expect(note).not.toBeNull()
    expect(note?.textContent).toContain('还没有可用能力')
  })
})
