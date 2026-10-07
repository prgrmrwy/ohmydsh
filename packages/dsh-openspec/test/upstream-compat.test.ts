import { describe, expect, it } from 'vitest'
import { getOfficialCatalog, renderOfficialBody, resolveEffectiveSelection } from '../src/upstream-compat.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

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
  it('selection_dependent_body_matches_independent_official_renderer_not_unfiltered_catalog', async () => {
    const require = createRequire(import.meta.url)
    const root = dirname(dirname(require.resolve('@fission-ai/openspec')))
    const official = await import(pathToFileURL(join(root, 'dist/core/shared/skill-generation.js')).href)
    const ids = ['propose', 'explore', 'apply', 'update', 'sync', 'archive']
    const entries = await getOfficialCatalog({ workflowIds: ids })
    for (const entry of entries) {
      const template = official.getSkillTemplates(ids).find((item: any) => item.workflowId === entry.workflowId)
      const rendered = official.generateSkillContent(template.template, '1.13.2', (body: string) => body.replace(/\/opsx:([a-z][a-z0-9-]*)/g, '/opsx-$1'))
      const expected = rendered.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, '').trim()
      expect(entry.body).toBe(expected)
    }
  })
  it('delivery_does_not_drop_selected_official_workflows_from_the_shared_body_catalog', async () => {
    for (const delivery of ['skills', 'commands', 'both']) {
      const entries = await getOfficialCatalog({ all: true, delivery })
      expect(entries.map(entry => entry.workflowId)).toContain('verify')
      expect(entries.map(entry => entry.workflowId)).toContain('onboard')
      expect(entries).toHaveLength(12)
    }
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
