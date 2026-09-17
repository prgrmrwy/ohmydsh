/**
 * Task 1.1 / 1.3 — real host-seam contract checks for `pet-locus-intent-triage`.
 *
 * These are NOT mock-based behavior tests (locus-management.test.ts already
 * covers that). This file records what the ACTUAL `@deepseek-ai/dsh-api-session-controller`
 * and its transitive `SessionInspection` type look like, so design.md's
 * simplified `{ events, meta.cwd }` description is checked against the real
 * shape rather than re-asserted from memory.
 */
import { describe, expect, it } from 'vitest'

describe('intent-triage host seam: sessionController.inspect shape (task 1.1)', () => {
  it('the installed @deepseek-ai/dsh-api-session-controller package exists and declares inspect()', async () => {
    // Resolve via the SAME import specifier production code would use if it
    // depended on the package directly (today it only reaches it through
    // `ctx.get('sessionController')`, never a static import — see the gap
    // recorded below).
    const pkg = await import('@deepseek-ai/dsh-api-session-controller/package.json', {
      with: { type: 'json' },
    }) as unknown as { default: { name: string; version: string } }
    expect(pkg.default.name).toBe('@deepseek-ai/dsh-api-session-controller')
    // Pin check: fail loudly if the reviewed dependency drifts without review.
    expect(pkg.default.version).toBe('0.1.2-rc.1')
  })

  it('GAP: dsh-session-persistence resolves at runtime (transitively) but is not a declared dsh-pet dependency', async () => {
    // Corrected finding (initial assumption was wrong — verified by actually
    // running the import, not by reasoning about the dependency tree from a
    // flat `ls`): the package DOES resolve at runtime, because pnpm hoists it
    // as a transitive dependency of `@deepseek-ai/dsh-api-session-controller`.
    // But it is absent from dsh-pet's own `package.json` (checked: neither
    // `dependencies` nor `devDependencies` names it — only
    // `dsh-api-session-controller` and `dsh-session` are declared there).
    //
    // Consequence for `pet_locus_intent_triage`'s only-read tool: any code
    // that does `import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'`
    // today would compile only because of this UNDECLARED transitive
    // resolution. It is not protected by semver and can silently stop
    // resolving if the controller package's own dependency graph changes.
    // `management.ts`/`index.ts` avoid this today by using a hand-written
    // `as { events?; meta?: { cwd? } }` narrowing instead of importing the
    // real type — which is why the narrowing has never been checked against
    // the real shape, only inferred from usage (see the next two tests for
    // the real shape).
    const pkgJson = JSON.parse(
      (await import('node:fs')).readFileSync(
        new URL('../package.json', import.meta.url),
        'utf8',
      ),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const declared = { ...pkgJson.dependencies, ...pkgJson.devDependencies }
    expect(declared['@deepseek-ai/dsh-session-persistence']).toBeUndefined()
    expect(declared['@deepseek-ai/dsh-api-session-controller']).toBeDefined()

    // And yet it resolves — confirming the transitive/hoisted path is real,
    // not merely theoretical.
    const mod = await import('@deepseek-ai/dsh-session-persistence')
    expect(Object.keys(mod)).toContain('SessionPersistence')
  })

  it('the real inspect() signature returns Promise<SessionInspection>, confirmed from the installed .d.ts, not re-asserted from memory', async () => {
    // We cannot `import type` a type we cannot resolve (see the GAP test
    // above), so this test reads the installed declaration file as TEXT and
    // asserts on it verbatim. This is the closest a running test can get to
    // "verified against the real package" without a resolvable type import.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const require = await import('node:module').then(m => m.createRequire(import.meta.url))
    const pkgJsonPath = require.resolve('@deepseek-ai/dsh-api-session-controller/package.json')
    const pkgDir = path.dirname(pkgJsonPath)
    const dtsPath = path.join(pkgDir, 'lib/types/index.d.ts')
    const dts = fs.readFileSync(dtsPath, 'utf8')

    expect(dts).toContain(
      'inspect(sessionId: SessionId, signal?: AbortSignal): Promise<SessionInspection>;',
    )
    // The official doc comment is the FIRST-PARTY evidence for design.md's D3
    // claim ("reading history must not activate the Agent / consume a turn").
    // If this string ever changes, D3's core citation has moved and must be
    // re-verified, not silently kept.
    expect(dts).toContain('Inspect one attached or persisted Session without activating its Agent')
  })

  it('the real SessionHeader (the type `meta` in SessionInspection actually is) has far more fields than design.md\'s simplified { cwd } sketch', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const require = await import('node:module').then(m => m.createRequire(import.meta.url))
    const dtsPath = path.join(
      path.dirname(require.resolve('@deepseek-ai/dsh-session/package.json')),
      'lib/types/types.d.ts',
    )
    const dts = fs.readFileSync(dtsPath, 'utf8')

    // These are the fields design.md's `{ meta: { cwd } }` sketch omits. This
    // test exists so that if a future task widens the narrowing assertion in
    // `management.ts`/`index.ts`, the implementer sees the full real shape
    // here instead of re-deriving it from the compiled runtime again.
    for (const field of [
      'readonly version: number;',
      'readonly id: SessionId;',
      'readonly createdAt: number;',
      'readonly cwd?: string;',
      'readonly parentSession?: SessionId;',
      'readonly isSeeded: boolean;',
    ]) {
      expect(dts).toContain(field)
    }
  })

  it('task 1.2: the existing inspect-consumption path in management.ts contains zero agent-activating calls', async () => {
    // We cannot make a REAL SessionController prove "inspect never activates
    // the Agent" from dsh-pet's side — that invariant lives inside Cordis's
    // own service implementation, one layer below anything Pet can reach in
    // a unit test, and staging a full `dsh-cordis-host-runner` just to watch
    // one call is disproportionate to what this task can actually verify.
    //
    // What Pet DOES own, and what this test verifies structurally: the
    // consumption path Pet built around `inspect` (`createLocusSessionDescriber`)
    // contains no call that could awaken a session on its own — no
    // `followup`, `queuePrompt`, `resolveAgent`, or messaging call anywhere
    // in the file. This is the real basis for design.md's D3 claim: not that
    // Pet has proven the Cordis internal, but that Pet's own code has no path
    // to accidentally reintroduce a write/wake operation next to a read one.
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../src/host/locus/management.ts', import.meta.url),
      'utf8',
    )
    for (const forbidden of ['followup', 'queuePrompt', 'resolveAgent', 'sendMessage', 'SendMessage']) {
      expect(source).not.toContain(forbidden)
    }
    // Confirms the file we just scanned is actually the one wiring `inspect`,
    // not an unrelated file that happens to be clean.
    expect(source).toContain('createLocusSessionDescriber')
    expect(source).toContain('inspect: ((sessionId: string) => Promise<')
  })

  it('task 1.3: the existing scoped-registration pattern (registerPetTools + installPetScope) needs no new plumbing for the three new tools', async () => {
    // Real finding, not a restatement of the plan: the three new tools
    // (read-only parent lookup, ledger read, `pet_locus_track`) all fit the
    // EXACT shape `pet_context`/`pet_locus_finish` already use — a
    // zero-argument tool that resolves identity via `callerSessionId(exec)`
    // and is registered through `ctx.tools.register()` inside
    // `registerPetTools`, which is itself only ever invoked from
    // `installPetScope`'s `scoped.inject(['tools'], ...)` callback. No new
    // scoping mechanism is required; this records that the existing single
    // injection point is sufficient, closing an open question implied by
    // design.md's "reuse rather than build another" framing.
    const fs = await import('node:fs')
    const toolsSource = fs.readFileSync(
      new URL('../src/host/tools.ts', import.meta.url),
      'utf8',
    )
    // The exact pattern every new tool must follow.
    expect(toolsSource).toContain('export function registerPetTools(')
    expect(toolsSource).toContain('function callerSessionId(exec: ExecutionLike): string')
    expect(toolsSource).toContain('ctx.tools.register(')
    expect(toolsSource).toContain('disposers.push(')

    const indexSource = fs.readFileSync(
      new URL('../src/index.ts', import.meta.url),
      'utf8',
    )
    // The single injection point all scoped tools ride through — confirms
    // there is exactly one place new tool registration must be threaded into,
    // not several.
    expect(indexSource).toContain("scoped.inject(['tools'], toolCtx => {")
    expect(indexSource).toContain('registerPetTools(toolCtx, {')
    // The idempotency guard tasks must not duplicate or bypass.
    expect(indexSource).toContain('contextToolAgents.add(key)')
    expect(indexSource).toContain('contextToolAgents.has(key)')
  })

  it('SessionInspection extends SessionStorageMetadata, which carries inheritedEventCount — a field design.md never mentions', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const require = await import('node:module').then(m => m.createRequire(import.meta.url))
    // dsh-session-persistence is unresolvable as an import specifier (prior
    // test), but its compiled .d.ts is still reachable on disk through the
    // session-controller package's own node_modules nesting or a hoisted
    // location; walk up from a package we CAN resolve to find it.
    const controllerDir = path.dirname(require.resolve('@deepseek-ai/dsh-api-session-controller/package.json'))
    let dir = controllerDir
    let dtsPath: string | undefined
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(dir, 'node_modules/@deepseek-ai/dsh-session-persistence/lib/types/index.d.ts')
      if (fs.existsSync(candidate)) { dtsPath = candidate; break }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    expect(dtsPath, 'dsh-session-persistence .d.ts must exist SOMEWHERE on disk even if unresolvable as a specifier').toBeDefined()
    const dts = fs.readFileSync(dtsPath as string, 'utf8')

    expect(dts).toContain('export interface SessionInspection extends SessionStorageMetadata')
    expect(dts).toContain('readonly inheritedEventCount: SessionLogOffset;')
    expect(dts).toContain('readonly events: readonly SessionEvent[];')
  })
})
