import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runSelftestCli, type SelftestIo } from '../src/cli/eval-selftest.js'
import { registerFixedRound } from '../src/eval/round.js'

function io(answer: string) {
  const calls: string[] = [], items: string[] = []
  let out = '', notice = ''
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-cli-'))
  const port: SelftestIo = {
    out: text => { out += text }, error: text => { out += text },
    confirm: async text => { notice = text; calls.push('confirm'); return answer },
    call: async (endpoint, payload) => { calls.push(endpoint); if (endpoint === 'eval/pendingDefaultReviews') return []; if (endpoint === 'eval/registerRound') return registerFixedRound(root, payload); if (endpoint === 'eval/runRound') { items.push('whole-round'); return { evidenceComplete: true } } return { defaultModelNotice: 'Please review default' } },
  }
  return { port, calls, items, output: () => out, notice: () => notice }
}
const routes = ['--tested', 'mock/tested', '--judge', 'mock/judge']

it('EVAL-001: 用户确认后运行六个条件', async () => {
  const h = io('RUN FIXED SELFTEST')
  expect(await runSelftestCli(routes, h.port)).toBe(0)
  expect(h.calls).toEqual(['confirm', 'eval/pendingDefaultReviews', 'eval/registerRound', 'eval/runRound', 'eval/status'])
  expect(h.items).toEqual(['whole-round'])
  expect(h.output()).toContain('固定虚构自检')
  expect(h.output()).toContain('宿主可达限制')
})

it('EVAL-001 (report): the offline report states the selftest scope and host reachability limits', async () => {
  const { renderSelftestReport } = await import('../src/eval/report.js')
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as never
  const markdown = renderSelftestReport(plan, {}).markdown
  expect(markdown).toContain('固定虚构自检')
  expect(markdown).toContain('宿主可达限制')
})

it('EVAL-002: 自定义输入被拒绝', async () => {
  const existing = join(mkdtempSync(join(realpathSync(tmpdir()), 'eval-cli-suite-')), 'private-suite')
  writeFileSync(existing, 'business questions')
  const messages: string[] = []
  for (const path of [existing, '/tmp/definitely-missing-private-suite']) {
    const h = io('RUN FIXED SELFTEST')
    expect(await runSelftestCli([...routes, '--suite', path], h.port)).toBe(2)
    expect(h.calls).toEqual([])
    expect(h.items).toEqual([])
    messages.push(h.output().replace(path, '<path>'))
  }
  // identical output for an existing and a missing path: the path was never read
  expect(messages[0]).toBe(messages[1])
})

it('stops at the first uncertain condition and never reports success', async () => {
  const h = io('RUN FIXED SELFTEST')
  const call = h.port.call
  h.port.call = async (endpoint, payload) => { if (endpoint === 'eval/runRound') throw new Error('release unproven'); return call(endpoint, payload) }
  expect(await runSelftestCli(routes, h.port)).toBe(1)
  expect(h.items).toEqual([])
  expect(h.output()).toContain('保留现场')
})

it('EVAL-003: 用户取消时无会话', async () => {
  const h = io('no')
  expect(await runSelftestCli(routes, h.port)).not.toBe(0)
  expect(h.calls).toEqual(['confirm'])
  expect(h.items).toEqual([])
})
