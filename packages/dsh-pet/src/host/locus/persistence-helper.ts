import type { PetLocusOperation } from '../spec.js'

export type OperationResourceRefs = NonNullable<PetLocusOperation['resourceRefs']>

export function operationKindOf(kind: string): PetLocusOperation['kind'] {
  switch (kind) {
    case 'ensure':
    case 'locus-create':
      return 'ensure'
    case 'ensure-default-qa':
    case 'locus-default-qa':
    case 'locus-default-qa-clear':
    case 'locus-default-qa-set':
      return 'ensure-default-qa'
    case 'replace':
    case 'locus-replace':
      return 'replace'
    case 'rebuild':
    case 'locus-rebuild':
    case 'locus-transition':
    case 'startup-index-reconciliation':
      return 'rebuild'
    case 'busy':
    case 'locus-busy':
      return 'busy'
    case 'stop':
    case 'retire':
    case 'invalidate':
    case 'permission':
    case 'locus-permission':
    case 'permission-mutation-begin':
    case 'permission-mutation-abort':
    case 'anchor':
    case 'locus-context-anchor':
    case 'delivery':
    case 'delivery-accept':
    case 'delivery-create':
    case 'delivery-queued':
    case 'delivery-running':
    case 'delivery-settled':
    case 'delivery-failed':
      return kind === 'locus-permission' || kind === 'permission' || kind.startsWith('permission-mutation-')
        ? 'permission'
        : kind === 'locus-context-anchor' || kind === 'anchor'
          ? 'anchor'
        : kind.startsWith('delivery-')
          ? 'delivery'
          : kind as PetLocusOperation['kind']
    default:
      // Never silently relabel a new lifecycle operation as `ensure`: the WAL
      // kind is restart/recovery metadata, not a best-effort display label.
      throw new Error(`Unknown locus operation kind '${kind}'`)
  }
}

export function extractResourceRefs(metadata: Record<string, unknown>): OperationResourceRefs | undefined {
  const fields = ['chatId', 'threadId', 'parentSessionId', 'childSessionId', 'workspaceId'] as const
  const refs: Partial<Record<(typeof fields)[number], string>> = {}
  for (const field of fields) {
    const value = metadata[field]
    if (typeof value === 'string' && value !== '') refs[field] = value
  }
  return Object.keys(refs).length === 0 ? undefined : refs
}
