/**
 * Produced-file extraction from the conversation snapshot's tool-result
 * nodes. Mirrors the official ui-deliverables vocabulary: a produced file is
 * the mutation tools' declared follow-along `locations` (render intent:
 * the `diff` card, or the `generic` card whose kind is `edit`) — never the
 * closing prose. Reads contribute nothing, neither do deletes, and failed
 * calls contribute nothing.
 */
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProducedFile } from '../shared/produced.js'

export type { ProducedFile } from '../shared/produced.js'

/** Collect the produced files of one tool-result node ([] for non-mutations/failures). */
export function producedFromNode(node: ToolResultNode): ProducedFile[] {
  if (node.isError || node.call === null) return []
  const view = node.callView
  if (view === null) return []
  let locations: readonly { path: string; line?: number }[]
  if (view.card === 'diff') {
    locations = view.locations ?? []
  } else if (view.card === 'generic' && view.kind === 'edit') {
    locations = view.locations ?? []
  } else {
    return []
  }
  return locations.map((location) => ({ path: location.path, time: node.time, seq: node.seq }))
}

export { compareProduced } from '../shared/produced.js'