// Explicit, no-model contract probe against an existing official runtime installation.
// Does not install packages, start a Host, create real sessions or mutate a profile.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

const anchor = process.env.DSH_SKILL_RUNTIME_ANCHOR
if (!anchor) throw new Error('DSH_SKILL_RUNTIME_ANCHOR must identify an existing official runtime; no silent skip')
const requireRuntime = createRequire(resolve(anchor))
const load = name => import(pathToFileURL(requireRuntime.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: SkillRegistry } = await load('@deepseek-ai/dsh-skill')
const { createScope } = await load('@deepseek-ai/dsh-scope')
const { apply } = await load('@deepseek-ai/dsh-tool-skill')
const callerPath = requireRuntime.resolve('@deepseek-ai/dsh-tool-skill')
const identity = JSON.parse(await readFile(join(dirname(callerPath), '../package.json'), 'utf8'))
// Default is the approved pin. A separately named expected identity supports
// diagnostic runs on drifted installations; such runs are not pin acceptance.
const expectedVersion = process.env.DSH_SKILL_CALLER_EXPECTED_VERSION ?? '0.1.5-rc.2'
assert.equal(identity.name, '@deepseek-ai/dsh-tool-skill')
assert.equal(identity.version, expectedVersion, 'caller runtime must match the explicitly expected identity')
const adapterRoot = resolve(process.env.DSH_OPENSPEC_TEST_LIB ?? new URL('../packages/dsh-openspec/lib/', import.meta.url).pathname)
const { createOpenSpecSkillProvider } = await import(pathToFileURL(join(adapterRoot, 'provider.js')).href)
const { createRegistryProvider } = await import(pathToFileURL(join(adapterRoot, 'registry-provider.js')).href)

const ctx = new Context()
await ctx.plugin(SkillRegistry)
const seen = []
let checks = 0
const adapter = createOpenSpecSkillProvider({
  skills: [{ name: 'opsx-test', body: 'official-test-body' }], generationId: 'caller-fixture',
  invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/fixture/cli'",
  telemetry: 'adapter-off', updateCheck: 'enabled',
  check: async () => { checks++; return { installed: '1.13.2', available: '1.13.3', managementEntry: 'openspec-upgrade' } },
})
const unregister = ctx.skills.registerProvider(() => createRegistryProvider({
  list: () => adapter.list(),
  get: (candidate, options) => {
    // The negative control proves these assertions catch the missing-scope defect,
    // rather than merely testing a fixture that cannot observe forwarding.
    if (process.env.DSH_SKILL_CALLER_NEGATIVE_CONTROL === 'drop-scope' || (process.env.DSH_SKILL_CALLER_NEGATIVE_CONTROL === 'drop-gesture-scope' && options.cwd === '/fixture/workspace-b')) options = { ...options, scope: undefined }
    seen.push(options)
    return adapter.get(candidate, options)
  },
}))
let tool
const listeners = []
apply({ skills: ctx.skills, tools: { register: value => { tool = value }, get: () => tool }, on: (event, fn) => { assert.equal(event, 'agent/pre-step'); listeners.push(fn) } })
assert.equal(listeners.length, 2)
const agent = cwd => { const value = { session: { header: { cwd }, surface: { nodes: [] }, seq: 0 } }; createScope(ctx, value); return value }
const model = agent('/fixture/workspace-a'), gesture = agent('/fixture/workspace-b')
const signal = new AbortController().signal
const modelResult = await tool.execute({ name: 'opsx-test' }, { agent: model, signal })
assert.equal(seen.at(-1).scope, model, 'model caller scope must reach provider get')
assert.equal(seen.at(-1).cwd, model.session.header.cwd)
assert.equal(seen.at(-1).signal, signal)
assert.match(modelResult.content, /notice.available=1.13.3/)

const userMessage = { id: 'fixture-user', source: { kind: 'user' }, content: [{ type: 'text', text: '/opsx-test use this workspace' }] }
let decision = { kind: 'continue', messages: [userMessage] }
for (const listener of listeners) {
  const previous = decision
  decision = await listener({ agent: gesture, messages: [userMessage], signal }, async () => previous)
}
const injected = decision.messages.find(message => message.source.kind === 'skill-invocation')
assert.ok(injected, 'actual gesture listener must inject instructions')
assert.equal(seen.at(-1).scope, gesture, 'gesture caller scope must reach provider get')
assert.equal(seen.at(-1).cwd, gesture.session.header.cwd)
assert.equal(seen.at(-1).signal, signal)
assert.equal(injected.content[0].text, tool.output.render({}, modelResult)[0].text, 'model and gesture frames must carry identical body and block')
assert.equal(checks, 2)
const repeated = await tool.execute({ name: 'opsx-test' }, { agent: model, signal })
assert.doesNotMatch(repeated.content, /notice.available/)
const before = checks
const scopeless = await tool.execute({ name: 'opsx-test' }, { signal })
assert.equal(seen.at(-1).scope, undefined)
assert.equal(seen.at(-1).cwd, undefined)
assert.doesNotMatch(scopeless.content, /notice.available/)
assert.equal(checks, before, 'undefined agent must never spend notice or check')
unregister()
console.log(JSON.stringify({ result: 'pass', caller: identity.name, version: identity.version, modelScope: true, gestureScope: true, callerCwd: true, signal: true, identicalFrames: true, scopelessNoNotice: true, realModelRequests: 0, realSessions: 0 }))
