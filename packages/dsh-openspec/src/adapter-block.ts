import { ADAPTER_BLOCK_END, ADAPTER_BLOCK_START } from './upstream-compat.js'
import { managedInvocation } from './managed-invocation.js'

export type AdapterNotice = { installed: string; available: string; managementEntry: string }
export type AdapterBlockFields = {
  generation: string
  invocation: string
  telemetry: 'adapter-off' | 'official'
  updateCheck: 'enabled' | 'disabled'
  notice?: AdapterNotice
  recovery?: 'none' | 'recovery-required'
}

function canonicalVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : undefined
}

function readShellArgument(command: string, start: number): { value: string; end: number } {
  let index = start
  let result = ''
  if (command[index] === "'") {
    index++
    while (index < command.length) {
      if (command.slice(index, index + 4) === "'\\''") { result += "'"; index += 4; continue }
      if (command[index] === "'") return { value: result, end: index + 1 }
      result += command[index++]
    }
    throw new Error('block-unrenderable')
  }
  throw new Error('block-unrenderable')
}

function normalizeInvocation(input: AdapterBlockFields): string {
  const value = input.invocation
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('block-unrenderable')
  const prefix = 'env OPENSPEC_NO_UPDATE_CHECK=1 '
  if (!value.startsWith(prefix)) throw new Error('block-unrenderable')
  let index = prefix.length
  let telemetry: 'adapter-off' | 'official' = 'official'
  if (value.startsWith('OPENSPEC_TELEMETRY=0 ', index)) {
    telemetry = 'adapter-off'
    index += 'OPENSPEC_TELEMETRY=0 '.length
  }
  const node = readShellArgument(value, index)
  index = node.end
  if (value[index] !== ' ') throw new Error('block-unrenderable')
  const cli = readShellArgument(value, index + 1)
  if (cli.end !== value.length) throw new Error('block-unrenderable')
  if ((input.telemetry === 'adapter-off') !== (telemetry === 'adapter-off')) throw new Error('block-unrenderable')
  return managedInvocation({ node: node.value, cli: cli.value, telemetry: input.telemetry })
}

export function buildAdapterBlock(input: AdapterBlockFields): string {
  if (!/^[a-z0-9._-]+$/.test(input.generation)) throw new Error('block-unrenderable')
  const invocation = normalizeInvocation(input)
  const lines = [ADAPTER_BLOCK_START, `generation=${input.generation}`, `invocation=${invocation}`, `telemetry=${input.telemetry}`, `updateCheck=${input.updateCheck}`]
  if (input.notice) {
    const installed = canonicalVersion(input.notice.installed)
    const available = canonicalVersion(input.notice.available)
    if (installed && available && input.notice.managementEntry === 'dsh-openspec-manage') {
      lines.push(`notice.installed=${installed}`, `notice.available=${available}`, 'notice.managementEntry=dsh-openspec-manage')
    }
  }
  if (input.recovery) lines.push(`recovery=${input.recovery}`)
  lines.push(ADAPTER_BLOCK_END)
  return lines.join('\n')
}

const ALLOWED = new Set(['generation', 'invocation', 'telemetry', 'updateCheck', 'notice.installed', 'notice.available', 'notice.managementEntry', 'recovery'])
export function parseAdapterBlock(content: string): Partial<AdapterBlockFields> | null {
  const start = content.lastIndexOf(ADAPTER_BLOCK_START)
  if (start < 0 || !content.endsWith(ADAPTER_BLOCK_END)) return null
  const block = content.slice(start).split('\n')
  if (block[0] !== ADAPTER_BLOCK_START || block.at(-1) !== ADAPTER_BLOCK_END) return null
  const fields: Record<string, string> = {}
  for (const line of block.slice(1, -1)) {
    const eq = line.indexOf('=')
    if (eq < 1 || !ALLOWED.has(line.slice(0, eq)) || fields[line.slice(0, eq)] !== undefined) return null
    fields[line.slice(0, eq)] = line.slice(eq + 1)
  }
  if (!/^[a-z0-9._-]+$/.test(fields.generation ?? '') || !fields.invocation || !['adapter-off', 'official'].includes(fields.telemetry) || !['enabled', 'disabled'].includes(fields.updateCheck)) return null
  return fields as Partial<AdapterBlockFields>
}

export function renderConsumedContent(body: string, fields: AdapterBlockFields): string {
  if (body.includes(ADAPTER_BLOCK_START) || body.includes(ADAPTER_BLOCK_END) || body.includes('</skill_content>') || body.includes('</skill_instructions>')) throw new Error('upstream-incompatible')
  return `${body.trimEnd()}\n\n${buildAdapterBlock(fields)}`
}
