import { expect, it } from 'vitest'
import { createHostRetirer } from '../src/eval/host-retirer.js'
it('fails before touching daily or absent agents and never fabricates disposal authority', async () => {
  let gets = 0
  const ctx = { get: () => ({ get: () => { gets++; return undefined } }) }
  const ledger = { read: () => [{ kind: 'reserved', id: 'registered' }] }
  const retire = createHostRetirer(ctx as never, ledger as never, { owners: new Set(['registered']), healthy: () => true, settleJobs: async () => {} })
  await expect(retire('daily')).rejects.toThrow(/unregistered/)
  expect(gets).toBe(0)
  await expect(retire('registered')).rejects.toThrow(/unavailable/)
  expect(gets).toBe(1)
})
