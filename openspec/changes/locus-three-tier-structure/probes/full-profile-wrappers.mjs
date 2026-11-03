// Opt-in preload for task 1.5. It never submits a prompt or calls an LLM.
// NODE_OPTIONS=--import=<this file>, LOCUS_WRAPPER_AUDIT=1,
// LOCUS_WRAPPER_AUDIT_RUNTIME=<reviewed isolated launcher>,
// LOCUS_WRAPPER_AUDIT_OUTPUT=<private JSON path in the worktree>.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

if (process.env.LOCUS_WRAPPER_AUDIT === '1' && process.argv.includes('web')) {
  const runtime = process.env.LOCUS_WRAPPER_AUDIT_RUNTIME
  const output = process.env.LOCUS_WRAPPER_AUDIT_OUTPUT
  if (!runtime || !output || !path.isAbsolute(runtime) || !path.isAbsolute(output)) {
    throw new Error('Wrapper audit requires absolute runtime and output paths')
  }
  const graph = createRequire(path.join(runtime, 'package.json'))
  const { EventsService } = await import(pathToFileURL(graph.resolve('@deepseek-ai/cordis')).href)
  const roots = new Set()
  const registrations = []
  const original = EventsService.prototype.on
  EventsService.prototype.on = function (...args) {
    roots.add(this.ctx.root)
    if (args[0] === 'tools/execute' || args[0] === 'tools/pre-execute') {
      registrations.push({ event: args[0], owner: this.ctx.fiber?.name ?? 'unknown',
        source: Function.prototype.toString.call(args[1]) })
    }
    return original.apply(this, args)
  }
  setTimeout(async () => {
    const result = { status: 'not-ready', runtime, createdSessions: [], errors: [], hooks: [] }
    try {
      const root = [...roots].find(candidate => candidate?.get('sessionController') && candidate?.get('tools'))
      if (!root) throw new Error('The actual profile did not expose sessionController and tools')
      // Creating an empty ordinary Session installs preset and per-Agent plugins;
      // it does not put any user message into the inbox or call a provider.
      for (const agentPreset of ['standard', 'locus-base']) {
        const created = await root.get('sessionController').create({
          sessionId: `session-wrapper-audit-${randomUUID()}`,
          cwd: process.cwd(), agentPreset,
        })
        result.createdSessions.push({ sessionId: created.sessionId, agentPreset })
      }
      for (const [event, hooks] of Object.entries(root.events._hooks)) {
        if (event !== 'tools/execute' && event !== 'tools/pre-execute') continue
        for (const hook of hooks) {
          const owner = hook.ctx?.fiber?.name ?? 'unknown'
          const registered = registrations.findLast(entry => entry.event === event && entry.owner === owner)
          result.hooks.push({ event, owner, global: hook.global === true,
            source: registered?.source ?? Function.prototype.toString.call(hook.callback) })
        }
      }
      result.status = 'observed'
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error))
    }
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
    console.error(`LOCUS_WRAPPER_AUDIT ${result.status}: ${result.hooks.length} hooks, ${result.createdSessions.length} empty sessions`)
  }, 15_000).unref()
}
