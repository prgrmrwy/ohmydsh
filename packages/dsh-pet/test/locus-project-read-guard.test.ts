import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  installLocusProjectReadGuard,
  locusDeniedRoots,
  LOCUS_PROJECT_READ_DENIAL,
} from '../src/host/locus/project-read-guard.js'
import { ensurePetDirectories, isContainedBy, resolvePetPaths } from '../src/host/paths.js'

function probeTool(name: string, effect: () => void) {
  return defineTool({
    name,
    description: 'Project-read guard probe.',
    parameters: {},
    output: { schema: { type: 'boolean' }, render: () => [] },
    async execute() { effect(); return true },
  })
}

describe('Locus canonical project-read guard', () => {
  const roots: string[] = []
  let ctx: Context | undefined
  afterEach(async () => {
    await ctx?.fiber.dispose()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })

  it('allows workspace reads/globs and rejects DSH, media cache, missing paths, and symlink escapes before bodies run', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-guard-'))
    roots.push(base)
    const workspace = join(base, 'project')
    const dshHome = join(base, 'dsh-home')
    const media = join(dshHome, 'plugins', 'dsh-pet', 'media-cache')
    const outside = join(base, 'outside')
    await Promise.all([mkdir(workspace), mkdir(media, { recursive: true }), mkdir(outside)])
    await writeFile(join(workspace, 'ok.txt'), 'ok')
    await writeFile(join(media, 'secret.png'), 'secret')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape'))

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'guarded-child' as SessionId } as Agent
    const scope = createScope(ctx, agent)
    installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [dshHome, media],
    })
    const execute = (name: string, args: unknown) => ctx!.tools.execute({
      agent,
      name,
      callId: `${name}-${Math.random()}` as ToolCallId,
      arguments: args,
      signal: new AbortController().signal,
    })

    expect((await execute('read', { file_path: 'ok.txt' })).isError).toBe(false)
    expect((await execute('glob', { pattern: '*', path: workspace })).isError).toBe(false)
    expect(bodies).toBe(2)
    for (const [name, args] of [
      ['glob', { pattern: '*', path: media }],
      ['read', { file_path: join(media, 'secret.png') }],
      ['read', { file_path: dshHome }],
      ['read', { file_path: 'escape' }],
      ['grep', { pattern: 'x' }],
      ['read_image', { file_path: join(workspace, 'missing.png') }],
    ] as const) expect((await execute(name, args)).isError, name).toBe(true)
    expect(bodies).toBe(2)
    await scope.dispose()
  })

  it('denial carries the allowed root and how to request more paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-deny-'))
    roots.push(base)
    const workspace = join(base, 'project')
    const outside = join(base, 'outside')
    const dshHome = join(base, 'dsh-home')
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(dshHome)])
    await writeFile(join(outside, 'secret.txt'), 'secret')

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'guarded-child' as SessionId } as Agent
    const scope = createScope(ctx, agent)
    installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [dshHome],
    })

    const result = await ctx.tools.execute({
      agent,
      name: 'read',
      callId: 'read-outside' as ToolCallId,
      arguments: { file_path: join(outside, 'secret.txt') },
      signal: new AbortController().signal,
    })
    const text = JSON.stringify(result)

    // A stable machine-readable code FIRST, then the minimum the model needs to
    // choose a next step instead of retrying blind.
    expect(text).toContain(LOCUS_PROJECT_READ_DENIAL)
    expect(text).toContain(workspace)
    expect(text).toContain('所有者')
    expect(text).toContain('确认')
    // Still a denial: nothing was read, and the guidance is not an allowance.
    expect(result.isError).toBe(true)
    expect(bodies).toBe(0)
    await scope.dispose()
  })

  it('keeps refusing every outside path once the guidance is attached', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-still-denied-'))
    roots.push(base)
    const workspace = join(base, 'project')
    const outside = join(base, 'outside')
    const dshHome = join(base, 'dsh-home')
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(dshHome)])
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape'))

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'guarded-child' as SessionId } as Agent
    const scope = createScope(ctx, agent)
    installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [dshHome],
    })
    const execute = (name: string, args: unknown) => ctx!.tools.execute({
      agent,
      name,
      callId: `${name}-${Math.random()}` as ToolCallId,
      arguments: args,
      signal: new AbortController().signal,
    })

    for (const [name, args] of [
      ['read', { file_path: join(outside, 'secret.txt') }],
      ['read', { file_path: '../outside/secret.txt' }],
      ['read', { file_path: join(workspace, 'escape') }],
      ['glob', { pattern: '*', path: outside }],
      ['grep', { pattern: 'x', path: outside }],
      ['read', { file_path: dshHome }],
      ['read', { file_path: '' }],
    ] as const) expect((await execute(name, args)).isError, name).toBe(true)
    // No new allowance was introduced by the guidance.
    expect(bodies).toBe(0)
    await scope.dispose()
  })

  it('authorizes an omitted grep/glob path as the exact Session cwd the tool would search', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-default-'))
    roots.push(base)
    const workspace = join(base, 'project')
    const outside = join(base, 'outside')
    const dshHome = join(base, 'dsh-home')
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(dshHome)])

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    // The live runtime Agent carries its Session; fs-search defaults to its cwd.
    const withCwd = (cwd: string) =>
      ({ id: 'default-path-child' as SessionId, session: { header: { cwd } } }) as unknown as Agent
    const agent = withCwd(workspace)
    const scope = createScope(ctx, agent)
    installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [dshHome],
    })
    const execute = (caller: Agent, name: string, args: unknown) => ctx!.tools.execute({
      agent: caller,
      name,
      callId: `${name}-${Math.random()}` as ToolCallId,
      arguments: args,
      signal: new AbortController().signal,
    })

    expect((await execute(agent, 'grep', { pattern: 'x' })).isError).toBe(false)
    expect((await execute(agent, 'glob', { pattern: '*' })).isError).toBe(false)
    expect(bodies).toBe(2)
    // An explicitly empty path and a read without file_path stay refused.
    expect((await execute(agent, 'grep', { pattern: 'x', path: '' })).isError).toBe(true)
    expect((await execute(agent, 'read', {})).isError).toBe(true)
    expect(bodies).toBe(2)
    await scope.dispose()
  })

  it('refuses an omitted search path when the Session cwd is outside the confirmed workspace', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-default-out-'))
    roots.push(base)
    const workspace = join(base, 'project')
    const outside = join(base, 'outside')
    const dshHome = join(base, 'dsh-home')
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(dshHome)])

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    for (const cwd of [outside, dshHome, 'relative/cwd']) {
      const agent = ({ id: `child-${cwd}` as SessionId, session: { header: { cwd } } }) as unknown as Agent
      const scope = createScope(ctx, agent)
      installLocusProjectReadGuard(scope.ctx, {
        childCwd: workspace,
        parentCwd: workspace,
        workspaceRoot: workspace,
        deniedRoots: [dshHome],
      })
      for (const name of ['grep', 'glob']) {
        const result = await ctx.tools.execute({
          agent, name, callId: `${name}-${Math.random()}` as ToolCallId,
          arguments: { pattern: 'x' }, signal: new AbortController().signal,
        })
        expect(result.isError, `${name} with cwd ${cwd}`).toBe(true)
      }
      await scope.dispose()
    }
    expect(bodies).toBe(0)
  })

  it('refuses the media spool, so a child can never read what Pet downloaded for it', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-spool-'))
    roots.push(base)
    // The project root must live OUTSIDE the DSH home: a workspace inside a
    // denied root is itself refused, by design.
    const dshHome = join(base, 'dsh-home')
    const workspace = join(base, 'project')
    const paths = resolvePetPaths(dshHome)
    // The guard canonicalizes every denied root synchronously, so each one must
    // already exist — exactly as it does in production, where DSH materializes
    // its own attachment store before Pet composes a child.
    await Promise.all([
      mkdir(workspace),
      mkdir(join(dshHome, 'attachments'), { recursive: true }),
    ])
    await ensurePetDirectories(paths)
    await writeFile(join(paths.mediaSpoolRoot, 'deadbeef.bin'), 'downloaded-bytes')

    // The invariant that makes the spool acceptable as a download target: it is
    // a descendant of a root the production denylist already refuses. Asserted
    // through `locusDeniedRoots` so the test and the install site cannot drift.
    const deniedRoots = locusDeniedRoots(paths)
    expect(deniedRoots.some(root => isContainedBy(root, paths.mediaSpoolRoot))).toBe(true)

    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'spool-guarded-child' as SessionId } as Agent
    const scope = createScope(ctx, agent)
    installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots,
    })
    const execute = (name: string, args: unknown) => ctx!.tools.execute({
      agent,
      name,
      callId: `${name}-${Math.random()}` as ToolCallId,
      arguments: args,
      signal: new AbortController().signal,
    })

    const spoolFile = join(paths.mediaSpoolRoot, 'deadbeef.bin')
    for (const [name, args] of [
      ['read', { file_path: spoolFile }],
      ['read_image', { file_path: spoolFile }],
      ['glob', { pattern: '*', path: paths.mediaSpoolRoot }],
      ['glob', { pattern: '**/*.bin', path: paths.stateRoot }],
      ['grep', { pattern: 'downloaded-bytes', path: paths.mediaSpoolRoot }],
    ] as const) expect((await execute(name, args)).isError, name).toBe(true)
    expect(bodies).toBe(0)
    await scope.dispose()
  })

  it('rejects a broad or divergent parent cwd instead of unioning it into authority', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-divergent-'))
    roots.push(base)
    const project = join(base, 'project')
    const denied = join(base, 'runtime')
    await Promise.all([mkdir(project), mkdir(denied)])
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx, {
      childCwd: project,
      parentCwd: base,
      workspaceRoot: project,
      deniedRoots: [denied],
    })).toThrow('do not agree')
  })

  it('rejects a project root that contains a denied runtime root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-overlap-'))
    roots.push(base)
    const denied = join(base, 'runtime')
    await mkdir(denied)
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx, {
      childCwd: base,
      parentCwd: base,
      workspaceRoot: base,
      deniedRoots: [denied],
    })).toThrow('overlaps or contains')
  })

  it('composes on a fresh DSH home whose attachment store does not exist yet (DSH 0.2 creates it lazily)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-fresh-home-'))
    roots.push(base)
    const dshHome = join(base, 'dsh-home')
    const workspace = join(base, 'project')
    const paths = resolvePetPaths(dshHome)
    await mkdir(workspace)
    await ensurePetDirectories(paths) // creates dshHome + Pet state, NOT dshHome/attachments
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let bodies = 0
    for (const name of ['read', 'read_image', 'glob', 'grep']) ctx.tools.register(probeTool(name, () => { bodies += 1 }))
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'fresh-home-child' as SessionId } as Agent
    const scope = createScope(ctx, agent)
    expect(() => installLocusProjectReadGuard(scope.ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: locusDeniedRoots(paths),
    })).not.toThrow()
    // The store appearing later is still refused: it lives under the denied DSH home.
    await mkdir(join(dshHome, 'attachments'))
    await writeFile(join(dshHome, 'attachments', 'a.png'), 'x')
    const result = await ctx.tools.execute({
      agent, name: 'read', callId: 'late-store' as ToolCallId,
      arguments: { file_path: join(dshHome, 'attachments', 'a.png') }, signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(bodies).toBe(0)
    await scope.dispose()
  })

  it('fails closed when the missing attachment store is a dangling symlink into the project', async () => {
    // Reviewer counterexample: lexically inside DSH_HOME, physically a future
    // project path. Dropping it would let a later store be read as project data.
    const base = await mkdtemp(join(tmpdir(), 'locus-read-dangling-'))
    roots.push(base)
    const dshHome = join(base, 'dsh-home')
    const workspace = join(base, 'project')
    const paths = resolvePetPaths(dshHome)
    await mkdir(workspace)
    await ensurePetDirectories(paths)
    await symlink(join(workspace, 'future-store'), join(dshHome, 'attachments'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx!, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: locusDeniedRoots(paths),
    })).toThrow('not physically covered')
  })

  it('fails closed when a missing root sits under a symlinked ancestor that leaves the denied root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-ancestor-'))
    roots.push(base)
    const denied = join(base, 'runtime')
    const workspace = join(base, 'project')
    await Promise.all([mkdir(denied), mkdir(workspace)])
    await symlink(workspace, join(denied, 'escape'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx!, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [denied, join(denied, 'escape', 'not-yet')],
    })).toThrow('not physically covered')
  })

  it('still fails closed when a missing denied root is not covered by another denied root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-uncovered-'))
    roots.push(base)
    const workspace = join(base, 'project')
    await mkdir(workspace)
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx, {
      childCwd: workspace,
      parentCwd: workspace,
      workspaceRoot: workspace,
      deniedRoots: [join(base, 'independent-missing-root')],
    })).toThrow()
  })

  it('fails installation closed when a Host-proven root is missing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'locus-read-root-'))
    roots.push(base)
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => installLocusProjectReadGuard(ctx, {
      childCwd: join(base, 'missing'),
      parentCwd: base,
      workspaceRoot: base,
      deniedRoots: [],
    })).toThrow()
  })
})
