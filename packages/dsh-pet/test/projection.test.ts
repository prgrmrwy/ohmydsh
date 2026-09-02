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
import { inspectBundle, installBundle } from '../src/host/skill-bundle.js'

async function petStore(): Promise<PetPaths> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

async function installSkill(
  paths: PetPaths,
  name: string,
  description = 'A skill',
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  )
  const inspection = await inspectBundle(root)
  await installBundle(inspection, paths.storeRoot, paths.stagingRoot)
  return inspection.digest
}

describe('projection publication', () => {
  it('publishes a symlink into the immutable store that DSH can follow', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')

    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })

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

  it('atomically switches an existing entry to a new revision', async () => {
    const paths = await petStore()
    const v1 = await installSkill(paths, 'create-mr', 'Version one')
    const v2 = await installSkill(paths, 'create-mr', 'Version two')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest: v1 })

    await publishProjectionEntry(paths, { skillName: 'create-mr', digest: v2 })

    expect((await inspectProjectionEntry(paths, 'create-mr', v2)).status).toBe('ok')
    const body = await readFile(path.join(paths.projectionRoot, 'create-mr', 'SKILL.md'), 'utf8')
    expect(body).toContain('Version two')
  })

  it('leaves no staging entries behind after publication', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')

    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })

    const entries = await readdir(paths.projectionRoot)
    expect(entries).toEqual(['create-mr'])
  })

  it('refuses to publish a revision that is not installed', async () => {
    const paths = await petStore()

    await expect(
      publishProjectionEntry(paths, { skillName: 'create-mr', digest: 'sha256:absent' }),
    ).rejects.toMatchObject({ code: 'SKILL_DIGEST_MISMATCH' })
  })

  it('refuses to publish a revision whose contents were tampered with', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await writeFile(
      path.join(paths.storeRoot, 'create-mr', digest, 'SKILL.md'),
      '---\nname: create-mr\ndescription: Evil\n---\n',
    )

    await expect(
      publishProjectionEntry(paths, { skillName: 'create-mr', digest }),
    ).rejects.toMatchObject({ code: 'SKILL_DIGEST_MISMATCH' })
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
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })
    await rm(path.join(paths.projectionRoot, 'create-mr'), { force: true })
    await mkdir(path.join(paths.projectionRoot, 'create-mr'), { recursive: true })

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    expect(observed.status).toBe('not-a-symlink')
  })

  it('reports a broken symlink', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })
    await rm(path.join(paths.storeRoot, 'create-mr', digest), { recursive: true, force: true })

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    expect(observed.status).toBe('missing')
    expect(observed.diagnostic).toContain('broken')
  })

  it('reports a link that escapes the immutable store', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    const outside = await mkdtemp(path.join(tmpdir(), 'pet-outside-'))
    await writeFile(
      path.join(outside, 'SKILL.md'),
      '---\nname: create-mr\ndescription: Hostile\n---\n',
    )
    await rm(path.join(paths.projectionRoot, 'create-mr'), { force: true })
    await symlink(outside, path.join(paths.projectionRoot, 'create-mr'), 'dir')

    const observed = await inspectProjectionEntry(paths, 'create-mr', digest)

    // Out-of-store content must never be silently accepted as an enabled Skill.
    expect(observed.status).toBe('out-of-store')
  })

  it('reports a link pointing at a different installed revision', async () => {
    const paths = await petStore()
    const v1 = await installSkill(paths, 'create-mr', 'Version one')
    const v2 = await installSkill(paths, 'create-mr', 'Version two')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest: v1 })

    const observed = await inspectProjectionEntry(paths, 'create-mr', v2)

    expect(observed.status).toBe('drifted')
  })

  it('collects only non-ok entries as drift', async () => {
    const paths = await petStore()
    const good = await installSkill(paths, 'create-mr')
    const bad = await installSkill(paths, 'send-cr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest: good })

    const drift = await detectProjectionDrift(paths, [
      { skillName: 'create-mr', digest: good },
      { skillName: 'send-cr', digest: bad },
    ])

    expect(drift.map(entry => entry.skillName)).toEqual(['send-cr'])
  })
})

describe('explicit projection rebuild', () => {
  it('repairs drift and removes entries that are no longer enabled', async () => {
    const paths = await petStore()
    const keep = await installSkill(paths, 'create-mr')
    const drop = await installSkill(paths, 'send-cr')
    await publishProjectionEntry(paths, { skillName: 'send-cr', digest: drop })

    const results = await rebuildProjection(paths, [{ skillName: 'create-mr', digest: keep }])

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

    await rebuildProjection(paths, [{ skillName: 'create-mr', digest }])

    expect(await readdir(paths.projectionRoot)).toEqual(['create-mr'])
  })

  it('reports a failed entry as drift instead of throwing the whole rebuild', async () => {
    const paths = await petStore()
    const good = await installSkill(paths, 'create-mr')

    const results = await rebuildProjection(paths, [
      { skillName: 'create-mr', digest: good },
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
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })

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
  it('refuses to republish a tampered revision instead of re-linking it', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })

    // Corrupt the immutable store copy itself, not the projection link.
    await writeFile(
      path.join(paths.storeRoot, 'create-mr', digest, 'SKILL.md'),
      '---\nname: create-mr\ndescription: Tampered\n---\n',
    )

    const results = await rebuildProjection(paths, [{ skillName: 'create-mr', digest }])

    // An explicit rebuild fixes broken or substituted LINKS. It must not
    // launder corrupted content back into service by re-linking it.
    expect(results[0]?.status).toBe('drifted')
    expect(results[0]?.diagnostic).toContain('does not match its digest')
  })

  it('still repairs a substituted link when the revision is intact', async () => {
    const paths = await petStore()
    const digest = await installSkill(paths, 'create-mr')
    await publishProjectionEntry(paths, { skillName: 'create-mr', digest })
    await rm(path.join(paths.projectionRoot, 'create-mr'), { force: true })
    await mkdir(path.join(paths.projectionRoot, 'create-mr'), { recursive: true })

    const results = await rebuildProjection(paths, [{ skillName: 'create-mr', digest }])

    expect(results[0]?.status).toBe('ok')
  })
})
