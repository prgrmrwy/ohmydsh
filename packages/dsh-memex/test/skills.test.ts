import { describe, expect, it, vi } from 'vitest'
import { registerMemexSkills, resolveMemexInstallation } from '../src/lifecycle/skills.js'

describe('memex skill filesystem integration', () => {
  it('mounts the official provider with one pinned custom skill root', () => {
    const plugin = vi.fn()
    registerMemexSkills({ plugin } as never, {
      root: '/pkg/memex', skills: '/pkg/memex/skills', cli: '/pkg/memex/dist/cli.js', version: '0.4.1',
    })
    expect(plugin).toHaveBeenCalledWith(expect.any(Function), {
      includeDefaultRoots: false,
      customSkillDirs: ['/pkg/memex/skills'],
      watch: false,
      watchFollowSymlinks: false,
    })
  })

  it('resolves the installed package and verifies its pinned version', () => {
    expect(resolveMemexInstallation()).toMatchObject({ version: '0.4.1' })
  })

})
