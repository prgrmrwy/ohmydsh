import { expect, it } from 'vitest'
import { createHostEvidenceReader } from '../src/eval/host-reader.js'
it('refuses claimed root or compression differing from the actual live backend configuration before stat', async () => {
  let stats = 0
  const ctx = { get: () => ({ name: 'session-persistence-jsonl', config: { root: '/actual', compression: 'zstd' }, stat: async () => { stats++; return undefined } }) }
  const ledger = { read: () => [{ kind: 'reserved', id: 'session-test' }] }
  for (const config of [{ root: '/other', compression: 'zstd' }, { root: '/actual', compression: 'none' }]) {
    const read = createHostEvidenceReader(ctx as never, ledger as never, { name: 'session-persistence-jsonl', version: '0.2.0-rc.2', ...config })
    await expect(read('session-test')).rejects.toThrow(/backend configuration/)
  }
  expect(stats).toBe(0)
})
it('refuses unregistered identity before persistence observation and non-JSONL Host before path access', async () => {
  let stats = 0
  const ctx = { get: () => ({ name: 'sqlite', stat: async () => { stats++; return undefined } }) }
  const ledger = { read: () => [{ kind: 'reserved', id: 'session-test' }] }
  const read = createHostEvidenceReader(ctx as never, ledger as never, { name: 'session-persistence-jsonl', version: '0.2.0-rc.2', root: '/state', compression: 'zstd' })
  await expect(read('session-daily')).rejects.toThrow(/unregistered/)
  await expect(read('session-test')).rejects.toThrow(/backend/)
  expect(stats).toBe(0)
})
