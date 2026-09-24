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
import { installLocusProjectReadGuard, locusDeniedRoots } from '../src/host/locus/project-read-guard.js'
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
