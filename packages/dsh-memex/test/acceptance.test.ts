import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createScopeResolver } from '../src/scope/resolver.js'
import { registerMemexTools } from '../src/tools/index.js'

function card(title: string, body: string): string {
  return `---\ntitle: ${title}\ncreated: 2026-09-18\nsource: acceptance\n---\n${body}\n`
}

function harness() {
  const namespaceDir = mkdtempSync(join(tmpdir(), 'dsh-memex-acceptance-'))
  const resolver = createScopeResolver({
    namespaceDir,
    config: {
      autoDerive: false,
      scopes: [
        { name: 'current', pathPrefixes: ['/workspace/current'], publish: 'internal' },
        { name: 'other', pathPrefixes: ['/workspace/other'], publish: 'internal' },
        { name: 'outside', pathPrefixes: ['/workspace/outside'], publish: 'internal' },
        { name: 'personal', publish: 'external' },
      ],
      bindings: [{ name: 'bound', read: ['current', 'other', 'personal'], write: ['current', 'other', 'personal'] }],
    },
    gitRemote: () => undefined,
  })
  const tools = new Map<string, ToolDefinition>()
  const logs: unknown[][] = []
  const ctx = {
    logger: () => ({ warn: (...args: unknown[]) => logs.push(args) }),
    tools: { register(definition: ToolDefinition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
  }
  registerMemexTools(ctx as never, resolver)
  const exec = { agent: { session: { header: { cwd: '/workspace/current' } } } }
  const call = async (name: string, args: unknown) => {
    const result = await tools.get(name)!.execute(args, exec as never) as { json: string }
    return JSON.parse(result.json)
  }
  return { namespaceDir, resolver, tools, logs, call }
}

describe('dsh-memex real-kernel acceptance', () => {
  it('fans out, preserves provenance, reads same slugs independently, and respects bindings', async () => {
    const h = harness()
    for (const name of ['current', 'other', 'personal']) h.resolver.ensure(h.resolver.resolveByName(name))
    writeFileSync(join(h.namespaceDir, 'current', 'cards', 'same.md'), card('Current title', 'shared-key current-body'))
    writeFileSync(join(h.namespaceDir, 'other', 'cards', 'same.md'), card('Other title', 'shared-key other-body'))
    writeFileSync(join(h.namespaceDir, 'personal', 'cards', 'personal.md'), card('Personal title', 'shared-key personal-body'))

    const local = await h.call('memex_search', { query: 'shared-key' })
    expect(local.hits.map((hit: any) => hit.scope)).toEqual(['current'])

    const result = await h.call('memex_search', { query: 'shared-key', scope: 'all' })
    expect(result.hits.map((hit: any) => hit.scope)).toEqual(['current', 'other', 'personal'])
    expect(result.failures).toEqual([])
    const current = await h.call('memex_read', { scope: 'current', slug: 'same' })
    const other = await h.call('memex_read', { scope: 'other', slug: 'same' })
    expect(current.content).toContain('current-body')
    expect(other.content).toContain('other-body')
    await expect(h.call('memex_read', { scope: 'outside', slug: 'same' })).rejects.toThrow(/outside the readable binding/)
  })

  it('writes current and internal targets, but rejects guarded and out-of-binding additions without rollback', async () => {
    const h = harness()
    const content = card('Decision', 'generic reusable decision')
    const success = await h.call('memex_write', { slug: 'decision', content, scope: ['other', 'outside'] })
    expect(success.written).toBe(true)
    expect(success.additional).toEqual([
      expect.objectContaining({ scope: 'other', written: true }),
      expect.objectContaining({ scope: 'outside', written: false }),
    ])
    expect(readFileSync(join(h.namespaceDir, 'current', 'cards', 'decision.md'), 'utf8')).toContain('generic reusable')
    expect(readFileSync(join(h.namespaceDir, 'other', 'cards', 'decision.md'), 'utf8')).toContain('generic reusable')

    // The guard decision is independent of where the text came from: simulate
    // first recalling an internal card, then attempting to publish its marker.
    writeFileSync(join(h.namespaceDir, 'current', 'cards', 'internal-context.md'), card('Internal context', 'current internals'))
    await h.call('memex_search', { query: 'internals' })
    const guarded = await h.call('memex_write', { slug: 'guarded', content: card('Guarded', 'mentions current internals'), scope: 'personal' })
    expect(guarded.additional).toEqual([expect.objectContaining({ scope: 'personal', written: false, rules: expect.any(Array) })])
    expect(readFileSync(join(h.namespaceDir, 'current', 'cards', 'guarded.md'), 'utf8')).toContain('mentions current')
    expect(h.logs).toHaveLength(1)
    expect(JSON.stringify(h.logs)).not.toContain('mentions current')
    const written = readFileSync(join(h.namespaceDir, 'current', 'cards', 'guarded.md'), 'utf8')
    expect(written).not.toMatch(/^origin:/m)
    expect(written).not.toMatch(/^scope:/m)
  })

  it('keeps libraries independent when one is removed', async () => {
    const h = harness()
    const current = h.resolver.ensure(h.resolver.resolveByName('current'))
    const other = h.resolver.ensure(h.resolver.resolveByName('other'))
    writeFileSync(join(current.home, 'cards', 'alive.md'), card('Alive', 'independent-key'))
    renameSync(other.home, `${other.home}.removed`)
    const result = await h.call('memex_search', { query: 'independent-key', scope: 'all' })
    expect(result.hits).toEqual([expect.objectContaining({ scope: 'current', slug: 'alive' })])
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'other' })]))
  })
})
