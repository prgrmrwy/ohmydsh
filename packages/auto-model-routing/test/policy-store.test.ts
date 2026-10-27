import { expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PolicyStore, type ChildDecision } from '../src/policy-store.js'
it.each(['claude','dsh-magpie-connect','dsh-magpie-connector'] as const)('restores %s identity-only records and fails closed on corruption or unknown fields', (provider) => {
  const dir = mkdtempSync(join(tmpdir(),'policy-store-')), store = new PolicyStore(dir)
  const record: ChildDecision = { childId: '../../child', parentId: 'parent', rootId: 'root', status: 'recommended', path: 'ordinary', explicit: { provider }, route: { provider, model: provider === 'claude' ? 'claude-haiku-5-5' : 'claude/claude-haiku-5-5', reasoningEffort: 'medium' } }
  store.set(record)
  expect(new PolicyStore(dir).get(record.childId)).toEqual(record)
  const file = join(dir,readdirSync(dir)[0]!)
  expect(readFileSync(file,'utf8')).not.toContain('task')
  expect(() => store.set({ ...record, task: 'raw task' } as ChildDecision)).toThrow()
  writeFileSync(file,JSON.stringify({ ...record, childId: 'other' }))
  expect(() => store.get(record.childId)).toThrow('无法恢复')
  writeFileSync(file,'broken')
  expect(() => store.get(record.childId)).toThrow('无法恢复')
})
