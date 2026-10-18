import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controller, presets, moduleOf } from './support/controller-harness.mjs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const home = process.env.DSH_COLLAB_COMPONENT_HOME
assert.ok(home && process.env.HOME === home && process.env.DSH_HOME === home, 'use run-components.mjs')
const { createUserMessage } = await moduleOf('dsh-llm')
const { defineTool } = await moduleOf('dsh-tools')
const { SessionId } = await moduleOf('dsh-session')
const { setSandboxMode } = await moduleOf('dsh-sandbox-policy')
const { setApprovalPolicy } = await moduleOf('dsh-user-approval')

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
    const consumer = await consumerPlugin(root)
    const pluginHandle = reader.plugin(consumer, { dataDir: join(root, 'cold-collab-data'), allowedSessionIds: [id] })
    await pluginHandle.inertia
    assert.equal(pluginHandle.state, 2)
    const sessions = await reader.tools.execute({ callId: 'cold-discovery', name: 'collab_sessions', arguments: {}, agent, signal: AbortSignal.timeout(5000) })
    assert.ok(!sessions.isError, JSON.stringify(sessions))
    assert.ok(sessions.value.some(record => record.id === id))
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

async function consumerPlugin(root) {
  // Resolve all DSH runtime imports from ONE graph's private scope identities.
  const { cp, symlink, mkdtemp } = await import('node:fs/promises')
  const deployment = await mkdtemp(join(root, 'deployment-'))
  await cp(new URL('../lib/', import.meta.url), join(deployment, 'lib'), { recursive: true })
  await writeFile(join(deployment, 'package.json'), '{"type":"module"}')
  await symlink(new URL('../../../spike/collab-components/node_modules', import.meta.url).pathname, join(deployment, 'node_modules'), 'dir')
  return import(pathToFileURL(join(deployment, 'lib', 'index.js')).href)
}

test('consumer-integration: actual bundled tools share ledger across sessions and revoke on dispose', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer')
  const cwdA = join(root, 'workspace-a'), cwdB = join(root, 'workspace-b')
  await mkdir(cwdA, { recursive: true }); await mkdir(cwdB)
  const plugin = await consumerPlugin(root)
  let ctx = await controller(root)
  const ids = [SessionId('consumer-a'), SessionId('consumer-b')]
  const config = { dataDir: join(root, 'collab-data'), allowedSessionIds: ids }
  try {
    await presets(ctx)
    for (const [index, id] of ids.entries()) await ctx.sessionController.create({ sessionId: id, cwd: index ? cwdB : cwdA, agentPreset: 'P1' })
    const a = (await ctx.sessionController.resolveAgent(ids[0])).agent
    const b = (await ctx.sessionController.resolveAgent(ids[1])).agent
    assert.ok(a && b)
    const handle = ctx.plugin(plugin, config)
    await handle.inertia
    assert.equal(handle.state, 2, 'consumer fiber active')
    const call = async (agent, name, args) => {
      const result = await ctx.tools.execute({ callId: `consumer-${name}`, name, arguments: args, agent, signal: AbortSignal.timeout(5000) })
      assert.ok(!result.isError, JSON.stringify(result))
      return result.value
    }
    assert.deepEqual(await call(a, 'collab_create_space', { spaceId: 'shared', cmdId: 'create', name: 'a' }), { seq: 1, spaceId: 'shared' })
    const invalidInvite = await call(a, 'collab_invite', { spaceId: 'shared', cmdId: 'prefix', name: 'prefix', recipientSessionId: 'consumer-' })
    assert.equal(invalidInvite.error.code, 'COLLAB_ADDRESS_UNCLAIMED')
    const invalidState = await call(a, 'collab_overview', { spaceId: 'shared' })
    assert.deepEqual(Object.keys(invalidState.members), ['a'])
    assert.deepEqual(invalidState.deliveries, {})
    const invited = await call(a, 'collab_invite', { spaceId: 'shared', cmdId: 'invite', name: 'b', recipientSessionId: ids[1] })
    assert.equal(invited.seq, 2)
    assert.equal((await call(b, 'collab_overview', { spaceId: 'shared' })).error.code, 'COLLAB_MEMBER_INACTIVE')
    await call(b, 'collab_join', { spaceId: 'shared', cmdId: 'join' })
    const created = await call(a, 'collab_create_item', { spaceId: 'shared', cmdId: 'item', itemId: 'item', kind: 'other', title: 'Title', body: 'Body', requiredAcks: ['b'], deciders: [] })
    assert.equal(created.itemId, 'item')
    await call(b, 'collab_ack_item', { spaceId: 'shared', cmdId: 'ack', itemId: 'item', revision: 1 })
    const conflict = await call(a, 'collab_revise_item', { spaceId: 'shared', cmdId: 'stale', itemId: 'item', expectedRevision: 99, changes: { title: 'must not change' } })
    assert.equal(conflict.error.code, 'COLLAB_STALE_REVISION')
    assert.equal(conflict.error.details.currentRevision, 1)
    const state = await call(b, 'collab_overview', { spaceId: 'shared' })
    assert.equal(state.members.a.binding.address, ids[0])
    assert.equal(state.members.b.binding.address, ids[1])
    assert.equal(state.items.item.status, 'agreed')
    assert.equal(state.items.item.acks.b, 1)
    await Promise.all([a.whenIdle(), b.whenIdle()])
    // Model idle does not drain asynchronous dispatch/completed persistence.
    // Compare business records so a legitimate late completion is not a failure.
    const businessRecords = async () => (await readFile(join(config.dataDir, 'shared.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(record => record.kind !== 'completion')
    const beforeDecision = await businessRecords()
    const received = b.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-collab').length
    assert.deepEqual(await call(a, 'collab_invite', { spaceId: 'shared', cmdId: 'invite', name: 'b', recipientSessionId: ids[1] }), invited)
    assert.deepEqual(await businessRecords(), beforeDecision)
    assert.equal(b.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-collab').length, received)
    assert.equal((await call(a, 'collab_request_decision', { spaceId: 'shared', cmdId: 'decision', itemId: 'item', options: ['yes', 'no'] })).error.code, 'COLLAB_NO_DECIDER')
    assert.deepEqual(await businessRecords(), beforeDecision)
    const afterDecision = await call(a, 'collab_overview', { spaceId: 'shared' })
    assert.deepEqual(Object.keys(afterDecision.members).sort(), ['a', 'b'])
    assert.deepEqual(afterDecision.requests, {})
    assert.deepEqual(afterDecision.decisions, [])
    await Promise.all([a.whenIdle(), b.whenIdle()])
    for (const agent of [a, b]) {
      assert.ok(agent.session.snapshotEvents().filter(e => e.type === 'turn/end').every(e => e.data.reason.kind === 'completed'))
      assert.equal(agent.session.header.cwd, agent === a ? cwdA : cwdB)
      await ctx.sessions.flush(agent.session)
    }
    const log = join(config.dataDir, 'shared.jsonl')
    const before = await readFile(log)
    await handle.dispose()
    assert.deepEqual(await readFile(log), before)
    const after = await ctx.tools.execute({ callId: 'removed', name: 'collab_overview', arguments: { spaceId: 'shared' }, agent: a, signal: AbortSignal.timeout(5000) })
    assert.equal(after.isError, true)
    await ctx.fiber.dispose()
    ctx = await controller(root)
    await presets(ctx)
    const restarted = ctx.plugin(plugin, config)
    await restarted.inertia
    assert.equal(restarted.state, 2)
    const restored = (await ctx.sessionController.resolveAgent(ids[1])).agent
    assert.ok(restored)
    const reopened = await ctx.tools.execute({ callId: 'reopened', name: 'collab_overview', arguments: { spaceId: 'shared' }, agent: restored, signal: AbortSignal.timeout(5000) })
    assert.ok(!reopened.isError, JSON.stringify(reopened))
    assert.equal(reopened.value.serviceId, state.serviceId)
    assert.equal(reopened.value.items.item.acks.b, 1)
    assert.deepEqual(await readFile(log), before)
  } finally { await ctx.fiber.dispose() }
})

test('consumer-cold-delivery: official provider resolve mounts P2 and sends exact plugin pointer', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-cold')
  const cwd = join(root, 'workspace-b')
  await mkdir(cwd, { recursive: true })
  const ids = [SessionId('cold-sender'), SessionId('cold-target')]
  const writer = await controller(root)
  try {
    await presets(writer)
    for (const id of ids) await writer.sessionController.create({ sessionId: id, cwd, agentPreset: 'P1' })
    const source = (await writer.sessionController.resolveAgent(ids[0])).agent
    assert.ok(source)
    assert.equal(await writer.sessions.flush(source.session), true)
    const target = (await writer.sessionController.resolveAgent(ids[1])).agent
    assert.ok(target)
    await writer.agentPresets.select(target, 'P2')
    setSandboxMode(target.session, 'read-only'); setApprovalPolicy(target.session, 'never')
    assert.equal(await writer.sessions.flush(target.session), true)
  } finally { await writer.fiber.dispose() }
  const reader = await controller(root)
  try {
    await presets(reader)
    const plugin = await consumerPlugin(root)
    const handle = reader.plugin(plugin, { dataDir: join(root, 'collab-data'), allowedSessionIds: ids })
    await handle.inertia; assert.equal(handle.state, 2)
    const sender = (await reader.sessionController.resolveAgent(ids[0])).agent
    assert.ok(sender)
    assert.equal(reader.agents.get(ids[1]), undefined)
    const call = async (name, args) => {
      const result = await reader.tools.execute({ callId: `cold-${name}`, name, arguments: args, agent: sender, signal: AbortSignal.timeout(5000) })
      assert.ok(!result.isError, JSON.stringify(result)); assert.ok(!result.value.error, JSON.stringify(result.value)); return result.value
    }
    const listed = await call('collab_sessions', {})
    assert.ok(listed.some(record => record.id === ids[1]))
    assert.equal(reader.agents.get(ids[1]), undefined, 'discovery must not activate cold target')
    await call('collab_create_space', { spaceId: 'cold-space', cmdId: 'create', name: 'a' })
    let stopMessageWatch
    let messageDeadline
    const delivered = new Promise((resolve, reject) => {
      messageDeadline = setTimeout(() => { stopMessageWatch?.(); reject(new Error('consumer pointer not enqueued')) }, 5000)
      stopMessageWatch = reader.on('session/event', (session, event) => {
        if (session.id === ids[1] && event.type === 'user/message' && event.data.source.kind === 'plugin:dsh-collab') {
          clearTimeout(messageDeadline); stopMessageWatch(); resolve()
        }
      })
    })
    try {
      await call('collab_invite', { spaceId: 'cold-space', cmdId: 'invite', name: 'b', recipientSessionId: ids[1] })
      await delivered
    } finally { clearTimeout(messageDeadline); stopMessageWatch?.() }
    // Kernel schedules delivery asynchronously; wait for real target publication
    // using the actual registry event rather than a sleep or model completion ack.
    let target = reader.agents.get(ids[1])
    if (!target) target = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('cold delivery did not publish target')) }, 5000)
      const off = reader.on('agent/created', ({ agent }) => { if (agent.id === ids[1]) { clearTimeout(timer); off(); resolve(agent) } })
      const now = reader.agents.get(ids[1]); if (now) { clearTimeout(timer); off(); resolve(now) }
    })
    await target.whenIdle()
    const events = target.session.snapshotEvents()
    const messages = events.filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin:dsh-collab')
    assert.equal(messages.length, 1)
    const pointer = JSON.stringify(messages[0].data)
    assert.ok(pointer.includes('cold-space'))
    assert.ok(pointer.includes('invited'))
    const header = events.find(e => e.type === 'request/header')
    assert.ok(header)
    assert.ok(JSON.stringify(header.data.header.tools).includes('sentinel_P2'))
    assert.ok(!JSON.stringify(header.data.header.tools).includes('sentinel_P1'))
    assert.equal(reader.sandboxPolicy.resolve({ session: target.session }).mode, 'read-only')
    assert.equal(reader.approval.effectivePolicy(target.session), 'never')
    const protectedFile = join(cwd, 'consumer-protected.txt')
    await writeFile(protectedFile, 'unchanged')
    const denied = await reader.tools.execute({ callId: 'consumer-cold-write', name: 'write', arguments: { file_path: protectedFile, content: 'forbidden' }, agent: target, signal: AbortSignal.timeout(5000) })
    assert.equal(denied.isError, true)
    assert.ok(JSON.stringify(denied).includes('read-only'), JSON.stringify(denied))
    assert.equal(await readFile(protectedFile, 'utf8'), 'unchanged')
    const allowed = await reader.tools.execute({ callId: 'consumer-cold-read', name: 'read', arguments: { file_path: protectedFile }, agent: target, signal: AbortSignal.timeout(5000) })
    assert.equal(allowed.isError, false)
    assert.ok(JSON.stringify(allowed).includes('unchanged'))
    assert.ok(events.filter(e => e.type === 'turn/end').every(e => e.data.reason.kind === 'completed'))
  } finally { await reader.fiber.dispose() }
})

test('consumer-busy: actual provider followup is absent from current request and present once next turn', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-busy')
  await mkdir(root)
  const ctx = await controller(root)
  let release = () => {}
  try {
    await presets(ctx)
    const ids = [SessionId('busy-sender'), SessionId('busy-target')]
    for (const id of ids) await ctx.sessionController.create({ sessionId: id, cwd: root, agentPreset: 'P1' })
    const sender = (await ctx.sessionController.resolveAgent(ids[0])).agent
    const target = (await ctx.sessionController.resolveAgent(ids[1])).agent
    assert.ok(sender && target)
    const plugin = await consumerPlugin(root)
    const handle = ctx.plugin(plugin, { dataDir: join(home, 'busy-ledger'), allowedSessionIds: ids })
    await handle.inertia; assert.equal(handle.state, 2)
    const call = async (name, args) => {
      const r = await ctx.tools.execute({ callId: `busy-${name}`, name, arguments: args, agent: sender, signal: AbortSignal.timeout(5000) })
      assert.ok(!r.isError && !r.value.error, JSON.stringify(r)); return r.value
    }
    await call('collab_create_space', { spaceId: 'busy-space', cmdId: 'create', name: 'a' })
    let entered
    const current = new Promise(resolve => { entered = resolve })
    const wait = new Promise(resolve => { release = resolve })
    ctx.componentAdapter.barrier = { entered, wait }
    target.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'current unrelated user input' }] }))
    await current
    const before = ctx.componentAdapter.requests[0]
    let stop
    let deadline
    let awaitLedger
    const message = new Promise((resolve, reject) => {
      deadline = setTimeout(() => { stop?.(); reject(new Error(`busy pointer not accepted; ledger=${JSON.stringify(target.session.snapshotEvents().map(e => e.type))}; collab=${JSON.stringify(awaitLedger)}`)) }, 5000)
      stop = ctx.on('session/event', (session, event) => {
        if (session.id !== target.id || event.type !== 'agent/inbox/spliced') return
        const pointer = event.data.inserted.find(message => message.source.kind === 'plugin:dsh-collab')
        if (pointer) { clearTimeout(deadline); stop(); resolve(pointer) }
      })
    })
    try {
      await call('collab_invite', { spaceId: 'busy-space', cmdId: 'invite', name: 'b', recipientSessionId: target.id })
      awaitLedger = await call('collab_overview', { spaceId: 'busy-space' })
      const pointer = await message
      assert.ok(pointer.id)
      assert.ok(!JSON.stringify(before).includes('busy-space'))
      assert.equal(ctx.componentAdapter.requests.length, 1, 'provider returned while current model request remains blocked')
      release()
      await target.whenIdle()
      assert.equal(ctx.componentAdapter.requests.length, 2)
      assert.equal(JSON.stringify(ctx.componentAdapter.requests[1]).split('busy-space').length - 1, 1)
      const events = target.session.snapshotEvents()
      assert.equal(events.filter(e => e.type === 'user/message' && e.data.id === pointer.id).length, 1)
      assert.deepEqual(events.filter(e => e.type === 'turn/end').map(e => e.data.reason.kind), ['completed', 'completed'])
      assert.equal(events.filter(e => e.type === 'agent/error').length, 0)
    } finally { clearTimeout(deadline); stop?.(); release() }
  } finally { release(); await ctx.fiber.dispose() }
})

test('consumer-workspace: new workspace containment refuses future reads and writes without changing logs', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-workspace')
  const cwd = join(root, 'workspace')
  await mkdir(cwd, { recursive: true })
  const ctx = await controller(root)
  try {
    await presets(ctx)
    const id = SessionId('workspace-caller')
    await ctx.sessionController.create({ sessionId: id, cwd, agentPreset: 'P1' })
    const agent = (await ctx.sessionController.resolveAgent(id)).agent
    assert.ok(agent)
    const plugin = await consumerPlugin(root)
    const dataDir = join(root, 'state')
    const handle = ctx.plugin(plugin, { dataDir, allowedSessionIds: [id] })
    await handle.inertia; assert.equal(handle.state, 2)
    const call = (name, args) => ctx.tools.execute({ callId: `workspace-${name}`, name, arguments: args, agent, signal: AbortSignal.timeout(5000) })
    const created = await call('collab_create_space', { spaceId: 's', cmdId: 'create', name: 'a' })
    assert.ok(!created.isError && !created.value.error, JSON.stringify(created))
    await ctx.workspaceRegistry.create(cwd)
    assert.equal((await call('collab_overview', { spaceId: 's' })).value.members.a.status, 'active')
    const before = await readFile(join(dataDir, 's.jsonl'))
    await ctx.workspaceRegistry.create(root)
    for (const [name, args] of [['collab_overview', { spaceId: 's' }], ['collab_set_status', { spaceId: 's', cmdId: 'status', text: 'must not commit' }], ['collab_create_space', { spaceId: 'new', cmdId: 'new', name: 'a' }]]) {
      const refused = await call(name, args)
      assert.ok(refused.value.error, JSON.stringify(refused))
    }
    assert.deepEqual(await readFile(join(dataDir, 's.jsonl')), before)
    await assert.rejects(readFile(join(dataDir, 'new.jsonl')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(dataDir, 'new.lock')), { code: 'ENOENT' })
  } finally { await ctx.fiber.dispose() }
})

test('consumer-model-identity: real model tool calls retain caller and reject forged or unallowlisted writes', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-model')
  const cwdA = join(root, 'a'), cwdB = join(root, 'b')
  await mkdir(cwdA, { recursive: true }); await mkdir(cwdB)
  const ctx = await controller(root)
  try {
    await presets(ctx)
    const ids = [SessionId('model-a'), SessionId('model-b'), SessionId('model-c')]
    for (const id of ids) await ctx.sessionController.create({ sessionId: id, cwd: id === ids[0] ? cwdA : cwdB, agentPreset: 'P1' })
    const agents = await Promise.all(ids.map(async id => (await ctx.sessionController.resolveAgent(id)).agent))
    assert.ok(agents.every(Boolean))
    const [a, b, c] = agents
    const plugin = await consumerPlugin(root)
    const dataDir = join(root, 'ledger')
    const handle = ctx.plugin(plugin, { dataDir, allowedSessionIds: ids.slice(0, 2) })
    await handle.inertia; assert.equal(handle.state, 2)
    const model = async (agent, name, args) => {
      ctx.componentAdapter.nextTool = { name, arguments: args }
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'execute only the scripted local tool call' }] }))
      await agent.whenIdle()
      const events = agent.session.snapshotEvents()
      assert.equal(events.filter(e => e.type === 'agent/error').length, 0)
      return events.filter(e => e.type === 'tool/result').at(-1)
    }
    await model(b, 'collab_create_space', { spaceId: 's', cmdId: 'create', name: 'b' })
    const log = join(dataDir, 's.jsonl')
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(records[0].events.find(event => event.type === 'member/joined').member.binding.address, b.id)
    assert.equal(records[0].events.find(event => event.type === 'space/created').actor, 'b')
    assert.equal(b.session.header.parentSession, undefined)
    assert.equal(b.session.header.agentPreset, 'P1')
    assert.equal(ctx.agentPresets.composedPreset(b.ctx), 'P1')
    const header = b.session.snapshotEvents().find(event => event.type === 'request/header')
    const names = header.data.header.tools.map(tool => tool.name).filter(name => name.startsWith('collab_'))
    assert.equal(names.length, 20); assert.equal(new Set(names).size, 20)
    assert.ok(!names.some(name => /confirm|reset|break|execute/.test(name)))
    const before = await readFile(log)
    for (const extra of [{ principal: { kind: 'human' } }, { actor: 'a' }, { sessionId: a.id }, { providerId: 'forged' }]) {
      await model(b, 'collab_set_status', { spaceId: 's', cmdId: 'forged', text: 'forbidden', ...extra })
      assert.deepEqual(await readFile(log), before)
    }
    await model(c, 'collab_set_status', { spaceId: 's', cmdId: 'outside', text: 'forbidden' })
    assert.deepEqual(await readFile(log), before)
    const retry = await ctx.tools.execute({ callId: 'retry', name: 'collab_create_space', arguments: { spaceId: 's', cmdId: 'create', name: 'b' }, agent: b, signal: AbortSignal.timeout(5000) })
    assert.deepEqual(retry.value, { seq: 1, spaceId: 's' }); assert.deepEqual(await readFile(log), before)
    for (const agent of [a, b, c]) assert.equal(agent.session.header.cwd, agent === a ? cwdA : cwdB)
  } finally { await ctx.fiber.dispose() }
})

test('consumer-stale-exec: real async pre-tool gate cannot retain a disposed caller capability', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-stale')
  await mkdir(root)
  const ctx = await controller(root)
  let release = () => {}, stop = () => {}, owned
  try {
    const id = SessionId('stale-caller')
    owned = await ctx.agents.create({ sessionId: id, meta: { cwd: root } })
    const plugin = await consumerPlugin(root)
    const dataDir = join(home, 'stale-ledger')
    const handle = ctx.plugin(plugin, { dataDir, allowedSessionIds: [id] })
    await handle.inertia; assert.equal(handle.state, 2)
    let entered
    const gated = new Promise(resolve => { entered = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    stop = ctx.on('tools/pre-execute', async (exec, next) => { if (exec.name === 'collab_create_space') { entered(); await barrier }; return next() })
    const pending = ctx.tools.execute({ callId: 'stale', name: 'collab_create_space', arguments: { spaceId: 's', cmdId: 'create', name: 'a' }, agent: owned.agent, signal: AbortSignal.timeout(5000) })
    await gated
    await owned.dispose()
    assert.equal(ctx.agents.get(id), undefined)
    release()
    const refused = await pending
    assert.equal(refused.value.error.code, 'COLLAB_CALLER_UNAVAILABLE')
    await assert.rejects(readFile(join(dataDir, 's.jsonl')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(dataDir, 's.lock')), { code: 'ENOENT' })
  } finally { release(); stop(); await owned?.dispose(); await ctx.fiber.dispose() }
})

test('consumer-owned: actual official child ownership is rejected without confusing ordinary fork lineage', { timeout: 15000 }, async () => {
  const root = join(home, 'consumer-owned')
  await mkdir(root)
  const ctx = await controller(root)
  const owned = []
  try {
    const parent = await ctx.agents.create({ sessionId: SessionId('owner'), meta: { cwd: root } }); owned.push(parent)
    const child = await ctx.agents.create({ sessionId: SessionId('owned'), parentAgent: parent.agent, meta: { cwd: root, parentSession: parent.agent.id } }); owned.push(child)
    const fork = await ctx.agents.create({ sessionId: SessionId('fork'), meta: { cwd: root, parentSession: parent.agent.id } }); owned.push(fork)
    assert.equal(ctx.agents.isOwnedBy(child.agent.id, parent.agent), true)
    const official = await ctx.sessionController.resolveAgent(child.agent.id)
    assert.ok(official.error, 'official controller must refuse actual owned child')
    const plugin = await consumerPlugin(root)
    const handle = ctx.plugin(plugin, { dataDir: join(home, 'owned-ledger'), allowedSessionIds: owned.map(handle => handle.agent.id) })
    await handle.inertia; assert.equal(handle.state, 2)
    const call = (agent, name, args) => ctx.tools.execute({ callId: 'owned', name, arguments: args, agent, signal: AbortSignal.timeout(5000) })
    assert.equal((await call(child.agent, 'collab_sessions', {})).value.error.code, 'COLLAB_CALLER_UNAVAILABLE')
    const discovered = (await call(parent.agent, 'collab_sessions', {})).value
    assert.ok(discovered.some(record => record.id === fork.agent.id))
    assert.ok(!discovered.some(record => record.id === child.agent.id))
    assert.equal((await call(fork.agent, 'collab_create_space', { spaceId: 's', cmdId: 'create', name: 'a' })).value.seq, 1)
    const refused = await call(fork.agent, 'collab_invite', { spaceId: 's', cmdId: 'owned', name: 'child', recipientSessionId: child.agent.id })
    assert.equal(refused.value.error.code, 'COLLAB_ADDRESS_UNCLAIMED')
  } finally { for (const handle of owned.reverse()) await handle.dispose(); await ctx.fiber.dispose() }
})

test('consumer-startup-dispose: real Cordis removal during async replay fences later spaces', { timeout: 15000 }, async () => {
  const root = join(home, 'startup-dispose')
  await mkdir(root)
  const ctx = await controller(root)
  const { promises: io } = await import('node:fs')
  const originalRead = io.readFile, originalOpen = io.open
  let release = () => {}
  try {
    const id = SessionId('startup-caller')
    const owned = await ctx.agents.create({ sessionId: id, meta: { cwd: root } })
    const plugin = await consumerPlugin(root), dataDir = join(home, 'startup-data')
    const config = { dataDir, allowedSessionIds: [id] }
    let handle = ctx.plugin(plugin, config)
    await handle.inertia
    for (const spaceId of ['a', 'b']) {
      const result = await ctx.tools.execute({ callId: spaceId, name: 'collab_create_space', arguments: { spaceId, cmdId: 'create', name: 'a' }, agent: owned.agent, signal: AbortSignal.timeout(5000) })
      assert.equal(result.value.seq, 1)
    }
    await handle.dispose()
    let entered
    const reading = new Promise(resolve => { entered = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    const opened = []
    io.readFile = async (...args) => { if (args[0] === join(dataDir, 'a.jsonl')) { entered(); await barrier }; return originalRead(...args) }
    io.open = async (...args) => { if (String(args[0]).startsWith(dataDir)) opened.push(args[0]); return originalOpen(...args) }
    handle = ctx.plugin(plugin, config)
    await reading
    const disposing = handle.dispose()
    assert.equal(handle.uid, null)
    release()
    await disposing
    assert.ok(!opened.includes(join(dataDir, 'b.lock')), JSON.stringify(opened))
    await assert.rejects(originalRead(join(dataDir, 'a.lock')), { code: 'ENOENT' })
    await assert.rejects(originalRead(join(dataDir, 'b.lock')), { code: 'ENOENT' })
  } finally { release(); io.readFile = originalRead; io.open = originalOpen; await ctx.fiber.dispose() }
})

test('consumer-corrupt-cold: real persistence omission stays unknown and cannot trigger restore', { timeout: 15000 }, async () => {
  const root = join(home, 'corrupt-cold')
  await mkdir(root)
  const id = SessionId('corrupt-target')
  const writer = await controller(root)
  try {
    const handle = await writer.agents.create({ sessionId: id, meta: { cwd: root } })
    await writer.sessions.flush(handle.agent.session)
  } finally { await writer.fiber.dispose() }
  const sessionRoot = join(root, 'sessions')
  let physical
  for (const project of await readdir(sessionRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const dir = join(sessionRoot, project.name, id)
    try { for (const name of await readdir(dir)) if (name.endsWith('.jsonl')) physical = join(dir, name) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  assert.ok(physical)
  const original = await readFile(physical, 'utf8')
  const header = JSON.parse(original.split('\n')[0])
  assert.ok(header)
  await writeFile(physical, 'not-json-header\n')
  const reader = await controller(root)
  try {
    const caller = await reader.agents.create({ sessionId: SessionId('corrupt-observer'), meta: { cwd: root } })
    const plugin = await consumerPlugin(root)
    const fiber = reader.plugin(plugin, { dataDir: join(home, 'corrupt-ledger'), allowedSessionIds: [id, caller.agent.id] })
    await fiber.inertia; assert.equal(fiber.state, 2)
    const call = (name, args) => reader.tools.execute({ callId: name, name, arguments: args, agent: caller.agent, signal: AbortSignal.timeout(5000) })
    const list = await call('collab_sessions', {})
    assert.ok(!list.value.some(record => record.id === id))
    assert.equal((await call('collab_create_space', { spaceId: 's', cmdId: 'create', name: 'a' })).value.seq, 1)
    const invite = await call('collab_invite', { spaceId: 's', cmdId: 'invite', name: 'b', recipientSessionId: id })
    assert.equal(invite.value.error.code, 'COLLAB_ADDRESS_UNCLAIMED')
    assert.equal(reader.agents.get(id), undefined)
    assert.equal(await readFile(physical, 'utf8'), 'not-json-header\n')
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
