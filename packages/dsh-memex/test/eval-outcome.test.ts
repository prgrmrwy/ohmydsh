import { expect, it } from 'vitest'
import { semanticOutcome } from '../src/eval/outcome.js'
import type { RoundItem } from '../src/eval/round.js'
const yes = { verdict: 'yes', provenance: 'checked', reason: 'fictional' } as const
it('maps two checked semantic criteria to Know or Act and endpoint without manufacturing R or W', () => {
  for (const kind of ['Know', 'Act'] as const) {
    expect(semanticOutcome({ kind } as RoundItem, [yes, yes])).toEqual({ R: [], K: kind === 'Know' ? ['yes', 'yes'] : [], A: kind === 'Act' ? ['yes', 'yes'] : [], W: [], endpoint: ['yes', 'yes'] })
  }
})
it('missing, malformed, unchecked or extra results cannot fabricate a semantic pass', () => {
  for (const raw of [undefined, [], [yes], [yes, yes, yes], ['yes', 'yes'], [{ ...yes, provenance: 'invalid' }, yes], [{ ...yes, verdict: 'invented' }, yes]]) {
    const result = semanticOutcome({ kind: 'Act' } as RoundItem, raw)
    expect(result.endpoint).toContain('unknown')
    expect(result.R).toEqual([])
    expect(result.W).toEqual([])
  }
})
it('retains a checked no as a diagnostic observation rather than replacing it with unknown', () => {
  expect(semanticOutcome({ kind: 'Know' } as RoundItem, [yes, { ...yes, verdict: 'no' }]).endpoint).toEqual(['yes', 'no'])
})
