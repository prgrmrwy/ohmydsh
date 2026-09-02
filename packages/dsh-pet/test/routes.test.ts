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
    const readBlock = routes.slice(routes.indexOf('petRoute(ROUTES.config,'))
    expect(readBlock.slice(0, 900)).toContain('appearance: global.appearance')
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
