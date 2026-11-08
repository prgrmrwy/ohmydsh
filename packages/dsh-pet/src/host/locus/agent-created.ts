/**
 * The `agent/created` decision for locus children (design D15, D8, D7).
 *
 * One synchronous-looking boundary, one lookup, in order:
 *
 * 0. the entry is in `accessChanging`, or has blocking first-creation recovery
 *    debt → refuse publication;
 * 1. an `active` row whose `sessionId` matches → compose from the row;
 * 2. a `not-created` row exactly matching the staged `(sessionId, M, revision)`
 *    → claim the staged reservation once, compose;
 * 3. the agent's durable preset is `locus-child` but neither 1 nor 2 → refuse
 *    ("已退役的 locus 子会话不可再运行");
 * 4. anything else → an ordinary session, left alone.
 *
 * After `composed:true`, `recordAccessVerified` runs BEFORE publication; if it
 * refuses, publication is refused. A composition failure is classified:
 * A (identity unproven) marks that one row `invalid`; B refuses and leaves the
 * row untouched; `main-unavailable` hands over to the whole-W migration.
 * `recordAccessVerified` is never reached on any failure path.
 *
 * The Host injects its ports; nothing here reaches DSH, Cordis or storage.
 */
import type { LocusAccessModeV20, LocusChildLookupInputV20, LocusChildLookupResultV20, LocusRowFenceV20, LocusRowV20 } from './contract-v20.js'
import {
  classifyLocusCompositionFailure,
  type LocusChildComposition,
  type LocusCompositionResult,
} from './composition.js'

export const LOCUS_RETIRED_CHILD_MESSAGE = '已退役的 locus 子会话不可再运行；会话历史仍可查看。'

export interface LocusAgentCreatedPorts<Candidate extends { readonly id: string } = { readonly id: string }> {
  readonly repository: {
    lookupChildForAgentCreated(input: LocusChildLookupInputV20): LocusChildLookupResultV20
    recordAccessVerified(fence: LocusRowFenceV20, accessMode: LocusAccessModeV20, now: number): Promise<LocusRowV20>
    markInvalid(fence: LocusRowFenceV20, reason: string, now: number): Promise<LocusRowV20>
  }
  /** The agent's DURABLE preset (not a live guess). */
  agentPreset(sessionId: string): string | undefined
  /** The staged first-creation reservation for this session, if one exists (inspect only, never claims). */
  staged(sessionId: string): LocusChildLookupInputV20['staged']
  /** Claim the staged reservation exactly once (branch 2). */
  claimStaged(sessionId: string): void
  /** `composeLocusChild` with the lookup answered by `composition`; throws on refusal. */
  compose(candidate: Candidate, composition: LocusChildComposition): LocusCompositionResult
  publishClaimed(sessionId: string): Promise<void>
  /**
   * Class `main-unavailable`: the Host starts the whole-W migration. Fire and
   * forget: the refused delivery stays in backlog and the dispatcher re-reads
   * the new sessionId. A rejection is caught and logged here, never unhandled.
   */
  migrateMain?(composition: LocusChildComposition): Promise<unknown>
  now(): number
  log?(message: string): void
}

function compositionOf(hit: { readonly row: LocusRowV20; readonly locusMainSessionId: string }): LocusChildComposition {
  const { row } = hit
  return {
    locusMainSessionId: hit.locusMainSessionId,
    sessionId: row.sessionId,
    locusId: row.locusId,
    revision: row.revision,
    accessMode: row.accessMode,
    endpoint: { ...row.endpoint },
  }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300)

/**
 * @returns `'ordinary'` when the agent is not a locus child (caller continues),
 *   `'composed'` when it was composed, verified and published.
 * @throws when publication must be refused; the runtime vetoes the creation.
 */
export async function handleLocusAgentCreated<Candidate extends { readonly id: string }>(
  ports: LocusAgentCreatedPorts<Candidate>,
  candidate: Candidate,
): Promise<'ordinary' | 'composed'> {
  const staged = ports.staged(candidate.id)
  const preset = ports.agentPreset(candidate.id)
  const hit = ports.repository.lookupChildForAgentCreated({
    sessionId: candidate.id,
    ...(preset === undefined ? {} : { agentPreset: preset }),
    ...(staged === undefined ? {} : { staged }),
  })

  switch (hit.kind) {
    case 'ordinary':
      return 'ordinary'
    case 'retired':
      throw new Error(LOCUS_RETIRED_CHILD_MESSAGE)
    case 'blocked':
      throw new Error(
        hit.reason === 'access-changing'
          ? '入口正在变更访问模式，本次发布被拒绝。'
          : '入口存在未决的首次创建恢复债，本次发布被拒绝。',
      )
    case 'staged':
      ports.claimStaged(candidate.id)
      break
    case 'active':
      break
  }

  const composition = compositionOf(hit.row)
  const fence: LocusRowFenceV20 = { expectedLocusId: composition.locusId, expectedRevision: composition.revision }
  let result: LocusCompositionResult
  try {
    result = ports.compose(candidate, composition)
  } catch (error) {
    const failure = classifyLocusCompositionFailure(error)
    ports.log?.(`locus composition refused ${candidate.id} (${failure}): ${reasonOf(error)}`)
    if (failure === 'A') {
      try {
        await ports.repository.markInvalid(fence, `composition: ${reasonOf(error)}`, ports.now())
      } catch (invalidateError) {
        ports.log?.(`locus markInvalid failed for ${composition.locusId}: ${reasonOf(invalidateError)}`)
      }
    } else if (failure === 'main-unavailable') {
      void ports.migrateMain?.(composition)?.catch(migrationError => {
        ports.log?.(`locus whole-W migration failed for ${composition.locusId}: ${reasonOf(migrationError)}`)
      })
    }
    throw error
  }
  if (!result.composed) {
    // The lookup said this IS a locus child; an ordinary answer would publish it unverified.
    throw new Error(`locus child ${candidate.id} was not composed; refusing publication`)
  }
  await ports.repository.recordAccessVerified(fence, result.accessMode, ports.now())
  await ports.publishClaimed(candidate.id)
  return 'composed'
}
