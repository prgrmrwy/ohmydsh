import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const indexUrl = new URL('../src/index.ts', import.meta.url)

describe('unified locus production transaction gate', () => {
  it('does not publish the unified channel without atomic storage', async () => {
    const source = await readFile(indexUrl, 'utf8')
    const gate = source.indexOf('if (!locusRepository.supportsAtomicProvisioning()) {')
    const diagnostic = source.indexOf("locusChannelGaps.push('atomic locus storage unavailable')", gate)
    const capability = source.indexOf('const locusChannel = locusChannelGaps.length === 0', diagnostic)
    expect(gate).toBeGreaterThan(-1)
    expect(diagnostic).toBeGreaterThan(gate)
    expect(capability).toBeGreaterThan(diagnostic)
  })
})
