import { expect, it } from 'vitest'
import { programEvidence } from '../src/eval/program-evidence.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function fixture() {
  let seq = 0
  const events: SessionEvent[] = []
  const call = (name: string, args: unknown, result: unknown, error = false, time = 10) => {
    const id = `call-${seq}`
    events.push({ type: 'assistant/message', seq: seq++, time, data: { message: { content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] } } } as never)
    events.push({ type: 'tool/result', seq: seq++, time: time + 1, data: { message: { toolCallId: id, isError: error, content: [{ type: 'text', text: JSON.stringify(result) }] } } } as never)
  }
  return { events, call }
}
const own = { scope: 'eval-fictional-repo', home: '/fictional/.dsh-memex/eval-fictional-repo', cwd: '/fictional/run/repo' }

it('pairs successful memory results with the exact tool and keeps source identity, excluding failed and seeded results', () => {
  const f = fixture()
  f.call('memex_read', { slug: 'retry-limit' }, { target: own, content: 'Fictional Lantern permits four retries.' })
  f.call('read', { path: '/fictional/config.json' }, { content: 'four retries' })
  f.call('memex_recall', { query: 'retry' }, { current: own, content: 'failed' }, true)
  const observed = programEvidence('root', f.events, 0, own)
  expect(observed.retrieval).toEqual([{ source: 'root:1', tool: 'memex_read', text: 'Fictional Lantern permits four retries.' }])
  expect(programEvidence('child', f.events, f.events.length, own).retrieval).toEqual([])
})

it('a link alone is retained as link text, never expanded into its target content', () => {
  const f = fixture()
  f.call('memex_recall', { query: 'retry' }, { current: own, content: '[[retry-limit]]' })
  expect(programEvidence('root', f.events, 0, own).retrieval[0]!.text).toBe('[[retry-limit]]')
})

it('records successful writes with their actual arguments, target and causal reminder time; failed calls stay failures', () => {
  const f = fixture()
  f.call('memex_retro', { slug: 'lease', title: 'Lease', body: 'leaseSeconds is 45' }, { current: own, slug: 'lease', written: true })
  f.events.push({ type: 'user/message', seq: f.events.length, time: 20, data: { source: { kind: 'plugin:dsh-memex', form: 'notice', summary: 'Memex write reminder' }, content: [{ type: 'text', text: 'reminder' }] } } as never)
  f.call('memex_write', { slug: 'lease', content: 'new content' }, { current: own, written: false }, true, 30)
  const observed = programEvidence('root', f.events, 0, own)
  expect(observed.writes).toHaveLength(2)
  expect(observed.writes[0]).toMatchObject({ success: true, targetCorrect: true, content: 'leaseSeconds is 45', slug: 'lease', at: 11 })
  expect(observed.writes[1]).toMatchObject({ success: false, at: 31 })
  expect(observed.writeback).toEqual({ class: 'proactive', failedWrites: 1 })
})

it('does not infer proactive timing after an unrecognized user intervention', () => {
  const f = fixture()
  f.events.push({ type: 'user/message', seq: 0, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Handle that finding as appropriate.' }] } } as never)
  f.call('memex_write', { slug: 'x', content: 'x' }, { current: own, written: true })
  expect(programEvidence('root', f.events, 0, own).writeback.class).toBe('unknown')
})

it('does not guess an agent-message write request from natural language', () => {
  const f = fixture()
  f.events.push({ type: 'user/message', seq: 0, time: 0, data: { source: { kind: 'agent' }, content: [{ type: 'text', text: 'Please revise the memory card with this finding.' }] } } as never)
  f.call('memex_write', { slug: 'x', content: 'x' }, { current: own, written: true })
  expect(programEvidence('child', f.events, 0, own).writeback.class).toBe('unknown')
})

it('records additional-target writes as wrong-target evidence even when the primary write succeeded', () => {
  const f = fixture()
  f.call('memex_write', { slug: 'x', content: 'x', scope: 'personal' }, { current: own, written: true, additional: [{ scope: 'personal', written: true }] })
  expect(programEvidence('root', f.events, 0, own).writes[0]).toMatchObject({ success: true, targetCorrect: false })
})

it('does not trust outer tool success without a written flag and exact library identity', () => {
  const f = fixture()
  f.call('memex_write', { slug: 'x', content: 'x' }, { current: { ...own, scope: 'personal' }, written: true })
  f.call('memex_retro', { slug: 'y', body: 'y' }, { current: own })
  const observed = programEvidence('root', f.events, 0, own)
  expect(observed.writes[0]).toMatchObject({ success: true, targetCorrect: false })
  expect(observed.writes[1]).toMatchObject({ success: false })
})
