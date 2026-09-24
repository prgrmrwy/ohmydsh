import type { Context } from '@deepseek-ai/cordis'
import { apply as applyFileSystemSkills } from '@deepseek-ai/dsh-skill-filesystem'
import { resolveMemexInstallation, type MemexInstallation } from '../run/installation.js'
export { resolveMemexInstallation } from '../run/installation.js'

/**
 * Mount upstream skills through the official filesystem provider seam.
 *
 * The kernel is a MANUAL prerequisite (`@touchskyer/memex` on PATH), not
 * something `dsh build` installs, so "absent" is an ordinary deployment state
 * rather than a defect — and nvm scopes global packages per Node version, so
 * merely starting the Host under a different Node makes an installed kernel
 * disappear.
 *
 * Resolution therefore MUST NOT be left in a default parameter: a default
 * argument is evaluated before the function body, so `resolveMemexInstallation()`
 * throwing `ENOENT` propagated out of this call, past the caller, and aborted
 * the whole `ctx.inject(['settings','tools','skills'])` callback in
 * `index.ts` — taking `registerMemexChannel` down with it. The settings page's
 * RPC channel does not need the kernel at all, yet answered 405, and because
 * the plugin's own logger is created inside that same aborted callback the
 * failure was completely silent: no log line anywhere (observed on lumevm).
 *
 * Only skill mounting depends on the kernel, so only skill mounting is skipped.
 * That also satisfies the spec's "内核缺失时明确报错 … MUST NOT 静默降级":
 * the operator gets a named reason and the install command instead of a dead
 * settings page.
 */
export function registerMemexSkills(ctx: Context, installation?: MemexInstallation): void {
  let resolved = installation
  if (resolved === undefined) {
    try {
      resolved = resolveMemexInstallation()
    } catch (error) {
      ctx.logger('dsh-memex').warn(
        'memex kernel unavailable, skills are not mounted (settings page and other features stay available): %s. ' +
        'Install it for the Node version this Host runs under — nvm keeps global packages per version: ' +
        'npm i -g @touchskyer/memex --registry=https://registry.npmjs.org/',
        error instanceof Error ? error.message : String(error),
      )
      return
    }
  }
  ctx.plugin(applyFileSystemSkills, {
    includeDefaultRoots: false,
    customSkillDirs: [resolved.skills],
    watch: false,
    watchFollowSymlinks: false,
  })
}
