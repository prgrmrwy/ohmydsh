import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { EvalLedger } from '../src/eval/ledger.js'
import { collectItemEvidence } from '../src/eval/collection.js'
import { loadSelection } from '../src/eval/selection.js'
import { readFrozenInput } from '../src/eval/freeze.js'

it('selects visible evidence from registered root and descendants only, auditing routes first', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-'))
  const ledger = new EvalLedger(directory)
  const root = ledger.reserve('round-test', 'know', 'mem'); ledger.recordCreated(root); ledger.recordChild(root, 'child')
  const read: string[] = []
  const result = await collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'm' }, async id => {
    read.push(id)
    return { id, parent: id === root ? undefined : root, inheritedEventCount: 0, events: [
      { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: `answer ${id}` }] }, usage: { inputTokens: 1, outputTokens: 1 }, stream: [] } },
    ] } as never
  })
  expect(read).toEqual([root, 'child'])
  expect(result.audit.status).toBe('valid')
  expect(result.audit.inputTokens).toBe(2)
  expect(loadSelection(join(directory, 'selection')).evidence).toHaveLength(2)
  expect(JSON.stringify(result.selection)).not.toContain('private')
})
it('freezes full successful tool results separately from the judge selection', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-tools-'))
  const ledger = new EvalLedger(directory)
  const root = ledger.reserve('round-test', 'know', 'mem')
  const card = 'retryLimit is 4.\n' + 'y'.repeat(50_000)
  await collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'm' }, async id => ({ id, inheritedEventCount: 0, events: [
    { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'memex_read', arguments: '{}' }] }, usage: { inputTokens: 1, outputTokens: 1 }, stream: [] } },
    { type: 'tool/result', seq: 2, data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: card }] } } },
    { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: 'answer: 4' }] }, usage: { inputTokens: 1, outputTokens: 1 }, stream: [] } },
  ] } as never))
  expect(readFrozenInput(join(directory, 'collected-tool-results'))).toEqual([{ id: `${root}:2`, tool: 'memex_read', text: card }])
  expect(loadSelection(join(directory, 'selection')).evidence.map(item => item.text)).toEqual(['answer: 4'])
})

it('EVAL-004 (collection): a known out-of-bounds read stops the item before any scoreable selection exists', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-boundary-'))
  const ledger = new EvalLedger(directory)
  const root = ledger.reserve('round-test', 'know', 'mem')
  const boundary = { home: '/u', own: { cwd: '/u/.dsh-memex-eval-runs/mem/eval-x/repo', home: '/u/.dsh-memex/eval-x-repo' } }
  await expect(collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'm' }, async id => ({ id, inheritedEventCount: 0, events: [
    { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"/u/.dsh-memex/personal/cards/real.md"}' }] }, usage: { inputTokens: 1, outputTokens: 1 }, stream: [] } },
    { type: 'tool/result', seq: 2, data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'real card' }] } } },
    { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: 'answer' }] }, usage: { inputTokens: 1, outputTokens: 1 }, stream: [] } },
  ] } as never), boundary)).rejects.toThrow(/环境污染|contaminat/)
  expect(readFrozenInput(join(directory, 'boundary-hits'))).toEqual([expect.objectContaining({ kind: 'real-library', tool: 'read' })])
  expect(existsSync(join(directory, 'selection'))).toBe(false)
})

it('does not freeze scoreable selection when actual descendant route differs', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-route-'))
  const ledger = new EvalLedger(directory); const root = ledger.reserve('round-test', 'know', 'mem')
  await expect(collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'fixed' }, async id => ({ id, inheritedEventCount: 0, events: [
    { type: 'request/header', seq: 0, data: { header: { config: { provider: 'wrong', model: 'fixed' } } } },
    { type: 'assistant/message', seq: 1, data: { usage: { inputTokens: 1, outputTokens: 1 }, stream: [], message: { content: [{ type: 'text', text: 'answer' }] } } },
  ] } as never))).rejects.toThrow(/configuration-mismatch/)
})

it('refuses collection if new descendants register while evidence is read', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-race-'))
  const ledger = new EvalLedger(directory); const root = ledger.reserve('round-test', 'know', 'mem')
  await expect(collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'm' }, async id => {
    ledger.recordChild(root, 'late-child')
    return { id, inheritedEventCount: 0, events: [
      { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { type: 'assistant/message', seq: 1, data: { usage: { inputTokens: 1, outputTokens: 1 }, stream: [], message: { content: [{ type: 'text', text: 'answer' }] } } },
    ] } as never
  })).rejects.toThrow(/changed/)
})

it('refuses foreign stored identity rather than freezing its answers as tested evidence', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'eval-collection-refuse-'))
  const ledger = new EvalLedger(directory); const root = ledger.reserve('round-test', 'know', 'mem')
  await expect(collectItemEvidence(directory, ledger, root, { provider: 'p', model: 'm' }, async () => ({ id: 'daily', inheritedEventCount: 0, events: [] }))).rejects.toThrow(/identity/)
})
