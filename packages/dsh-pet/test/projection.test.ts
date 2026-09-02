import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import {
  detectProjectionDrift,
  inspectProjectionEntry,
  publishProjectionEntry,
  rebuildProjection,
  removeProjectionEntry,
} from '../src/host/projection.js'
import { inspectBundle, } from '../src/host/skill-bundle.js'

async function petStore(): Promise<PetPaths> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

/**
 * Create a Skill directory and return its canonical path.
 *
 * Registration links the user's own directory, so a test "installs" a Skill
 * simply by creating one — there is no store copy to produce.
 */
async function installSkill(
  paths: PetPaths,
  name: string,
  description = 'A skill',
): Promise<string> {
  void paths
  const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  )
  const inspection = await inspectBundle(root)
  return inspection.canonicalSourcePath
}

describe('projection publication', () => {
  it('publishes a symlink into the immutable store that DSH can follow', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')

    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })

    const entryPath = path.join(paths.projectionRoot, 'create-mr')
    const info = await lstat(entryPath)
    expect(info.isSymbolicLink()).toBe(true)
    // DSH's filesystem provider stats the final target and reads the bundle
    // through the link, so the entry file must be readable through it.
    const body = await readFile(path.join(entryPath, 'SKILL.md'), 'utf8')
    expect(body).toContain('name: create-mr')

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)
    expect(observed.status).toBe('ok')
  })

  it('atomically switches an existing entry to a new directory', async () => {
    const paths = await petStore()
    const v1 = await installSkill(paths, 'create-mr', 'Version one')
    const v2 = await installSkill(paths, 'create-mr', 'Version two')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: v1 })

    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: v2 })

    expect((await inspectProjectionEntry(paths, 'create-mr', v2)).status).toBe('ok')
    const body = await readFile(path.join(paths.projectionRoot, 'create-mr', 'SKILL.md'), 'utf8')
    expect(body).toContain('Version two')
  })

  it('leaves no staging entries behind after publication', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')

    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })

    const entries = await readdir(paths.projectionRoot)
    expect(entries).toEqual(['create-mr'])
  })


})

describe('projection drift fails closed', () => {
  it('reports a missing entry', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    expect(observed.status).toBe('missing')
  })

  it('reports an entry replaced by a plain directory', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })
    await rm(path.join(paths.projectionRoot, 'create-mr'), { force: true })
    await mkdir(path.join(paths.projectionRoot, 'create-mr'), { recursive: true })

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    expect(observed.status).toBe('not-a-symlink')
  })

  it('reports a broken symlink', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })
    // Deleting the registered directory breaks the link.
    await rm(digest, { recursive: true, force: true })

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    expect(observed.status).toBe('missing')
    expect(observed.diagnostic).toContain('broken')
  })



  it('collects only non-ok entries as drift', async () => {
    const paths = await petStore()
    const good = await installSkill(paths, 'create-mr')
    const bad = await installSkill(paths, 'send-cr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: good })

    const drift = await detectProjectionDrift(paths, [
      { skillName: 'create-mr', sourcePath: good },
      { skillName: 'send-cr', sourcePath: bad },
    ])

    expect(drift.map(entry => entry.skillName)).toEqual(['send-cr'])
  })
})

describe('explicit projection rebuild', () => {
  it('repairs drift and removes entries that are no longer enabled', async () => {
    const paths = await petStore()
    const keep = await installSkill(paths, 'create-mr')
    const drop = await installSkill(paths, 'send-cr')
    await publishProjectionEntry(paths, { skillName: 'send-cr', sourcePath: drop })

    const results = await rebuildProjection(paths, [{ skillName: 'create-mr', sourcePath: keep }])

    expect(results).toEqual([
      expect.objectContaining({ skillName: 'create-mr', status: 'ok' }),
    ])
    expect(await readdir(paths.projectionRoot)).toEqual(['create-mr'])
  })

  it('clears abandoned staging links from an interrupted publish', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await symlink(
      path.join(paths.storeRoot, 'create-mr', digest),
      path.join(paths.projectionRoot, '.create-mr.staging-123-456'),
      'dir',
    )

    await rebuildProjection(paths, [{ skillName: 'create-mr', sourcePath: digest }])

    expect(await readdir(paths.projectionRoot)).toEqual(['create-mr'])
  })

  it('reports a failed entry as drift instead of throwing the whole rebuild', async () => {
    const paths = await petStore()
    const good = await installSkill(paths, 'create-mr')

    const results = await rebuildProjection(paths, [
      { skillName: 'create-mr', sourcePath: good },
      { skillName: 'send-cr', digest: 'sha256:absent' },
    ])

    expect(results[0]).toMatchObject({ skillName: 'create-mr', status: 'ok' })
    expect(results[1]).toMatchObject({ skillName: 'send-cr', status: 'drifted' })
  })
})

describe('projection removal', () => {
  it('removes a Pet-managed link', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })

    await removeProjectionEntry(paths, 'create-mr')

    expect(await readdir(paths.projectionRoot)).toEqual([])
  })

  it('refuses to delete foreign content it did not create', async () => {
    const paths = await petStore()
    await mkdir(path.join(paths.projectionRoot, 'create-mr'), { recursive: true })
    await writeFile(path.join(paths.projectionRoot, 'create-mr', 'SKILL.md'), 'user content')

    await expect(removeProjectionEntry(paths, 'create-mr')).rejects.toMatchObject({
      code: 'PROJECTION_DRIFT',
    })
  })

  it('is a no-op for an absent entry', async () => {
    const paths = await petStore()
    await expect(removeProjectionEntry(paths, 'create-mr')).resolves.toBeUndefined()
  })
})

describe('rebuild repairs links, never contents', () => {

  it('still repairs a substituted link when the revision is intact', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', sourcePath: digest })
    await rm(path.join(paths.projectionRoot, 'create-mr'), { force: true })
    await mkdir(path.join(paths.projectionRoot, 'create-mr'), { recursive: true })

    const results = await rebuildProjection(paths, [{ skillName: 'create-mr', sourcePath: digest }])

    expect(results[0]?.status).toBe('ok')
  })
})
