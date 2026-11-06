/**
 * first-delivery-publication.ts (owner C) against owner A's real
 * LocusRepositoryV20 on a temp SQLite medium: the same callbacks the lazy
 * creator runs, with every durable effect read back from storage.
 * The storage stack mirrors test/locus-startup-recovery-sqlite-v20.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { createFirstDeliveryPublication } from '../src/host/locus/first-delivery-publication.js'
import { createFirstPromptRegistry } from '../src/host/locus/first-prompt.js'
import * as petStoragePlugin from '../src/host/storage/plugin.js'
import { PET_BACKEND_NAME } from '../src/host/storage/backend.js'
import { withAtomicWrites } from '../src/host/storage/atomic-domain.js'
import { PET_DOMAIN_NAME, PET_DOMAIN_VERSION } from '../src/host/spec.js'
import { petDomainSpec } from '../src/host/domain.js'
import { seedPetState, tempPetHome, type RawRows } from './support/pet-sqlite.js'

const endpoint = { chatId: 'oc_1' }

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

const rows: RawRows = {
  locus_mains: { M1: { locusMainSessionId: 'M1', workSessionId: 'W1', generation: 1, status: 'active', spaceId: 's', workspaceId: 'ws', createdAt: 1, updatedAt: 1 } },
  loci: {
    oc_1: {
      endpoint, locusId: 'locus-1', sessionId: 'session-0', state: 'not-created', accessMode: 'danger-full-access',
      grantedBy: 'owner', revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M1', workspaceId: 'ws',
    },
  },
}

async function scenario(body: (input: {
  repo: LocusRepositoryV20
  publication: ReturnType<ReturnType<typeof createFirstDeliveryPublication>>
  firstPrompts: ReturnType<typeof createFirstPromptRegistry>
}) => Promise<void>): Promise<void> {
  const { file } = tempPetHome('pet-first-publication-v20-')
  await seedPetState(file, PET_DOMAIN_VERSION, rows)
  const { ctx, domain } = await openStack(file)
  try {
    try {
      const repo = new LocusRepositoryV20(domain as never, { now: () => 5 })
      await repo.acceptDelivery({ endpoint, locusId: 'locus-1', sessionId: 'session-0', messageId: 'm1', deliveryId: 'd1', senderOpenId: 'ou_1', text: 'a', acceptedAt: 1 } as never)
      await repo.acceptDelivery({ endpoint, locusId: 'locus-1', sessionId: 'session-0', messageId: 'm2', deliveryId: 'd2', senderOpenId: 'ou_1', text: 'b', acceptedAt: 2 } as never)
      await repo.claimCurrentDelivery({ endpoint, locusId: 'locus-1', sessionId: 'session-0', now: 3 } as never)
      let next = 1
      const firstPrompts = createFirstPromptRegistry()
      const publication = createFirstDeliveryPublication({
        repository: repo, firstPrompts, reserveChildSessionId: () => `session-${String(next++)}`, now: () => 10,
      })({ locus: { locusId: 'locus-1', sessionId: 'session-0', revision: 3, endpoint }, deliveryId: 'd1', executionId: 'exec-1' })
      await body({ repo, publication, firstPrompts })
    } finally { await (domain as unknown as { close(): Promise<void> }).close() }
  } finally { await ctx.fiber.dispose() }
}

describe('first-delivery publication on the real v20 repository (temp SQLite)', () => {
  it('publish then commit: the row goes active at the same revision with accessMode kept', async () => {
    await scenario(async ({ repo, publication, firstPrompts }) => {
      await publication.publish('session-0')
      expect(repo.getRow(endpoint)).toMatchObject({ state: 'active', sessionId: 'session-0', revision: 3, accessMode: 'danger-full-access' })
      expect(repo.getOperation('first-child:exec-1')).toMatchObject({ phase: 'publishing', expectedRevision: 3 })
      firstPrompts.resolve({ childSessionId: 'session-0', messageId: 'inbox-1' })
      await publication.commit('session-0')
      expect(repo.getOperation('first-child:exec-1')?.phase).not.toBe('publishing')
    })
  })

  it('spec Scenario "回调内发布后创建被拒时回滚" (durable): unpublish rotates, bumps revision and settles the trigger on its old id', async () => {
    await scenario(async ({ repo, publication }) => {
      await publication.publish('session-0')
      await publication.unpublish('session-0')
      expect(repo.getRow(endpoint)).toMatchObject({ state: 'not-created', sessionId: 'session-1', revision: 4, accessMode: 'danger-full-access', grantedBy: 'owner' })
      expect(repo.getDelivery('d1')).toMatchObject({ status: 'failed', sessionId: 'session-0' })
      expect(repo.getDelivery('d2')).toMatchObject({ status: 'accepted', sessionId: 'session-1' })
    })
  })

  it('spec Scenario "创建失败不推进代际" (durable): failed before publish settles and rotates in one write', async () => {
    await scenario(async ({ repo, publication }) => {
      await publication.failed('session-0')
      expect(repo.getRow(endpoint)).toMatchObject({ state: 'not-created', sessionId: 'session-1', revision: 4, accessMode: 'danger-full-access' })
      expect(repo.getDelivery('d1')).toMatchObject({ status: 'failed', sessionId: 'session-0' })
      expect(repo.getDelivery('d2')?.sessionId).toBe('session-1')
    })
  })

  it('the pre-prompt image exception keeps the trigger for one text retry on the new reservation', async () => {
    await scenario(async ({ repo, publication }) => {
      await publication.publish('session-0')
      await publication.retryText('session-0')
      expect(repo.getRow(endpoint)).toMatchObject({ state: 'not-created', sessionId: 'session-1', revision: 4 })
      expect(repo.getDelivery('d1')).toMatchObject({ sessionId: 'session-1' })
      expect(repo.getDelivery('d1')?.status).not.toBe('failed')
    })
  })

  it('an unprovable release leaves blocking recovery debt', async () => {
    await scenario(async ({ repo, publication }) => {
      await publication.publish('session-0')
      await publication.recoveryDebt('session-0')
      expect(repo.hasFirstDeliveryRecoveryDebt('locus-1')).toBe(true)
    })
  })
})
