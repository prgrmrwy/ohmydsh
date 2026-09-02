import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePetDirectories, isContainedBy, resolvePetPaths } from '../src/host/paths.js'

describe('Pet runtime path resolution', () => {
  it('derives every path from the active DSH home', () => {
    const paths = resolvePetPaths('/tmp/example-home')

    expect(paths.stateRoot).toBe('/tmp/example-home/plugins/dsh-pet')
    expect(paths.databaseFile).toBe('/tmp/example-home/plugins/dsh-pet/state.sqlite')
    expect(paths.workspaceRoot).toBe('/tmp/example-home/plugins/dsh-pet/workspace')
    expect(paths.projectionRoot).toBe(
      '/tmp/example-home/plugins/dsh-pet/workspace/.dsh/skills',
    )
    expect(paths.storeRoot).toBe('/tmp/example-home/plugins/dsh-pet/skills/store')
  })

  it('follows a $DSH_HOME override so state moves with the harness', () => {
    const paths = resolvePetPaths(undefined, { DSH_HOME: '/tmp/other-home' })
    expect(paths.stateRoot).toBe('/tmp/other-home/plugins/dsh-pet')
  })

  it('never writes into the package checkout or a generated profile', () => {
    const paths = resolvePetPaths('/tmp/example-home')
    const forbidden = ['node_modules', 'profiles', 'packages/dsh-pet']

    for (const value of Object.values(paths)) {
      for (const segment of forbidden) {
        expect(value).not.toContain(segment)
      }
    }
  })

  it('creates the owner-only directory tree idempotently', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)

    await ensurePetDirectories(paths)
    await ensurePetDirectories(paths)

    for (const dir of [paths.stateRoot, paths.workspaceRoot, paths.projectionRoot, paths.storeRoot]) {
      const info = await stat(dir)
      expect(info.isDirectory()).toBe(true)
      // Owner-only: no group or other bits on POSIX filesystems.
      expect(info.mode & 0o077).toBe(0)
    }
  })

  it('fails loud when a required path exists as a non-directory', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await mkdir(path.dirname(paths.stateRoot), { recursive: true })
    await writeFile(paths.stateRoot, 'not a directory')

    await expect(ensurePetDirectories(paths)).rejects.toThrow(/is not a directory/)
  })
})

describe('store containment', () => {
  it('accepts the root itself and its descendants', () => {
    expect(isContainedBy('/a/store', '/a/store')).toBe(true)
    expect(isContainedBy('/a/store', '/a/store/skill/abc')).toBe(true)
  })

  it('rejects siblings, escapes and prefix look-alikes', () => {
    expect(isContainedBy('/a/store', '/a/store-evil')).toBe(false)
    expect(isContainedBy('/a/store', '/a/other')).toBe(false)
    expect(isContainedBy('/a/store', '/a/store/../escape')).toBe(false)
  })
})
