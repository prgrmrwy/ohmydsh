import { describe, expect, it } from 'vitest'
import { getOfficialCatalog, renderOfficialBody, resolveEffectiveSelection } from '../src/upstream-compat.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('pinned OpenSpec surface', () => {
  it('profile_custom_delivery_selection_uses_official_resolution_and_defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-openspec-config-')); const path = join(dir, 'config.json')
    try {
      await writeFile(path, JSON.stringify({ profile: 'custom', workflows: ['new', 'archive'], delivery: 'skills' }))
      expect(await resolveEffectiveSelection({ configPath: path })).toMatchObject({ workflows: ['new', 'sync', 'archive'], delivery: 'skills' })
      await writeFile(path, JSON.stringify({ profile: 'core', delivery: 'both' }))
      expect((await resolveEffectiveSelection({ configPath: path })).workflows).toEqual(['propose', 'explore', 'apply', 'update', 'sync', 'archive'])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('renders_official_catalog_and_bodies_equal_render_official_body', async () => {
    const catalog = await getOfficialCatalog({ all: true })
    expect(catalog).toHaveLength(12)
    expect(new Set(catalog.map((entry) => entry.workflowId)).size).toBe(12)
    for (const entry of catalog) {
      expect(entry.body).toBe(await renderOfficialBody({ workflowId: entry.workflowId, all: true }))
      expect(entry.body).not.toMatch(/\/opsx:/)
    }
  })
})
