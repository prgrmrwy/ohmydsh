/**
 * Two resident siblings under one locus main, with a fake
 * `drainChildren(exactLiveParent, [ids])` (test-plan "Shared fixtures", owner C).
 *
 * `live` is what `ctx.agents.get(id)` would answer; `resident` is the parent's
 * resident child set. They differ on purpose: the "目标不在 resident" scenario is
 * exactly a live agent that `drainChildren` does not know about.
 */

export type SiblingDrainMode =
  /** Releases only the listed ids that are resident under the exact parent. */
  | 'release'
  /** Resolves and changes nothing (target absent from resident). */
  | 'no-op'
  /** Rejects because the passed parent is not the exact live parent. */
  | 'stale-parent'
  /** The target goes away, then the promise rejects anyway. */
  | 'reject-after-gone'

export interface SiblingParent {
  readonly id: string
}

export interface SiblingChildren {
  readonly parent: SiblingParent
  readonly live: Set<string>
  readonly resident: Set<string>
  mode: SiblingDrainMode
  readonly drainCalls: { readonly parent: SiblingParent; readonly ids: readonly string[] }[]
  /** Counts calls to the forbidden substitute; must stay 0. */
  disposeCalls: number
  drainChildren(parent: SiblingParent, ids: readonly string[]): Promise<void>
  dispose(id: string): void
}

export function siblingChildren(options: {
  readonly parentId?: string
  readonly children?: readonly string[]
  readonly mode?: SiblingDrainMode
} = {}): SiblingChildren {
  const parent: SiblingParent = { id: options.parentId ?? 'locus-main-1' }
  const children = options.children ?? ['session-a', 'session-b']
  const world: SiblingChildren = {
    parent,
    live: new Set(children),
    resident: new Set(children),
    mode: options.mode ?? 'release',
    drainCalls: [],
    disposeCalls: 0,
    async drainChildren(passed, ids) {
      world.drainCalls.push({ parent: passed, ids: [...ids] })
      switch (world.mode) {
        case 'no-op':
          return
        case 'stale-parent':
          throw new Error('drainChildren: parent is not the exact live parent')
        case 'reject-after-gone':
          for (const id of ids) {
            world.resident.delete(id)
            world.live.delete(id)
          }
          throw new Error('drainChildren: rejected after release')
        case 'release':
          if (passed !== parent) throw new Error('drainChildren: parent is not the exact live parent')
          for (const id of ids) {
            if (!world.resident.has(id)) continue
            world.resident.delete(id)
            world.live.delete(id)
          }
      }
    },
    dispose(id) {
      world.disposeCalls += 1
      world.live.delete(id)
      world.resident.delete(id)
    },
  }
  return world
}
