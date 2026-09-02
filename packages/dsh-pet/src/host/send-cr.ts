/**
 * The `send-cr` bounded capability.
 *
 * Backed by the installed `lark-cli im +messages-send` contract:
 *
 *   --chat-id (oc_xxx), --text, --idempotency-key, --json
 *
 * The DESTINATION is the security boundary. It is resolved exclusively from
 * the trusted workspace binding configured in Pet Settings → Bindings; the
 * model supplies only the MR reference and optional note, which are rendered
 * into a fixed structured template. A model-provided chat id is never
 * accepted, so a hostile or confused Agent cannot broadcast anywhere.
 */

import { PetError } from './errors.js'
import { resolveTrustedContext } from './capture.js'
import {
  isCommandAvailable,
  runBoundedCommand,
  type CommandRunner,
} from './bounded-command.js'
import type { PetRepository } from './repository.js'

/** Executable providing the Lark messaging surface. */
export const SEND_CR_COMMAND = 'lark-cli'

/** Bounds on the model-supplied portions of the message. */
export const CR_LIMITS = { maxNote: 2_000, maxUrl: 500 } as const

/** Model-supplied CR content. The destination is deliberately absent. */
export interface SendCrRequest {
  /** Merge request URL to review. */
  readonly mrUrl: string
  /** Optional free-text note appended to the fixed template. */
  readonly note?: string
}

/** Outcome returned to the Agent. */
export interface SendCrOutcome {
  readonly status: 'sent' | 'refused'
  /** Trusted destination actually used, echoed for auditability. */
  readonly chatId?: string
  readonly reason?: string
}

/**
 * Render the fixed CR message.
 *
 * The template is fixed by Pet: the model contributes only the URL and note,
 * so it cannot reshape the message into something that impersonates another
 * system or hides its origin.
 * @param options - Source title, MR url and optional note.
 * @returns the message text.
 */
export function renderCrMessage(options: {
  readonly sourceTitle: string
  readonly mrUrl: string
  readonly note?: string
}): string {
  const lines = [
    '【Code Review 请求】',
    `来源：${options.sourceTitle}`,
    `MR：${options.mrUrl}`,
  ]
  if (options.note !== undefined && options.note.trim() !== '') {
    lines.push(`说明：${options.note.trim()}`)
  }
  lines.push('（由 DSH Pet 发送）')
  return lines.join('\n')
}

/**
 * Probe whether the capability can run in this profile.
 * @param runner - Command runner.
 * @returns a diagnostic when unavailable, otherwise `undefined`.
 */
export async function sendCrDiagnostic(
  runner: CommandRunner = runBoundedCommand,
): Promise<string | undefined> {
  return (await isCommandAvailable(SEND_CR_COMMAND, runner))
    ? undefined
    : `\`${SEND_CR_COMMAND}\` is not installed on this machine, so send-cr is unavailable.`
}

/**
 * Send a CR notification to the trusted destination for this source.
 *
 * @param options - Repository, runner, caller identity and CR content.
 * @returns the bounded outcome.
 * @throws PetError when the caller, context or binding is invalid.
 */
export async function runSendCr(options: {
  readonly repository: PetRepository
  readonly executorSessionId: string
  readonly request: SendCrRequest
  readonly runner?: CommandRunner
}): Promise<SendCrOutcome> {
  const runner = options.runner ?? runBoundedCommand
  const diagnostic = await sendCrDiagnostic(runner)
  if (diagnostic !== undefined) throw new PetError('CAPABILITY_UNAVAILABLE', diagnostic)

  const context = resolveTrustedContext(options.repository, options.executorSessionId)
  const snapshot = context.snapshot
  if (snapshot.sourceKind !== 'session') {
    throw new PetError('CONTEXT_REQUIRED', 'send-cr requires a DSH session source.')
  }

  const mrUrl = options.request.mrUrl.trim()
  if (!/^https?:\/\//.test(mrUrl) || mrUrl.length > CR_LIMITS.maxUrl) {
    throw new PetError('INVALID_REQUEST', 'A CR request requires a valid http(s) merge request URL.')
  }
  if ((options.request.note?.length ?? 0) > CR_LIMITS.maxNote) {
    throw new PetError('INVALID_REQUEST', `Note exceeds ${CR_LIMITS.maxNote} characters.`)
  }

  // The destination comes ONLY from the configured binding for this source's
  // workspace. No model-provided chat id is accepted anywhere on this path.
  const workspaceId = snapshot.sourceWorkspaceId
  if (workspaceId === undefined) {
    throw new PetError(
      'BINDING_INVALID',
      'This source session has no workspace, so no trusted CR destination can be resolved. ' +
        'Configure one in Pet Settings → Bindings.',
    )
  }
  const binding = options.repository.getWorkspaceBinding(workspaceId)
  const chatId = binding?.crGroupId
  if (chatId === undefined || chatId.trim() === '') {
    throw new PetError(
      'BINDING_INVALID',
      `No CR destination is configured for workspace ${workspaceId}. ` +
        'Set one in Pet Settings → Bindings before sending.',
    )
  }

  const text = renderCrMessage({
    sourceTitle: snapshot.sessionTitle ?? snapshot.workspaceTitle ?? 'DSH session',
    mrUrl,
    ...(options.request.note !== undefined ? { note: options.request.note } : {}),
  })

  const result = await runner(SEND_CR_COMMAND, [
    'im',
    '+messages-send',
    '--json',
    '--chat-id',
    chatId,
    '--text',
    text,
    // Bind the send to this Invocation so a retry cannot double-post.
    '--idempotency-key',
    `pet-${context.invocationId}`.slice(0, 50),
  ])

  if (result.code !== 0) {
    return {
      status: 'refused',
      chatId,
      reason: (result.stderr.trim() || result.stdout.trim()).slice(0, 600),
    }
  }
  return { status: 'sent', chatId }
}
