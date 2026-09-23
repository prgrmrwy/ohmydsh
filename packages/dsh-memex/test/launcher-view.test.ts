// @vitest-environment jsdom
/**
 * Launcher mounting across hash changes.
 *
 * Regression: opening library B while a launcher tab for A was already mounted
 * kept showing A. The mount guard returned early whenever a host element
 * existed, without ever comparing the scope it was mounted for — so the second
 * navigation reused the first library's view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountLauncher } from '../src/client/launcher-view.js'
import { createBrowseAddressRegistry } from '../src/client/browse-address.js'

function setHash(hash: string): void {
  window.location.hash = hash
  window.dispatchEvent(new Event('hashchange'))
}

let dispose: (() => void) | undefined

beforeEach(() => {
  document.body.innerHTML = ''
  window.location.hash = ''
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('launcher view', () => {
  const mount = (requested: string[]) => mountLauncher({
    deps: {
      request: async (_endpoint, params) => {
        requested.push((params as { scope: string }).scope)
        return { status: 'ok', port: 4000 + requested.length, scope: (params as { scope: string }).scope }
      },
      addresses: createBrowseAddressRegistry(),
    },
    t: (key, params) => `${key}:${params?.scope ?? ''}`,
    navigate: () => undefined,
  })

  it('re-resolves when the hash names a different library', async () => {
    const requested: string[] = []
    setHash('#/dsh-memex/browse/alpha')
    dispose = mount(requested)
    await vi.waitFor(() => expect(requested).toEqual(['alpha']))

    setHash('#/dsh-memex/browse/beta')
    await vi.waitFor(() => expect(requested).toEqual(['alpha', 'beta']))

    const host = document.querySelector('[data-dsh-memex-launcher]')
    expect(host?.getAttribute('data-dsh-memex-launcher')).toBe('beta')
  })

  it('a superseded resolution never navigates the retargeted tab', async () => {
    // The user can retarget this tab while the first library is still starting.
    // The slow answer must not win the navigation.
    const navigated: string[] = []
    const release: Record<string, () => void> = {}
    dispose = mountLauncher({
      deps: {
        request: async (_endpoint, params) => {
          const scope = (params as { scope: string }).scope
          await new Promise<void>(resolve => { release[scope] = resolve })
          return { status: 'ok', port: 4000, scope }
        },
        addresses: createBrowseAddressRegistry(),
      },
      t: key => key,
      navigate: address => { navigated.push(address) },
    })

    setHash('#/dsh-memex/browse/alpha')
    await vi.waitFor(() => expect(release.alpha).toBeTypeOf('function'))
    setHash('#/dsh-memex/browse/beta')
    await vi.waitFor(() => expect(release.beta).toBeTypeOf('function'))

    // Answer the STALE request last; it must be ignored entirely.
    release.beta?.()
    await vi.waitFor(() => expect(navigated).toHaveLength(1))
    release.alpha?.()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(navigated).toHaveLength(1)
  })

  it('mounts nothing outside its own route and cleans up on leaving', async () => {
    const requested: string[] = []
    setHash('#/settings')
    dispose = mount(requested)
    expect(document.querySelector('[data-dsh-memex-launcher]')).toBeNull()

    setHash('#/dsh-memex/browse/alpha')
    await vi.waitFor(() => expect(document.querySelector('[data-dsh-memex-launcher]')).not.toBeNull())

    setHash('#/settings')
    expect(document.querySelector('[data-dsh-memex-launcher]')).toBeNull()
    expect(requested).toEqual(['alpha'])
  })
})
