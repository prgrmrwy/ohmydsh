import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { SettingsStore } from '../src/host/settings.js'
import { MagpieRuntime, lineCredentialRefs, type Credentials } from '../src/host/runtime.js'
import { LINE_ID, line } from './support/line.js'

const refs = lineCredentialRefs(LINE_ID)
const baseLine = line('https://gateway.test/v1', LINE_ID, 'cloudflare')

test('incomplete credential update survives restart and requires explicit complete retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-access-restart-')); const path = join(dir, 'settings.json')
  const values = new Map<string, string>([[String(refs.key), 'gateway'], [String(refs.accessClientId), 'old-id'], [String(refs.accessClientSecret), 'old-secret']])
  let fail = true
  const credentials: Credentials = {
    describe: async ref => ({ configured: values.has(String(ref)), writable: true }),
    resolve: async ref => values.has(String(ref)) ? { value: values.get(String(ref))!, source: 'file' } : undefined,
    set: async (ref, value) => { if (fail && String(ref) === String(refs.accessClientSecret)) throw Error('write failed'); values.set(String(ref), value) },
    unset: async ref => { values.delete(String(ref)) },
  }
  const store = new SettingsStore(path); store.save({ lines: [baseLine], visibleModels: {}, defaultEfforts: {} })
  const runtime = new MagpieRuntime(credentials, store)
  let restarted: MagpieRuntime | undefined
  try {
    const response = await runtime.settings({ lines: [{ ...baseLine, accessClientId: 'new-id', accessClientSecret: 'new-secret' }] })
    expect(response.status).toBe(500)
    expect(values.get(String(refs.accessClientId))).toBe('new-id')
    expect(values.get(String(refs.accessClientSecret))).toBe('old-secret')
    const disk = readFileSync(path, 'utf8')
    expect(disk).toContain('credentialUpdatePending')
    for (const secret of values.values()) if (secret !== 'gateway') expect(disk).not.toContain(secret)
    await runtime.dispose(); restarted = new MagpieRuntime(credentials, new SettingsStore(path))
    const request = vi.spyOn(restarted.transport, 'request').mockResolvedValue(Response.json({ data: [] }))
    await expect(restarted.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED'); expect(request).not.toHaveBeenCalled()
    expect((await restarted.settings({ resync: true })).status).toBe(409)
    expect((await restarted.settings({ lines: [{ ...baseLine, accessClientSecret: 'new-secret' }] })).status).toBe(409)
    fail = false
    expect((await restarted.settings({ lines: [{ ...baseLine, accessClientId: 'new-id', accessClientSecret: 'new-secret' }] })).status).toBe(200)
    expect(JSON.parse(readFileSync(path, 'utf8')).credentialUpdatePending).toBeUndefined()
    const op = await restarted.beginOperation(); expect(op.accessClientSecret).toBe('new-secret'); op.release()
  } finally { await runtime.dispose(); await restarted?.dispose(); rmSync(dir, { recursive: true, force: true }) }
})

test('failure to persist quarantine never starts credential writes', async () => {
  const values = new Map<string, string>([[String(refs.key), 'gateway'], [String(refs.accessClientId), 'old-id'], [String(refs.accessClientSecret), 'old-secret']])
  const set = vi.fn(async (ref: unknown, value: string) => { values.set(String(ref), value) })
  const credentials: Credentials = {
    describe: async ref => ({ configured: values.has(String(ref)), writable: true }),
    resolve: async ref => values.has(String(ref)) ? { value: values.get(String(ref))!, source: 'file' } : undefined,
    set,
    unset: async ref => { values.delete(String(ref)) },
  }
  const store = new SettingsStore(); store.save({ lines: [baseLine], visibleModels: {}, defaultEfforts: {} })
  const runtime = new MagpieRuntime(credentials, store)
  vi.spyOn(store, 'save').mockImplementation(() => { throw Error('disk unavailable') })
  try { expect((await runtime.settings({ lines: [{ ...baseLine, accessClientId: 'id', accessClientSecret: 'secret' }] })).status).toBe(500); expect(set).not.toHaveBeenCalled() } finally { await runtime.dispose() }
})
