import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMemexRuntime } from '../src/plugin.js'
import { parseConfig } from '../src/scope/settings.js'
it('adds fixed selftest workspace closures only when managed configuration opts in, preserving ordinary declarations', async () => {
  const ctx = new Context(), root = join(homedir(), '.dsh-memex-eval-runs')
  try {
    const runtime = createMemexRuntime(ctx, parseConfig({ evalSelftest: true, workspaces: [{ path: '/ordinary', memory: false }] }))
    expect(runtime.config().workspaces).toContainEqual({ path: root, fallback: false })
    expect(runtime.config().workspaces).toContainEqual({ path: join(root, 'nomem'), memory: false, fallback: false })
    expect(runtime.config().workspaces).toContainEqual({ path: join(root, 'judge'), memory: false, fallback: false })
    expect(runtime.config().workspaces).toContainEqual({ path: '/ordinary', memory: false })
    const off = createMemexRuntime(ctx, parseConfig({}))
    expect(off.config().workspaces).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
