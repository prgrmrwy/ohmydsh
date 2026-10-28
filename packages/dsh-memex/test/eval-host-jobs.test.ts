import { mkdtempSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvalLedger } from '../src/eval/ledger.js'
import { expect, it } from 'vitest'
import { attachEvalJobs, type EvalJobEvent } from '../src/eval/host-jobs.js'

function harness(outcome: 'completed' | 'killed' | 'failed' = 'killed') {
  let listener: (event: EvalJobEvent) => void = () => {}
  const events: unknown[] = [], killed: string[] = []
  const jobs = [ { id: 'owned', owner: 'root', status: 'running' }, { id: 'global', status: 'running' }, { id: 'other', owner: 'daily', status: 'running' } ]
  const port = {
    events: { subscribe: (_filter: { owners: 'all' }, fn: (event: EvalJobEvent) => void) => { listener = fn; return () => {} } },
    list: (_owner: string) => jobs,
    kill: (id: string, owner: string) => { expect(owner).toBe('root'); killed.push(id) },
    wait: async (id: string, _ms: number, owner: string) => {
      listener({ type: 'settled', job: { id, owner, status: outcome } })
      jobs[0]!.status = outcome
      return jobs[0]!
    },
  }
  const tracking = attachEvalJobs(port, new Set(['root']), 'host-1', event => events.push(event), 20)
  return { tracking, events, killed, emit: (event: EvalJobEvent) => listener(event), jobs }
}

it('subscribes before jobs, persists release evidence and cancels exact owners only', async () => {
  const h = harness()
  h.emit({ type: 'registered', job: { id: 'owned', owner: 'root', status: 'running' } })
  await h.tracking.settle()
  expect(h.killed).toEqual(['owned'])
  expect(h.events).toHaveLength(2)
  expect(h.jobs[1]!.status).toBe('running')
  await h.tracking.settle()
  expect(h.killed).toEqual(['owned'])
})

it('fails closed on a failed job even after a wait returned terminal', async () => {
  const h = harness('failed')
  h.emit({ type: 'registered', job: { id: 'owned', owner: 'root', status: 'running' } })
  await expect(h.tracking.settle()).rejects.toThrow(/owned/)
})

it('does not infer release from a terminal list when registration was missed', async () => {
  const h = harness('completed')
  h.jobs[0]!.status = 'completed'
  await expect(h.tracking.settle()).rejects.toThrow(/owned/)
})

it('writes Host generation and all release events durably and refuses cross-Host recovery', () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-job-ledger-'))
  const ledger = new EvalLedger(directory)
  ledger.recordRelease({ type: 'registered', id: 'job-1', owner: 'root', generation: 'host-1' })
  ledger.recordRelease({ type: 'settled', id: 'job-1', owner: 'root', generation: 'host-1', status: 'completed' })
  const reopened = new EvalLedger(directory)
  expect(reopened.releaseHistory('host-1')).toHaveLength(2)
  expect(() => reopened.releaseHistory('host-2')).toThrow(/Host generation/)
  expect(readFileSync(join(directory, 'jobs.ndjson'), 'utf8')).toContain('root')
})

it('replays same-Host evidence without appending it again', async () => {
  const saved = [
    { type: 'registered' as const, id: 'retained', owner: 'root', generation: 'host-1' },
    { type: 'settled' as const, id: 'retained', owner: 'root', generation: 'host-1', status: 'completed' },
  ]
  const appended: unknown[] = []
  const tracking = attachEvalJobs({
    events: { subscribe: () => () => {} },
    list: () => [{ id: 'retained', owner: 'root', status: 'completed' }],
    kill: () => { throw new Error('must not cancel settled') }, wait: async () => {},
  }, new Set(['root']), 'host-1', event => appended.push(event), 20, saved)
  await tracking.settle()
  expect(appended).toEqual([])
})

it('persists private owner identities and ignores unowned registrations', async () => {
  const h = harness()
  h.emit({ type: 'registered', job: { id: 'global', status: 'running' } })
  expect(h.events).toHaveLength(0)
})
