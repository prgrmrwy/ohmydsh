import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, chmod, realpath, symlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { validateConfig, checkCurrentLocation, admissionPolicy } from '../src/config.js'

describe('trusted Host config', () => {
  it('config-01: rejects nonabsolute and node_modules storage before IO', async () => {
    for (const dataDir of ['relative', '', '/tmp/node_modules/collab']) {
      await expect(validateConfig({ dataDir }, [])).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
    }
  })
  it('config-02: rejects empty, repeated and nonstring allowed identities', async () => {
    for (const allowedSessionIds of [[''], [' '], ['a', 'a'], [1], 'a']) {
      await expect(validateConfig({ dataDir: '/unused', allowedSessionIds } as never, [])).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
    }
  })
  it('trust-config-01：缺省开启成员信任', async () => {
    expect(admissionPolicy({ dataDir: '/unused' }).memberTrust).toBe(true)
    expect(admissionPolicy({ dataDir: '/unused', admission: 'allowlist', allowedSessionIds: ['a'] }).memberTrust).toBe(true)
    expect(admissionPolicy({ dataDir: '/unused', memberTrust: false }).memberTrust).toBe(false)
    const parent = await realpath(tmpdir())
    const home = await mkdtemp(join(parent, 'collab-home-'))
    try { expect((await validateConfig({}, [], { DSH_HOME: home })).memberTrust).toBe(true) }
    finally { if (basename(home).startsWith('collab-home-') && dirname(home) === parent) await rm(home, { recursive: true, force: true }) }
  })
  it('config-unknown: rejects unknown config fields before IO', async () => {
    await expect(validateConfig({ dataDir: '/unused', principal: 'forged' } as never, [])).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
  })
  it('data-dir-01：未配置 dataDir 时使用 DSH home 下的默认目录', async () => {
    const parent = await realpath(tmpdir())
    const home = await mkdtemp(join(parent, 'collab-home-'))
    try {
      const config = await validateConfig({}, [], { DSH_HOME: home })
      const expected = join(home, 'plugins', 'dsh-collab')
      expect(config.dataDir).toBe(expected)
      expect((await stat(expected)).mode & 0o777).toBe(0o700)
      const again = await validateConfig({}, [], { DSH_HOME: home })
      expect(again.serviceId).toBe(config.serviceId)
    } finally { if (basename(home).startsWith('collab-home-') && dirname(home) === parent) await rm(home, { recursive: true, force: true }) }
  })
  it('data-dir-02：显式 dataDir 优先且仍受校验', async () => {
    const parent = await realpath(tmpdir())
    const home = await mkdtemp(join(parent, 'collab-home-'))
    try {
      const explicit = join(home, 'explicit')
      const config = await validateConfig({ dataDir: explicit }, [], { DSH_HOME: home })
      expect(config.dataDir).toBe(explicit)
      await expect(stat(join(home, 'plugins', 'dsh-collab'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(validateConfig({ dataDir: 'relative' }, [], { DSH_HOME: home })).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
    } finally { if (basename(home).startsWith('collab-home-') && dirname(home) === parent) await rm(home, { recursive: true, force: true }) }
  })
  it('config-03: canonical workspace aliases denied; wide existing dirs not silently chmodded', async () => {
    const parent = await realpath(tmpdir())
    const root = await mkdtemp(join(parent, 'collab-config-'))
    try {
      const cwd = join(root, 'workspace')
      await mkdir(cwd)
      const alias = join(root, 'alias')
      await symlink(cwd, alias, 'dir')
      await expect(validateConfig({ dataDir: join(alias, 'state') }, [cwd])).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
      const wide = join(root, 'wide')
      await mkdir(wide); await chmod(wide, 0o755)
      await expect(validateConfig({ dataDir: wide }, [])).rejects.toMatchObject({ code: 'COLLAB_BAD_CONFIG' })
      expect((await stat(wide)).mode & 0o777).toBe(0o755)
      const state = join(root, 'private', 'data')
      const config = await validateConfig({ dataDir: state }, [cwd])
      expect((await stat(state)).mode & 0o777).toBe(0o700)
      expect(config.allowedSessionIds).toEqual([])
      const same = await validateConfig({ dataDir: state, allowedSessionIds: ['a'] }, [cwd])
      expect(same.serviceId).toBe(config.serviceId)
      expect(same.dataDir).toBe(state)
      expect(() => checkCurrentLocation(state, [cwd])).not.toThrow()
      expect(() => checkCurrentLocation(state, [root])).toThrowError(expect.objectContaining({ code: 'COLLAB_BAD_CONFIG' }))
      const rootAlias = join(root, 'root-alias')
      await symlink(root, rootAlias, 'dir')
      expect(() => checkCurrentLocation(state, [rootAlias])).toThrowError(expect.objectContaining({ code: 'COLLAB_BAD_CONFIG' }))
    } finally {
      const checked = await realpath(root)
      expect(dirname(checked)).toBe(parent)
      expect(basename(checked).startsWith('collab-config-')).toBe(true)
      await rm(checked, { recursive: true })
    }
  })
})
