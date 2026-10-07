import { renderConsumedContent, type AdapterBlockFields } from './adapter-block.js'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { buildInitCommand, InitOptionsError, parseInitArgs } from './init-command.js'
import { checkManagedCli } from './manage-check.js'
import { parseManageInput, type ManageIntent } from './manage-input.js'
import type { SessionManagementPlan } from './session-management.js'
import { isAbsolute } from 'node:path'
import type { OfficialEntry } from './upstream-compat.js'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

function summarizeOutcome(outcome: any) {
  return { status: String(outcome?.status ?? 'unknown'), ...(typeof outcome?.target === 'string' ? { target: outcome.target } : {}), ...(typeof outcome?.activation === 'string' ? { activation: outcome.activation } : {}), ...(typeof outcome?.reason === 'string' ? { reason: outcome.reason } : {}) }
}

export type CommandMessage = { source: 'dsh-openspec' | 'user'; text: string }
export async function dispatchWorkflowCommand(input: {
  name: string
  body: string
  generation: string
  invocation: string
  telemetry: 'adapter-off' | 'official'
  updateCheck: 'enabled' | 'disabled'
  args: string
  send: (message: CommandMessage) => void | Promise<void>
  check?: () => Promise<void>
}) {
  await input.check?.()
  const fields: AdapterBlockFields = { generation: input.generation, invocation: input.invocation, telemetry: input.telemetry, updateCheck: input.updateCheck }
  await input.send({ source: 'dsh-openspec', text: renderConsumedContent(input.body, fields) })
  await input.send({ source: 'user', text: input.args })
}

export function registerWorkflowCommands(ctx: Context, input: {
  entries: OfficialEntry[]
  generation: string
  invocation: string
  telemetry: 'adapter-off' | 'official'
  updateCheck: 'enabled' | 'disabled'
  check?: () => Promise<void>
  consumeWorkflow?: (skillName: string, scope: object | undefined) => Promise<string | undefined>
  initInstruction: string
  manageInstruction: string
  managedVersion?: string
  pathVersion?: string | null
  checkCommand?: () => Promise<string>
  skillDiagnostics?: (caller: { cwd?: string; scope?: object }) => Promise<Array<{ name: string; source: string; provider: string }>>
  /** Version of `node` on the session Bash PATH (null when undeterminable). Never the Host process version. */
  checkBashNodeVersion?: (cwd: string | undefined) => Promise<string | null>
  hasOpenSpecDir?: (cwd: string) => Promise<boolean>
  /** Official init tool ids of the pinned release; absent in pure unit harnesses (falls back to the conservative set). */
  initToolIds?: () => Promise<string[]>
  prepareManagement?: (intent: ManageIntent, cwd: string) => Promise<SessionManagementPlan>
  onGeneration?: () => Promise<void>
  generationState?: () => Promise<{ id: string; invocation: string }>
  checkManagedVersion?: () => Promise<string | undefined>
  checkPathVersion?: () => Promise<string | null>
  recoveryState?: () => Promise<string>
}): () => void {
  const disposers: Array<() => void> = []
  const fields = (body: string) => renderConsumedContent(body, {
    generation: input.generation, invocation: input.invocation,
    telemetry: input.telemetry, updateCheck: input.updateCheck,
  })
  const send = async (agent: any, text: string) => agent.send({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'adapter', id: 'dsh-openspec' } }, { kind: 'next' }, false)
  const register = (definition: CommandDefinition) => disposers.push(ctx.commands.register(definition))
  for (const entry of input.entries) register({
    name: entry.commandName,
    description: `Official OpenSpec ${entry.workflowId} workflow`,
    input: { hint: 'Optional change name or workflow details' },
    recordInput: false,
    handler: async (invocation: any) => {
      try {
        await input.onGeneration?.()
        const consumed = await input.consumeWorkflow?.(entry.skillName, invocation.agent)
        if (input.consumeWorkflow && !consumed) return { kind: 'error', text: 'OpenSpec workflow is no longer selected.' }
        const generation = await input.generationState?.()
        const body = consumed ?? renderConsumedContent(entry.body, { generation: generation?.id ?? input.generation, invocation: generation?.invocation ?? input.invocation, telemetry: input.telemetry, updateCheck: input.updateCheck })
        await send(invocation.agent, body)
        if (invocation.rawInput !== '') invocation.agent.send({ role: 'user', content: [{ type: 'text', text: invocation.rawInput }], source: { kind: 'user' } }, { kind: 'next' }, false)
        return { kind: 'success', text: 'OpenSpec workflow submitted.' }
      } catch { return { kind: 'error', text: 'OpenSpec workflow could not be submitted.' } }
    },
  })
  register({
    name: 'openspec-init', description: 'Initialize OpenSpec in the current workspace', recordInput: false,
    // Advertise the grammar parseInitArgs accepts so clients keep the composer open for arguments.
    input: { hint: '[--tools <id>] [--profile core|custom] [--language <code>]' },
    handler: async (invocation: any) => {
      try {
        const cwd = invocation.agent?.session?.header?.cwd
        if (typeof cwd !== 'string' || !isAbsolute(cwd)) return { kind: 'error', text: 'OpenSpec init requires an absolute caller session cwd.' }
        // Validate every raw argument before any filesystem access or message submission.
        const parsed = parseInitArgs(typeof invocation.rawInput === 'string' ? invocation.rawInput : '')
        const allowedTools = input.initToolIds ? new Set(await input.initToolIds()) : undefined
        buildInitCommand({ cwd, ...parsed, ...(allowedTools ? { allowedTools } : {}) })
        const hasOpenSpecDir = input.hasOpenSpecDir ? await input.hasOpenSpecDir(cwd) : await access(join(cwd, 'openspec')).then(() => true).catch(() => false)
        // The current generation, not the registration-time snapshot, names the CLI the block will also name.
        const generation = await input.generationState?.()
        const command = buildInitCommand({ cwd, ...parsed, hasOpenSpecDir, ...(allowedTools ? { allowedTools } : {}), invocation: generation?.invocation ?? input.invocation })
        await send(invocation.agent, renderConsumedContent(`${input.initInstruction}\n\nRun this adapter-built command in the current workspace:\n${command}`, { generation: generation?.id ?? input.generation, invocation: generation?.invocation ?? input.invocation, telemetry: input.telemetry, updateCheck: input.updateCheck }))
        return { kind: 'success', text: 'OpenSpec init instructions submitted.' }
      } catch (error) {
        return { kind: 'error', text: error instanceof InitOptionsError ? `OpenSpec init rejected argument: ${error.argument}. Accepted: --tools <id>, --profile core|custom, --language <code>.` : 'OpenSpec init could not be prepared.' }
      }
    },
  })
  register({
    name: 'openspec-upgrade', description: 'Upgrade the managed official OpenSpec stack (adapter-defined)', recordInput: false,
    // Mirrors parseManageInput: empty input is a read-only check; every mutation needs the literal --approve.
    input: { hint: '[upgrade <X.Y.Z> | rollback <X.Y.Z> | refresh-project] [--approve]' },
    handler: async (invocation: any) => {
      try {
        const intent = parseManageInput(typeof invocation.rawInput === 'string' ? invocation.rawInput : '')
        let outcome: SessionManagementPlan | undefined
        if (intent.kind === 'invalid') return { kind: 'error', text: 'Usage: /openspec-upgrade [upgrade|rollback <X.Y.Z> | refresh-project] [--approve]' }
        if (intent.kind !== 'help') {
          const cwd = invocation.agent?.session?.header?.cwd
          if (!intent.approved) outcome = { status: 'blocked', reason: intent.kind === 'refresh-project' ? 'explicit-project-refresh-approval-required' : 'explicit-approval-required' }
          else if (typeof cwd !== 'string' || !isAbsolute(cwd)) outcome = { status: 'blocked', reason: 'caller-cwd-unavailable' }
          else if (!input.prepareManagement) outcome = { status: 'blocked', reason: 'transaction-support-unavailable' }
          else outcome = await input.prepareManagement(intent, cwd)
        }
        await input.onGeneration?.()
        const generation = await input.generationState?.()
        const actualVersion = await input.checkManagedVersion?.()
        const pathVersion = await input.checkPathVersion?.() ?? input.pathVersion ?? null
        const recovery = await input.recoveryState?.()
        const callerCwd = typeof invocation.agent?.session?.header?.cwd === 'string' ? invocation.agent.session.header.cwd : undefined
        const bashNode = input.checkBashNodeVersion ? await input.checkBashNodeVersion(callerCwd).catch(() => null) : null
        const diag = checkManagedCli({ pathVersion, managedVersion: actualVersion ?? input.managedVersion ?? input.generation, nodeVersion: bashNode, engine: '>=20.19.0', recovery })
        const winners = input.skillDiagnostics ? await input.skillDiagnostics({ ...(callerCwd ? { cwd: callerCwd } : {}), scope: invocation.agent }) : []
        const update = input.checkCommand ? await input.checkCommand() : 'update check is available on explicit request'
        const manageSkill = `${input.manageInstruction}\n\nAdapter check: ${JSON.stringify({ ...diag, skillWinners: winners, update, ...(outcome === undefined ? {} : { outcome: summarizeOutcome(outcome) }) })}\n\nUpgrade or rollback uses an exact stable version and requires explicit approval. Project refresh requires separate explicit approval. The helper operations are available only in a profile with recorded authoritative-source transaction support.`
        const execution = outcome?.status === 'ready' && outcome.command && outcome.workdir
          ? `\n\nRun this adapter-built command only through this session's Bash tool, with workdir=${JSON.stringify(outcome.workdir)}. Do not switch cwd, elevate policy, or retry a denied operation outside this session. Report the helper result; this handler has not executed it.\n${outcome.command}` : ''
        const manageContent = renderConsumedContent(manageSkill + execution, { generation: generation?.id ?? input.generation, invocation: generation?.invocation ?? input.invocation, telemetry: input.telemetry, updateCheck: input.updateCheck })
        await send(invocation.agent, manageContent)
        return { kind: 'success', text: 'OpenSpec management guidance submitted.' }
      }
      catch { return { kind: 'error', text: 'OpenSpec management guidance unavailable.' } }
    },
  })
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
