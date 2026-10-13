import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PET_LARK_CLI_MIN_VERSION,
  PetLarkCliCompatUnavailableError,
  meetsPetLarkCliFloor,
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
  it('accepts the minimum version and carries the spool it may write into', async () => {
    const binary = await fakeCli(`lark-cli version ${PET_LARK_CLI_MIN_VERSION}`)
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary })).resolves.toEqual({
      binary,
      version: PET_LARK_CLI_MIN_VERSION,
      spoolRoot: '/spool',
    })
  })

  it('accepts newer versions without a code change', async () => {
    for (const version of ['1.0.98', '1.0.100', '1.1.0', '2.0.0']) {
      const binary = await fakeCli(`lark-cli version ${version}`)
      await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
        .resolves.toMatchObject({ binary, version })
    }
  })

  it('refuses versions below the verified floor', async () => {
    for (const reported of ['lark-cli version 1.0.94', 'lark-cli version 1.0.96', 'lark-cli version 0.9.99']) {
      const binary = await fakeCli(reported)
      await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
        .rejects.toThrow(PetLarkCliCompatUnavailableError)
    }
  })

  it('compares versions numerically per segment', () => {
    expect(meetsPetLarkCliFloor('1.0.97')).toBe(true)
    expect(meetsPetLarkCliFloor('1.0.100')).toBe(true)
    expect(meetsPetLarkCliFloor('1.1.0')).toBe(true)
    expect(meetsPetLarkCliFloor('1.0.9')).toBe(false)
    expect(meetsPetLarkCliFloor('0.99.999')).toBe(false)
    expect(meetsPetLarkCliFloor('1.0')).toBe(false)
    expect(meetsPetLarkCliFloor('')).toBe(false)
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

  it('reports the observed version and the floor so an operator can act on it', async () => {
    const binary = await fakeCli('lark-cli version 1.0.94')
    await expect(resolvePetLarkCliCompat({ spoolRoot: '/spool', binary }))
      .rejects.toThrow(/is 1\.0\.94, but Pet media requires >= 1\.0\.97/)
  })
})
