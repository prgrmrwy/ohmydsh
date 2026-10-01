/** Host-coordinated Locus tool-tier mutation, independent from file permission. */
import type { LocusMutationFence, LocusToolTier, LocusToolTierName } from './aggregate.js'

export interface ToolTierMutationLocus {
  readonly id: string
  readonly generation: number
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly revision?: number
  readonly updatedAt?: number
  readonly childSessionId?: string
  readonly childComposition?: 'safe-v1' | 'safe-v2'
  readonly toolTier?: LocusToolTier
  readonly state: 'active' | 'switching' | 'invalid' | string
  readonly busy: boolean
}

export interface ToolTierMutationRepository {
  findLocus(locusId: string): ToolTierMutationLocus | undefined
  findCurrentLocus(endpoint: { readonly chatId: string; readonly threadId?: string }): ToolTierMutationLocus | undefined
  hasPendingDeliveries(locusId: string): boolean
  getLocusByChild?(childSessionId: string): ToolTierMutationLocus | undefined
  beginToolTierMutation(locusId: string, now: number, fence?: LocusMutationFence): Promise<ToolTierMutationLocus>
  commitToolTierMutation(locusId: string, tier: LocusToolTier, now: number, fence?: LocusMutationFence): Promise<ToolTierMutationLocus>
  abortToolTierMutation(locusId: string, now: number, fence?: LocusMutationFence): Promise<ToolTierMutationLocus>
  invalidateToolTierMutation?(locusId: string, reason: string, now: number, fence?: LocusMutationFence): Promise<ToolTierMutationLocus>
}

export interface LocusLiveToolTierSurface {
  /** A current open GUI/inquiry turn also forbids switching without a Delivery. */
  isIdle(): boolean
  setToolTier(tier: LocusToolTierName): void
  visibleTools(): readonly string[] | undefined
}

export interface ToolTierMutationPorts {
  readonly repository: ToolTierMutationRepository
  readonly live: {
    find(childSessionId: string): LocusLiveToolTierSurface | undefined
  }
  readonly attest: (visible: readonly string[] | undefined, tier: LocusToolTierName) => boolean
  readonly now?: () => number
}

export type ToolTierMutationResult =
  | { readonly ok: true; readonly locus: ToolTierMutationLocus; readonly effective: LocusToolTierName }
  | { readonly ok: false; readonly reason: 'not-found' | 'busy' | 'legacy-v1-shell' | 'apply-failed' | 'verification-failed' }

async function restoreSafeOrInvalidate(
  current: ToolTierMutationLocus,
  live: LocusLiveToolTierSurface,
  fence: LocusMutationFence,
  requested: LocusToolTierName,
  actor: string,
  ports: ToolTierMutationPorts,
  now: () => number,
): Promise<boolean> {
  try { live.setToolTier('safe') } catch { /* verified readback below decides recovery */ }
  let safeVerified = false
  try { safeVerified = ports.attest(live.visibleTools(), 'safe') } catch { safeVerified = false }
  if (safeVerified) {
    try {
      await ports.repository.commitToolTierMutation(current.id, {
        desired: requested, effective: 'safe', verifiedAt: now(), grantedBy: actor,
      }, now(), fence)
      return true
    } catch { /* preserve fail-closed switching state below */ }
  }
  const switching = ports.repository.findLocus(current.id)
  if (switching?.state === 'switching' && ports.repository.invalidateToolTierMutation !== undefined) {
    await ports.repository.invalidateToolTierMutation(current.id, 'tool-tier rollback could not be attested', now(), {
      expectedGeneration: switching.generation,
      ...(switching.updatedAt === undefined ? {} : { expectedUpdatedAt: switching.updatedAt }),
      ...(switching.revision === undefined ? {} : { expectedRevision: switching.revision }),
    }).catch(() => undefined)
  }
  return false
}

/** Serialize by locus id and fail closed on a busy/pending generation. */
export function createLocusToolTierMutation(ports: ToolTierMutationPorts) {
  const now = ports.now ?? Date.now
  const locks = new Map<string, Promise<unknown>>()

  async function serialized<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    locks.set(id, current)
    await previous.catch(() => undefined)
    try { return await run() }
    finally {
      release()
      if (locks.get(id) === current) locks.delete(id)
    }
  }

  return {
    set(input: { readonly locusId: string; readonly endpoint: { readonly chatId: string; readonly threadId?: string }; readonly tier: LocusToolTierName; readonly actor: string; readonly fence?: LocusMutationFence }): Promise<ToolTierMutationResult> {
      const targetId = input.locusId
      return serialized(targetId, async () => {
        const latest = ports.repository.findLocus(targetId)
        const endpoint = input.endpoint
        const current = latest?.state === 'active'
          && endpoint !== undefined
          && latest?.endpoint.chatId === endpoint.chatId
          && latest?.endpoint.threadId === endpoint.threadId
          && ports.repository.findCurrentLocus(endpoint)?.id === latest.id
          && ports.repository.findLocus(targetId)?.id === latest.id
          ? latest
          : undefined
        if (current === undefined) return { ok: false, reason: 'not-found' }
        if (input.actor.trim() === '') return { ok: false, reason: 'apply-failed' }
        if (input.fence?.expectedLocusId !== undefined && input.fence.expectedLocusId !== current.id) {
          return { ok: false, reason: 'not-found' }
        }
        if (current.state !== 'active' || current.childSessionId === undefined
          || (ports.repository.getLocusByChild !== undefined
            && ports.repository.getLocusByChild(current.childSessionId)?.id !== current.id)
          || current.busy || ports.repository.hasPendingDeliveries(current.id)
          || input.fence?.expectedGeneration !== undefined && input.fence.expectedGeneration !== current.generation
          || input.fence?.expectedUpdatedAt !== undefined && input.fence.expectedUpdatedAt !== current.updatedAt
          || input.fence?.expectedRevision !== undefined && input.fence.expectedRevision !== current.revision) {
          return { ok: false, reason: 'busy' }
        }
        if (input.tier === 'shell' && current.childComposition !== 'safe-v2') {
          return { ok: false, reason: 'legacy-v1-shell' }
        }
        const fence = input.fence ?? {
          expectedGeneration: current.generation,
          ...(current.updatedAt === undefined ? {} : { expectedUpdatedAt: current.updatedAt }),
          ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
        }
        let begun: ToolTierMutationLocus
        try {
          begun = await ports.repository.beginToolTierMutation(current.id, now(), fence)
        } catch {
          return { ok: false, reason: 'busy' }
        }
        const mutationFence = {
          expectedGeneration: begun.generation,
          ...(begun.updatedAt === undefined ? {} : { expectedUpdatedAt: begun.updatedAt }),
          ...(begun.revision === undefined ? {} : { expectedRevision: begun.revision }),
        }
        const childId = current.childSessionId
        if (childId === undefined) {
          await ports.repository.abortToolTierMutation(current.id, now(), mutationFence)
          return { ok: false, reason: 'apply-failed' }
        }
        let live: LocusLiveToolTierSurface | undefined
        try {
          live = ports.live.find(childId)
        } catch {
          await ports.repository.abortToolTierMutation(current.id, now(), mutationFence).catch(() => undefined)
          return { ok: false, reason: 'apply-failed' }
        }
        // A cold child has no mutable surface; persist the desired effective
        // tier and let the next synchronous publication install it.
        if (live === undefined) {
          try {
            const persisted = await ports.repository.commitToolTierMutation(current.id, {
              desired: input.tier,
              effective: input.tier,
              verifiedAt: now(),
              grantedBy: input.actor,
            }, now(), mutationFence)
            return { ok: true, locus: persisted, effective: input.tier }
          } catch {
            const latestFence = ports.repository.findLocus(current.id)
            if (latestFence?.state === 'switching') {
              await ports.repository.abortToolTierMutation(current.id, now(), {
                expectedGeneration: latestFence.generation,
                ...(latestFence.updatedAt === undefined ? {} : { expectedUpdatedAt: latestFence.updatedAt }),
                ...(latestFence.revision === undefined ? {} : { expectedRevision: latestFence.revision }),
              }).catch(() => undefined)
            }
            return { ok: false, reason: 'apply-failed' }
          }
        }
        let idle = false
        try { idle = live.isIdle() === true } catch { /* Unknown is not idle proof. */ }
        if (!idle) {
          await ports.repository.abortToolTierMutation(current.id, now(), mutationFence).catch(() => undefined)
          return { ok: false, reason: 'busy' }
        }
        try {
          live.setToolTier(input.tier)
        } catch {
          await restoreSafeOrInvalidate(current, live, mutationFence, input.tier, input.actor, ports, now)
          return { ok: false, reason: 'apply-failed' }
        }
        let targetVerified = false
        try { targetVerified = ports.attest(live.visibleTools(), input.tier) } catch { targetVerified = false }
        if (!targetVerified) {
          const restored = await restoreSafeOrInvalidate(current, live, mutationFence, input.tier, input.actor, ports, now)
          return { ok: false, reason: restored ? 'verification-failed' : 'apply-failed' }
        }
        try {
          const persisted = await ports.repository.commitToolTierMutation(current.id, {
            desired: input.tier,
            effective: input.tier,
            verifiedAt: now(),
            grantedBy: input.actor,
          }, now(), mutationFence)
          return { ok: true, locus: persisted, effective: input.tier }
        } catch {
          try { live.setToolTier('safe') } catch { /* durable fence remains closed if unknown */ }
          let safeVerified = false
          try { safeVerified = ports.attest(live.visibleTools(), 'safe') } catch { safeVerified = false }
          if (safeVerified) {
            const latestFence = ports.repository.findLocus(current.id)
            if (latestFence?.state === 'switching') {
              const released = await ports.repository.commitToolTierMutation(current.id, {
                desired: input.tier, effective: 'safe', verifiedAt: now(), grantedBy: input.actor,
              }, now(), {
                expectedGeneration: latestFence.generation,
                ...(latestFence.updatedAt === undefined ? {} : { expectedUpdatedAt: latestFence.updatedAt }),
                ...(latestFence.revision === undefined ? {} : { expectedRevision: latestFence.revision }),
              }).catch(() => undefined)
              if (released === undefined) {
                const stillSwitching = ports.repository.findLocus(current.id)
                if (stillSwitching?.state === 'switching') {
                  await ports.repository.invalidateToolTierMutation?.(current.id, 'tool-tier persistence recovery failed', now(), {
                    expectedGeneration: stillSwitching.generation,
                    ...(stillSwitching.updatedAt === undefined ? {} : { expectedUpdatedAt: stillSwitching.updatedAt }),
                    ...(stillSwitching.revision === undefined ? {} : { expectedRevision: stillSwitching.revision }),
                  }).catch(() => undefined)
                }
              }
            }
          }
          return { ok: false, reason: 'apply-failed' }
        }
      })
    },
  }
}
