import { describe, expect, it } from 'vitest'
import {
  needsOfflinePetStateMigration,
  PET_STATE_MIGRATION_COMMAND,
  withOfflinePetStateMigrationGuidance,
} from '../src/host/migration-guidance.js'

describe('offline Pet state migration guidance', () => {
  it('recognizes the real storage-domain version mismatch', () => {
    const diagnostic = 'Pet storage domain: stamped version 5 is incompatible with descriptor version 9'

    expect(needsOfflinePetStateMigration(diagnostic)).toBe(true)
    const guided = withOfflinePetStateMigrationGuidance(diagnostic)
    expect(guided).toContain(diagnostic)
    expect(guided).toContain('explicit offline migration')
    expect(guided).toContain('dsh stop')
    expect(guided).toContain(`${PET_STATE_MIGRATION_COMMAND} --dry-run`)
    expect(guided).toContain(`${PET_STATE_MIGRATION_COMMAND} --yes && dsh`)
  })

  it('does not prescribe a database operation for unrelated degradation', () => {
    const diagnostic = 'Pet channel: bot identity unavailable'
    expect(needsOfflinePetStateMigration(diagnostic)).toBe(false)
    expect(withOfflinePetStateMigrationGuidance(diagnostic)).toBe(diagnostic)
  })

  it('does not mistake another domain mismatch for Pet state', () => {
    const diagnostic = 'Workspace storage domain: stamped version 1 is incompatible with descriptor version 2'
    expect(needsOfflinePetStateMigration(diagnostic)).toBe(false)
  })
})
