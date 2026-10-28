import { describe, expect, it } from 'vitest'
import { JobReleaseProof, retireTestRoot, bindJobReleaseEvents, type RetirementPort } from '../src/eval/release.js'

it('captures synchronous Host events before resources and unregisters on teardown', () => {
  let listener: ((event: { type: string; job: { id: string; owner?: string; status?: string } }) => void) | undefined
  let closed = false
  const p = proof()
  const dispose = bindJobReleaseEvents({ subscribe: (filter, fn) => {
    expect(filter).toEqual({ owners: 'all' }); listener = fn; return () => { closed = true }
  } }, p, 'host-1')
  listener!({ type: 'registered', job: { id: 'bash-1', owner } })
  listener!({ type: 'settled', job: { id: 'bash-1', owner, status: 'completed' } })
  expect(() => p.requireReleased([{ id: 'bash-1', owner }])).not.toThrow()
  dispose()
  expect(closed).toBe(true)
})

const owner = 'test-root'
function proof() { return new JobReleaseProof('host-1', new Set([owner]), () => {}) }
function registered(p: JobReleaseProof, id = 'bash-1') { p.observe({ type: 'registered', id, owner, generation: 'host-1' }) }

it('a forced-failed orphan job blocks the round and is listed by raw ID', () => {
  const p = proof()
  registered(p, 'orphan-bash')
  p.observe({ type: 'settled', id: 'orphan-bash', owner, generation: 'host-1', status: 'failed' })
  expect(() => p.requireReleased([])).toThrow(/orphan-bash/)
})

it('an accepted interrupt whose queue was not drained is not treated as retirement', async () => {
  const calls: string[] = []
  const root = { id: owner, pending: ['queued prompt'] }
  const port: RetirementPort<typeof root> = {
    root, current: () => root,
    archive: async () => { calls.push('archive') },
    cancel: () => { calls.push('cancel accepted') },
    whenIdle: async () => { calls.push('idle') },
    pending: agent => agent.pending.length,
    settleJobs: async () => {}, drainDescendants: async () => {}, settleOneShots: async () => {},
    healthy: () => true,
  }
  await expect(retireTestRoot(port)).rejects.toThrow(/inbox not empty/)
  expect(root.pending).toEqual(['queued prompt'])
})

it('EVAL-057: failed 或丢证据不能当资源释放', () => {
  const p = proof()
  registered(p)
  p.observe({ type: 'settled', id: 'bash-1', owner, generation: 'host-1', status: 'failed' })
  p.observe({ type: 'removed', id: 'bash-1', owner, generation: 'host-1' })
  expect(() => p.requireReleased([])).toThrow(/bash-1/)
  const missing = proof()
  missing.observe({ type: 'settled', id: 'bash-2', owner, generation: 'host-1', status: 'completed' })
  expect(() => missing.requireReleased([])).toThrow(/bash-2/)
})

it('EVAL-059: 作业按精确 owner 清退', () => {
  const p = proof()
  registered(p)
  expect(p.ownedJobs([{ id: 'bash-1', owner }, { id: 'global' }, { id: 'foreign', owner: 'daily' }])).toEqual([{ id: 'bash-1', owner }])
  p.observe({ type: 'settled', id: 'bash-1', owner, generation: 'host-1', status: 'killed' })
  expect(() => p.requireReleased([{ id: 'bash-1', owner }])).not.toThrow()
})

it('EVAL-061: 可信结算记录保留不阻止继续', () => {
  const p = proof()
  registered(p)
  p.observe({ type: 'settled', id: 'bash-1', owner, generation: 'host-1', status: 'completed' })
  expect(() => p.requireReleased([{ id: 'bash-1', owner }])).not.toThrow()
  p.observe({ type: 'removed', id: 'bash-1', owner, generation: 'host-1' })
  expect(() => p.requireReleased([])).not.toThrow()
  const unknown = proof()
  registered(unknown)
  expect(() => unknown.requireReleased([])).toThrow(/bash-1/)
})

it('host generation changes and persistence failures are sticky', () => {
  const p = proof()
  registered(p)
  p.observe({ type: 'settled', id: 'bash-1', owner, generation: 'host-2', status: 'completed' })
  expect(() => p.requireReleased([])).toThrow()
  const failedWriter = new JobReleaseProof('host-1', new Set([owner]), () => { throw new Error('disk full') })
  expect(() => registered(failedWriter)).not.toThrow()
  expect(() => failedWriter.requireReleased([])).toThrow(/unhealthy/)
})

function retirement() {
  const calls: string[] = []
  const root = { id: owner, pending: ['old'] as string[] }
  const daily = { id: 'daily', pending: ['keep'] }
  const port: RetirementPort<typeof root> = {
    root, current: () => root,
    archive: async id => { calls.push(`archive:${id}`) },
    cancel: agent => { calls.push('cancel'); agent.pending.length = 0 },
    whenIdle: async () => { calls.push('idle') },
    pending: agent => agent.pending.length,
    settleJobs: async () => { calls.push('jobs') },
    drainDescendants: async () => { calls.push('drain'); root.pending.push('settlement') },
    settleOneShots: async () => { calls.push('one-shots'); root.pending.push('one-shot settlement') },
    healthy: () => true,
  }
  return { port, root, daily, calls }
}

it('EVAL-058: 归档测试根但不销毁日常对象', async () => {
  const f = retirement()
  await retireTestRoot(f.port)
  expect(f.calls[0]).toBe('archive:test-root')
  expect(f.daily.pending).toEqual(['keep'])
  expect(f.port.current()).toBe(f.root)
})

it('EVAL-058 (report): the selftest report describes test roots as archived and quiesced, never disposed', async () => {
  const { renderSelftestReport } = await import('../src/eval/report.js')
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as never
  const markdown = renderSelftestReport(plan, {}).markdown
  expect(markdown).toContain('测试根会话已归档并静止，未销毁')
  expect(markdown).not.toMatch(/已(销毁|dispose)|disposed/)
})

it('EVAL-060: 后代结算通知在最终清队列时清除', async () => {
  const f = retirement()
  await retireTestRoot(f.port)
  expect(f.calls).toEqual(['archive:test-root', 'cancel', 'idle', 'jobs', 'drain', 'one-shots', 'cancel', 'idle', 'jobs'])
  expect(f.root.pending).toEqual([])
})

it('does not reach the final check or next item before the one-shot owner settles', async () => {
  const f = retirement()
  f.port.settleOneShots = async () => { throw new Error('owner not settled') }
  await expect(retireTestRoot(f.port)).rejects.toThrow('owner not settled')
  expect(f.calls.filter(c => c === 'cancel')).toHaveLength(1)
})
