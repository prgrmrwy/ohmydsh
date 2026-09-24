import { PET_DOMAIN_VERSION } from './spec.js'

/** Stable executable shipped by the deployed dsh-pet package. */
export const PET_STATE_MIGRATION_COMMAND =
  '"${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/.bin/dsh-pet-migrate-state"'

/**
 * A storage-domain mismatch is actionable only for Pet's own stamped unit.
 * Other storage errors keep their exact diagnostic and must not suggest a
 * potentially unrelated file operation.
 */
export function needsOfflinePetStateMigration(diagnostic: string): boolean {
  const text = diagnostic.toLowerCase()
  return text.includes('pet storage domain') &&
    text.includes('stamped version') &&
    text.includes('incompatible') &&
    text.includes('descriptor version')
}

/**
 * Add copy/paste operator guidance without weakening the original error.
 *
 * Normal Host startup never opens or mutates state.sqlite directly. The
 * executable requires the operator to stop DSH and confirm the offline write.
 */
export function withOfflinePetStateMigrationGuidance(diagnostic: string): string {
  if (!needsOfflinePetStateMigration(diagnostic)) return diagnostic
  return `${diagnostic}; ` +
    `Pet state requires an explicit offline migration to domain version ${PET_DOMAIN_VERSION}. ` +
    `Run: dsh stop && ${PET_STATE_MIGRATION_COMMAND} --dry-run && ` +
    `${PET_STATE_MIGRATION_COMMAND} --yes && dsh`
}
