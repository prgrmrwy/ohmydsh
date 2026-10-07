import { describe, expect, it } from 'vitest'
import { checkManagedCli } from '../src/manage-check.js'

describe('managed CLI diagnostics', () => {
  it('check_reports_path_managed_version_mismatch', () => {
    expect(checkManagedCli({ pathVersion: '1.11.0', managedVersion: '1.13.2', nodeVersion: '22.19.0', engine: '>=20.19.0', recovery: 'none' })).toMatchObject({ pathVersion: '1.11.0', managedVersion: '1.13.2', mismatch: true, nodeSupported: true, recovery: 'none' })
  })
})
