import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishStopDescriptor, releaseStopDescriptor, type StopDescriptor } from '../src/host/locus/stop-preparation.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const homes: string[] = []
afterEach(async () => {
  vi.mocked(open).mockRestore()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'pet-private-中文 '))
  homes.push(home)
  const run = join(home, 'run')
  const directory = join(run, 'dsh-pet-stop')
  const target = join(directory, '34567.json')
  const descriptor: StopDescriptor = { v: 1, pid: process.pid, bootId: 'first-boot', profile: 'web', origin: 'http://127.0.0.1:34567', authenticatedUrl: 'http://127.0.0.1:34567/?token=fixture' }
  return { home, run, directory, target, descriptor, publish: (doc = descriptor) => publishStopDescriptor(home, 34567, doc), release: (bootId = descriptor.bootId) => releaseStopDescriptor(home, 34567, bootId) }
}

it('independent Pet creates its private boundary and keeps another boot until its own release', async () => {
  const h = await fixture()
  await h.publish()
  expect(JSON.parse(await readFile(h.target, 'utf8'))).toEqual(h.descriptor)
  if (process.platform !== 'win32') {
    expect((await lstat(h.run)).mode & 0o777).toBe(0o700)
    expect((await lstat(h.directory)).mode & 0o777).toBe(0o700)
    expect((await lstat(h.target)).mode & 0o777).toBe(0o600)
  }
  const replacement = { ...h.descriptor, bootId: 'replacement-boot' }
  await h.publish(replacement)
  await h.release()
  expect(JSON.parse(await readFile(h.target, 'utf8'))).toEqual(replacement)
  await h.release(replacement.bootId)
  await expect(lstat(h.target)).rejects.toMatchObject({ code: 'ENOENT' })
})

describe.skipIf(process.platform === 'win32')('POSIX descriptor filesystem safety', () => {
  it.each(['run', 'directory', 'target'] as const)('rejects an unsafe %s without fixing it or reading bootId on release', async entry => {
    const h = await fixture()
    await h.publish()
    const mode = entry === 'target' ? 0o644 : 0o777
    await chmod(h[entry], mode)
    await expect(h.publish()).rejects.toThrow(/Unsafe/)
    vi.mocked(open).mockClear()
    await h.release()
    expect(open).not.toHaveBeenCalled()
    expect((await lstat(h[entry])).mode & 0o777).toBe(mode)
    expect(JSON.parse(await readFile(h.target, 'utf8'))).toEqual(h.descriptor)
  })

  it('checks an existing run before creating a child directory', async () => {
    const h = await fixture()
    await mkdir(h.run, { mode: 0o777 })
    await chmod(h.run, 0o777)
    await expect(h.publish()).rejects.toThrow(/Unsafe/)
    await expect(lstat(h.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['run', 'directory', 'target'] as const)('refuses a symlink at %s for publishing and release', async entry => {
    const h = await fixture()
    await h.publish()
    const moved = join(h.home, 'moved')
    await rename(h[entry], moved)
    await symlink(moved, h[entry], entry === 'target' ? 'file' : 'dir')
    await expect(h.publish()).rejects.toThrow(/Unsafe/)
    vi.mocked(open).mockClear()
    await h.release()
    expect(open).not.toHaveBeenCalled()
    expect((await lstat(h[entry])).isSymbolicLink()).toBe(true)
    const retained = entry === 'run' ? join(moved, 'dsh-pet-stop', '34567.json') : entry === 'directory' ? join(moved, '34567.json') : moved
    expect(JSON.parse(await readFile(retained, 'utf8'))).toEqual(h.descriptor)
  })

  it('refuses hardlinked and oversized files before reading bootId or replacing them', async () => {
    const h = await fixture()
    await h.publish()
    const alias = join(h.directory, 'alias')
    await link(h.target, alias)
    await expect(h.publish()).rejects.toThrow(/Unsafe/)
    vi.mocked(open).mockClear()
    await h.release()
    expect(open).not.toHaveBeenCalled()
    expect((await lstat(h.target)).nlink).toBe(2)
    await rm(alias)
    await writeFile(h.target, 'x'.repeat(64 * 1024 + 1), { mode: 0o600 })
    await expect(h.publish()).rejects.toThrow(/Unsafe/)
    vi.mocked(open).mockClear()
    await h.release()
    expect(open).not.toHaveBeenCalled()
    expect((await lstat(h.target)).size).toBe(64 * 1024 + 1)
  })

  it('leaves a replacement boot published while the old descriptor is being read', async () => {
    const h = await fixture()
    await h.publish()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const replacement = { ...h.descriptor, bootId: 'concurrent-boot' }
    vi.mocked(open).mockImplementationOnce(async (...args: Parameters<typeof open>) => {
      const file = await actual.open(...args)
      const originalRead = file.readFile.bind(file)
      file.readFile = (async (...readArgs: Parameters<typeof file.readFile>) => {
        const body = await originalRead(...readArgs)
        await h.publish(replacement)
        return body
      }) as typeof file.readFile
      return file
    })
    await h.release()
    expect(JSON.parse(await readFile(h.target, 'utf8'))).toEqual(replacement)
  })

  it('rejects invalid ports on release before opening a file', async () => {
    const h = await fixture()
    await h.publish()
    vi.mocked(open).mockClear()
    await releaseStopDescriptor(h.home, Number.NaN, h.descriptor.bootId)
    await releaseStopDescriptor(h.home, 0, h.descriptor.bootId)
    expect(open).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(h.target, 'utf8'))).toEqual(h.descriptor)
  })
})
