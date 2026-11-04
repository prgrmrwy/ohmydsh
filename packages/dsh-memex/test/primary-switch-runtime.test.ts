import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, guardConfigCandidates } from '../src/scope/settings.js'
import { createMemexRuntime, type MemexRuntime } from '../src/plugin.js'
import { liveConfig } from './support/live-config.js'

// dsh-memex-settings-ui「切换主入口 = 先合并卡片，再替换」: the live Config commit
// path moves the old primary library's cards into the new one before the resolver
// starts serving the new routing, and keeps the old routing when it cannot.

let root: string
const contexts: Context[] = []
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-memex-switch-')) })
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  rmSync(root, { recursive: true, force: true })
})

const workspace = () => join(root, 'ws')
const workHome = () => join(root, 'lib-work')
const personalHome = () => join(root, 'lib-personal')

function twoEntryConfig(primary: 'work' | 'personal'): Record<string, unknown> {
  const scopes = [
    { name: 'work', pathPrefixes: [workspace()], home: workHome(), ...(primary === 'work' ? { primary: true } : {}) },
    { name: 'personal', pathPrefixes: [workspace()], home: personalHome(), ...(primary === 'personal' ? { primary: true } : {}) },
  ]
  return primary === 'work' ? { scopes } : { scopes, workspaces: [{ path: workspace(), primary: 'personal' }] }
}

function probe(seen: { runtime?: MemexRuntime }) {
  return {
    name: 'dsh-memex',
    Config,
    apply(ctx: Context, config: Config) {
      guardConfigCandidates(ctx)
      seen.runtime = createMemexRuntime(ctx, config, undefined, { namespaceDir: root, homeDir: root })
    },
  }
}

describe('a live primary switch', () => {
  it('copies the old primary library into the new one before the routing changes', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime } = {}
    const live = await liveConfig(ctx, probe(seen) as never, twoEntryConfig('work'))
    mkdirSync(join(workHome(), 'cards'), { recursive: true })
    writeFileSync(join(workHome(), 'cards', 'note.md'), 'note body')
    expect(seen.runtime!.scopes.current.resolve(workspace()).scope).toBe('work')

    await live.replace(twoEntryConfig('personal'))

    expect(seen.runtime!.scopes.current.resolve(workspace()).scope).toBe('personal')
    expect(readFileSync(join(personalHome(), 'cards', 'note.md'), 'utf8')).toBe('note body')
  })

  it('keeps the running routing when the cards cannot be moved', async () => {
    const ctx = new Context(); contexts.push(ctx)
    const seen: { runtime?: MemexRuntime } = {}
    const live = await liveConfig(ctx, probe(seen) as never, twoEntryConfig('work'))
    mkdirSync(join(workHome(), 'cards'), { recursive: true })
    writeFileSync(join(workHome(), 'cards', 'note.md'), 'note body')
    // A regular file where the target library should be: the merge cannot
    // create `cards/` below it, so the switch must not take effect.
    writeFileSync(personalHome(), 'not a directory')

    await live.replace(twoEntryConfig('personal'))

    expect(seen.runtime!.scopes.current.resolve(workspace()).scope).toBe('work')
    expect(seen.runtime!.config().scopes.find(entry => entry.name === 'personal')?.primary).toBeUndefined()
  })
})
