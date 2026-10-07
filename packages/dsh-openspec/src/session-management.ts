import type { ManageIntent } from './manage-input.js'
import { isAbsolute, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { quotePosixArgument } from './managed-invocation.js'
import { readSourceCheckout, isWorktreeCheckout } from './source-record.js'
import { validStableTarget } from './upgrade-version.js'

export type SessionManagementInput = { home: string; cwd: string; node: string; updater: string; intent: ManageIntent; telemetry?: 'adapter-off' | 'official' }
export type SessionManagementPlan = { status: 'ready' | 'blocked'; reason?: string; command?: string; workdir?: string }

/** Read-only planning. The Host never executes this command or elevates session policy. */
export async function prepareSessionManagement(input: SessionManagementInput): Promise<SessionManagementPlan> {
  const { intent } = input
  if (intent.kind === 'help' || intent.kind === 'invalid') return { status: 'blocked', reason: 'invalid-management-action' }
  if (!intent.approved) return { status: 'blocked', reason: intent.kind === 'refresh-project' ? 'explicit-project-refresh-approval-required' : 'explicit-approval-required' }
  if (!isAbsolute(input.cwd) || !isAbsolute(input.home)) return { status: 'blocked', reason: 'caller-cwd-unavailable' }
  if (intent.kind !== 'refresh-project') {
    if (!validStableTarget(intent.target)) return { status: 'blocked', reason: 'invalid-stable-version' }
    const recorded = await readSourceCheckout(join(input.home, 'plugins/dsh-openspec'))
    if (!recorded) return { status: 'blocked', reason: 'non-recorded-checkout' }
    const caller = await realpath(input.cwd).catch(() => undefined)
    const source = await realpath(recorded).catch(() => undefined)
    if (!caller || caller !== source) return { status: 'blocked', reason: 'non-recorded-checkout' }
    if (await isWorktreeCheckout(caller)) return { status: 'blocked', reason: 'worktree-bound' }
  }
  // quotePosixArgument intentionally accepts only absolute paths. Verbs/flags are fixed literals;
  // the target passed the stable-version grammar above, so none can contain shell syntax.
  const command = `${quotePosixArgument(input.node)} ${quotePosixArgument(input.updater)} --home ${quotePosixArgument(input.home)} ${intent.kind}${intent.kind === 'refresh-project' ? '' : ` ${intent.target}`} --approve --telemetry ${input.telemetry === 'official' ? 'official' : 'adapter-off'}`
  return { status: 'ready', command, workdir: input.cwd }
}
