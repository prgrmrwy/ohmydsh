/**
 * recoverLocusStartupV20 against the real LocusRepositoryV20 on a temp SQLite
 * medium (task 2A.9 item 5): proves the repository satisfies the recovery port
 * and that its writes persist.
 */
import { describe, expect, it } from 'vitest'
import { LocusRepositoryV20, LocusRefusalError } from '../src/host/locus/persistence-v20.js'
import { recoverLocusStartupV20 } from '../src/host/locus/reconcile.js'
import { PET_DOMAIN_VERSION } from '../src/host/spec.js'
import { Context } from '@deepseek-ai/cordis'
import * as petStoragePlugin from '../src/host/storage/plugin.js'
import { PET_BACKEND_NAME } from '../src/host/storage/backend.js'
import { withAtomicWrites } from '../src/host/storage/atomic-domain.js'
import { PET_DOMAIN_NAME } from '../src/host/spec.js'
import { petDomainSpec } from '../src/host/domain.js'
import { seedPetState, tempPetHome, type RawRows } from './support/pet-sqlite.js'

const NOW = 1_000_000
const main = (id: string, work: string) => ({ locusMainSessionId: id, workSessionId: work, generation: 1, status: 'active', spaceId: 's', workspaceId: 'ws', createdAt: 1, updatedAt: 1 })
const groupRow = (m: string) => ({
  endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'child-1', state: 'active', accessMode: 'read-only',
  revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: m, workspaceId: 'ws',
})
const delivery = (patch: Record<string, unknown>) => ({
  deliveryId: 'd1', messageId: 'om1', sequence: 1, endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'child-1',
  senderOpenId: 'ou1', feedbackTarget: { chatId: 'oc_1', messageId: 'om1' }, acceptedAt: NOW - 1000, ...patch,
})

/**
 * Same storage stack as test/support/pet-host-fixture.ts, minus its import of
 * src/index.ts, so this suite does not depend on the Host entry compiling.
 */
async function openStack(statePath: string): Promise<{ ctx: Context; domain: unknown }> {
  const [Storage, Domain] = await Promise.all([
    import('@deepseek-ai/dsh-storage'),
    import('@deepseek-ai/dsh-storage-domain'),
  ])
  const ctx = new Context()
  await ctx.plugin(Storage.default as never)
  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    apply(inner: Context) {
      const backend = { kv: { open: () => Promise.reject(new Error('no default unit in this suite')) }, close: () => Promise.resolve() }
      inner.effect(() => inner.storage.backend.register('json', backend as never))
      inner.provide(Storage.storageBackendServiceKey('json'), backend as never)
    },
  } as never)
  await ctx.plugin(petStoragePlugin as never, { path: statePath })
  await ctx.plugin(Domain as never, { backend: 'json', routes: { [PET_DOMAIN_NAME]: PET_BACKEND_NAME } })
  const opened = await ctx.storageDomain.open(petDomainSpec)
  const backend = ctx.storage.backend.get(PET_BACKEND_NAME) as unknown as {
    unitFor(name: string): Promise<{ applyBatch(writes: readonly never[]): Promise<void> } | undefined>
  }
  return { ctx, domain: withAtomicWrites(opened as never, await backend.unitFor(PET_DOMAIN_NAME) as never) }
}

async function withRepo<T>(rows: RawRows, body: (repo: LocusRepositoryV20) => Promise<T>): Promise<T> {
  const { file } = tempPetHome('pet-recover-v20-')
  await seedPetState(file, PET_DOMAIN_VERSION, rows)
  const { ctx, domain } = await openStack(file)
  try {
    try {
      return await body(new LocusRepositoryV20(domain as never, { now: () => NOW }))
    } finally { await (domain as unknown as { close(): Promise<void> }).close() }
  } finally { await ctx.fiber.dispose() }
}

describe('recoverLocusStartupV20 on the real repository (temp SQLite)', () => {
  it('converges finishing to unknown-terminal and persists it; reclaims only the crashed rebind\'s M1', async () => {
    const rows: RawRows = {
      locus_mains: { M1: main('M1', 'W1') },
      loci: { oc_1: groupRow('M1') },
      locus_deliveries: {
        d1: delivery({ status: 'finishing', queueState: 'current', deadlineAt: NOW + 5000, hardDeadlineAt: NOW - 1000 + 86_400_000, revision: 4, stateRevision: 4, finishOutcome: 'reply' }),
      },
      locus_operations: {
        'op-rebind': { id: 'op-rebind', kind: 'rebind', phase: 'provisioning', operation: 'rebind', endpointKey: 'oc_1', resourceRefs: { locusMainSessionId: 'M-new' }, step: 0, attempts: 0, createdAt: 1, updatedAt: 1 },
      },
    }
    await withRepo(rows, async repo => {
      const reclaimed: string[] = []
      const report = await recoverLocusStartupV20(repo, {
        now: NOW,
        compensators: { locusMainSession: async i => { reclaimed.push(i.locusMainSessionId) }, chat: async () => { throw new Error('must not run') } },
      })
      expect(reclaimed).toEqual(['M-new'])
      expect(report.compensatedOperations.map(o => o.id)).toEqual(['op-rebind'])
      expect(repo.getDelivery('d1')).toMatchObject({ status: 'unknown-terminal', outboundResult: 'unknown' })
      expect(repo.getOperation('op-rebind')?.phase).toBe('compensated')
      expect(repo.listRecoverableOperations()).toEqual([])
    })
  })

  it('fails startup naming a group row whose M has no pairing', async () => {
    await withRepo({ loci: { oc_1: groupRow('M-gone') } }, async repo => {
      const error = await recoverLocusStartupV20(repo, { now: NOW }).catch(e => e)
      expect(error).toBeInstanceOf(LocusRefusalError)
      expect((error as Error).message).toContain('oc_1')
    })
  })

  it('pauses an unprovable current as manual debt and the debt is persisted', async () => {
    const rows: RawRows = {
      locus_mains: { M1: main('M1', 'W1') },
      loci: { oc_1: groupRow('M1') },
      locus_deliveries: { d1: delivery({ sessionId: 'someone-else', status: 'current', queueState: 'current', deadlineAt: NOW + 5000, hardDeadlineAt: NOW - 1000 + 86_400_000, revision: 1, stateRevision: 1 }) },
    }
    await withRepo(rows, async repo => {
      const report = await recoverLocusStartupV20(repo, { now: NOW })
      expect(report.manualDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
      expect(repo.getDelivery('d1')?.startupRecoveryDebt).toBeDefined()
    })
  })
})

/** Reopen the same medium: the Host's next boot parses every stored row at open. */
async function openRepoAt(file: string) {
  const { ctx, domain } = await openStack(file)
  return {
    repo: new LocusRepositoryV20(domain as never, { now: () => NOW }),
    close: async () => {
      await (domain as unknown as { close(): Promise<void> }).close()
      await ctx.fiber.dispose()
    },
  }
}

describe('startup recovery writes reopen cleanly (stateRevision agrees with revision)', () => {
  const base = (d: Record<string, unknown>): RawRows => ({
    locus_mains: { M1: main('M1', 'W1') },
    loci: { oc_1: groupRow('M1') },
    locus_deliveries: { d1: delivery(d) },
  })

  it('a manual-debt write for a current row bound to another session reopens', async () => {
    const { file } = tempPetHome('pet-reopen-session-')
    await seedPetState(file, PET_DOMAIN_VERSION, base({
      sessionId: 'someone-else', status: 'current', queueState: 'current',
      deadlineAt: NOW + 5000, hardDeadlineAt: NOW - 1000 + 86_400_000, revision: 1, stateRevision: 1,
    }))
    const first = await openRepoAt(file)
    try {
      expect((await recoverLocusStartupV20(first.repo, { now: NOW })).manualDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
    } finally { await first.close() }

    const second = await openRepoAt(file) // throws 'revision and stateRevision must agree' on the bug
    try {
      expect(second.repo.getDelivery('d1')).toMatchObject({ startupRecoveryDebt: expect.any(String), revision: 2, stateRevision: 2 })
    } finally { await second.close() }
  })

  it('a manual-debt write for a live turn with no provable proof reopens', async () => {
    const { file } = tempPetHome('pet-reopen-proof-')
    await seedPetState(file, PET_DOMAIN_VERSION, base({
      status: 'running', executionId: 'exec-1', inboxMessageId: 'inbox-1', turnId: 'child-1#1',
      startedAt: NOW - 500, deadlineAt: NOW + 5000, hardDeadlineAt: NOW - 1000 + 86_400_000, revision: 1, stateRevision: 1,
    }))
    const first = await openRepoAt(file)
    try {
      expect((await recoverLocusStartupV20(first.repo, { now: NOW })).manualDeliveries.map(d => d.deliveryId)).toEqual(['d1'])
    } finally { await first.close() }

    const second = await openRepoAt(file)
    try {
      expect(second.repo.getDelivery('d1')).toMatchObject({ startupRecoveryDebt: expect.any(String), revision: 2, stateRevision: 2 })
    } finally { await second.close() }
  })

  it('after reverting a crashed first-child publication the uninjected backlog B stays clean on its retargeted session (no debt)', async () => {
    const accepted = {
      deliveryId: 'dA', messageId: 'omA', sequence: 1, endpoint: { chatId: 'oc_1' }, locusId: 'locus-1', sessionId: 'session-old',
      senderOpenId: 'ou1', feedbackTarget: { chatId: 'oc_1', messageId: 'omA' }, acceptedAt: NOW - 2000,
      status: 'current', queueState: 'current', deadlineAt: NOW + 60_000, hardDeadlineAt: NOW - 2000 + 86_400_000, revision: 1, stateRevision: 1,
    }
    const rows: RawRows = {
      locus_mains: { M1: main('M1', 'W1') },
      loci: { oc_1: { ...groupRow('M1'), sessionId: 'session-old', state: 'not-created', revision: 3 } },
      locus_deliveries: {
        dA: accepted,
        dB: { ...accepted, deliveryId: 'dB', messageId: 'omB', sequence: 2, status: 'accepted', queueState: 'backlog', feedbackTarget: { chatId: 'oc_1', messageId: 'omB' }, revision: undefined, stateRevision: undefined, deadlineAt: undefined, hardDeadlineAt: undefined },
      },
    }
    await withRepo(rows, async repo => {
      await repo.publishFirstDelivery({ locusId: 'locus-1', sessionId: 'session-old', revision: 3, deliveryId: 'dA', now: NOW, executionId: 'exec-1' })
      const terminated: string[] = []
      const report = await recoverLocusStartupV20(repo, {
        now: NOW, reserveChildSessionId: () => 'session-new',
        compensators: { childSession: async i => { terminated.push(i.childSessionId) } },
      })
      expect(terminated).toEqual(['session-old'])
      expect(repo.getLocus('locus-1')).toMatchObject({ sessionId: 'session-new', state: 'not-created' })
      expect(report.manualDeliveries).toEqual([])
      const b = repo.getDelivery('dB')!
      expect(b).toMatchObject({ status: 'accepted', sessionId: 'session-new' })
      expect(b.startupRecoveryDebt).toBeUndefined()
      expect(report.retainedDeliveries.map(d => d.deliveryId)).toContain('dB')
    })
  })
})

