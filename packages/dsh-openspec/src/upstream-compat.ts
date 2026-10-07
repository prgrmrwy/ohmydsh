import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

export type OfficialSelection = { workflowId: string; all?: boolean; workflowIds?: string[]; profile?: 'core' | 'custom' | string; delivery?: string }
export type OfficialEntry = { workflowId: string; skillName: string; commandName: string; body: string }
export const ADAPTER_BLOCK_START = '<!-- dsh-openspec-adapter:block-format=1 -->'
export const ADAPTER_BLOCK_END = '<!-- /dsh-openspec-adapter -->'

export class UpstreamIncompatibleError extends Error {
  readonly code = 'upstream-incompatible'
  constructor(message: string) { super(message); this.name = 'UpstreamIncompatibleError' }
}

export const WORKFLOWS = ['propose', 'explore', 'new', 'continue', 'apply', 'update', 'ff', 'sync', 'archive', 'bulk-archive', 'verify', 'onboard'] as const
const require = createRequire(import.meta.url)
const packageEntryPath = require.resolve('@fission-ai/openspec')
const packageRoot = dirname(dirname(packageEntryPath))
const packageJsonPath = join(packageRoot, 'package.json')
const importInternal = (relativePath: string) => import(pathToFileURL(join(packageRoot, relativePath)).href)

type UpstreamApi = { getSkillTemplates: (ids?: string[]) => any[]; generateSkillContent: (template: any, version: string, transform?: (body: string) => string) => string; version: string; getProfileWorkflows?: (profile: string, custom?: string[]) => string[] }
let apiPromise: Promise<UpstreamApi> | undefined
async function api() {
  apiPromise ??= Promise.all([importInternal('dist/core/shared/skill-generation.js'), importInternal('dist/core/profiles.js')]).then(([generation, profiles]: any[]) => ({
    ...generation,
    ...profiles,
    version: JSON.parse(readFileSync(packageJsonPath, 'utf8')).version,
  }))
  return apiPromise
}

function transformDshReferences(body: string): string {
  return body.replace(/\/opsx:([a-z][a-z0-9-]*)/g, (_match, workflow: string) => `/opsx-${workflow}`)
}

export async function renderOfficialBody(selection: OfficialSelection): Promise<string> {
  if (!WORKFLOWS.includes(selection.workflowId as (typeof WORKFLOWS)[number])) throw new UpstreamIncompatibleError(`unmapped workflow ${selection.workflowId}`)
  const upstream = await api()
  const entries = upstream.getSkillTemplates(selection.workflowIds ?? (selection.all ? [...WORKFLOWS] : undefined))
  const entry = entries.find((candidate: any) => candidate.workflowId === selection.workflowId)
  if (!entry) throw new UpstreamIncompatibleError(`workflow is not selected: ${selection.workflowId}`)
  const generated = upstream.generateSkillContent(entry.template, upstream.version, transformDshReferences)
  const body = generated.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, '').trim()
  if (!body) throw new UpstreamIncompatibleError(`empty body for ${selection.workflowId}`)
  return body
}

export async function resolveEffectiveSelection(input: { configPath?: string; profile?: string; workflows?: string[]; delivery?: string } = {}): Promise<{ workflows: string[]; delivery: string; fingerprint: string }> {
  const path = input.configPath ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'openspec/config.json')
  let config: any = {}
  try { config = JSON.parse(await readFile(path, 'utf8')) } catch { config = {} }
  const upstream = await api()
  const profile = input.profile ?? config.profile ?? 'core'
  const custom = input.workflows ?? config.workflows
  const selected = upstream.getProfileWorkflows?.(profile, custom) ?? (profile === 'custom' ? (custom ?? []) : ['propose', 'explore', 'apply', 'update', 'sync', 'archive'])
  const delivery = input.delivery ?? config.delivery ?? 'both'
  if (!['both', 'skills', 'commands'].includes(delivery)) throw new UpstreamIncompatibleError('invalid official delivery mode')
  const fingerprint = createHash('sha256').update(JSON.stringify({ profile, selected, delivery })).digest('hex')
  return { workflows: selected, delivery, fingerprint }
}

export async function prepareCatalog(selection: { all?: boolean; activeGeneration?: unknown; customNames?: string[]; workflowIds?: string[]; delivery?: string } = {}): Promise<OfficialEntry[]> {
  const upstream = await api()
  const requested = selection.workflowIds ?? (selection.all ? [...WORKFLOWS] : undefined)
  const entries = upstream.getSkillTemplates(requested)
  const delivery = selection.delivery ?? 'both'
  const customNames = new Set(selection.customNames ?? ['openspec-init', 'openspec-upgrade'])
  const result: OfficialEntry[] = []
  for (const entry of entries) {
    const workflowId = entry.workflowId
    if (!WORKFLOWS.includes(workflowId)) throw new UpstreamIncompatibleError(`unmapped workflow ${workflowId}`)
    const skillName = entry.dirName
    const commandName = `opsx-${workflowId}`
    if (customNames.has(skillName) || customNames.has(commandName)) throw new UpstreamIncompatibleError(`upstream surface collides with custom name ${skillName}/${commandName}`)
    const body = await renderOfficialBody({ workflowId, all: selection.all, workflowIds: requested, delivery })
    if (body.split(/\r?\n/).some((line) => line === ADAPTER_BLOCK_START || line === ADAPTER_BLOCK_END) || body.includes('</skill_instructions>') || body.includes('</skill_content>')) {
      throw new UpstreamIncompatibleError(`unsafe marker or loader frame in ${workflowId}`)
    }
    result.push({ workflowId, skillName, commandName, body })
  }
  return result
}

export const getOfficialCatalog = prepareCatalog
