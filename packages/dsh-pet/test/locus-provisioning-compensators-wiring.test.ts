/**
 * Production wiring gate (the same shape as locus-production-transaction-gate):
 * the repository must receive the startup compensators before startup recovery,
 * so a failed live provisioning past its block window is compensated with the
 * real Lark / DSH hooks rather than the empty default.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const indexUrl = new URL('../src/index.ts', import.meta.url)

describe('locus provisioning compensator wiring', () => {
  it('sets the startup compensators on the repository before startup recovery runs', async () => {
    const source = await readFile(indexUrl, 'utf8')
    const wire = source.indexOf('locusRepository.setProvisioningCompensators(startupCompensators)')
    const recover = source.indexOf('recoverLocusStartupV20(locusRepository')
    expect(wire).toBeGreaterThan(-1)
    expect(recover).toBeGreaterThan(wire)
  })
})
