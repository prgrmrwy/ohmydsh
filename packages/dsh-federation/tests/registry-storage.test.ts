import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeRegistryModel, parseNodeId } from '../src/core/index.js'
import { NodeRegistryStorage, RegistryStorageError } from '../src/host/index.js'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-registry-'))
  roots.push(root)
  return { root, storage: new NodeRegistryStorage(root) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function initial() {
  return NodeRegistryModel.create(parseNodeId('local-node')).snapshot
}

function next(snapshot = initial()) {
  const model = new NodeRegistryModel(snapshot)
  return model.addRemote({ nodeId: parseNodeId('vm-a'), displayName: 'VM A', sshAlias: 'vm-a', remoteDshPort: 3080 })
}

describe('private registry storage', () => {
  it('loads missing conservatively and commits 0700/0600 with exact generation CAS', async () => {
    const { storage } = await fixture()
    expect(await storage.load()).toEqual({ status: 'missing' })
    const saved = await storage.save(initial(), 'missing')
    expect(saved.generation).toBe(0)
    expect((await lstat(storage.directory)).mode & 0o777).toBe(0o700)
    expect((await lstat(storage.file)).mode & 0o777).toBe(0o600)
    const loaded = await storage.load()
    expect(loaded.status).toBe('loaded')
    expect(loaded.snapshot).toEqual(saved)
    await expect(storage.save(next(saved), 'missing')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects symlink and overly broad directory/file modes without replacing content', async () => {
    const { root, storage } = await fixture()
    await mkdir(storage.directory, { recursive: true, mode: 0o700 })
    const target = path.join(root, 'target.json')
    await writeFile(target, 'sentinel')
    await symlink(target, storage.file)
    await expect(storage.load()).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    expect(await readFile(target, 'utf8')).toBe('sentinel')
    await rm(storage.file)
    await writeFile(storage.file, '{}', { mode: 0o644 })
    await expect(storage.load()).rejects.toMatchObject({ code: 'PERMISSION' })
    await chmod(storage.file, 0o600)
    await chmod(storage.directory, 0o755)
    await expect(storage.load()).rejects.toMatchObject({ code: 'PERMISSION' })
  })

  it('fails closed on truncation, unknown version and invalid model without writing empty config', async () => {
    const { storage } = await fixture()
    await mkdir(storage.directory, { recursive: true, mode: 0o700 })
    for (const content of ['{"version":1', '{"version":2,"nodes":[]}', '{"version":1,"generation":0,"localNodeId":"x","nodes":[]}']) {
      await writeFile(storage.file, content, { mode: 0o600 })
      const before = await readFile(storage.file)
      await expect(storage.load()).rejects.toBeInstanceOf(RegistryStorageError)
      expect(await readFile(storage.file)).toEqual(before)
    }
  })

  it('serializes concurrent writers and rejects the stale expected generation', async () => {
    const { storage } = await fixture()
    await storage.save(initial(), 'missing')
    const update = next()
    const [a, b] = await Promise.allSettled([
      storage.save(update, 0),
      storage.save(update, 0),
    ])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason
    expect(rejected).toMatchObject({ code: 'CONFLICT' })
    expect((await storage.load()).snapshot?.generation).toBe(1)
  })

  it('preserves last-known-good on interruption before rename and removes owned temp', async () => {
    const { storage } = await fixture()
    await storage.save(initial(), 'missing')
    const before = await readFile(storage.file)
    await expect(storage.save(next(), 0, { beforeRename() { throw new Error('simulated interruption') } })).rejects.toMatchObject({ code: 'IO' })
    expect(await readFile(storage.file)).toEqual(before)
    expect((await readdir(storage.directory)).filter(name => name.startsWith('.nodes.json.dsh-federation-tmp-'))).toEqual([])
  })

  it('cleans only regular plugin-owned stale temps and leaves lookalikes/symlinks untouched', async () => {
    const { root, storage } = await fixture()
    await mkdir(storage.directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(storage.directory, '.nodes.json.dsh-federation-tmp-123-abc'), 'owned', { mode: 0o600 })
    await writeFile(path.join(storage.directory, '.nodes.json.tmp-123-abc'), 'foreign', { mode: 0o600 })
    const target = path.join(root, 'target')
    await writeFile(target, 'target')
    await symlink(target, path.join(storage.directory, '.nodes.json.dsh-federation-tmp-123-link'))
    expect(await storage.cleanupOwnedTemps()).toBe(1)
    const remaining = await readdir(storage.directory)
    expect(remaining).toContain('.nodes.json.tmp-123-abc')
    expect(remaining).toContain('.nodes.json.dsh-federation-tmp-123-link')
    expect(await readFile(target, 'utf8')).toBe('target')
  })
})
