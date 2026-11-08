/**
 * Deterministic names in the Locus collaboration space
 * (`locus-three-tier-structure` design D8).
 *
 * A space has exactly two ordinary members: the locus main session (Leader,
 * `locus`) and the work main session (`work`). Every name here is recomputable
 * from durable Pet facts, so "is the space established?" is answered by
 * reading the space, never by a Pet-side flag.
 */
import { createHash } from 'node:crypto'

/** The managed channel Pet attaches as; used only for the manager role (disposition). */
export const PET_COLLAB_CHANNEL = 'pet-locus'
/** Member names inside every Locus space. */
export const LOCUS_MEMBER = 'locus'
export const WORK_MEMBER = 'work'

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** `pet-locus-<first 16 hex of sha256(locusMainSessionId)>`: one space per locus main session. */
export function locusSpaceId(locusMainSessionId: string): string {
  return `pet-locus-${sha256Hex(locusMainSessionId).slice(0, 16)}`
}

/** Idempotency key prefix for establishing one locus main session's space, fixed per main. */
export function establishCmdId(locusMainSessionId: string, step: 'create' | 'allow' | 'invite'): string {
  return `establish-${step}-${sha256Hex(locusMainSessionId).slice(0, 16)}`
}

const PURPOSE_LIMIT = 200
const PURPOSE_SUFFIX = ' 的 Locus：工作主会话与 locus 主会话共享待办与结论。open 的待办等用户决定何时开工。'

/** Purpose text, truncated on the title so the whole fits in 200 characters. */
export function locusSpacePurpose(workTitle: string | undefined): string {
  const title = (workTitle ?? '').trim() || '工作主会话'
  const room = PURPOSE_LIMIT - [...PURPOSE_SUFFIX].length
  const chars = [...title]
  const shown = chars.length <= room ? title : `${chars.slice(0, Math.max(0, room - 1)).join('')}…`
  return `${shown}${PURPOSE_SUFFIX}`
}

/**
 * The stable identity of one entry, stored as `ext.pet.entry`:
 * `locus-` + first 16 hex of sha256(normalized endpoint key).
 *
 * The endpoint key is what the Locus index is keyed by, so this is unchanged
 * across generations, rebuilds, cold starts and locus main replacement, and
 * needs no history. The caller passes the key from `endpointKeyOf(...)`.
 */
export function locusIdentity(endpointKey: string): string {
  return `locus-${sha256Hex(endpointKey).slice(0, 16)}`
}
