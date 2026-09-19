import type { Context } from '@deepseek-ai/cordis'
import { apply as applyFileSystemSkills } from '@deepseek-ai/dsh-skill-filesystem'
import { resolveMemexInstallation, type MemexInstallation } from '../run/installation.js'
export { resolveMemexInstallation } from '../run/installation.js'

/** Mount upstream skills through the official filesystem provider seam. */
export function registerMemexSkills(ctx: Context, installation: MemexInstallation = resolveMemexInstallation()): void {
  ctx.plugin(applyFileSystemSkills, {
    includeDefaultRoots: false,
    customSkillDirs: [installation.skills],
    watch: false,
    watchFollowSymlinks: false,
  })
}
