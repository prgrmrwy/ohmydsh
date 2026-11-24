import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The virtual asset modules resolve through the same plugin the production Host bundle uses. */
describe('virtual asset modules', () => {
  it('virtual:dshls/inject and virtual:dshls/sw default-export script text', async () => {
    const inject = (await import('virtual:dshls/inject' as string)).default as unknown
    const sw = (await import('virtual:dshls/sw' as string)).default as unknown
    expect(typeof inject).toBe('string')
    expect(typeof sw).toBe('string')
    expect((inject as string).length).toBeGreaterThan(0)
    expect((sw as string).length).toBeGreaterThan(0)
    // A real entry must never be replaced by the scaffold placeholder.
    if (existsSync(resolve(__dirname, '../../src/inject/index.ts'))) expect(inject).not.toContain('dshls placeholder')
    if (existsSync(resolve(__dirname, '../../src/sw/index.ts'))) expect(sw).not.toContain('dshls placeholder')
  })
})
