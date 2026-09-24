/**
 * Durable Pet environment entries across the global and workspace scopes.
 *
 * The precedence rule (workspace overrides global) is exercised through
 * `resolveEnvFor`, which is the single place that merges them — the shell-env
 * contributor consumes that result rather than merging again, so testing it
 * here covers the behavior the injected environment actually gets.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { openPetHarness, type PetHarness } from './harness.js'
import { PET_ENV_GLOBAL_SCOPE } from '../src/host/spec.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function fixture(): Promise<PetHarness> {
  harness = await openPetHarness()
  return harness
}

function entry(
  scope: string,
  key: string,
  value: string,
): { scope: string; key: string; value: string; updatedAt: number } {
  return { scope, key, value, updatedAt: 1 }
}

describe('environment entries persist per scope', () => {
  it('stores and reads back a global entry', async () => {
    const h = await fixture()

    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))

    expect(h.repository.getEnvEntry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP')?.value).toBe('oc_default')
    expect(h.repository.listEnvEntriesByScope(PET_ENV_GLOBAL_SCOPE)).toHaveLength(1)
  })

  it('stores a workspace entry independently of the global one', async () => {
    const h = await fixture()

    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_project_a'))

    // Same key, two scopes, two rows: neither write clobbers the other.
    expect(h.repository.getEnvEntry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP')?.value).toBe('oc_default')
    expect(h.repository.getEnvEntry('ws-a', 'CR_GROUP')?.value).toBe('oc_project_a')
    expect(h.repository.listEnvEntries()).toHaveLength(2)
  })

  it('overwrites the same scope and key rather than duplicating', async () => {
    const h = await fixture()

    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'first'))
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'second'))

    expect(h.repository.listEnvEntriesByScope('ws-a')).toHaveLength(1)
    expect(h.repository.getEnvEntry('ws-a', 'CR_GROUP')?.value).toBe('second')
  })

  it('deletes one entry and reports whether a row existed', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_a'))

    expect(await h.repository.deleteEnvEntry('ws-a', 'CR_GROUP')).toBe(true)
    expect(await h.repository.deleteEnvEntry('ws-a', 'CR_GROUP')).toBe(false)
    expect(h.repository.getEnvEntry('ws-a', 'CR_GROUP')).toBeUndefined()
  })

  it('survives a Host restart over the same medium', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))
    await h.close()

    // Reopening the same medium is how this suite models a Host restart.
    harness = await openPetHarness(h.medium)

    expect(harness.repository.getEnvEntry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP')?.value).toBe(
      'oc_default',
    )
  })
})

describe('malformed entries are rejected at write time', () => {
  it('rejects a key that is not upper snake case', async () => {
    const h = await fixture()

    // Rejected on WRITE, not skipped at injection: a stored `cr-group` would
    // simply never reach the child environment, which reads as config that
    // silently does nothing.
    await expect(h.repository.putEnvEntry(entry('ws-a', 'cr-group', 'x'))).rejects.toMatchObject({
      code: 'BINDING_INVALID',
    })
    await expect(h.repository.putEnvEntry(entry('ws-a', '1ABC', 'x'))).rejects.toMatchObject({
      code: 'BINDING_INVALID',
    })
    expect(h.repository.listEnvEntries()).toHaveLength(0)
  })

  it('rejects an empty value', async () => {
    const h = await fixture()

    await expect(h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', ''))).rejects.toMatchObject({
      code: 'BINDING_INVALID',
    })
    expect(h.repository.listEnvEntries()).toHaveLength(0)
  })
})

describe('workspace entries override global ones', () => {
  it('prefers the workspace value for a same-named key', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_project_a'))

    expect(h.repository.resolveEnvFor('ws-a')).toEqual({ CR_GROUP: 'oc_project_a' })
  })

  it('falls back to the global value when the workspace has no such key', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))
    await h.repository.putEnvEntry(entry('ws-a', 'OTHER', 'x'))

    expect(h.repository.resolveEnvFor('ws-a')).toEqual({ CR_GROUP: 'oc_default', OTHER: 'x' })
  })

  it('merges both scopes rather than choosing one', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'NOTIFY_CHANNEL', 'oc_notify'))
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_project_a'))

    expect(h.repository.resolveEnvFor('ws-a')).toEqual({
      NOTIFY_CHANNEL: 'oc_notify',
      CR_GROUP: 'oc_project_a',
    })
  })

  it('yields only global entries when there is no workspace', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry(PET_ENV_GLOBAL_SCOPE, 'CR_GROUP', 'oc_default'))
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_project_a'))

    // An independent Task has no workspace: it gets the global set only, and
    // must never inherit some other workspace's value.
    expect(h.repository.resolveEnvFor(undefined)).toEqual({ CR_GROUP: 'oc_default' })
  })

  it('keeps one workspace invisible to another', async () => {
    const h = await fixture()
    await h.repository.putEnvEntry(entry('ws-a', 'CR_GROUP', 'oc_project_a'))
    await h.repository.putEnvEntry(entry('ws-b', 'CR_GROUP', 'oc_project_b'))

    expect(h.repository.resolveEnvFor('ws-a')).toEqual({ CR_GROUP: 'oc_project_a' })
    expect(h.repository.resolveEnvFor('ws-b')).toEqual({ CR_GROUP: 'oc_project_b' })
  })

  it('resolves to nothing when neither scope configures the key', async () => {
    const h = await fixture()

    // No default is invented here: the variable is simply absent, and the
    // Skill is expected to notice and stop.
    expect(h.repository.resolveEnvFor('ws-a')).toEqual({})
  })
})
