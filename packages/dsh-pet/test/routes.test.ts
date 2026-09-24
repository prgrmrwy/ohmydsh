/**
 * Pet management route contracts.
 */

import { describe, expect, it } from 'vitest'
describe('appearance round-trips through the config routes', () => {
  it('is projected by the read route, not only accepted by the write', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const routes = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'host', 'routes.ts'),
      'utf8',
    )

    // Storing a value the read route never returns looks exactly like a
    // persistence failure: the panel resets on every restart.
    // Bound the slice at the NEXT route rather than a magic offset: a magic
    // number silently passes or fails when unrelated lines move.
    const from = routes.indexOf('petRoute(ROUTES.config,')
    const readBlock = routes.slice(from, routes.indexOf('petRoute(', from + 10))
    expect(readBlock).toContain('appearance: global.appearance')
  })

  it('never persists the position, which stays per-browser', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const spec = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'host', 'spec.ts'),
      'utf8',
    )
    const appearance = spec.slice(spec.indexOf('appearance: z'), spec.indexOf('appearance: z') + 300)

    // Dragging is display state, not a setting.
    expect(appearance).not.toContain('x:')
    expect(appearance).not.toContain('y:')
  })
})

describe('the model selection is not Pet-owned', () => {
  it('rejects provider and model on the write route', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const routes = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'host', 'routes.ts'),
      'utf8',
    )
    const from = routes.indexOf('petRoute(ROUTES.configUpdate,')
    const writeBlock = routes.slice(from, routes.indexOf('petRoute(', from + 10))

    // These used to be accepted and stored, but `selection()` reads the Host
    // default and never the stored copy — so a saved value was silently
    // dropped and the panel echoed a different one back. Accepting a field
    // nothing consumes is worse than not offering it.
    expect(writeBlock).not.toContain("'providerId'")
    expect(writeBlock).not.toContain("'modelId'")
  })

  it('reports the followed selection, never a stored copy', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const routes = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'host', 'routes.ts'),
      'utf8',
    )
    const from = routes.indexOf('petRoute(ROUTES.config,')
    const readBlock = routes.slice(from, routes.indexOf('petRoute(', from + 10))

    expect(readBlock).not.toContain('global.providerId')
    expect(readBlock).not.toContain('global.modelId')
  })
})
