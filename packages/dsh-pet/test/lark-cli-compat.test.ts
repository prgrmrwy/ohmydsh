import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PET_LARK_CLI_PINNED_VERSION,
  PetLarkCliCompatUnavailableError,
  resolvePetLarkCliCompat,
} from '../src/host/channel/lark-cli-compat.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A real executable that reports one version, to exercise the default probe. */
async function fakeCli(reports: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pet-lark-cli-pin-'))
  roots.push(root)
  const binary = join(root, 'lark-cli')
  await writeFile(binary, `#!/bin/sh\necho ${JSON.stringify(reports)}\n`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

describe('Pet official lark-cli resolution', () => {
  it('accepts the pinned version and carries the spool it may write into', async () => {
    const binary = await fakeCli('lark-cli version 1.0.94')
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary })).resolves.toEqual({
      binary,
      pinnedVersion: PET_LARK_CLI_PINNED_VERSION,
      spoolRoot: '/spool',
    })
  })

  it('refuses an older or newer version rather than trusting un-reviewed output rules', async () => {
    for (const reported of ['lark-cli version 1.0.93', 'lark-cli version 1.1.0', 'lark-cli version 1.0.100']) {
      const binary = await fakeCli(reported)
      await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
        .rejects.toThrow(PetLarkCliCompatUnavailableError)
    }
  })

  it('refuses output that carries no version at all', async () => {
    const binary = await fakeCli('command not found')
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
      .rejects.toThrow(/reported no version/)
  })

  it('refuses a binary that cannot be run', async () => {
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary: '/nonexistent/lark-cli' }))
      .rejects.toThrow(/could not be probed/)
  })

  it('refuses to resolve media without a spool directory', async () => {
    await expect(resolvePetLarkCliCompat({ spoolRoot: '  ', binary: 'lark-cli' }))
      .rejects.toThrow(/spool directory is not configured/)
  })

  it('reports the observed version so an operator can act on it', async () => {
    const binary = await fakeCli('lark-cli version 9.9.9')
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
      .rejects.toThrow(/requires 1\.0\.94/)
  })
})
