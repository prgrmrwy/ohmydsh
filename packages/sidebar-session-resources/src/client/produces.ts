/**
 * Produced-file extraction from the conversation transcript's tool-result
 * nodes. Mirrors the official ui-deliverables vocabulary: a produced file is
 * a successful first-party mutation call's declared path (`write`, `edit`,
 * mutating `str_replace_editor`) — never the closing prose. Reads contribute
 * nothing, neither do deletes, and failed calls contribute nothing.
 *
 * 0.1.2 note: transcript nodes no longer carry the host-computed `callView`
 * render intent, so the mutation test reads the node's own call head
 * (`name` + `argsRaw`) with the same vocabulary the official 0.1.2
 * deliverables Definition uses (`turn-deliverables.js` mutationPath). The
 * documented semantic — "mirror the official deliverables vocabulary" — is
 * unchanged; only the official vocabulary's carrier moved.
 */
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ProducedFile } from '../shared/produced.js'

export type { ProducedFile } from '../shared/produced.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Validate the fields that an `edit` execution requires (official vocabulary). */
function validEditArgs(args: Record<string, unknown>): boolean {
  return typeof args.old_string === 'string' && args.old_string.length > 0
    && typeof args.new_string === 'string' && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Record<string, unknown>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string' && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string') ? path : null
    case 'insert':
      return typeof args.insert_line === 'number' && Number.isInteger(args.insert_line)
        && args.insert_line >= 0 && typeof args.new_str === 'string' ? path : null
    default:
      return null
  }
}

/** The path of a supported first-party mutation call, or null otherwise. */
export function mutationPathOfCall(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = argsRaw === '' ? {} : JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}

/** Collect the produced files of one tool-result node ([] for non-mutations/failures). */
export function producedFromNode(node: ToolResultNode): ProducedFile[] {
  if (node.isError || node.call === null) return []
  const path = mutationPathOfCall(node.call.name, node.call.argsRaw)
  if (path === null) return []
  return [{ path, time: node.time, seq: node.seq }]
}

export { compareProduced } from '../shared/produced.js'
