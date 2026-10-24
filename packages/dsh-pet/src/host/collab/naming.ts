/**
 * Deterministic names in the Locus collaboration space (design D1, D5).
 *
 * Every name here is recomputable from durable Pet facts, so "is the space
 * established?" is answered by reading the space, never by a Pet-side flag.
 */
import { createHash } from 'node:crypto'

/** The managed channel Pet attaches as. */
export const PET_COLLAB_CHANNEL = 'pet-locus'
/** Member names inside every Locus space. */
export const MAIN_MEMBER = 'main'
export const PET_MEMBER = 'pet'
/** Allowed `to` values for a stamped child's messages. */
export const PET_RECIPIENTS: readonly string[] = Object.freeze([MAIN_MEMBER])

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** `pet-locus-<first 16 hex of sha256(parentSessionId)>`. */
export function locusSpaceId(parentSessionId: string): string {
  return `pet-locus-${sha256Hex(parentSessionId).slice(0, 16)}`
}

const ADDRESS_PREFIX = 'pet:'

/** `pet:<parentSessionId>` — the proxy member's address, unique on this machine. */
export function petAddress(parentSessionId: string): string {
  return `${ADDRESS_PREFIX}${parentSessionId}`
}

/** Inverse of {@link petAddress}; undefined for anything that is not one. */
export function parentOfPetAddress(address: unknown): string | undefined {
  if (typeof address !== 'string' || !address.startsWith(ADDRESS_PREFIX)) return undefined
  const parent = address.slice(ADDRESS_PREFIX.length)
  return parent.length > 0 ? parent : undefined
}

/** Idempotency key for the one-time `admit('pet')`, fixed per parent session. */
export function admitCmdId(parentSessionId: string): string {
  return `admit-pet-${sha256Hex(parentSessionId).slice(0, 16)}`
}

/** Idempotency key prefix for `establish`, fixed per parent session. */
export function establishCmdId(parentSessionId: string): string {
  return `establish-${sha256Hex(parentSessionId).slice(0, 16)}`
}

const PURPOSE_LIMIT = 200
const PURPOSE_SUFFIX = ' 的 Locus：主会话与它的群、话题子会话共享待办与结论。open 的待办等用户决定何时开工。'

/** D1 purpose text, truncated on the title so the whole fits in 200 characters. */
export function locusSpacePurpose(mainTitle: string | undefined): string {
  const title = (mainTitle ?? '').trim() || '主会话'
  const room = PURPOSE_LIMIT - [...PURPOSE_SUFFIX].length
  const chars = [...title]
  const shown = chars.length <= room ? title : `${chars.slice(0, Math.max(0, room - 1)).join('')}…`
  return `${shown}${PURPOSE_SUFFIX}`
}

/** Space display name. */
export function locusSpaceName(mainTitle: string | undefined): string {
  const title = (mainTitle ?? '').trim() || '主会话'
  const chars = [...title]
  return chars.length <= 64 ? `${title} Locus` : `${chars.slice(0, 63).join('')}… Locus`
}

/**
 * The stable identity of one entry, used as the stamp's `locusId` (design D4,
 * AMD-2): `locus-` + first 16 hex of sha256(normalized endpoint key).
 *
 * The endpoint key is what the Locus index is keyed by, so this is unchanged
 * across generations, rebuilds and cold starts, and needs no history. The
 * caller passes the key from `normalizeLocusEndpoint(...).key`.
 */
export function locusIdentity(endpointKey: string): string {
  return `locus-${sha256Hex(endpointKey).slice(0, 16)}`
}

const IDENTITY_MENTION = /(?<![0-9A-Za-z_-])locus-[0-9a-f]{16}(?![0-9A-Za-z_-])/g

/** Every distinct locus identity mentioned in a text, in first-seen order (D5 rule 2). */
export function mentionedLocusNames(text: string): readonly string[] {
  return [...new Set(text.match(IDENTITY_MENTION) ?? [])]
}
