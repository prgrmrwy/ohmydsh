/**
 * Kernel-absent behaviour, in its own file on purpose.
 *
 * `resolveMemexInstallation()` memoizes its result in a module-level `cached`,
 * so any test that resolves it successfully first would make a later
 * "kernel is missing" case unreachable. Vitest gives each test FILE its own
 * module registry, so isolating this case here is what keeps the cache empty
 * when it runs — putting it beside the happy-path cases in `skills.test.ts`
 * silently passed for the wrong reason.
 */
import { describe, expect, it, vi } from 'vitest'
import { registerMemexSkills } from '../src/lifecycle/skills.js'

describe('memex kernel absent', () => {
  // Regression: the kernel is a MANUAL prerequisite (`@touchskyer/memex` on
  // PATH), and nvm scopes global packages per Node version — starting the Host
  // under a different Node is enough to make an installed kernel invisible.
  //
  // Resolution used to sit in a DEFAULT PARAMETER, which is evaluated before
  // the function body, so the ENOENT escaped this call, escaped its caller,
  // and aborted the whole `ctx.inject(['settings','tools','skills'])` callback
  // in index.ts. That took `registerMemexChannel` down with it: the settings
  // page answered 405 despite needing no kernel at all, and because the
  // plugin's logger is created inside that same aborted callback, the failure
  // produced no log line anywhere. Observed on lumevm; the spec's
  // "内核缺失时明确报错 … MUST NOT 静默降级" forbids exactly that outcome.
  it('skips only skill mounting, keeps the plugin alive, and names the fix', () => {
    const plugin = vi.fn()
    const warn = vi.fn()
    const ctx = { plugin, logger: () => ({ warn }) }

    // `npm root -g` is spawned through PATH, so an empty PATH reproduces the
    // absent-kernel failure without mocking the module.
    const realPath = process.env.PATH
    process.env.PATH = '/nonexistent-for-this-test'
    try {
      expect(() => registerMemexSkills(ctx as never)).not.toThrow()
    } finally {
      process.env.PATH = realPath
    }

    expect(plugin).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()

    const [message] = warn.mock.calls[0] as [string]
    expect(message).toMatch(/skills are not mounted/)
    expect(message).toMatch(/npm i -g @touchskyer\/memex/)
    expect(message).toMatch(/per version/)
  })
})
