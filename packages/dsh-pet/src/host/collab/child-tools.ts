/**
 * The collaboration tool face of a Locus child (design D6).
 *
 * dsh-collab registers its `collab_*` tools on the GLOBAL layer. A Locus child
 * is created with an allow-style `toolFilter` over its inherited tools, and that
 * filter (a) cannot name a global tool that does not exist — so listing these
 * names there would make every child creation fail while dsh-collab is absent —
 * and (b) is persisted in the subagent descriptor, so children created before
 * this change would never see them. A child's OWN-layer registrations are
 * outside that filter (docs/architecture/dsh-plugin-integration-pitfalls.md
 * §12 "`toolFilter` 不覆盖 agent 自有 scope"), which is why Pet re-registers the
 * eight member tools on the child's own scope, exactly as its other
 * caller-bound tools are installed.
 *
 * Each registration is the global dsh-collab definition, unchanged (same name,
 * description, parameters and output), with `execute` delegating to it and the
 * execution context passed through untouched: caller resolution, stamping,
 * projection and write authorization all stay inside dsh-collab. Nothing here
 * inspects arguments or identity. Space, invite and member tools are never
 * offered to a child.
 */

import { LOCUS_COLLAB_MEMBER_TOOLS } from '../locus/composition.js'

/** The member tools a Locus child may use, in a stable order (the reviewed list lives with the attestation). */
export const LOCUS_COLLAB_TOOL_NAMES: readonly string[] = LOCUS_COLLAB_MEMBER_TOOLS

/** Minimal structural view of a tool definition; only `execute` is touched. */
export interface DelegableToolDefinition {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  readonly [key: string]: unknown
}

export interface ScopedToolRegistry {
  register(definition: unknown): () => void
}

/**
 * Register the eight delegating tools on one child's own scope.
 *
 * Installs all or nothing: if any global definition is missing, nothing is
 * registered and `undefined` is returned, so a partly loaded dsh-collab never
 * yields a partial face.
 *
 * @param scoped - the child's own-scope tools service.
 * @param globalDefinition - lookup of the CURRENT global definition by name.
 * @returns a disposer that removes every registration, or undefined.
 */
export function installLocusCollabTools(
  scoped: ScopedToolRegistry,
  globalDefinition: (name: string) => DelegableToolDefinition | undefined,
): (() => void) | undefined {
  const definitions = LOCUS_COLLAB_TOOL_NAMES.map(name => globalDefinition(name))
  if (definitions.some(definition => definition === undefined || typeof definition.execute !== 'function')) return undefined
  const disposers: (() => void)[] = []
  try {
    for (const definition of definitions as DelegableToolDefinition[]) {
      const source = definition
      disposers.push(scoped.register({ ...source, execute: (args: unknown, exec: unknown) => source.execute(args, exec) }))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* the scope is already gone */ }
    }
  }
}
