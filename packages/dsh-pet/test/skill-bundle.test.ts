import { mkdtemp, mkdir, readFile, symlink, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_LIMITS,
  collectBundleFiles,
  inspectBundle,
  parseFrontmatter,
} from '../src/host/skill-bundle.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'

async function makeBundle(
  options: { name?: string; description?: string; extraFiles?: Record<string, string> } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
  const name = options.name ?? 'create-mr'
  const description = options.description ?? 'Create a merge request'
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody text.\n`,
  )
  for (const [relative, content] of Object.entries(options.extraFiles ?? {})) {
    const absolute = path.join(root, relative)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  return root
}

async function petStore(): Promise<ReturnType<typeof resolvePetPaths>> {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-home-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  return paths
}

describe('frontmatter parsing', () => {
  it('reads name, description and whenToUse', () => {
    const parsed = parseFrontmatter(
      '---\nname: send-cr\ndescription: "Send a CR"\nwhenToUse: after an MR\n---\nbody',
    )
    expect(parsed).toEqual({
      name: 'send-cr',
      description: 'Send a CR',
      whenToUse: 'after an MR',
    })
  })

  it('returns nothing when there is no frontmatter block', () => {
    expect(parseFrontmatter('just a body')).toEqual({})
  })
})

describe('bundle inspection', () => {


  it('rejects a relative path', async () => {
    await expect(inspectBundle('relative/path')).rejects.toMatchObject({
      code: 'SKILL_IMPORT_REJECTED',
    })
  })

  it('rejects a bundle without SKILL.md', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(path.join(root, 'README.md'), 'no entry file')

    await expect(inspectBundle(root)).rejects.toThrow(/is not a Skill/)
  })

  it('rejects an invalid skill name', async () => {
    const root = await makeBundle({ name: 'Not_A_Valid Name' })
    await expect(inspectBundle(root)).rejects.toThrow(/not a valid kebab-case skill name/)
  })

  it('rejects a bundle with no description', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(path.join(root, 'SKILL.md'), '---\nname: create-mr\n---\nbody')

    await expect(inspectBundle(root)).rejects.toThrow(/must declare a description/)
  })

  it('rejects a symlink anywhere inside the bundle', async () => {
    const root = await makeBundle()
    const outside = await mkdtemp(path.join(tmpdir(), 'pet-outside-'))
    await writeFile(path.join(outside, 'secret.txt'), 'sensitive')
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))

    // A user-provided symlink is never resolved: a later edit to its target
    // would silently change installed semantics.
    await expect(inspectBundle(root)).rejects.toThrow(/symbolic link/)
  })

  it('rejects a bundle exceeding the file-count limit', async () => {
    const extraFiles: Record<string, string> = {}
    for (let index = 0; index <= BUNDLE_LIMITS.maxFiles; index += 1) {
      extraFiles[`file-${index}.txt`] = 'x'
    }
    const root = await makeBundle({ extraFiles })

    await expect(inspectBundle(root)).rejects.toThrow(/more than \d+ files/)
  })

  it('rejects a file exceeding the per-file size limit', async () => {
    const root = await makeBundle({
      extraFiles: { 'big.bin': 'x'.repeat(BUNDLE_LIMITS.maxFileBytes + 1) },
    })

    await expect(inspectBundle(root)).rejects.toThrow(/exceeds \d+ bytes/)
  })

  it('rejects nesting deeper than the depth limit', async () => {
    const deep = Array.from({ length: BUNDLE_LIMITS.maxDepth + 1 }, (_, i) => `d${i}`).join('/')
    const root = await makeBundle({ extraFiles: { [`${deep}/file.txt`]: 'deep' } })

    await expect(inspectBundle(root)).rejects.toThrow(/nests deeper than/)
  })
})



describe('registration links the source instead of copying it', () => {
  it('reports the canonical directory the projection will link to', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(
      path.join(root, 'SKILL.md'),
      '---\nname: demo\ndescription: Demo\n---\nBody\n',
    )

    const inspection = await inspectBundle(root)

    // A Skill is the user's own directory, so inspection reports where it is
    // rather than a digest of a copy that no longer exists.
    expect(inspection.skillName).toBe('demo')
    expect(inspection.canonicalSourcePath).toBe(await realpath(root))
  })

  it('sees an edit to the source immediately, with no reinstall', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(
      path.join(root, 'SKILL.md'),
      '---\nname: demo\ndescription: Before\n---\nBody\n',
    )
    expect((await inspectBundle(root)).description).toBe('Before')

    await writeFile(
      path.join(root, 'SKILL.md'),
      '---\nname: demo\ndescription: After\n---\nBody\n',
    )

    // This is the point of linking: the Skill is live, not a snapshot.
    expect((await inspectBundle(root)).description).toBe('After')
  })
})

describe('a non-Skill directory says what to pick instead', () => {
  it('names the nested candidates when a parent directory is chosen', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await mkdir(path.join(root, 'alpha'), { recursive: true })
    await writeFile(
      path.join(root, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: Alpha\n---\nBody\n',
    )

    // Picking the directory that HOLDS several Skills is the common mistake;
    // "missing a regular SKILL.md" alone did not say what to do about it.
    await expect(inspectBundle(root)).rejects.toThrow(/alpha/)
    await expect(inspectBundle(root)).rejects.toThrow(/directly contains/)
  })

  it('still reports plainly when there is nothing to suggest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(path.join(root, 'notes.txt'), 'no skill here')

    await expect(inspectBundle(root)).rejects.toThrow(/is not a Skill/)
  })
})



describe('a removed frontmatter field does not break existing Skills', () => {
  it('ignores a leftover petConfirm declaration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(
      path.join(root, 'SKILL.md'),
      '---\nname: legacy\ndescription: Declares a field Pet no longer reads\n' +
        'petLabel: Legacy\npetConfirm: true\n---\nBody\n',
    )

    // Skills written before the field was dropped must keep loading: rejecting
    // an unknown key would break every one of them for no benefit.
    const inspection = await inspectBundle(root)

    expect(inspection.skillName).toBe('legacy')
    expect(inspection.pet?.label).toBe('Legacy')
    expect(inspection.pet).not.toHaveProperty('confirm')
  })
})
