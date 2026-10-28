import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { freezeInput } from '../src/eval/freeze.js'
import { freezeSelection, loadSelection } from '../src/eval/selection.js'
const directory = () => mkdtempSync(join(realpathSync(tmpdir()), 'eval-selection-'))
it('freezes exact judge-visible text with hashes and declared coverage before dispatch', () => {
  const root = directory()
  const selection = freezeSelection(join(root, 'selection'), [{ id: 's:1', text: 'Visible answer' }, { id: 's:2', text: 'Second answer' }], ['s:2'])
  expect(selection.coverage).toEqual({ available: 2, selected: 1, omitted: ['s:1'], full: false })
  expect(selection.evidence).toEqual([{ id: 's:2', text: 'Second answer', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  expect(loadSelection(join(root, 'selection'))).toEqual(selection)
})
it('does not freeze unapproved fields carried by evidence objects', () => {
  const selection = freezeSelection(join(directory(), 'selection'), [{ id: 's:1', text: 'answer', reasoning: 'private' }] as never, ['s:1'])
  expect(JSON.stringify(selection)).not.toContain('private')
})

it('refuses hash-valid selections with false coverage, duplicate IDs or leaked fields', () => {
  const valid = freezeSelection(join(directory(), 'valid'), [{ id: 's:1', text: 'answer' }], ['s:1'])
  for (const invalid of [
    { ...valid, coverage: { ...valid.coverage, available: 9 } },
    { ...valid, coverage: { ...valid.coverage, full: false } },
    { ...valid, evidence: [valid.evidence[0], valid.evidence[0]] },
    { ...valid, evidence: [{ ...valid.evidence[0], reasoning: 'private' }] },
    { ...valid, coverage: { ...valid.coverage, omitted: ['s:1'] } },
  ]) {
    const path = join(directory(), 'invalid'); freezeInput(path, invalid)
    expect(() => loadSelection(path)).toThrow()
  }
})

it('refuses duplicate, absent or blank source selections', () => {
  for (const [evidence, ids] of [
    [[{ id: 's:1', text: 'answer' }], ['missing']],
    [[{ id: 's:1', text: 'answer' }], ['s:1', 's:1']],
    [[{ id: 's:1', text: ' ' }], ['s:1']],
    [[{ id: 's:1', text: 'a' }, { id: 's:1', text: 'b' }], ['s:1']],
  ] as const) expect(() => freezeSelection(join(directory(), 'selection'), evidence, ids)).toThrow()
})
