import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

// All runtime modules resolve from ONE isolated graph. Mixing the root graph
// would duplicate Cordis/scope private symbols and invalidate the experiment.
const deps = createRequire(new URL('../../../spike/collab-components/package.json', import.meta.url))
async function moduleOf(name) { return import(pathToFileURL(deps.resolve(`@deepseek-ai/${name}`)).href) }
const home = process.env.DSH_COLLAB_COMPONENT_HOME
assert.ok(home && process.env.HOME === home && process.env.DSH_HOME === home, 'use run-components.mjs')
const { Context } = await moduleOf('cordis')
const { default: Loader } = await moduleOf('cordis-plugin-loader')
const { default: LlmRuntime, LlmAdapter, createUserMessage, ToolCallId } = await moduleOf('dsh-llm')
const { defineTool } = await moduleOf('dsh-tools')
const { SessionId } = await moduleOf('dsh-session')
const { setSandboxMode } = await moduleOf('dsh-sandbox-policy')
const { setApprovalPolicy } = await moduleOf('dsh-user-approval')

class Scripted extends LlmAdapter {
  requests = []
  nextTool
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.requests.push(options)
    if (this.nextTool) {
      const name = this.nextTool
      this.nextTool = undefined
      const id = ToolCallId('approval-probe')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'component-only' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'component-only' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function install(ctx, name, config = {}) {
  const mod = await moduleOf(name)
  await ctx.plugin(mod.default ?? mod, config)
}

async function controller(root, onCreated) {
  const ctx = new Context()
  try {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(`${root}/`).href })
    await ctx.plugin(LlmRuntime)
    for (const name of ['dsh-session', 'dsh-session-projection']) await install(ctx, name)
    await install(ctx, 'dsh-system-prompt', { persona: '' })
    for (const name of ['dsh-tools', 'dsh-agent']) await install(ctx, name)
    await install(ctx, 'dsh-session-persistence-jsonl', { root: join(root, 'sessions'), compression: 'none' })
    await install(ctx, 'dsh-agent-loop', { agents: [] })
    const adapter = new Scripted()
    ctx.llm.registerAdapter(['scripted'], adapter)
    await install(ctx, 'dsh-agent-default-model', { provider: 'scripted', model: 'scripted' })
    await install(ctx, 'dsh-typert-registry')
    await install(ctx, 'dsh-commands')
    await install(ctx, 'dsh-credentials-local', { dshHome: root, watch: false })
    await install(ctx, 'dsh-client-connection')
    await install(ctx, 'dsh-attachment-local', { dshHome: root })
    await install(ctx, 'dsh-client-file-upload')
    await install(ctx, 'dsh-sandbox-policy', { mode: 'danger-full-access', workspaceRoot: root })
    await install(ctx, 'dsh-fs-sandbox', { cwd: root })
    await install(ctx, 'dsh-user-approval', { policy: 'ask' })
    await install(ctx, 'dsh-tool-fs')
    await install(ctx, 'dsh-subprocess-local')
    await install(ctx, 'dsh-sandbox-local')
    await install(ctx, 'dsh-bash-sandbox')
    await install(ctx, 'dsh-jobs-local')
    await install(ctx, 'dsh-shell-env')
    await install(ctx, 'dsh-tool-bash')
    await install(ctx, 'dsh-session-query')
    await install(ctx, 'dsh-storage')
    await install(ctx, 'dsh-storage-sqlite', { path: join(root, 'state.sqlite') })
    await install(ctx, 'dsh-storage-domain', { backend: 'sqlite' })
    await install(ctx, 'dsh-workspace')
    await install(ctx, 'dsh-agent-preset-registry', { default: 'P1' })
    await install(ctx, 'dsh-api-session-controller', { nativeOpen: false })
    assert.ok(ctx.sessionController, 'real SessionController was activated')
    ctx.componentAdapter = adapter
    if (onCreated) ctx.on('agent/created', onCreated)
    return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

async function presets(ctx) {
  for (const id of ['P1', 'P2']) await ctx.agentPresets.register({
    id,
    plugins: [{ name: new URL('./support/preset-sentinel.mjs', import.meta.url).href, config: { toolName: `sentinel_${id}` } }],
  })
}

test('controller-cold: current P2 projection mounts real tools after checkpoint and fresh Context', { timeout: 15000 }, async () => {
  const root = join(home, 'cold')
  const cwd = join(root, 'workspace-b')
  await mkdir(cwd, { recursive: true })
  await writeFile(join(root, 'cwd-proof.txt'), 'wrong-root')
  await writeFile(join(cwd, 'cwd-proof.txt'), 'workspace-b')
  const id = SessionId('cold-b')
  const writer = await controller(root)
  try {
    await presets(writer)
    await writer.sessionController.create({ sessionId: id, cwd, agentPreset: 'P1' })
    const resolved = await writer.sessionController.resolveAgent(id)
    assert.ok(resolved.agent, JSON.stringify(resolved.error))
    await writer.agentPresets.select(resolved.agent, 'P2')
    setSandboxMode(resolved.agent.session, 'read-only')
    setApprovalPolicy(resolved.agent.session, 'never')
    const target = join(cwd, 'protected.txt')
    await writeFile(target, 'unchanged', 'utf8')
    const before = await writer.tools.execute({ callId: 'before-write', name: 'write', arguments: { file_path: target, content: 'forbidden' }, agent: resolved.agent, signal: AbortSignal.timeout(5000) })
    assert.equal(before.isError, true)
    assert.ok(JSON.stringify(before).includes('read-only'), JSON.stringify(before))
    assert.equal(await readFile(target, 'utf8'), 'unchanged')
    assert.equal(resolved.agent.session.header.agentPreset, 'P1', 'header alone is stale by design')
    assert.equal(await writer.sessions.flush(resolved.agent.session), true)
  } finally { await writer.fiber.dispose() }
  const reader = await controller(root)
  try {
    await presets(reader)
    assert.equal(reader.agents.get(id), undefined, 'cold before resolve')
    const resolved = await reader.sessionController.resolveAgent(id)
    assert.ok(resolved.agent, JSON.stringify(resolved.error))
    const agent = resolved.agent
    assert.equal(agent.id, id)
    assert.equal(agent.session.header.cwd, cwd)
    assert.equal(reader.agentPresets.composedPreset(agent.ctx), 'P2')
    assert.equal(reader.sandboxPolicy.resolve({ session: agent.session }).mode, 'read-only')
    assert.equal(reader.approval.effectivePolicy(agent.session), 'never')
    const target = join(cwd, 'protected.txt')
    const denied = await reader.tools.execute({ callId: 'after-write', name: 'write', arguments: { file_path: target, content: 'forbidden' }, agent, signal: AbortSignal.timeout(5000) })
    assert.equal(denied.isError, true)
    assert.ok(JSON.stringify(denied).includes('read-only'), JSON.stringify(denied))
    assert.equal(await readFile(target, 'utf8'), 'unchanged')
    const bashDenied = await reader.tools.execute({ callId: 'after-bash', name: 'bash', arguments: { command: `printf forbidden > protected.txt`, workdir: cwd, description: 'Probe isolated read-only shell write' }, agent, signal: AbortSignal.timeout(5000) })
    assert.ok(!bashDenied.isError, JSON.stringify(bashDenied))
    assert.equal(bashDenied.value.sandbox.mode, 'read-only')
    assert.equal(bashDenied.value.sandbox.denied, true)
    assert.equal(bashDenied.value.sandbox.enforcement, 'full')
    assert.ok(!bashDenied.value.sandbox.runnerFailed)
    assert.equal(bashDenied.value.kind, 'foreground')
    assert.equal(Number.isInteger(bashDenied.value.exitCode), true)
    assert.notEqual(bashDenied.value.exitCode, 0)
    assert.equal(bashDenied.value.timedOut, false)
    assert.equal(bashDenied.value.aborted, false)
    assert.equal(bashDenied.value.signal, null)
    const bashAllowed = await reader.tools.execute({ callId: 'after-bash-read', name: 'bash', arguments: { command: 'pwd', description: 'Probe restored session default working directory' }, agent, signal: AbortSignal.timeout(5000) })
    assert.ok(!bashAllowed.isError, JSON.stringify(bashAllowed))
    assert.equal(bashAllowed.value.exitCode, 0)
    assert.equal(bashAllowed.value.stdout.text.trim(), cwd)
    assert.equal(bashAllowed.value.sandbox.mode, 'read-only')
    assert.equal(bashAllowed.value.sandbox.denied, false)
    assert.equal(bashAllowed.value.sandbox.enforcement, 'full')
    assert.equal(await readFile(target, 'utf8'), 'unchanged', 'real shell sandbox did not mutate the file')
    const allowed = await reader.tools.execute({ callId: 'after-read', name: 'read', arguments: { file_path: target }, agent, signal: AbortSignal.timeout(5000) })
    assert.ok(!allowed.isError, JSON.stringify(allowed))
    assert.ok(JSON.stringify(allowed).includes('unchanged'))
    const relative = await reader.tools.execute({ callId: 'after-relative-read', name: 'read', arguments: { file_path: 'cwd-proof.txt' }, agent, signal: AbortSignal.timeout(5000) })
    assert.ok(!relative.isError, JSON.stringify(relative))
    assert.ok(JSON.stringify(relative).includes('workspace-b'), JSON.stringify(relative))
    assert.ok(!JSON.stringify(relative).includes('wrong-root'))
    const errors = []
    reader.on('agent/error', e => { errors.push(e.error); return undefined })
    const outcomes = []
    let answererCalls = 0
    reader.on('approval/request', async (_request, _next) => { answererCalls++; return 'allowed-once' })
    reader.tools.register(defineTool({
      name: 'probe_approval', description: 'Ask actual approval service during a turn', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) {
        const outcome = await reader.approval.request({ agent: exec.agent, toolName: 'probe_approval', callId: exec.callId, signal: exec.signal })
        outcomes.push(outcome)
        return outcome
      },
    }))
    reader.componentAdapter.nextTool = 'probe_approval'
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cold probe' }], source: { kind: 'plugin:dsh-collab' } }))
    await agent.whenIdle()
    assert.deepEqual(errors, [])
    assert.deepEqual(outcomes, ['rejected'], 'persisted never must bypass even an allowing answerer')
    assert.equal(answererCalls, 0)
    assert.equal(reader.componentAdapter.requests.length, 2)
    const audit = agent.session.snapshotEvents().filter(e => e.type === 'approval/decided')
    assert.equal(audit.length, 1)
    assert.equal(audit[0].data.outcome, 'rejected')
    const header = agent.session.snapshotEvents().find(e => e.type === 'request/header')
    assert.ok(header, 'real request/header logged')
    const tools = JSON.stringify(header.data.header.tools)
    assert.ok(tools.includes('sentinel_P2'), tools)
    assert.ok(!tools.includes('sentinel_P1'), tools)
    const end = agent.session.snapshotEvents().find(e => e.type === 'turn/end')
    assert.equal(end.data.reason.kind, 'completed')
  } finally { await reader.fiber.dispose() }
})

test('controller-worktree: real recovery and guard hook is restored at cold Agent publication', { timeout: 15000 }, async () => {
  const root = join(home, 'worktree')
  const repo = join(root, 'repo')
  const wt = join(repo, '.worktrees', 'guard-probe')
  await mkdir(repo, { recursive: true })
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim()
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Component Fixture'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  await writeFile(join(repo, 'proof.txt'), 'proof')
  git(['add', 'proof.txt']); git(['commit', '-m', 'isolated fixture'])
  const head = git(['rev-parse', 'HEAD'])
  git(['worktree', 'add', '-b', 'ws/guard-probe', wt, 'HEAD'])
  const common = join(repo, '.git')
  const id = SessionId('guard-b')
  const iso = new Date().toISOString()
  const operation = { schemaVersion: 2, operationId: 'operation-guard-probe', repoRoot: repo, gitCommonDir: common, baseRef: 'main', baseCommit: head, taskBranch: 'ws/guard-probe', worktreePath: wt, taskHash: 'guard-probe', dependencyMode: 'lean', dshHome: join(common, 'ws', 'home', 'operation-guard-probe'), phase: 'prepared', createdAt: iso, updatedAt: iso, binding: { mode: 'source-session', sourceSessionId: id, state: 'bound', updatedAt: iso } }
  const operations = join(common, 'ws', 'operations')
  await mkdir(operations, { recursive: true })
  await writeFile(join(operations, 'operation-guard-probe.json'), JSON.stringify(operation))
  // Compile the REAL four-file source closure; no copied policy implementation
  // and no runtime Cordis imports from the root dependency graph.
  const requireRoot = createRequire(import.meta.url)
  const ts = requireRoot('typescript')
  const compiled = join(root, 'compiled')
  for (const relative of ['wire', 'host/containment', 'host/guard', 'host/recovery']) {
    const source = new URL(`../../worktree-session/src/${relative}.ts`, import.meta.url)
    const target = join(compiled, `${relative}.js`)
    await mkdir(dirname(target), { recursive: true })
    const result = ts.transpileModule(await readFile(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    await writeFile(target, result.outputText)
  }
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}')
  const { recoverBindingSync } = await import(pathToFileURL(join(compiled, 'host/recovery.js')).href)
  const { installGuard } = await import(pathToFileURL(join(compiled, 'host/guard.js')).href)
  const observed = []
  const hook = ({ agent, source }) => {
    const recovered = recoverBindingSync(agent.session.header.cwd, String(agent.id))
    if (recovered) {
      assert.equal(recovered.valid, true, recovered.diagnostic)
      observed.push({ id: agent.id, source })
      agent.ctx.effect(() => installGuard(agent, recovered.operation))
    }
    return undefined
  }
  const writer = await controller(root, hook)
  try {
    await presets(writer)
    await writer.sessionController.create({ sessionId: id, cwd: repo, agentPreset: 'P1' })
    const { agent, error } = await writer.sessionController.resolveAgent(id)
    assert.ok(agent, JSON.stringify(error))
    assert.equal(await writer.sessions.flush(agent.session), true)
  } finally { await writer.fiber.dispose() }
  const reader = await controller(root, hook)
  try {
    await presets(reader)
    assert.equal(reader.agents.get(id), undefined)
    const { agent, error } = await reader.sessionController.resolveAgent(id)
    assert.ok(agent, JSON.stringify(error))
    assert.ok(observed.some(e => e.id === id && e.source === 'resume'))
    const call = (agent, name, args) => reader.tools.execute({ callId: `guard-${name}`, name, arguments: args, agent, signal: AbortSignal.timeout(5000) })
    const inside = await call(agent, 'read', { file_path: join(wt, 'proof.txt') })
    assert.ok(!inside.isError, JSON.stringify(inside))
    const outside = await call(agent, 'read', { file_path: join(repo, 'proof.txt') })
    assert.equal(outside.isError, true)
    assert.ok(JSON.stringify(outside).includes('escapes the managed root'), JSON.stringify(outside))
    const denied = await call(agent, 'write', { file_path: join(repo, 'proof.txt'), content: 'forbidden' })
    assert.equal(denied.isError, true)
    assert.equal(await readFile(join(repo, 'proof.txt'), 'utf8'), 'proof')
    const otherWorkspace = join(root, 'workspace-a')
    await mkdir(otherWorkspace)
    await reader.sessionController.create({ sessionId: SessionId('unbound-a'), cwd: otherWorkspace, agentPreset: 'P1' })
    const unbound = await reader.sessionController.resolveAgent(SessionId('unbound-a'))
    assert.ok(unbound.agent, JSON.stringify(unbound.error))
    assert.equal(unbound.agent.session.header.cwd, otherWorkspace)
    assert.equal(agent.session.header.cwd, repo, 'other workspace did not replace recipient cwd')
    assert.equal(reader.sandboxPolicy.resolve({ session: agent.session }).mode, 'danger-full-access', 'worktree guard is tested independently of read-only policy')
    const control = await call(unbound.agent, 'read', { file_path: join(repo, 'proof.txt') })
    assert.ok(!control.isError, JSON.stringify(control))
  } finally { await reader.fiber.dispose() }
})

test('controller-assembly: all real concrete services activate without a full DSH executable', { timeout: 15000 }, async () => {
  const root = join(home, 'controller')
  await mkdir(root)
  const ctx = await controller(root)
  try {
    for (const name of ['fs', 'attachments', 'credentials', 'sessionController', 'workspaceRegistry', 'agentPresets']) assert.ok(ctx.get(name), name)
    assert.ok(ctx.attachments.imageLimits)
  } finally { await ctx.fiber.dispose() }
})
