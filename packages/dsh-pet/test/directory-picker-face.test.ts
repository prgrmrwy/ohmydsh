/**
 * The Host directory picker, resolved through REAL cordis.
 *
 * Every other client suite hands `apply` a hand-written `ctx` whose `get`
 * returns `undefined`. That fake cannot fail the way the browser did: the
 * defect was not in Pet's logic but in how cordis resolves a name, so a stub
 * answering `undefined` reports "no picker" — indistinguishable from a
 * correctly degraded deployment — while the real runtime threw.
 *
 * So this suite composes the exact shape `dsh-api-gateway` installs: `remote`
 * is a service, and each Remote namespace is ANOTHER service registered under
 * the dotted name `remote.<namespace>` (its `remoteServiceKey`). Under that
 * arrangement `ctx.get('remote').directoryPicker` throws
 * `cannot get property "remote.directoryPicker" without inject`, because the
 * traceable proxy re-routes an associated dotted property back through the
 * context proxy, which enforces `inject`.
 *
 * @vitest-environment jsdom
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Capture what `apply` publishes to the settings page.
 *
 * The published callbacks ARE the Browse button's behaviour, so intercepting
 * them tests the same code path the user clicks, without exporting test-only
 * accessors from the component module.
 */
const published: {
  picker?: (() => Promise<string | undefined>) | undefined
  lister?: ((path?: string) => Promise<unknown>) | undefined
} = {}

vi.mock('../src/client/settings.js', async () => {
  const actual = await vi.importActual<typeof import('../src/client/settings.js')>(
    '../src/client/settings.js',
  )
  return {
    ...actual,
    setDirectoryPicker: (picker: (() => Promise<string | undefined>) | undefined) => {
      published.picker = picker
    },
    setDirectoryLister: (lister: ((path?: string) => Promise<unknown>) | undefined) => {
      published.lister = lister
    },
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  published.picker = undefined
  published.lister = undefined
  document.body.innerHTML = ''
  for (const style of document.head.querySelectorAll('style[data-plugin="dsh-pet"]')) {
    style.remove()
  }
})

/** Calls recorded by the stand-in Host namespace. */
interface PickerCalls {
  pick: number
  list: (string | undefined)[]
}

/** Let cordis settle the fibers started so far. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Compose Pet's client half over a cordis root shaped like the real Client.
 *
 * @param options - whether to mount the gateway and the picker namespace.
 * @returns the recorded namespace calls plus a disposer.
 */
async function composeClient(
  options: { gateway?: boolean; namespace?: boolean } = {},
): Promise<{ calls: PickerCalls; dispose: () => Promise<void> }> {
  const { gateway = true, namespace = true } = options
  const calls: PickerCalls = { pick: 0, list: [] }

  const ctx = new Context()

  // The services Pet declares in `inject`; without them cordis never runs
  // `apply`, which is itself part of the contract under test.
  ctx.provide('slots', {
    inject: (_name: string, run: () => unknown) => {
      run()
      return () => {}
    },
    register: () => () => {},
  })
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    open: () => {},
  })
  ctx.provide('workspaces', {
    list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
  })
  ctx.provide('connection', {})

  if (gateway) {
    // `remote` is a plain service, exactly as the gateway installs it.
    ctx.plugin({
      name: 'remote',
      apply: (inner: Context) => {
        new (class extends Service {
          constructor(host: Context) {
            super(host, 'remote')
          }
        })(inner)
      },
    })
    await settle()

    if (namespace) {
      // The namespace is its own service under the DOTTED key, with its
      // methods installed as accessors returning bound callables.
      ctx.plugin({
        name: 'remote.directoryPicker',
        apply: (inner: Context) => {
          const service = new (class extends Service {
            constructor(host: Context) {
              super(host, 'remote.directoryPicker')
            }
          })(inner)
          Object.defineProperty(service, 'pick', {
            configurable: true,
            enumerable: true,
            get: () => async () => {
              calls.pick += 1
              return { ok: true, value: '/host/picked' }
            },
          })
          Object.defineProperty(service, 'list', {
            configurable: true,
            enumerable: true,
            get: () => async (path?: string) => {
              calls.list.push(path)
              return {
                ok: true,
                value: {
                  path: path ?? '/host',
                  home: '/host',
                  crumbs: [],
                  entries: [],
                  truncated: false,
                },
              }
            },
          })
        },
      })
      await settle()
    }
  }

  const petPlugin = await import('../src/client/index.js')
  const fiber = ctx.plugin(petPlugin)
  await fiber
  await settle()

  return {
    calls,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

describe('the directory picker resolves through the real service graph', () => {
  it('publishes a picker and a lister once Pet loads', async () => {
    const { dispose } = await composeClient()

    // A rejected or never-run `apply` would leave both undefined, so this
    // pins that the rest of the suite asserts against a Pet that loaded.
    expect(typeof published.picker).toBe('function')
    expect(typeof published.lister).toBe('function')

    await dispose()
  })

  it('reaches the Host namespace instead of throwing "without inject"', async () => {
    const { calls, dispose } = await composeClient()

    // Reading the namespace off the `remote` service threw here, and the
    // rejection escaped the Browse click handler as an uncaught promise error.
    await expect(published.picker?.()).resolves.toBe('/host/picked')
    expect(calls.pick).toBe(1)

    await dispose()
  })

  it('lists a directory level for the in-app browser', async () => {
    const { calls, dispose } = await composeClient()

    await expect(published.lister?.('/host/somewhere')).resolves.toMatchObject({
      path: '/host/somewhere',
    })
    expect(calls.list).toEqual(['/host/somewhere'])

    await dispose()
  })

  it('degrades to "unsupported" when the namespace is not mounted', async () => {
    // A deployment serving neither `native` nor `browse` must leave the user
    // typing a path — not crash, and not block Pet from loading.
    const { dispose } = await composeClient({ namespace: false })

    await expect(published.picker?.()).resolves.toBeUndefined()
    await expect(published.lister?.(undefined)).resolves.toBeUndefined()

    await dispose()
  })

  it('degrades when the composition carries no gateway at all', async () => {
    const { dispose } = await composeClient({ gateway: false, namespace: false })

    expect(typeof published.picker).toBe('function')
    await expect(published.picker?.()).resolves.toBeUndefined()

    await dispose()
  })
})
