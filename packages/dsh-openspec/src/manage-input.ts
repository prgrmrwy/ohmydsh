export type ManageIntent =
  | { kind: 'help' }
  | { kind: 'upgrade' | 'rollback'; target: string; approved: boolean }
  | { kind: 'refresh-project'; approved: boolean }
  | { kind: 'invalid' }

/**
 * Parses the user-typed argument of `/openspec-upgrade`.
 * Only the exact literal `--approve` flag counts as approval; the model never supplies this text,
 * because the argument arrives from the user's own gesture. Anything unrecognized is `invalid`, never a mutation.
 */
export function parseManageInput(raw: string): ManageIntent {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { kind: 'help' }
  const approved = tokens.includes('--approve')
  const rest = tokens.filter(token => token !== '--approve')
  const [verb, target, ...extra] = rest
  if (extra.length > 0) return { kind: 'invalid' }
  if ((verb === 'upgrade' || verb === 'rollback') && target && /^\d+\.\d+\.\d+$/.test(target)) return { kind: verb, target, approved }
  if (verb === 'refresh-project' && target === undefined) return { kind: 'refresh-project', approved }
  return { kind: 'invalid' }
}
