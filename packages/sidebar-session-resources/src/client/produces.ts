/** Successful first-party mutations from transcript tool-result nodes. */
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ProducedFile } from '../shared/produced.js'
import { mutationPathOfCall } from '../shared/mutations.js'

export type { ProducedFile } from '../shared/produced.js'
export { mutationPathOfCall } from '../shared/mutations.js'

/** Reads, deletes and failed calls contribute no produced files. */
export function producedFromNode(node: ToolResultNode): ProducedFile[] {
  if (node.isError || node.call === null) return []
  const path = mutationPathOfCall(node.call.name, node.call.argsRaw)
  if (path === null) return []
  return [{ path, time: node.time, seq: node.seq }]
}

export { compareProduced } from '../shared/produced.js'
