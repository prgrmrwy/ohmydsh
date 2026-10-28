import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { executePreparedItem } from '../src/eval/prepared-execution.js'
import type { FixedRound } from '../src/eval/round.js'
import type { TestedSessionPort } from '../src/eval/executor.js'
const plan = { id: 'round-fixed', tested: { provider: 'p', model: 'm' }, items: [{ id: 'know-mem', question: 'know', condition: 'mem', prompt: 'frozen question' }] } as FixedRound
function fixture() {
  const ledger = new EvalLedger(mkdtempSync(join(realpathSync(tmpdir()), 'eval-prepared-')))
  const id = ledger.reserve(plan.id, 'know', 'mem')
  const calls: string[] = []
  const attempt = { cwd: '/fixture/repo', home: '/library/eval', scope: 'eval', condition: 'mem' as const }
  let title = ''
  const port: TestedSessionPort = { create: async () => { calls.push('create'); ledger.recordCreated(id) }, rename: async (_id, value) => { title = value }, setManual: async () => {}, selectModel: async () => {}, inspect: async () => ({ title, userPinned: true, mode: 'MANUAL', route: plan.tested }), prompt: async (_id, text) => { calls.push(text) } }
  const resolver = { resolve: () => ({ scope: 'eval', home: attempt.home, source: 'local', publish: 'external', memory: true, fallback: false, personal: { read: false, write: false }, access: { read: ['eval'], write: ['eval'] } }) }
  return { ledger, id, calls, attempt, port, resolver }
}
it('binds execution to a reserved matching item and validates the actual Host route before create', async () => {
  const f = fixture()
  await executePreparedItem(plan, 'know-mem', f.id, f.attempt, f.ledger, f.resolver as never, f.port)
  expect(f.calls).toEqual(['create', 'frozen question'])
})
it('rejects a root reserved for another condition and never creates a Session', async () => {
  const f = fixture(), other = f.ledger.reserve(plan.id, 'know', 'nomem')
  await expect(executePreparedItem(plan, 'know-mem', other, f.attempt, f.ledger, f.resolver as never, f.port)).rejects.toThrow(/reservation/)
  expect(f.calls).toEqual([])
})
it('Host route exposing fallback fails before Session creation', async () => {
  const f = fixture()
  const resolve = f.resolver.resolve
  f.resolver.resolve = () => ({ ...resolve(), fallback: true })
  await expect(executePreparedItem(plan, 'know-mem', f.id, f.attempt, f.ledger, f.resolver as never, f.port)).rejects.toThrow(/fallback/)
  expect(f.calls).toEqual([])
})
