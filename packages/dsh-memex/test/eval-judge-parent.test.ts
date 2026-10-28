import { expect, it } from 'vitest'
import { createJudgeParent, requirePristineJudgeParent } from '../src/eval/judge-parent.js'

it('rejects a judge parent workspace that exposes memory or personal fallback before creating an Agent', async () => {
  for (const route of [
    { memory: true, fallback: false, personal: { read: false, write: false } },
    { memory: false, fallback: true, personal: { read: true, write: true } },
  ]) await expect(createJudgeParent({} as never, { id: 'test', cwd: '/test', preset: 'minimal' }, { resolve: () => route } as never)).rejects.toThrow(/disable memory/)
})

it('EVAL-033: 父会话已收到 prompt 被拒绝', () => {
  for (const parent of [
    { session: { snapshotEvents: () => [{ type: 'user/message' }] }, inbox: { nextTurn: [], nextStep: [] } },
    { session: { snapshotEvents: () => [] }, inbox: { nextTurn: ['GUI prompt'], nextStep: [] } },
    { session: { snapshotEvents: () => [] }, inbox: { nextTurn: [], nextStep: ['injected'] } },
  ]) expect(() => requirePristineJudgeParent(parent as never)).toThrow(/contaminated/)
  expect(() => requirePristineJudgeParent({ session: { snapshotEvents: () => [{ type: 'subagent/catalog' }] }, inbox: { nextTurn: [], nextStep: [] } } as never)).not.toThrow()
})
