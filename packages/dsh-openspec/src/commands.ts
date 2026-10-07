import { renderConsumedContent, type AdapterBlockFields } from './adapter-block.js'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { buildInitCommand } from './init-command.js'
import { checkManagedCli } from './manage-check.js'
import { parseManageInput } from './manage-input.js'
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
  skillDiagnostics?: () => Promise<Array<{ name: string; source: string; provider: string }>>
  hasOpenSpecDir?: (cwd: string) => Promise<boolean>
  management?: { upgrade(target: string, consent: { approved: boolean }): Promise<any>; rollback(target: string, consent: { approved: boolean }): Promise<any>; refreshProject(consent: { approved: boolean }): Promise<any> }
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
    handler: async (invocation: any) => {
      try {
        const cwd = invocation.agent.cwd ?? process.cwd()
        const hasOpenSpecDir = input.hasOpenSpecDir ? await input.hasOpenSpecDir(cwd) : await access(join(cwd, 'openspec')).then(() => true).catch(() => false)
        const command = buildInitCommand({ cwd, hasOpenSpecDir })
        await send(invocation.agent, fields(`${input.initInstruction}\n\nRun this adapter-built command in the current workspace:\n${command}`))
        return { kind: 'success', text: 'OpenSpec init instructions submitted.' }
      } catch { return { kind: 'error', text: 'OpenSpec init options were invalid.' } }
    },
  })
  register({
    name: 'dsh-openspec-manage', description: 'Manage the DSH OpenSpec adapter', recordInput: false,
    handler: async (invocation: any) => {
      try {
        const intent = parseManageInput(typeof invocation.rawInput === 'string' ? invocation.rawInput : '')
        let outcome: unknown
        if (intent.kind === 'invalid') return { kind: 'error', text: 'Usage: /dsh-openspec-manage [upgrade|rollback <X.Y.Z> | refresh-project] [--approve]' }
        if (intent.kind !== 'help') {
          if (!input.management) outcome = { status: 'blocked', reason: 'transaction-support-unavailable' }
          else if (intent.kind === 'refresh-project') outcome = await input.management.refreshProject({ approved: intent.approved })
          else outcome = await input.management[intent.kind](intent.target, { approved: intent.approved })
        }
        await input.onGeneration?.()
        const generation = await input.generationState?.()
        const actualVersion = await input.checkManagedVersion?.()
        const pathVersion = await input.checkPathVersion?.() ?? input.pathVersion ?? null
        const recovery = await input.recoveryState?.()
        const diag = checkManagedCli({ pathVersion, managedVersion: actualVersion ?? input.managedVersion ?? input.generation, nodeVersion: process.versions.node, engine: '>=20.19.0', recovery })
        const winners = input.skillDiagnostics ? await input.skillDiagnostics() : []
        const update = input.checkCommand ? await input.checkCommand() : 'update check is available on explicit request'
        const manageSkill = `${input.manageInstruction}\n\nAdapter check: ${JSON.stringify({ ...diag, skillWinners: winners, update, ...(outcome === undefined ? {} : { outcome: summarizeOutcome(outcome) }) })}\n\nUpgrade or rollback uses an exact stable version and requires explicit approval. Project refresh requires separate explicit approval. The helper operations are available only in a profile with recorded authoritative-source transaction support.`
        const manageContent = renderConsumedContent(manageSkill, { generation: generation?.id ?? input.generation, invocation: generation?.invocation ?? input.invocation, telemetry: input.telemetry, updateCheck: input.updateCheck })
        await send(invocation.agent, manageContent)
        return { kind: 'success', text: 'OpenSpec management guidance submitted.' }
      }
      catch { return { kind: 'error', text: 'OpenSpec management guidance unavailable.' } }
    },
  })
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
