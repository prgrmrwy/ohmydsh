import { describe, expect, it, vi } from 'vitest'
import { carryArchivedTopics, type CarryTopicsDeps } from '../src/host/locus/carry-topics.js'

const S1 = 'session-archived'
const S2 = 'session-target'
const LIVE = 'session-live'

function row(id: string, chatId: string, threadId: string | undefined, parent: string, state = 'active') {
  return { id, endpoint: threadId === undefined ? { chatId } : { chatId, threadId }, parentSessionId: parent, state }
}

function deps(rows: ReturnType<typeof row>[], fail: string[] = []): CarryTopicsDeps & { rebuild: ReturnType<typeof vi.fn> } {
  return {
    listLoci: () => rows,
    latestIdOf: endpoint => rows.filter(r => r.endpoint.chatId === endpoint.chatId && r.endpoint.threadId === endpoint.threadId).at(-1)?.id,
    isArchived: id => id === S1,
    rebuild: vi.fn(async ({ previousLocusId }: { previousLocusId: string }) => {
      if (fail.includes(previousLocusId)) throw new Error('入口仍有执行中或排队消息')
    }),
  }
}

describe('carry archived topics with a group /bind', () => {
  it('spec Scenario "群级改挂连带同群遗留话题": moves only this chat\'s topics on the archived main', async () => {
    const rows = [
      row('g', 'oc-g', undefined, S2),
      row('a', 'oc-g', 'omt-a', S1),
      row('b', 'oc-g', 'omt-b', S1),
      row('c', 'oc-g', 'omt-c', S1, 'stopped'),
      row('d', 'oc-g', 'omt-d', LIVE),
      row('e', 'oc-g', 'omt-e', S2),
      row('h', 'oc-h', 'omt-h', S1),
    ]
    const d = deps(rows)

    await expect(carryArchivedTopics(d, { chatId: 'oc-g' }, S2)).resolves.toEqual({ movedTopics: 2, skippedTopics: [] })
    expect(d.rebuild.mock.calls.map(([input]) => input.previousLocusId)).toEqual(['a', 'b'])
    expect(d.rebuild).toHaveBeenCalledWith(expect.objectContaining({ parentSessionId: S2, replaceArchivedParent: true }))
  })

  it('skips a topic row that is no longer its endpoint\'s latest generation', async () => {
    const rows = [row('a1', 'oc-g', 'omt-a', S1), row('a2', 'oc-g', 'omt-a', S2)]
    const d = deps(rows)
    await expect(carryArchivedTopics(d, { chatId: 'oc-g' }, S2)).resolves.toEqual({ movedTopics: 0, skippedTopics: [] })
    expect(d.rebuild).not.toHaveBeenCalled()
  })

  it('reports a topic that failed to move instead of dropping it', async () => {
    const d = deps([row('a', 'oc-g', 'omt-a', S1), row('b', 'oc-g', 'omt-b', S1)], ['b'])
    await expect(carryArchivedTopics(d, { chatId: 'oc-g' }, S2)).resolves.toEqual({
      movedTopics: 1,
      skippedTopics: ['入口仍有执行中或排队消息'],
    })
  })

  it.each([
    ['a topic endpoint', { chatId: 'oc-g', threadId: 'omt-a' }],
    ['a document endpoint', { chatId: 'doc:docx:D' }],
  ])('does nothing for %s', async (_label, endpoint) => {
    const d = deps([row('a', endpoint.chatId, 'omt-x', S1)])
    await expect(carryArchivedTopics(d, endpoint, S2)).resolves.toEqual({ movedTopics: 0, skippedTopics: [] })
    expect(d.rebuild).not.toHaveBeenCalled()
  })
})
