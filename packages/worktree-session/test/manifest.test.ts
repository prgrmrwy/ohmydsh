import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('package contract', () => {
  it('declares one Host+Client bundle pinned to rc.7', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.exports['./client']).toBe('./lib/client.js')
    expect(pkg.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-workspace')
    for (const dependency of ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-subagent']) {
      expect(pkg.peerDependencies[dependency]).toContain('rc.7')
    }
    for (const [name, version] of Object.entries({ ...pkg.peerDependencies, ...pkg.devDependencies })) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version).toContain('rc.7')
    }
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    expect((patch.match(/name: dsh-worktree-session/g) ?? []).length).toBe(1)
    expect(patch).toContain('continuableDelegationTools:')
    expect(patch).toMatch(/continuableDelegationTools:[\s\S]*- subagent/)
  })
})
