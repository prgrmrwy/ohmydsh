import { mkdtempSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'

function ledger() { return new EvalLedger(mkdtempSync(join(realpathSync(tmpdir()), 'eval-ledger-'))) }

it('EVAL-021: 创建响应丢失不重复派发', async () => {
  const l = ledger()
  const id = l.reserve('round', 'know', 'mem')
  const sessions = new Map<string, string>()
  let creates = 0
  const port = {
    lookup: async (sessionId: string) => sessions.get(sessionId),
    create: async (sessionId: string) => { creates++; sessions.set(sessionId, sessionId); throw new Error('response lost') },
  }
  await expect(l.ensureCreated(id, port)).rejects.toThrow('response lost')
  expect(await l.ensureCreated(id, port)).toBe(id)
  expect(creates).toBe(1)
  expect(l.read().filter(e => e.kind === 'reserved')).toHaveLength(1)
})

it('coalesces concurrent create requests for the same reserved identity', async () => {
  const l = ledger()
  const id = l.reserve('round', 'know', 'mem')
  let creates = 0
  const port = { lookup: async () => undefined, create: async (id: string) => { creates++; return id } }
  await Promise.all([l.ensureCreated(id, port), l.ensureCreated(id, port)])
  expect(creates).toBe(1)
})

it('EVAL-022: turn-end 但 job 仍运行', async () => {
  const l = ledger()
  const session = l.reserve('round', 'know', 'mem')
  l.recordJob(session, 'job-1')
  let waited = false
  await expect(l.requireSettled({ settle: async () => { waited = true; return false } })).rejects.toThrow(/job-1/)
  expect(waited).toBe(true)
})

it('EVAL-023: 后代在 CLI 崩溃前已登记', () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-registry-'))
  const publicFile = join(directory, 'registry.ndjson')
  const l = new EvalLedger(directory, publicFile)
  const session = l.reserve('round', 'know', 'mem')
  l.recordChild(session, 'child-id')
  const registry = readFileSync(publicFile, 'utf8')
  expect(registry).not.toContain(session)
  expect(registry).not.toContain('child-id')
  expect(registry.split('\n').filter(Boolean)).toHaveLength(2)
  const restarted = new EvalLedger(l.directory)
  expect(restarted.read()).toContainEqual(expect.objectContaining({ kind: 'child', parent: session, id: 'child-id' }))
})
