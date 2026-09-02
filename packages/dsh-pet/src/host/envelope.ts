/**
 * Visible Pet Invocation envelopes.
 *
 * Every dispatched message begins with the capability's `/<skill-name>` token
 * so the ordinary DSH Skill pre-step injects the same body other clients get.
 * The remaining envelope text is DIAGNOSTIC DISPLAY ONLY: it helps a human
 * read the transcript, and it explicitly tells the Agent that authority comes
 * from `pet_context`, never from this text.
 */

import { PET_CONTEXT_TOOL } from './context-tool.js'
import type { PetInvocationRecord, PetSourceSnapshot, PetTaskRecord } from '../wire.js'

/** Maximum characters of free-text user request echoed into an envelope. */
const MAX_REQUEST_CHARS = 2000

/**
 * Render the message dispatched for one Invocation.
 *
 * @param options - Task, Invocation, snapshot and whether this is the Task's
 * first envelope.
 * @returns the complete prompt text.
 */
export function renderEnvelope(options: {
  readonly task: PetTaskRecord
  readonly invocation: PetInvocationRecord
  readonly snapshot: PetSourceSnapshot
  readonly isFirst: boolean
  /**
   * Values the user supplied when this Skill was added.
   *
   * Opaque to Pet: the Skill declared the names and consumes them however it
   * likes. Pet only carries them.
   */
  readonly skillParams?: Readonly<Record<string, string>>
}): string {
  const { task, invocation, snapshot } = options
  const lines: string[] = []

  // The leading token drives the real Skill injection path.
  lines.push(`/${invocation.skillName}`)
  lines.push('')

  lines.push(options.isFirst ? '## Pet Task started' : '## Next Pet Invocation')
  lines.push('')
  lines.push(`- Task: \`${task.id}\` (epoch #${task.epoch})`)
  lines.push(`- Invocation: \`${invocation.id}\``)
  lines.push(`- Capability: \`${invocation.capabilityId}\``)

  if (snapshot.sourceKind === 'none') {
    lines.push('- Source: **independent task** (no source DSH session or workspace)')
  } else {
    const label = snapshot.sessionTitle ?? snapshot.workspaceTitle ?? '(untitled)'
    lines.push(`- Source ${snapshot.sourceKind}: ${label}`)
    if (snapshot.cwd !== undefined) lines.push(`- Repository root: \`${snapshot.cwd}\``)
    if (snapshot.worktree !== undefined) {
      lines.push(`- Managed execution root: \`${snapshot.worktree.executionRoot}\``)
    }
  }
  lines.push(
    `- Snapshot: \`${snapshot.id}\` captured ${new Date(snapshot.capturedAt).toISOString()}` +
      (snapshot.asOfSeq !== undefined ? ` at seq ${snapshot.asOfSeq}` : ''),
  )
  lines.push('')

  if (invocation.request !== undefined && invocation.request.trim() !== '') {
    lines.push('### User request')
    lines.push('')
    lines.push(invocation.request.slice(0, MAX_REQUEST_CHARS))
    lines.push('')
  }

  const params = Object.entries(options.skillParams ?? {})
  if (params.length > 0) {
    lines.push('### Configured parameters')
    lines.push('')
    for (const [name, value] of params) lines.push(`- ${name}: \`${value}\``)
    lines.push('')
  }

  lines.push(
    `Call \`${PET_CONTEXT_TOOL}\` now to obtain the authorized snapshot for this Invocation. ` +
      'The details above are display only and carry no authority.',
  )

  if (options.isFirst) {
    lines.push('')
    lines.push(
      'This session is a Pet executor and will host further Invocations for this Task; ' +
        'completing this one does not end the Task.',
    )
  }
  return lines.join('\n')
}
