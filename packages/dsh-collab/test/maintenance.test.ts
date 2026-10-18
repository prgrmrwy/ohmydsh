import { it, expect, vi } from 'vitest'
import { FileStore } from 'collab-kernel'
import { writeFileSync } from 'node:fs'
import { recoverLock } from '../src/maintenance.js'
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
it('maintenance-01: live/EPERM/unknown/changed/malformed locks stay untouched, ESRCH exact identity only', async () => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'collab-unlock-'))
  const path = join(root, 's.lock')
  const breakLock = vi.spyOn(FileStore.prototype, 'breakLock')
  const open = vi.spyOn(FileStore.prototype, 'open')
  try {
    const bytes = JSON.stringify({ instanceId: 'expected', pid: 12345 })
    for (const code of [undefined, 'EPERM', 'EUNKNOWN']) {
      await writeFile(path, bytes)
      const probe = () => { if (code) throw Object.assign(new Error('unavailable'), { code }) }
      await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, probe)).rejects.toBeDefined()
      expect(await readFile(path, 'utf8')).toBe(bytes)
    }
    for (const bytes of ['not-json', JSON.stringify({ instanceId: 'other', pid: 12345 }), ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12345', null, undefined].map(pid => JSON.stringify({ instanceId: 'expected', pid }))]) {
      await writeFile(path, bytes)
      await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, () => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }) })).rejects.toBeDefined()
      expect(await readFile(path, 'utf8')).toBe(bytes)
    }
    await writeFile(path, bytes)
    await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: false })).rejects.toBeDefined()
    expect(await readFile(path, 'utf8')).toBe(bytes)
    const replacement = JSON.stringify({ instanceId: 'replacement', pid: 12345 })
    await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, () => {
      writeFileSync(path, replacement)
      throw Object.assign(new Error('dead'), { code: 'ESRCH' })
    })).rejects.toBeDefined()
    expect(await readFile(path, 'utf8')).toBe(replacement)
    await writeFile(path, bytes)
    const sameIdChanged = JSON.stringify({ instanceId: 'expected', pid: 54321 })
    await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, () => {
      writeFileSync(path, sameIdChanged)
      throw Object.assign(new Error('dead'), { code: 'ESRCH' })
    })).rejects.toBeDefined()
    expect(await readFile(path, 'utf8')).toBe(sameIdChanged)
    expect(breakLock).not.toHaveBeenCalled()
    await writeFile(path, bytes)
    let probes = 0
    await recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, () => { probes++; throw Object.assign(new Error('dead'), { code: 'ESRCH' }) })
    expect(probes).toBe(1)
    expect(breakLock).toHaveBeenCalledExactlyOnceWith('s', 'expected')
    expect(open).not.toHaveBeenCalled()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    breakLock.mockRestore(); open.mockRestore()
    const checked = await realpath(root)
    expect(dirname(checked)).toBe(parent); expect(basename(checked).startsWith('collab-unlock-')).toBe(true)
    await rm(checked, { recursive: true })
  }
})
