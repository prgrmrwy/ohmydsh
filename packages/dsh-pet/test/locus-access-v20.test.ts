/**
 * v20 access-mode writes (owner A; design D8): `setAccessMode` and
 * `recordAccessVerified`. Spec: pet-locus-collaboration "Locus 访问模式".
 * The set check belongs to the caller (acquireAccessChange holds it), so these
 * writes must NOT consult `accessChanging`.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'

/** In-memory stand-in for the domain: tables as Maps, atomic transaction shim. */
function memoryDomain(): LocusDomain {
  const tables = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let map = tables.get(name)
    if (map === undefined) {
      map = new Map()
      tables.set(name, map)
    }
    return {
      get: (key: string) => map!.get(key),
      entries: () => map!.entries(),
      keys: () => map!.keys(),
      get size() { return map!.size },
      put: async (key: string, value: unknown) => { map!.set(key, value) },
      delete: async (key: string) => map!.delete(key),
    }
  }
  return {
    table,
    supportsTransaction: true,
    transaction: async (body: (tx: { put(t: string, k: string, v: unknown): void; delete(t: string, k: string): void }) => void) => {
      body({ put: (t, k, v) => { table(t).put(k, v) }, delete: (t, k) => { table(t).delete(k) } })
    },
  } as unknown as LocusDomain
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: { chatId: 'oc_1' },
    locusId: 'locus-1',
    sessionId: 'session-1',
    state: 'active',
    accessMode: 'read-only',
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
    locusMainSessionId: 'M1',
    workspaceId: 'W1',
    ...overrides,
  }
}

async function seeded(rowOverrides: Record<string, unknown> = {}) {
  const domain = memoryDomain()
  await domain.table('loci').put('oc_1', row(rowOverrides))
  return { repo: new LocusRepositoryV20(domain, { now: () => 50 }) }
}

describe('setAccessMode (D8 step 4 CAS write)', () => {
  it('writes accessMode, grantedBy and revision + 1, and clears verifiedAt', async () => {
    const { repo } = await seeded({ verifiedAt: 10 })
    const next = await repo.setAccessMode({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'danger-full-access', 'owner', 60)
    expect(next).toMatchObject({ accessMode: 'danger-full-access', grantedBy: 'owner', revision: 4 })
    expect(next.verifiedAt).toBeUndefined()
  })

  it('does not require the entry to be in the access-changing set', async () => {
    const { repo } = await seeded()
    expect(repo.isAccessChanging('locus-1')).toBe(false)
    await expect(repo.setAccessMode({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'read-only', 'owner', 60)).resolves.toMatchObject({ revision: 4 })
  })

  it('refuses a stopped row with INVALID_REQUEST and leaves it unchanged', async () => {
    const { repo } = await seeded({ state: 'stopped', stoppedAt: 5 })
    const error = await repo.setAccessMode({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'danger-full-access', 'owner', 60).catch(e => e)
    expect(error).toBeInstanceOf(LocusRefusalError)
    expect((error as LocusRefusalError).code).toBe('INVALID_REQUEST')
    expect(repo.getLocus('locus-1')).toMatchObject({ revision: 3, accessMode: 'read-only' })
  })

  it('refuses a stale revision with LOCUS_CONFLICT', async () => {
    const { repo } = await seeded()
    const error = await repo.setAccessMode({ expectedLocusId: 'locus-1', expectedRevision: 2 }, 'read-only', 'owner', 60).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
  })

  it('refuses an unknown locus with LOCUS_NOT_FOUND', async () => {
    const { repo } = await seeded()
    const error = await repo.setAccessMode({ expectedLocusId: 'locus-x', expectedRevision: 3 }, 'read-only', 'owner', 60).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_NOT_FOUND')
  })
})

describe('recordAccessVerified (verifiedAt only, revision unchanged)', () => {
  it('writes verifiedAt and keeps the revision', async () => {
    const { repo } = await seeded()
    const next = await repo.recordAccessVerified({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'read-only', 70)
    expect(next).toMatchObject({ verifiedAt: 70, revision: 3 })
  })

  it('accepts a not-created row (first creation verifies before activation)', async () => {
    const { repo } = await seeded({ state: 'not-created', sessionId: 'session-r' })
    const next = await repo.recordAccessVerified({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'read-only', 70)
    expect(next).toMatchObject({ state: 'not-created', verifiedAt: 70 })
  })

  it('refuses when the row accessMode differs from the verified mode (LOCUS_CONFLICT)', async () => {
    const { repo } = await seeded()
    const error = await repo.recordAccessVerified({ expectedLocusId: 'locus-1', expectedRevision: 3 }, 'danger-full-access', 70).catch(e => e)
    expect((error as LocusRefusalError).code).toBe('LOCUS_CONFLICT')
    expect(repo.getLocus('locus-1')?.verifiedAt).toBeUndefined()
  })
})
