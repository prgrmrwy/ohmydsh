/**
 * Proof that a Locus child's tool ceiling survives DSH 0.2.1, which dropped the
 * request-level `toolFilter` of a subagent start and IGNORES it silently.
 *
 * Everything below runs on the OFFICIAL runtime (real AgentLoop, SubagentRuntime,
 * PresetRegistry, ToolRuntime, jsonl persistence, `@deepseek-ai/dsh-tool-fs`),
 * and reads the one observation that cannot lie: the `tools` list the model
 * request actually carried (what `request/header` records). Only the unrelated
 * plugins' tools are stand-ins, registered in the GLOBAL layer like a real
 * Host plugin would.
 *
 * What it pins:
 * - a child started with `agentPreset: 'locus-child'` has no `write`/`edit`
 *   because the preset's tool-fs row (read from the real preset file) is
 *   read-only — the same runtime with the `locus-base` row would register them;
 * - global-layer tools a preset cannot hide are removed by Pet's own allow list
 *   (`applyLocusInheritedToolCeiling`), and without it they would reach the
 *   model — the control that shows why that half is load-bearing;
 * - safe tier request == old safe set, shell tier request == old shell set;
 * - after the child is released and cold-resumed, the persisted selection
 *   mounts the SAME preset again and the request surface is unchanged.
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Query from '@deepseek-ai/dsh-session-query'
import Agents from '@deepseek-ai/dsh-agent'
import Llm, { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Projections from '@deepseek-ai/dsh-session-projection'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import PresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyLocusInheritedToolCeiling,
  createLocusChildAdapter,
  probeLocusChildPorts,
} from '../src/host/locus/child.js'
import {
  attestLocusComposition,
  LOCUS_SAFE_TOOL_NAMES,
  LOCUS_SHELL_TIER_TOOL_NAMES,
} from '../src/host/locus/composition.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from '../src/host/locus/preset.js'

const REPO = nodePath.resolve(import.meta.dirname, '../../..')

/** What the pre-0.2.1 runtime exposed to a child before the tier layer: filter ∩ preset. */
const OLD_SAFE = [...LOCUS_SAFE_TOOL_NAMES].sort()
const OLD_SHELL = [...OLD_SAFE, ...LOCUS_SHELL_TIER_TOOL_NAMES].sort()

/** The `tool-fs` row config of a real preset file (the only part of it this graph can load). */
async function presetFsConfig(presetId: string): Promise<Record<string, unknown>> {
  const source = await readFile(nodePath.join(REPO, 'presets', presetId, 'agent.cordis.yml'), 'utf8')
  const row = source.split(/^- id: /m).find(block => block.startsWith('tool-fs\n'))
  expect(row, `${presetId} has a tool-fs row`).toBeDefined()
  const config: Record<string, unknown> = {}
  const section = row!.split(/^  config:\n/m)[1]
  for (const line of (section ?? '').split('\n')) {
    const match = line.match(/^    (\w+): (true|false)\s*$/)
    if (match === null) break
    config[match[1]!] = match[2] === 'true'
  }
  return config
}

function stub(name: string) {
  return defineTool({
    name,
    description: 'Synthetic probe.',
    parameters: {},
    output: { schema: { type: 'boolean' }, render: () => [{ type: 'text' as const, text: 'ok' }] },
    async execute() { return true },
  })
}

/** The model requests the runtime actually built, in order. */
class RecordingAdapter extends LlmAdapter {
  /** `tools` is what the request carried; `transcript` tells whose request it is. */
  readonly requests: { readonly tools: string[]; readonly transcript: string }[] = []
  /** Requests for the child prompts only (the parent wakes on the settlement notice and asks too). */
  forPrompt(text: string): { readonly tools: string[] }[] {
    return this.requests.filter(request => request.transcript.includes(`"text":"${text}"`) && !request.transcript.includes('Background subagent'))
  }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push({ tools: (options.tools ?? []).map(tool => tool.name).sort(), transcript: JSON.stringify(options.messages ?? []) })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('locus child tool ceiling on the official 0.2.1 runtime', () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  async function world(options: { readonly hostCeiling: boolean; readonly tier: () => 'safe' | 'shell' }) {
    const ctx = new Context()
    const cwd = mkdtempSync(nodePath.join(realpathSync(tmpdir()), 'locus-child-preset-'))
    const root = mkdtempSync(nodePath.join(realpathSync(tmpdir()), 'locus-child-preset-log-'))
    mkdirSync(cwd, { recursive: true })
    cleanups.push(async () => {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    })
    await ctx.plugin(Llm)
    await ctx.plugin(Sessions)
    await ctx.plugin(Persistence, { root })
    await ctx.plugin(Query)
    await ctx.plugin(Prompt, { persona: '' })
    await ctx.plugin(Tools)
    await ctx.plugin(Agents)
    await ctx.plugin(Projections)
    await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(FsLocal, { cwd })
    await ctx.plugin(WorkingDirectory, { defaultDirectory: cwd })
    await ctx.plugin(Subagents)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(Loader)
    await ctx.plugin(AgentDefaultModel, { provider: 'fake', model: 'text', reasoningEffort: undefined })
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['fake'], adapter)

    // Other plugins' tools, registered where a Host plugin registers them: the
    // GLOBAL layer, which no preset can leave out.
    for (const name of ['memex_recall', 'collab_read']) ctx.tools.register(stub(name))

    // `read_image` is registered only while an attachment store is mounted. The
    // tool is never executed here, so a registration-only stand-in is enough.
    ctx.provide('attachments', { imageLimits: { mediaTypes: [], maxImageBytes: 0, maxMessageImageBytes: 0 } } as never)
    ctx.loader.builtins['locus-fs'] = ToolFs as never
    ctx.loader.builtins['locus-others'] = {
      name: 'locus-others',
      inject: ['tools'],
      apply(inner: Context) { for (const name of ['bash', 'skill', 'glob', 'grep', 'web_search']) inner.tools.register(stub(name)) },
    } as never
    await ctx.plugin(PresetRegistry, { default: LOCUS_BASE_PRESET })
    await ctx.agentPresets.register({
      id: LOCUS_BASE_PRESET,
      plugins: [
        { name: 'cordis:locus-fs', config: await presetFsConfig(LOCUS_BASE_PRESET) },
        { name: 'cordis:locus-others' },
      ],
    })
    await ctx.agentPresets.register({
      id: LOCUS_CHILD_PRESET,
      plugins: [
        { name: 'cordis:locus-fs', config: await presetFsConfig(LOCUS_CHILD_PRESET) },
        { name: 'cordis:locus-others' },
      ],
    })

    // The Host boundary Pet owns, on every publication of a locus child:
    // the inherited-tool ceiling (the function index.ts calls) and the tier layer.
    const children = new Set<string>()
    const claimKinds: { id: string; kind: string | undefined }[] = []
    ctx.on('agent/inbox/claimed', event => { claimKinds.push({ id: event.agent.id, kind: event.message.source?.kind }) })
    const published: { id: string; source: string; names: string[]; preset: string | undefined; headerPreset: string | undefined }[] = []
    const tierLayers = new WeakMap<object, () => void>()
    ctx.on('agent/created', ({ agent, source }) => {
      if (!children.has(agent.id)) return
      if (options.hostCeiling) applyLocusInheritedToolCeiling(agent.ctx.tools as never)
      const tools = agent.ctx.tools as unknown as { restrict(filter: { deny: readonly string[] }): () => void }
      if (options.tier() === 'safe') tierLayers.set(agent, tools.restrict({ deny: LOCUS_SHELL_TIER_TOOL_NAMES }))
      // What Pet's publication readback sees at this exact boundary.
      published.push({
        id: agent.id,
        source: String(source),
        names: ctx.tools.schemas(agent).map(schema => schema.name),
        preset: ctx.agentPresets.composedPreset(agent.ctx),
        headerPreset: agent.session.header.agentPreset,
      })
    })

    const parentId = SessionId('locus-main')
    const parentHandle = await ctx.agents.create({
      sessionId: parentId,
      meta: { cwd, agentPreset: LOCUS_BASE_PRESET },
      agentOptions: { provider: 'fake', model: 'text' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, LOCUS_BASE_PRESET) },
    })
    cleanups.push(async () => { await parentHandle.dispose?.() })
    const logs: string[] = []
    const probe = probeLocusChildPorts(ctx as never)
    if (!probe.available) throw new Error(`locus child ports unavailable: ${probe.diagnostic}`)
    const adapterPort = createLocusChildAdapter({ ...probe.ports, log: message => { logs.push(message) } })
    return { ctx, adapter, logs, published, claimKinds, children, parentId, parent: parentHandle.agent, ports: probe.ports, adapterPort }
  }

  async function settle(adapter: RecordingAdapter, prompt: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (adapter.forPrompt(prompt).length < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    if (adapter.forPrompt(prompt).length < 1) throw new Error(`no model request for ${prompt}`)
  }

  it('the preset files differ only in the tool-fs row, and the child row is read-only', async () => {
    expect(await presetFsConfig(LOCUS_BASE_PRESET)).toEqual({})
    expect(await presetFsConfig(LOCUS_CHILD_PRESET)).toEqual({ read: true, readImage: true, write: false, edit: false })
  })

  it('safe tier: the model request carries exactly the old safe set, and survives release + cold resume on the same preset', async () => {
    const w = await world({ hostCeiling: true, tier: () => 'safe' })
    const childId = 'locus-child-safe'
    w.children.add(childId)

    // Control: the base preset registers the file-writing tools (so the child
    // preset's read-only row is what removes them), plus the global tools.
    const parentTools = w.ctx.tools.schemas(w.parent).map(schema => schema.name)
    expect(parentTools).toEqual(expect.arrayContaining(['write', 'edit', 'memex_recall', 'collab_read']))

    const created = await w.adapterPort.createChild({
      parentSessionId: w.parentId,
      childId,
      label: 'entry',
      prompt: [{ type: 'text', text: 'first' }],
    })
    expect(created, JSON.stringify([created, w.logs])).toMatchObject({ ok: true, created: true })
    // Measured on rc.5: as with the earlier runtime, the first prompt is already
    // claimed when `startActivation` returns (Pet's first-prompt gating relies on
    // the claim preceding the durable binding, which this ordering preserves).
    expect(w.claimKinds.filter(claim => claim.id === childId)).toHaveLength(1)
    await settle(w.adapter, 'first')

    // The request header's tools == the old filter ∩ preset, tier safe.
    expect(w.adapter.forPrompt('first')[0]!.tools).toEqual(OLD_SAFE)
    // `delivery: 'parent'`: settling woke the parent with the settlement notice,
    // as the earlier runtime did (the parent's own, wider request is not the child's).
    const deadline = Date.now() + 10_000
    while (!w.adapter.requests.some(request => request.transcript.includes('Background subagent')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(w.adapter.requests.some(request => request.transcript.includes('Background subagent'))).toBe(true)

    // Evidence for the turn-observer's first-turn exemption list: on the real
    // 0.2.1 runtime (with working-directory installed) the child's first claim is
    // the Pet-queued prompt alone — no `working-directory` notice appears unless
    // the directory changes, and `subagent-settled` goes to the PARENT's inbox.
    expect(w.claimKinds.filter(claim => claim.id === childId).map(claim => claim.kind)).toEqual(['user'])
    expect(w.claimKinds.filter(claim => claim.id === w.parentId).map(claim => claim.kind)).toContain('subagent-settled')

    // The child unloads once its first activation settles, so everything about
    // the first publication is read at the publication boundary itself.
    const first = w.published[0]!
    const attestation = attestLocusComposition(first.names, 'safe')
    expect(attestation, JSON.stringify(first)).toMatchObject({ ok: true, leaks: [] })
    expect(first.preset).toBe(LOCUS_CHILD_PRESET)
    expect(first.headerPreset).toBe(LOCUS_CHILD_PRESET)
    const persisted = await (w.ctx as any).sessionQuery.observeSession(childId)
    try {
      expect(persisted.events.some((event: any) =>
        event.type === 'agent-preset/selected' && event.data.agentPreset === LOCUS_CHILD_PRESET)).toBe(true)
    } finally { persisted[Symbol.dispose]?.() }

    // Release the resident activation (compensation port), then queue a prompt:
    // the runtime cold-resumes the child from its persisted descriptor.
    await w.ports.compensation!.drainChildren(w.parent, [childId] as never)
    await w.ports.inbox!.queuePrompt(w.parent, childId, [{ type: 'text', text: 'second' }], { kind: 'user' }, new AbortController().signal)
    await settle(w.adapter, 'second')

    // A second publication, this time a cold resume, composed the SAME preset
    // from the persisted selection and read back the same safe surface.
    const resumed = w.published.at(-1)!
    expect(w.published).toHaveLength(2)
    expect(resumed.source).not.toBe(first.source)
    expect(resumed.preset).toBe(LOCUS_CHILD_PRESET)
    expect(attestLocusComposition(resumed.names, 'safe')).toMatchObject({ ok: true, leaks: [] })
    expect(w.adapter.forPrompt('second')[0]!.tools).toEqual(OLD_SAFE)
  })

  it('shell tier: the request carries exactly the old shell set (safe + bash + skill)', async () => {
    const w = await world({ hostCeiling: true, tier: () => 'shell' })
    const childId = 'locus-child-shell'
    w.children.add(childId)
    await w.adapterPort.createChild({
      parentSessionId: w.parentId, childId, label: 'entry', prompt: [{ type: 'text', text: 'first' }],
    })
    await settle(w.adapter, 'first')
    const tools = w.adapter.forPrompt('first')[0]!.tools
    expect(tools).toEqual(OLD_SHELL)
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
  })

  it('control: without Pet\'s own allow list the preset alone lets other plugins\' global tools through', async () => {
    const w = await world({ hostCeiling: false, tier: () => 'safe' })
    const childId = 'locus-child-no-ceiling'
    w.children.add(childId)
    await w.adapterPort.createChild({
      parentSessionId: w.parentId, childId, label: 'entry', prompt: [{ type: 'text', text: 'first' }],
    })
    await settle(w.adapter, 'first')
    const tools = w.adapter.forPrompt('first')[0]!.tools
    // The preset DID remove write/edit ...
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
    // ... but it cannot remove tools registered globally, which is exactly the
    // gap the host-applied ceiling closes (and publication attestation checks).
    expect(tools).toEqual(expect.arrayContaining(['memex_recall', 'collab_read']))
    expect(attestLocusComposition(tools, 'safe')).toMatchObject({ ok: false, reason: 'leaked' })
  })
})
