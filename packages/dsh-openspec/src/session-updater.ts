import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { readSourceCheckout, isWorktreeCheckout } from './source-record.js'
import { loadGeneration, recoverGeneration } from './generations.js'
import { createUpgradeTransaction } from './upgrade-transaction.js'
import { stageTarget, type StagedTarget } from './stage-target.js'
import { officialStageDependencies } from './stage-official.js'
import { validStableTarget } from './upgrade-version.js'
import { parseManageInput } from './manage-input.js'

export type SessionUpdateRequest = { home: string; cwd: string; kind: 'upgrade' | 'rollback' | 'refresh-project'; approved: boolean; target?: string; telemetry?: 'adapter-off' | 'official' }
export type SessionUpdaterDependencies = {
  stage(checkout: string, target: string): Promise<StagedTarget>
  sync(checkout: string, home: string): Promise<boolean>
  refresh(cli: string, cwd: string, telemetry: 'adapter-off' | 'official'): Promise<boolean>
}
const defaults: SessionUpdaterDependencies = {
  stage: (checkout, target) => stageTarget(checkout, target, officialStageDependencies(checkout)),
  sync: async (checkout, home) => spawnSync(process.execPath, [join(checkout, 'scripts/sync.mjs')], {
    cwd: checkout, timeout: 120_000, stdio: 'inherit', env: { ...process.env, DSH_HOME: home },
  }).status === 0,
  refresh: async (cli, cwd, telemetry) => spawnSync(process.execPath, [cli, 'update'], {
    cwd, timeout: 120_000, stdio: 'inherit', env: { ...process.env, OPENSPEC_NO_UPDATE_CHECK: '1', ...(telemetry === 'adapter-off' ? { OPENSPEC_TELEMETRY: '0' } : {}) },
  }).status === 0,
}

/** Only invoked by a session Bash child (never by the Host); OS/sandbox/Worktree policy remains in force. */
export async function runSessionManagement(input: SessionUpdateRequest, deps: SessionUpdaterDependencies = defaults) {
  if (!input.approved) return { status: 'blocked', reason: input.kind === 'refresh-project' ? 'explicit-project-refresh-approval-required' : 'explicit-approval-required' }
  if (!isAbsolute(input.cwd) || !isAbsolute(input.home)) return { status: 'blocked', reason: 'caller-cwd-unavailable' }
  try {
    if (input.kind === 'refresh-project') {
      const generation = await loadGeneration(input.home)
      const root = await realpath(join(input.home, 'plugins/dsh-openspec/generations', generation.id))
      const cli = typeof generation.cli === 'string' ? await realpath(generation.cli) : undefined
      if (!cli || relative(root, cli).startsWith('..') || isAbsolute(relative(root, cli))) return { status: 'blocked', reason: 'generation-invalid' }
      return await deps.refresh(cli, input.cwd, input.telemetry ?? 'adapter-off') ? { status: 'ok' } : { status: 'failed', reason: 'project-refresh-failed' }
    }
    if (!input.target || !validStableTarget(input.target)) return { status: 'blocked', reason: 'invalid-stable-version' }
    if (process.env.DSH_WORKTREE_SESSION) return { status: 'blocked', reason: 'worktree-bound' }
    const stateDir = join(input.home, 'plugins/dsh-openspec')
    const recorded = await readSourceCheckout(stateDir)
    const caller = await realpath(input.cwd).catch(() => undefined)
    const checkout = recorded ? await realpath(recorded).catch(() => undefined) : undefined
    if (!checkout || caller !== checkout) return { status: 'blocked', reason: 'non-recorded-checkout' }
    if (await isWorktreeCheckout(checkout)) return { status: 'blocked', reason: 'worktree-bound' }
    const selected = await loadGeneration(input.home)
    const sourcePackage = JSON.parse(await readFile(join(checkout, 'packages/dsh-openspec/package.json'), 'utf8'))
    const transaction = createUpgradeTransaction({
      checkout, recordedCheckout: checkout, stateDir, isWorktreeBound: false,
      stage: target => deps.stage(checkout, target),
      verify: async staged => staged.integrity.startsWith('sha512-'),
      runSync: () => deps.sync(checkout, input.home),
      // No reload or active switch in this helper. Existing loaded bodies retain their generation until Host restart.
      activate: async () => ({ activation: 'pending-reload' }),
    })
    const recovery = await recoverGeneration(input.home)
    if (recovery.state === 'recovery-required') {
      if (input.kind !== 'rollback' || input.target !== recovery.journal?.previousVersion) return { status: 'blocked', reason: 'recovery-required' }
      return transaction.recoverRollback({ approved: true })
    }
    if (selected.version !== sourcePackage.dependencies?.['@fission-ai/openspec']) return { status: 'blocked', reason: 'selected-source-mismatch' }
    const result = await transaction[input.kind](input.target, { approved: true })
    return result.status === 'failed' ? { status: 'failed', reason: 'session-updater-failed' } : result
  } catch {
    // Never persist/report raw error strings from a child process, source or registry response.
    return { status: 'failed', reason: 'session-updater-failed' }
  }
}

export async function sessionUpdaterMain(args: string[], cwd = process.cwd()) {
  if (args[0] !== '--home' || !args[1] || !isAbsolute(args[1])) return { status: 'blocked', reason: 'invalid-management-input' }
  let actionArgs = args.slice(2)
  let telemetry: 'adapter-off' | 'official' = 'adapter-off'
  const modeIndex = actionArgs.indexOf('--telemetry')
  if (modeIndex >= 0) {
    const mode = actionArgs[modeIndex + 1]
    if (modeIndex !== actionArgs.length - 2 || (mode !== 'official' && mode !== 'adapter-off')) return { status: 'blocked', reason: 'invalid-management-input' }
    telemetry = mode
    actionArgs = actionArgs.slice(0, modeIndex)
  }
  const intent = parseManageInput(actionArgs.join(' '))
  if (intent.kind === 'help' || intent.kind === 'invalid') return { status: 'blocked', reason: 'invalid-management-input' }
  return runSessionManagement({ home: args[1], cwd, kind: intent.kind, approved: intent.approved, telemetry, ...(intent.kind === 'refresh-project' ? {} : { target: intent.target }) })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await sessionUpdaterMain(process.argv.slice(2))
  console.log(JSON.stringify(outcome))
  process.exitCode = outcome.status === 'ok' ? 0 : 1
}
