import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PetLarkCliCompatUnavailableError,
  resolvePetLarkCliCompat,
} from '../src/host/channel/lark-cli-compat.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE_ARTIFACT = join(PACKAGE_ROOT, 'compat', 'lark-cli', 'artifact')
const roots: string[] = []

async function fixture(): Promise<{ root: string; artifact: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pet-lark-cli-compat-'))
  roots.push(root)
  const artifact = join(root, 'compat', 'lark-cli', 'artifact')
  await mkdir(artifact, { recursive: true })
  await copyFile(join(SOURCE_ARTIFACT, 'lark-cli'), join(artifact, 'lark-cli'))
  await chmod(join(artifact, 'lark-cli'), 0o755)
  await copyFile(join(SOURCE_ARTIFACT, 'provenance.json'), join(artifact, 'provenance.json'))
  return { root, artifact }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Pet private lark-cli runtime resolver', () => {
  it('accepts only the packaged executable whose bytes match provenance', async () => {
    const { root, artifact } = await fixture()
    expect(resolvePetLarkCliCompat(root)).toEqual({
      binary: join(artifact, 'lark-cli'),
      supportsBoundedFdDownload: true,
      upstreamVersion: '1.0.94',
    })
  })

  it('rejects a replaced binary even when provenance remains unchanged', async () => {
    const { root, artifact } = await fixture()
    await writeFile(join(artifact, 'lark-cli'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    expect(() => resolvePetLarkCliCompat(root)).toThrow(PetLarkCliCompatUnavailableError)
  })

  it('rejects a symlinked executable even when its target is executable', async () => {
    const { root, artifact } = await fixture()
    const target = join(root, 'replacement')
    await writeFile(target, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await rm(join(artifact, 'lark-cli'))
    await symlink(target, join(artifact, 'lark-cli'))
    expect(() => resolvePetLarkCliCompat(root)).toThrow(PetLarkCliCompatUnavailableError)
  })
})
