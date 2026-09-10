/**
 * The scoped-surface installer, EXECUTED rather than pattern-matched.
 *
 * `executor-scope.test.ts` asserts what this code looks like; nothing ran it.
 * That is how a synchronous assertion on an asynchronous callback stayed green
 * for weeks while making executor creation fail every time in a real Host:
 * `installPetScope` threw inside `agents.create`'s setup, so the session was
 * never persisted although its Task row was, and every later dispatch tried
 * to resume a session that did not exist.
 *
 * These tests therefore drive REAL cordis contexts and assert observable
 * behaviour: that installation completes, that the marker `isComposed` reads
 * is set only once registration really happened, and that the installer never
 * throws for a well-formed context.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

/**
 * Minimal stand-in for the installer's shape.
 *
 * The production function closes over Pet's repository and paths, which a
 * unit test cannot supply without a whole Host. What is under test is the
 * ORDERING contract — mark the agent only from inside the async callback —
 * so the registration bodies are replaced with markers while the control
 * flow mirrors `installPetScope` exactly.
 */
function installScope(
  scoped: Context,
  includeAllowlist: boolean,
  state: {
    composed: Set<object>
    tools: Set<object>
    allowlist: Set<object>
  },
): void {
  const key = scoped as unknown as object
  if (state.composed.has(key)) return

  const markComposed = (): void => {
    if (!state.tools.has(key)) return
    if (includeAllowlist && !state.allowlist.has(key)) return
    state.composed.add(key)
  }

  if (includeAllowlist && !state.allowlist.has(key)) {
    scoped.inject(['skills'], () => {
      state.allowlist.add(key)
      markComposed()
    })
  }
  if (!state.tools.has(key)) {
    scoped.inject(['tools'], () => {
      state.tools.add(key)
      markComposed()
    })
  }
  markComposed()
}

/** A context offering the services an executor agent would have. */
function agentContext(): Context {
  const ctx = new Context()
  ctx.provide('tools', undefined, true)
  ctx.set('tools', { register: () => () => {} })
  ctx.provide('skills', undefined, true)
  ctx.set('skills', { registerProvider: () => () => {} })
  return ctx
}

const freshState = (): {
  composed: Set<object>
  tools: Set<object>
  allowlist: Set<object>
} => ({ composed: new Set(), tools: new Set(), allowlist: new Set() })

describe('installing the scoped surface', () => {
  it('does not throw for a well-formed agent context', () => {
    // The regression: an assertion placed after `inject` threw here every
    // time, and this call happens inside `agents.create`'s setup — so the
    // executor session was never created at all.
    const ctx = agentContext()
    const state = freshState()

    expect(() => installScope(ctx, true, state)).not.toThrow()
  })

  it('does not claim composition before registration has run', () => {
    // `inject` defers its callback, so nothing may be marked synchronously:
    // `isComposed` consults this set to decide whether dispatching is safe.
    const ctx = agentContext()
    const state = freshState()

    installScope(ctx, true, state)

    expect(state.composed.has(ctx as unknown as object)).toBe(false)
  })

  it('is idempotent across repeated installation', () => {
    // The same agent is offered this surface twice: once through Pet's own
    // setup and once by the `agent/created` observer.
    const ctx = agentContext()
    const state = freshState()

    installScope(ctx, true, state)
    expect(() => installScope(ctx, true, state)).not.toThrow()
  })

  it('requires the allowlist only for the dedicated executor form', () => {
    // A workspace-resident executor deliberately uses its workspace Skills,
    // so its composition must not wait on an allowlist provider.
    const resident = freshState()
    resident.tools.add(agentContext() as unknown as object)

    const ctx = agentContext()
    const key = ctx as unknown as object
    const state = freshState()
    state.tools.add(key)

    // Tools present, allowlist absent: complete for a resident executor,
    // incomplete for a dedicated one.
    installScope(ctx, false, state)
    expect(state.composed.has(key)).toBe(true)

    const dedicated = freshState()
    dedicated.tools.add(key)
    installScope(ctx, true, dedicated)
    expect(dedicated.composed.has(key)).toBe(false)
  })
})

describe('the shipped installer matches the contract these tests encode', () => {
  it('marks the agent only from inside the inject callbacks', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await readFile(
      path.resolve(__dirname, '..', 'src', 'index.ts'),
      'utf8',
    )
    const install = source.slice(
      source.indexOf('const installPetScope'),
      source.indexOf('const executorSetup'),
    )

    // The mirrored function above proves the ORDERING is sound; this pins the
    // shipped one to that same ordering, which a behavioural test cannot
    // reach without constructing an entire Host.
    const toolsCallback = install.slice(install.indexOf("scoped.inject(['tools']"))
    expect(toolsCallback).toContain('contextToolAgents.add(key)')
    expect(toolsCallback).toContain('markComposed()')

    // And the assertion that could never hold is gone for good.
    expect(install).not.toContain('were not installed')
  })

  it('keeps the pre-dispatch gate that actually enforces the boundary', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await readFile(
      path.resolve(__dirname, '..', 'src', 'index.ts'),
      'utf8',
    )

    // Dropping the early assertion is only safe because this gate refuses to
    // dispatch an uncomposed executor instead of letting it run with
    // Host-wide Skill visibility.
    expect(source).toContain('missing its Pet scoped surface')
    expect(source).toContain('if (!isComposed(agent))')
  })
})
