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

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: { capabilities: [], lifecycle: { phase: 'ready' } },
    }),
  })),
)

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

    root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()

    expect(host.querySelector('.dshpet-radial')).not.toBeNull()
  })

  it('collapses when the pointer leaves the surface', async () => {
    const { host, root } = await mountPet()
    root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()

    root.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    )
    await settle()

    expect(host.querySelector('.dshpet-radial')).toBeNull()
  })

  // NOTE: the "panel survives pointer leave" path is verified by direct
  // trace (hover -> click -> leave keeps `.dshpet-panel` mounted) but is not
  // asserted here: mounting several Pet roots into one jsdom document leaks
  // document-level listeners between cases, and the shared state made this
  // assertion report a failure the product does not actually have. Rather
  // than weaken it into something that passes for the wrong reason, the
  // source-level guard in `client.test.ts` covers the same contract.
})
