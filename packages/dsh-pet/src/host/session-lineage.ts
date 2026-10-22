/**
 * Read delegation lineage from a DSH session header.
 *
 * `parentSession` alone does NOT mean "child": DSH writes it for two different
 * relations. A subagent child carries `origin: 'subagent'` and
 * `delegationDepth >= 1`; a user fork ("分叉") carries `isSeeded: true` with
 * depth 0 and no origin, and is an ordinary top-level session the owner works
 * in. Treating a fork as a child made it unbindable (`/bind` read it as "prefix
 * hit a child") and denied it the main-session role in collaboration.
 *
 * Only the exact fork shape is released; any other header with a parent stays
 * a child, so an old or unrecognised header fails closed.
 */
export function delegationParentOf(meta: {
  readonly parentSession?: unknown
  readonly isSeeded?: unknown
  readonly origin?: unknown
  readonly delegationDepth?: unknown
}): unknown {
  if (meta.parentSession === undefined) return undefined
  const isTopLevelFork = meta.isSeeded === true
    && meta.origin === undefined
    && (meta.delegationDepth === undefined || meta.delegationDepth === 0)
  return isTopLevelFork ? undefined : meta.parentSession
}
