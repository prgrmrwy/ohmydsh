/**
 * Every persisted field must survive a full write/read round trip.
 *
 * This exists because the same defect recurred three times: a field is added
 * to the wire contract and written successfully, but the storage schema never
 * learns about it. The domain validates records on the way OUT, so an
 * undeclared key is silently STRIPPED on read — the value is in the database,
 * the panel shows nothing, and it looks exactly like "saving is broken".
 *
 * Reading the schema back is not enough on its own: these tests drive the real
 * repository so a mismatch fails here rather than in the user's browser.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('Skill registrations round-trip every declared field', () => {
  it('preserves free-text arguments', async () => {
    harness = await openPetHarness()
    await harness.repository.putSkillRevision({
      skillName: 'ws',
      sourcePath: '/tmp/skills/ws',
      description: 'Worktree Session',
      arguments: 'clean',
      provenance: { kind: 'local-link', installedAt: 1 },
      fileCount: 1,
      totalBytes: 10,
    } as never)

    // The exact failure users saw: stored fine, read back as undefined.
    expect(harness.repository.getSkillRevision('ws')?.arguments).toBe('clean')
  })

  it('preserves the Pet presentation block', async () => {
    harness = await openPetHarness()
    await harness.repository.putSkillRevision({
      skillName: 'demo',
      sourcePath: '/tmp/skills/demo',
      description: 'Demo',
      pet: { label: '演示', icon: '🧪', context: 'session-required' },
      provenance: { kind: 'local-link', installedAt: 1 },
      fileCount: 1,
      totalBytes: 10,
    } as never)

    const stored = harness.repository.getSkillRevision('demo')

    expect(stored?.pet?.label).toBe('演示')
    expect(stored?.pet?.icon).toBe('🧪')
    expect(stored?.pet?.context).toBe('session-required')
  })

  it('covers every field the wire contract declares', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const wire = await readFile(path.resolve(process.cwd(), 'src', 'wire.ts'), 'utf8')
    const spec = await readFile(
      path.resolve(process.cwd(), 'src', 'host', 'spec.ts'),
      'utf8',
    )

    // A field present in the contract but absent from the schema is the exact
    // shape of this bug, and it is invisible to type checking: the write path
    // type-checks against the contract, while the read path validates against
    // the schema.
    const start = wire.indexOf('export interface PetSkillRevision')
    const block = wire.slice(start, wire.indexOf('\n}', start))
    const declared = [...block.matchAll(/^ {2}readonly (\w+)\??:/gm)].map(match => match[1])

    expect(declared).toContain('arguments')
    for (const field of declared) {
      expect(spec.includes(`${field}:`), `schema is missing '${field}'`).toBe(true)
    }
  })
})

describe('Global configuration round-trips every declared field', () => {
  it('preserves the appearance block', async () => {
    harness = await openPetHarness()
    await harness.repository.updateGlobal(current => ({
      ...current,
      appearance: { accent: 'green', glyph: '🐾', size: 'large', ringStyle: 'faint' },
    }))

    const stored = harness.repository.global.appearance

    // Each of these reached the panel through a separate change; one missing
    // schema entry silently drops just that one.
    expect(stored?.accent).toBe('green')
    expect(stored?.glyph).toBe('🐾')
    expect(stored?.size).toBe('large')
    expect(stored?.ringStyle).toBe('faint')
  })

  it('preserves the agent preset and context policy', async () => {
    harness = await openPetHarness()
    await harness.repository.updateGlobal(current => ({
      ...current,
      agentPreset: 'dsh-pet-executor',
      defaultContextPolicy: 'none',
    }))

    expect(harness.repository.global.agentPreset).toBe('dsh-pet-executor')
    expect(harness.repository.global.defaultContextPolicy).toBe('none')
  })

  it('reaches the read route, not only the database', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const routes = await readFile(
      path.resolve(process.cwd(), 'src', 'host', 'routes.ts'),
      'utf8',
    )
    const from = routes.indexOf('petRoute(ROUTES.config,')
    const readBlock = routes.slice(from, routes.indexOf('petRoute(', from + 10))

    // Storing a value the read route never projects is the second way this
    // defect appears — it also reads as "saving is broken".
    for (const field of ['agentPreset', 'appearance', 'defaultContextPolicy']) {
      expect(readBlock.includes(field), `config route does not project '${field}'`).toBe(true)
    }
  })

  it('accepts every appearance key the panel can write', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const routes = await readFile(
      path.resolve(process.cwd(), 'src', 'host', 'routes.ts'),
      'utf8',
    )
    const settings = await readFile(
      path.resolve(process.cwd(), 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Keys the panel sends but the route does not whitelist are dropped on the
    // way in, which is the third variant of the same failure.
    const written = [...settings.matchAll(/appearance: \{ (\w+):/g)].map(match => match[1])
    expect(written.length).toBeGreaterThan(0)
    for (const key of written) {
      expect(routes.includes(`'${key}'`), `config route does not accept '${key}'`).toBe(true)
    }
  })
})
