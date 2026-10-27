import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadGuardConfig, validateGuardConfig, writeGuardConfig } from '../src/config.js'
import { requiresEgressGuard, isClaudeFamily } from '../src/rules.js'
import { createEgressGate } from '../src/egress-gate.js'
import { ComposerGuardController } from '../src/client/guard.js'
import { apply, configPathOf } from '../src/index.js'
import { NetworkVerdictCache } from '../src/network.js'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'

const magpie = { provider: 'dsh-magpie', model: 'claude/claude-opus-5-5' }
const dirs: string[] = []
const temporary = () => { const dir = mkdtempSync(path.join(tmpdir(), 'guard-exempt-')); dirs.push(dir); return dir }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('matches only the actual provider identity while preserving Claude classification', () => {
  expect(isClaudeFamily(magpie.provider, magpie.model)).toBe(true)
  expect(requiresEgressGuard(magpie.provider, magpie.model, ['dsh-magpie'])).toBe(false)
  for (const provider of ['claude', 'anthropic', 'dsh-magpie-connect', 'dsh-magpie-other', 'DSH-MAGPIE', 'Magpie (Claude)']) {
    expect(requiresEgressGuard(provider, magpie.model, ['dsh-magpie'])).toBe(true)
  }
})

describe('config precedence and validation', () => {
  it('defaults to no exemption and deduplicates exact route IDs', () => {
    expect(validateGuardConfig({})).toMatchObject({ ok: true, config: { exemptProviders: [] } })
    expect(validateGuardConfig({ exemptProviders: ['dsh-magpie', 'dsh-magpie', 'Other'] })).toMatchObject({ ok: true, config: { exemptProviders: ['dsh-magpie', 'Other'] } })
    for (const exemptProviders of [null, '*', ['*'], [''], ['Magpie (Claude)'], [5], [' dsh-magpie'], ['x'.repeat(129)], Array(65).fill('a')]) {
      expect(validateGuardConfig({ exemptProviders }).ok).toBe(false)
    }
  })

  it('inherits deployment defaults, supports explicit empty override, and fails closed on invalid files', async () => {
    const file = path.join(temporary(), 'config.json')
    expect(loadGuardConfig(file, ['dsh-magpie']).exemptProviders).toEqual(['dsh-magpie'])
    writeFileSync(file, '{}')
    expect(loadGuardConfig(file, ['dsh-magpie']).exemptProviders).toEqual(['dsh-magpie'])
    await writeGuardConfig(file, { exemptProviders: [], timeoutMs: 3456 })
    expect(loadGuardConfig(file, ['dsh-magpie'])).toMatchObject({ exemptProviders: [], timeoutMs: 3456 })
    writeFileSync(file, '{"exemptProviders":["*"]}')
    expect(loadGuardConfig(file, ['dsh-magpie']).exemptProviders).toEqual([])
    writeFileSync(file, 'broken')
    expect(loadGuardConfig(file, ['dsh-magpie']).exemptProviders).toEqual([])
  })
})

it.each(['blocked', 'unknown'] as const)('bypasses Geo only for exempt providers on %s and observes revocation live', async verdict => {
  const check = vi.fn(async () => ({ verdict, degraded: false }))
  let providers = ['dsh-magpie']
  const gate = createEgressGate(check, undefined, () => providers)
  const next = vi.fn(() => (async function* () { yield { type: 'text-delta', index: 0, text: 'ok' } as const })())
  const consume = async (options: typeof magpie) => { for await (const _ of gate(options as never, next)) {} }
  await consume(magpie)
  expect(check).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledTimes(1)
  await expect(consume({ ...magpie, provider: 'claude' })).rejects.toThrow('restricted')
  providers = []
  await expect(consume(magpie)).rejects.toThrow('restricted')
  expect(next).toHaveBeenCalledTimes(1)
})

it.each(['blocked', 'unknown'] as const)('clears only its own composer block on %s and reapplies after revocation', verdict => {
  let providers: string[] = []
  let selection = { ...magpie, provider: 'claude' }
  let block: { reason: string } | undefined
  const guard = new ComposerGuardController({ network: () => verdict, exemptProviders: () => providers,
    read: () => ({ selection, routable: true }), blockOf: () => block,
    setBlock: (_, value) => { block = value }, reason: () => 'guard' })
  guard.evaluate('s')
  expect(block?.reason).toBe('guard')
  providers = ['dsh-magpie']; selection = magpie
  guard.evaluate('s')
  expect(block).toBeUndefined()
  providers = []; guard.evaluate('s')
  expect(block?.reason).toBe('guard')
  block = { reason: 'foreign' }; providers = ['dsh-magpie']; guard.evaluate('s')
  expect(block?.reason).toBe('foreign')
})

it('serves effective Host policy without Geo, applies persisted revocation at the real stream hook', async () => {
  vi.stubEnv('DSH_HOME', temporary())
  const check = vi.spyOn(NetworkVerdictCache.prototype, 'check').mockResolvedValue({ verdict: 'unknown', degraded: true })
  let handler: any, gate: any
  const ctx: any = { logger: () => ({ info: vi.fn() }), on: (_: string, fn: any) => { gate = fn },
    inject: (_: string[], fn: any) => fn(ctx), get: () => ({ rpc: { handle: (_: string, fn: any) => { handler = fn } } }), effect: (fn: any) => fn() }
  apply(ctx, { exemptProviders: ['dsh-magpie'] })
  expect(await handler('policy')).toEqual({ ok: true, value: { exemptProviders: ['dsh-magpie'] } })
  expect(check).not.toHaveBeenCalled()
  const next = vi.fn(() => (async function* () {})())
  for await (const _ of gate(magpie, next)) {}
  expect(next).toHaveBeenCalledTimes(1)
  expect(check).not.toHaveBeenCalled()
  expect(await handler('set-config', { exemptProviders: [] })).toMatchObject({ ok: true })
  expect(await handler('policy')).toEqual({ ok: true, value: { exemptProviders: [] } })
  await expect((async () => { for await (const _ of gate(magpie, next)) {} })()).rejects.toThrow('restricted')
  expect(loadGuardConfig(configPathOf(process.env.DSH_HOME!)).exemptProviders).toEqual([])
})

it('removes the old connect manifest entry and explicitly configures only dsh-magpie', () => {
  const manifest = parse(readFileSync(new URL('../../../dsh.yaml', import.meta.url), 'utf8'))
  expect(manifest.customizations.some((c: any) => c.id === 'dsh-magpie-connect')).toBe(false)
  expect(manifest.customizations.find((c: any) => c.id === 'home-network-model-guard-config').enabled).toBe(true)
  const patch = parse(readFileSync(new URL('../../../patches/home-network-model-guard-config.yml', import.meta.url), 'utf8'))
  expect(patch).toEqual([{ id: 'dsh-home-network-model-guard', name: 'dsh-home-network-model-guard', config: { exemptProviders: ['dsh-magpie'] } }])
})
