import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  await harnessRef.repository.putSkillRevision({
    skillName: inspection.skillName,
    sourcePath: inspection.canonicalSourcePath,
    description: inspection.description,
    provenance: { kind: 'local-import', sourcePath: root, installedAt: Date.now() },
    fileCount: inspection.fileCount,
    totalBytes: inspection.totalBytes,
  })
  return inspection.canonicalSourcePath
}



describe('Pet allowlist provider', () => {
  it('serves only enabled skills', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const enabled = await installSkill(paths, harness, 'create-mr', 'Create MR')
    await installSkill(paths, harness, 'send-cr', 'Send CR')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabled: true,
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
      enabled: true,
      showAsShortcut: true,
    })
    await harness.repository.deleteSkillRevision('create-mr', digest)

    expect(currentAllowlist(harness.repository)).toEqual([])
  })

  it('loads a body from the registered directory, not the Workspace projection', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr', 'Create MR')

    const definition = await loadRevision(paths, 'create-mr', digest)

    expect(definition.provider).toBe('dsh-pet-allowlist')
    expect(definition.content).toContain('Instructions for create-mr')
    // Frontmatter is stripped from the model-facing body.
    expect(definition.content).not.toContain('---')
    // The resource base is the registered directory itself.
    expect(definition.resourceBase).toEqual({ kind: 'directory', path: digest })
  })

})

describe('explicit invocation boundary', () => {
  it('resolves an enabled skill at its fixed digest', async () => {
    const paths = await petStore()
    harness = await openPetHarness()
    const digest = await installSkill(paths, harness, 'create-mr', 'Create MR')
    await harness.repository.putSkillSelection({
      skillName: 'create-mr',
      enabled: true,
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

})




describe('the allowlist is the authorization boundary', () => {
  it('excludes a Skill whose selection is explicitly disabled', async () => {
    harness = await openPetHarness()
    await harness.repository.putSkillRevision({
      skillName: 'disabled-skill',
      sourcePath: '/tmp/pet-test-skills/disabled-skill',
      description: 'disabled',
      provenance: { kind: 'local-link', installedAt: 1 },
      fileCount: 1,
      totalBytes: 1,
    })
    // `enabled` is optional in the schema, so an explicit `false` is a real
    // stored shape — not only the absent-field case the UI happens to write.
    await harness.repository.putSkillSelection({
      skillName: 'disabled-skill',
      enabled: false,
      showAsShortcut: true,
    })

    // Everything downstream derives from this list: what the Agent can see,
    // what gets projected, what diagnostics report. A regression here was
    // invisible to 415 passing tests.
    expect(currentAllowlist(harness.repository)).toEqual([])
  })

  it('excludes a Skill whose selection omits the flag', async () => {
    harness = await openPetHarness()
    await harness.repository.putSkillRevision({
      skillName: 'never-enabled',
      sourcePath: '/tmp/pet-test-skills/never-enabled',
      description: 'never enabled',
      provenance: { kind: 'local-link', installedAt: 1 },
      fileCount: 1,
      totalBytes: 1,
    })
    await harness.repository.putSkillSelection({
      skillName: 'never-enabled',
      showAsShortcut: true,
    })

    expect(currentAllowlist(harness.repository)).toEqual([])
  })
})
