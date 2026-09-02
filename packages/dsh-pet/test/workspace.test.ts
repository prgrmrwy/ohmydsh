/**
 * Pet Workspace materialization.
 */

import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import {
  inspectWorkspace,
  preparePetWorkspace,
  repairWorkspace,
} from '../src/host/workspace.js'
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
    expect(pkg.files).toContain('executor-instructions.md')
    await expect(
      readFile(path.resolve(__dirname, '..', 'executor-instructions.md'), 'utf8'),
    ).resolves.toContain('DSH Pet executor session')

    // NOT `AGENTS.md` in the package: that is DSH's directory-level
    // instruction convention, so anyone working inside `packages/dsh-pet`
    // would load these executor instructions as their own.
    expect(pkg.files).not.toContain('AGENTS.md')
  })
})

describe('the Workspace self-heals instead of staying broken', () => {
  it('detects a deleted instructions file', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)
    await rm(path.join(paths.workspaceRoot, 'AGENTS.md'))

    const health = await inspectWorkspace(paths)

    // Preparation runs once at boot, so a file deleted afterwards would
    // otherwise persist until the next restart.
    expect(health.ok).toBe(false)
    expect(health.problems.join(' ')).toContain('missing')
  })

  it('detects instructions left stale by a package upgrade', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)
    await writeFile(path.join(paths.workspaceRoot, 'AGENTS.md'), 'outdated text\n')

    const health = await inspectWorkspace(paths)

    expect(health.ok).toBe(false)
    expect(health.problems.join(' ')).toContain('stale')
  })

  it('repairs a symlink WITHOUT writing through it', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)

    const decoy = path.join(home, 'decoy.md')
    await writeFile(decoy, 'PACKAGE CONTENT')
    const target = path.join(paths.workspaceRoot, 'AGENTS.md')
    await rm(target)
    await symlink(decoy, target)

    const health = await repairWorkspace(paths)

    // `writeFile` FOLLOWS a symlink, so a naive repair would overwrite the
    // package's own file and leave the bad link in place.
    expect(health.ok).toBe(true)
    expect(await readFile(decoy, 'utf8')).toBe('PACKAGE CONTENT')
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
  })

  it('restores a missing projection directory', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)
    await rm(paths.projectionRoot, { recursive: true })

    expect((await inspectWorkspace(paths)).ok).toBe(false)
    expect((await repairWorkspace(paths)).ok).toBe(true)
  })

  it('reports healthy right after preparation', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    await preparePetWorkspace(paths)

    expect(await inspectWorkspace(paths)).toEqual({ ok: true, problems: [] })
  })
})
