import { mkdtempSync, realpathSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ calls: [] as string[], fail: false, failItem: '' }))
vi.mock('../src/eval/round.js', () => ({ loadFixedRound: () => ({ items: [{ id: 'know-mem' }, { id: 'know-nomem' }] }) }))
vi.mock('../src/eval/prepare-item.js', () => ({ prepareFixedItem: (_root: string, _round: string, item: string) => { f.calls.push(`prepare:${item}`); mkdirSync(join(_root, _round, item)); return { session: `session-${item}`, attempt: {} } } }))
vi.mock('../src/eval/host-item.js', () => ({ runHostItem: async (_ctx: unknown, input: { item: string }) => { f.calls.push(`run:${input.item}`); if (f.fail || f.failItem === input.item) throw new Error('release unproven'); return input.item } }))
import { runHostRound } from '../src/eval/host-round.js'
const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-orchestrator-'))
const base = { root, round: 'round', home: '/home', tracking: { healthy: () => true } } as any
beforeEach(() => { f.failItem = ''; base.root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-round-orchestrator-case-')); mkdirSync(join(base.root, base.round)) })
it('prepares and runs fixed conditions serially, retaining all outcomes', async () => {
  f.calls.length = 0; f.fail = false
  expect(await runHostRound({} as never, base, new AbortController().signal)).toEqual({ 'know-mem': 'know-mem', 'know-nomem': 'know-nomem' })
  expect(f.calls).toEqual(['prepare:know-mem', 'run:know-mem', 'prepare:know-nomem', 'run:know-nomem'])
  expect(JSON.parse(readFileSync(join(base.root, base.round, 'know-mem', 'outcome.json'), 'utf8'))).toEqual('know-mem')
  expect(JSON.parse(readFileSync(join(base.root, base.round, 'know-nomem', 'outcome.json'), 'utf8'))).toEqual('know-nomem')
})
it('uncertain item stops before preparing any next condition', async () => {
  f.calls.length = 0; f.fail = true
  await expect(runHostRound({} as never, base, new AbortController().signal)).rejects.toThrow('release unproven')
  expect(f.calls).toEqual(['prepare:know-mem', 'run:know-mem'])
  expect(existsSync(join(base.root, base.round, 'know-mem', 'outcome.json'))).toBe(false)
})
it('later release failure retains earlier durable results without writing a fake success for the failed item', async () => {
  f.calls.length = 0; f.fail = false; f.failItem = 'know-nomem'
  await expect(runHostRound({} as never, base, new AbortController().signal)).rejects.toThrow('release unproven')
  expect(JSON.parse(readFileSync(join(base.root, base.round, 'know-mem', 'outcome.json'), 'utf8'))).toBe('know-mem')
  expect(existsSync(join(base.root, base.round, 'know-nomem', 'outcome.json'))).toBe(false)
})
it('unhealthy tracking or declined carrier creates no attempt', async () => {
  for (const aborted of [true, false]) {
    f.calls.length = 0
    const abort = new AbortController(); if (aborted) abort.abort()
    await expect(runHostRound({} as never, { ...base, tracking: { healthy: () => !aborted ? false : true } }, abort.signal)).rejects.toThrow()
    expect(f.calls).toEqual([])
  }
})
