import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_LIMITS,
  digestBundle,
  collectBundleFiles,
  inspectBundle,
  installBundle,
  parseFrontmatter,
  verifyRevision,
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
  it('accepts a valid bundle and reports a stable digest', async () => {
    const root = await makeBundle({ extraFiles: { 'reference/notes.md': 'notes' } })

    const first = await inspectBundle(root)
    const second = await inspectBundle(root)

    expect(first.skillName).toBe('create-mr')
    expect(first.description).toBe('Create a merge request')
    expect(first.fileCount).toBe(2)
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Inspect is pure: the same bytes must produce the same digest.
    expect(second.digest).toBe(first.digest)
  })

  it('changes the digest when any file content changes', async () => {
    const root = await makeBundle()
    const before = await inspectBundle(root)
    await writeFile(path.join(root, 'SKILL.md'), '---\nname: create-mr\ndescription: Other\n---\n')
    const after = await inspectBundle(root)

    expect(after.digest).not.toBe(before.digest)
  })

  it('rejects a relative path', async () => {
    await expect(inspectBundle('relative/path')).rejects.toMatchObject({
      code: 'SKILL_IMPORT_REJECTED',
    })
  })

  it('rejects a bundle without SKILL.md', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pet-bundle-'))
    await writeFile(path.join(root, 'README.md'), 'no entry file')

    await expect(inspectBundle(root)).rejects.toThrow(/missing a regular SKILL\.md/)
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

describe('bundle installation', () => {
  it('copies into a content-addressed immutable revision', async () => {
    const paths = await petStore()
    const root = await makeBundle({ extraFiles: { 'reference/a.md': 'A' } })
    const inspection = await inspectBundle(root)

    const target = await installBundle(inspection, paths.storeRoot, paths.stagingRoot)

    expect(target).toBe(path.join(paths.storeRoot, 'create-mr', inspection.digest))
    expect(await readFile(path.join(target, 'reference/a.md'), 'utf8')).toBe('A')
    expect(await verifyRevision(paths.storeRoot, 'create-mr', inspection.digest)).toBe(true)
  })

  it('is idempotent for an identical digest', async () => {
    const paths = await petStore()
    const root = await makeBundle()
    const inspection = await inspectBundle(root)

    const first = await installBundle(inspection, paths.storeRoot, paths.stagingRoot)
    const second = await installBundle(inspection, paths.storeRoot, paths.stagingRoot)

    expect(second).toBe(first)
  })

  it('keeps the installed revision independent of later source edits', async () => {
    const paths = await petStore()
    const root = await makeBundle()
    const inspection = await inspectBundle(root)
    await installBundle(inspection, paths.storeRoot, paths.stagingRoot)

    await writeFile(path.join(root, 'SKILL.md'), '---\nname: create-mr\ndescription: Hijacked\n---\n')

    // The store copy is the authority; mutating the import source must not
    // change what was installed.
    expect(await verifyRevision(paths.storeRoot, 'create-mr', inspection.digest)).toBe(true)
    const stored = await readFile(
      path.join(paths.storeRoot, 'create-mr', inspection.digest, 'SKILL.md'),
      'utf8',
    )
    expect(stored).toContain('Create a merge request')
    expect(stored).not.toContain('Hijacked')
  })

  it('fails when the source changes between inspect and install', async () => {
    const paths = await petStore()
    const root = await makeBundle()
    const inspection = await inspectBundle(root)
    await writeFile(path.join(root, 'SKILL.md'), '---\nname: create-mr\ndescription: Changed\n---\n')

    await expect(installBundle(inspection, paths.storeRoot, paths.stagingRoot)).rejects.toThrow(
      /changed during import/,
    )
  })

  it('reports a tampered revision as unverified', async () => {
    const paths = await petStore()
    const root = await makeBundle()
    const inspection = await inspectBundle(root)
    const target = await installBundle(inspection, paths.storeRoot, paths.stagingRoot)

    await writeFile(path.join(target, 'SKILL.md'), '---\nname: create-mr\ndescription: Evil\n---\n')

    expect(await verifyRevision(paths.storeRoot, 'create-mr', inspection.digest)).toBe(false)
  })

  it('reports a missing revision as unverified', async () => {
    const paths = await petStore()
    expect(await verifyRevision(paths.storeRoot, 'create-mr', 'sha256:absent')).toBe(false)
  })
})

describe('digest canonicalization', () => {
  it('covers file paths, not just contents', async () => {
    const rootA = await mkdtemp(path.join(tmpdir(), 'pet-d-'))
    const rootB = await mkdtemp(path.join(tmpdir(), 'pet-d-'))
    await writeFile(path.join(rootA, 'a.txt'), 'same')
    await writeFile(path.join(rootB, 'b.txt'), 'same')

    const digestA = await digestBundle(rootA, await collectBundleFiles(rootA))
    const digestB = await digestBundle(rootB, await collectBundleFiles(rootB))

    expect(digestA).not.toBe(digestB)
  })
})
