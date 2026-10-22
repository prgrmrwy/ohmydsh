/**
 * Carry a group's old topics off an archived main onto the group's new main.
 *
 * After a group-level `/bind` moves the group, its old topics still point at
 * the archived main and keep answering "stopped". Only these are moved:
 * topics of THIS chat, whose own recorded main is archived, still the current
 * generation of their endpoint, not owner-stopped, and not already on the
 * target. Nothing in another chat or document is touched, and a topic whose
 * main is still serving is left alone (that would be binding drift).
 * `rebuild` (the controller's rebuildExplicit) re-proves the archive fact.
 */

interface TopicRow {
  readonly id: string
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly parentSessionId: string
  readonly state: string
}

export interface CarryTopicsDeps {
  listLoci(): readonly TopicRow[]
  latestIdOf(endpoint: TopicRow['endpoint']): string | undefined
  isArchived(sessionId: string): boolean
  rebuild(input: {
    readonly endpoint: TopicRow['endpoint']
    readonly previousLocusId: string
    readonly parentSessionId: string
    readonly replaceArchivedParent: true
  }): Promise<unknown>
}

export interface CarriedTopics {
  readonly movedTopics: number
  readonly skippedTopics: readonly string[]
}

export async function carryArchivedTopics(
  deps: CarryTopicsDeps,
  group: { readonly chatId: string; readonly threadId?: string },
  parentSessionId: string,
): Promise<CarriedTopics> {
  if (group.threadId !== undefined || group.chatId.startsWith('doc:')) {
    return { movedTopics: 0, skippedTopics: [] }
  }
  const topics = deps.listLoci().filter(row =>
    row.endpoint.chatId === group.chatId
    && row.endpoint.threadId !== undefined
    && row.state === 'active'
    && row.parentSessionId !== parentSessionId
    && deps.isArchived(row.parentSessionId)
    && deps.latestIdOf(row.endpoint) === row.id)
  let movedTopics = 0
  const skippedTopics: string[] = []
  for (const topic of topics) {
    try {
      await deps.rebuild({
        endpoint: topic.endpoint,
        previousLocusId: topic.id,
        parentSessionId,
        replaceArchivedParent: true,
      })
      movedTopics += 1
    } catch (error) {
      skippedTopics.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { movedTopics, skippedTopics }
}
