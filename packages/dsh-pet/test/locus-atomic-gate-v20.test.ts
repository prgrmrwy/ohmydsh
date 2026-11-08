import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'

describe('supportsAtomicProvisioning (v20)', () => {
  it('is false when the domain cannot run an atomic transaction', () => {
    const repo = new LocusRepositoryV20({ table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator]() }) } as never, { now: () => 1 })
    expect(repo.supportsAtomicProvisioning()).toBe(false)
  })

  it('is true when the domain supports transactions', () => {
    const repo = new LocusRepositoryV20({
      supportsTransaction: true,
      transaction: async () => {},
      table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator]() }),
    } as never, { now: () => 1 })
    expect(repo.supportsAtomicProvisioning()).toBe(true)
  })
})
