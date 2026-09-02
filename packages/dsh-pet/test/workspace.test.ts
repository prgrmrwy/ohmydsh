/**
 * Pet Workspace materialization.
 */

import { lstat, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { preparePetWorkspace } from '../src/host/workspace.js'
describe('standing instructions are package-owned but copied', () => {
  it('materializes a real file, not a symlink into the package', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)

    await preparePetWorkspace(paths)

    // A symlink would break on the next deploy: the package directory is
    // deleted and recreated, leaving a dangling link and stripping the
    // executor of its identity briefing. The spec also requires Pet state to
    // stay independent of the install directory.
    const info = await lstat(path.join(paths.workspaceRoot, 'AGENTS.md'))
    expect(info.isSymbolicLink()).toBe(false)
    expect(info.isFile()).toBe(true)
  })

  it('survives the package directory disappearing', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)

    const text = await readFile(path.join(paths.workspaceRoot, 'AGENTS.md'), 'utf8')

    // The copy is self-contained: nothing resolves back into the package.
    expect(text).toContain('DSH Pet Task Agent')
    expect(text).not.toContain('node_modules')
  })

  it('ships the instructions file so an installed package can read it', async () => {
    const pkg = JSON.parse(
      await readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as { files: string[] }

    // Omitting it from `files` would publish a package that throws at boot.
    expect(pkg.files).toContain('AGENTS.md')
    await expect(readFile(path.resolve(__dirname, '..', 'AGENTS.md'), 'utf8')).resolves.toContain(
      'DSH Pet executor session',
    )
  })
})
