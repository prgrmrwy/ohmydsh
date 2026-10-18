import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { recoverLock } from '../src/maintenance.js'
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
it('maintenance-01: live/EPERM/unknown/changed/malformed locks stay untouched, ESRCH exact identity only', async () => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'collab-unlock-'))
  const path = join(root, 's.lock')
  try {
    const bytes = JSON.stringify({ instanceId: 'expected', pid: 12345 })
    for (const code of [undefined, 'EPERM', 'EUNKNOWN']) {
      await writeFile(path, bytes)
      const probe = () => { if (code) throw Object.assign(new Error('unavailable'), { code }) }
      await expect(recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, probe)).rejects.toBeDefined()
      expect(await readFile(path, 'utf8')).toBe(bytes)
    }
    for (const bytes of ['not-json', JSON.stringify({ instanceId: 'other', pid: 12345 }), JSON.stringify({ instanceId: 'expected', pid: 0 })]) {
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
    await recoverLock({ dataDir: root, spaceId: 's', expectedInstanceId: 'expected', stoppedHostsConfirmed: true }, () => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }) })
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    const checked = await realpath(root)
    expect(dirname(checked)).toBe(parent); expect(basename(checked).startsWith('collab-unlock-')).toBe(true)
    await rm(checked, { recursive: true })
  }
})
