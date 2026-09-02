import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBuiltins, inventoryBuiltins, readBuiltinManifest } from '../src/host/builtins.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import {
  collectableRevisions,
  createPetSkillProvider,
  currentAllowlist,
  loadRevision,
  resolveInvocationSkill,
} from '../src/host/skill-provider.js'
import {
  inspectBundle,
  installBundle,
  removeRevisionDirectory,
  verifyRevision,
} from '../src/host/skill-bundle.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function petStore(): Promise<PetPaths> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

async function writeBundle(root: string, name: string, description: string): Promise<string> {
  await mkdir(root, { recursive: true })
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nInstructions for ${name}.\n`,
  )
  return root
}

async function installSkill(
  paths: PetPaths,
  harnessRef: PetHarness,
  name: string,
  description = 'A skill',
): Promise<string> {
  const root = await writeBundle(
    await mkdtemp(path.join(tmpdir(), 'pet-bundle-')),
    name,
    description,
  )
  const inspection = await inspectBundle(root)
  await installBundle(inspection, paths.storeRoot, paths.stagingRoot)
  await harnessRef.repository.putSkillRevision({
    skillName: inspection.skillName,
    digest: inspection.digest,
    description: inspection.description,
    provenance: { kind: 'local-import', sourcePath: root, installedAt: Date.now() },
    fileCount: inspection.fileCount,
    totalBytes: inspection.totalBytes,
  })
  return inspection.digest
}

describe('built-in manifest', () => {
  it('treats an absent manifest as no built-ins', async () => {
    expect(await readBuiltinManifest('/nonexistent/manifest.json')).toEqual([])
  })

  it('rejects a malformed manifest instead of ignoring it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(manifestPath, '{ not json')

    await expect(readBuiltinManifest(manifestPath)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a manifest with an unexpected shape', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ version: 2, skills: [] }))

    await expect(readBuiltinManifest(manifestPath)).rejects.toThrow(/malformed/)
  })

  it('installs and enables only defaultEnabled declarations on first boot', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    await writeBundle(path.join(dir, 'alpha'), 'alpha-skill', 'Alpha')
    await writeBundle(path.join(dir, 'beta'), 'beta-skill', 'Beta')
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        skills: [
          { directory: 'alpha', defaultEnabled: true },
          { directory: 'beta', defaultEnabled: false },
        ],
      }),
    )

    const result = await installBuiltins(harness.repository, paths, '0.1.0', manifestPath)

    // Both are installed as immutable revisions...
    expect(result.installed.map(r => r.skillName).sort()).toEqual(['alpha-skill', 'beta-skill'])
    // ...but only the declared default is enabled.
    expect(currentAllowlist(harness.repository).map(e => e.skillName)).toEqual(['alpha-skill'])
  })

  it('never scans undeclared directories in the package', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    await writeBundle(path.join(dir, 'declared'), 'declared-skill', 'Declared')
    await writeBundle(path.join(dir, 'sneaky'), 'sneaky-skill', 'Undeclared')
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, skills: [{ directory: 'declared', defaultEnabled: true }] }),
    )

    await installBuiltins(harness.repository, paths, '0.1.0', manifestPath)

    const names = harness.repository.listSkillRevisions().map(r => r.skillName)
    expect(names).toEqual(['declared-skill'])
  })

  it('records a newer built-in as an available upgrade without applying it', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    const bundleDir = path.join(dir, 'alpha')
    await writeBundle(bundleDir, 'alpha-skill', 'Version one')
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, skills: [{ directory: 'alpha', defaultEnabled: true }] }),
    )
    await installBuiltins(harness.repository, paths, '0.1.0', manifestPath)
    const original = harness.repository.getSkillSelection('alpha-skill')?.enabledDigest

    // A package upgrade ships a different body for the same skill.
    await writeBundle(bundleDir, 'alpha-skill', 'Version two')
    const second = await installBuiltins(harness.repository, paths, '0.2.0', manifestPath)

    expect(second.upgradesAvailable.map(item => item.skillName)).toEqual(['alpha-skill'])
    const selection = harness.repository.getSkillSelection('alpha-skill')
    // The enabled digest is untouched until the user explicitly upgrades.
    expect(selection?.enabledDigest).toBe(original)
    expect(selection?.upgradeAvailableDigest).toBeDefined()
    expect(selection?.upgradeAvailableDigest).not.toBe(original)
  })

  it('does not auto-enable new declarations after first boot', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const dir = await mkdtemp(path.join(tmpdir(), 'pet-manifest-'))
    await writeBundle(path.join(dir, 'alpha'), 'alpha-skill', 'Alpha')
    const manifestPath = path.join(dir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, skills: [{ directory: 'alpha', defaultEnabled: true }] }),
    )
    await installBuiltins(harness.repository, paths, '0.1.0', manifestPath)

    // A later package version adds a brand-new default-enabled skill.
    await writeBundle(path.join(dir, 'beta'), 'beta-skill', 'Beta')
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        skills: [
          { directory: 'alpha', defaultEnabled: true },
          { directory: 'beta', defaultEnabled: true },
        ],
      }),
    )
    await installBuiltins(harness.repository, paths, '0.2.0', manifestPath)

    // Installed, but not silently granted to the Agent.
    expect(harness.repository.getSkillRevision('beta-skill', inventoryDigest(await inventoryBuiltins(manifestPath), 'beta-skill'))).toBeDefined()
    expect(currentAllowlist(harness.repository).map(e => e.skillName)).toEqual(['alpha-skill'])
  })
})

function inventoryDigest(
  inventory: Awaited<ReturnType<typeof inventoryBuiltins>>,
  name: string,
): string {
  const found = inventory.find(item => item.skillName === name)
  if (found === undefined) throw new Error(`missing ${name}`)
  return found.digest
}

describe('Pet allowlist provider', () => {
  it('serves only enabled skills', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const enabled = await installSkill(paths, harness, 'create-mr', 'Create MR')
    await installSkill(paths, harness, 'send-cr', 'Send CR')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: enabled,
      showAsShortcut: true,
    })

    const provider = createPetSkillProvider(harness.repository, paths)
    const candidates = await provider.list()

    // `send-cr` is installed but not enabled, so the Agent never sees it.
    expect(candidates.map(c => c.name)).toEqual(['create-mr'])
  })

  it('omits a selection whose revision row was removed rather than falling back', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr')
    await installSkill(paths, harness, 'create-mr', 'Another version')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: digest,
      showAsShortcut: true,
    })
    await harness.repository.deleteSkillRevision('create-mr', digest)

    expect(currentAllowlist(harness.repository)).toEqual([])
  })

  it('loads a body from the immutable store, not the Workspace projection', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr', 'Create MR')

    const definition = await loadRevision(paths, 'create-mr', digest)

    expect(definition.provider).toBe('dsh-pet-allowlist')
    expect(definition.content).toContain('Instructions for create-mr')
    // Frontmatter is stripped from the model-facing body.
    expect(definition.content).not.toContain('---')
    expect(definition.resourceBase).toEqual({
      kind: 'directory',
      path: path.join(paths.storeRoot, 'create-mr', digest),
    })
  })

  it('refuses to load a tampered revision', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr')
    await writeFile(
      path.join(paths.storeRoot, 'create-mr', digest, 'SKILL.md'),
      '---\nname: create-mr\ndescription: Evil\n---\nHostile\n',
    )

    await expect(loadRevision(paths, 'create-mr', digest)).rejects.toMatchObject({
      code: 'SKILL_DIGEST_MISMATCH',
    })
  })
})

describe('explicit invocation boundary', () => {
  it('resolves an enabled skill at its fixed digest', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr', 'Create MR')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: digest,
      showAsShortcut: true,
    })

    const definition = await resolveInvocationSkill(harness.repository, paths, 'create-mr', digest)

    expect(definition.name).toBe('create-mr')
  })

  it('rejects an unknown skill instead of treating it as prose', async () => {
    const paths = await petStore()
    harness = await openPetHarness()

    await expect(
      resolveInvocationSkill(harness.repository, paths, 'unknown', 'sha256:x'),
    ).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' })
  })

  it('rejects a disabled skill', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr')

    await expect(
      resolveInvocationSkill(harness.repository, paths, 'create-mr', digest),
    ).rejects.toMatchObject({ code: 'SKILL_DISABLED' })
  })

  it('keeps a queued Invocation on its fixed revision after an upgrade', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const v1 = await installSkill(paths, harness, 'create-mr', 'Version one')
    const v2 = await installSkill(paths, harness, 'create-mr', 'Version two')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: v1,
      showAsShortcut: true,
    })
    // The user upgrades while v1 work is still queued.
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: v2,
      showAsShortcut: true,
    })

    const queued = await resolveInvocationSkill(harness.repository, paths, 'create-mr', v1)

    expect(queued.content).toContain('Instructions for create-mr')
    // The already-queued Invocation still resolves v1, not the new selection.
    expect(queued.path).toContain(v1)
  })
})

describe('garbage collection retention', () => {
  it('retains digests referenced by live work and enabled selections', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const repo = harness.repository
    const referenced = await installSkill(paths, harness, 'create-mr', 'Referenced')
    const orphan = await installSkill(paths, harness, 'send-cr', 'Orphan')
    await repo.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: referenced,
      showAsShortcut: true,
    })
    await repo.createTask(testTask())
    await repo.appendInvocation(testInvocation({ skillDigest: referenced }))

    const collectable = collectableRevisions(repo)

    expect(collectable).toEqual([{ skillName: 'send-cr', digest: orphan }])
  })
})

describe('uninstall retains in-use revisions', () => {
  it('removes an unreferenced revision from disk and from the store', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr')

    // Not enabled and not referenced by any Task: collectable.
    const collectable = collectableRevisions(harness.repository)
    expect(collectable).toEqual([{ skillName: 'create-mr', digest }])

    expect(await removeRevisionDirectory(paths.storeRoot, 'create-mr', digest)).toBe(true)
    await harness.repository.deleteSkillRevision('create-mr', digest)

    expect(await verifyRevision(paths.storeRoot, 'create-mr', digest)).toBe(false)
    expect(harness.repository.getSkillRevision('create-mr', digest)).toBeUndefined()
  })

  it('never collects a digest a queued Invocation still references', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr')
    await harness.repository.createTask(testTask())
    await harness.repository.appendInvocation(testInvocation({ skillDigest: digest }))

    // Uninstall disables the skill, but the fixed revision must survive so the
    // queued Invocation keeps running exactly what it accepted.
    await harness.repository.putSkillSelection({ skillName: 'create-mr', showAsShortcut: false })

    expect(collectableRevisions(harness.repository)).toEqual([])
    expect(await verifyRevision(paths.storeRoot, 'create-mr', digest)).toBe(true)
  })

  it('refuses to remove a path outside the immutable store', async () => {
    const paths = await petStore()
    await expect(
      removeRevisionDirectory(paths.storeRoot, '..', 'escape'),
    ).rejects.toMatchObject({ code: 'SKILL_IMPORT_REJECTED' })
  })

  it('treats an already-absent revision as a no-op', async () => {
    const paths = await petStore()
    expect(await removeRevisionDirectory(paths.storeRoot, 'ghost', 'sha256:none')).toBe(false)
  })
})

describe('explicit built-in upgrade', () => {
  it('clears the pending marker and moves the enabled digest', async () => {
    harness = await openPetHarness()
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: 'sha256:v1',
      showAsShortcut: true,
      upgradeAvailableDigest: 'sha256:v2',
    })

    // Applying the upgrade replaces the whole selection row.
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: 'sha256:v2',
      showAsShortcut: true,
    })

    const selection = harness.repository.getSkillSelection('create-mr')
    expect(selection?.enabledDigest).toBe('sha256:v2')
    expect(selection?.upgradeAvailableDigest).toBeUndefined()
  })

  it('bumps the skill-set generation so catalogs are republished', async () => {
    harness = await openPetHarness()
    const before = harness.repository.global.skillSetGeneration

    const after = await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabledDigest: 'sha256:v2',
      showAsShortcut: true,
    })

    expect(after).toBe(before + 1)
  })
})
