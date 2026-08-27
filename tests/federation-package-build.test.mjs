import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildWorkspaceEmbed } from '../scripts/build-rc2-workspace-embed.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = path.join(REPO, 'packages/dsh-federation')

function runBuild() {
  return spawnSync('npm', ['run', 'build', '--workspace', 'dsh-federation'], { cwd: REPO, encoding: 'utf8' })
}

test('package build embeds provenance, injects owned CSS and reuses unchanged verified source', async () => {
  const first = runBuild()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /workspace embed reused|workspace embed rebuilt/)
  assert.match(first.stdout, /connection compat e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9/)
  const provenance = JSON.parse(await readFile(path.join(PACKAGE, 'lib/workspace-embed-meta/provenance.json'), 'utf8'))
  assert.equal(provenance.schemaVersion, 1)
  assert.equal(provenance.dshVersion, '0.1.1-rc.2')
  assert.equal(provenance.releaseCommit, 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e')
  assert.equal(provenance.patch.sha256, '1a5338a83523a705b9357293a5ee2d2d7833971e3cff800c52c095a7f007860d')
  assert.equal(provenance.outputs.length, 3)
  const client = await readFile(path.join(PACKAGE, 'lib/client.js'), 'utf8')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{ id: "dsh-federation"/)
  assert.match(client, /data-plugin-css=/)
  assert.match(client, /tag\.dataset\.plugin = "dsh-federation"/)
  assert.match(client, /Rows_projectRow/)
  const connectionMeta = JSON.parse(await readFile(path.join(PACKAGE, 'lib/connection/package.json'), 'utf8'))
  assert.equal(connectionMeta.name, '@deepseek-ai/dsh-client-connection')
  assert.equal(connectionMeta.federationProvenance.patchSha256,
    'e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9')
  const connectionClient = await readFile(path.join(PACKAGE, 'lib/connection/lib/client.js'), 'utf8')
  assert.match(connectionClient, /id: "@deepseek-ai\/dsh-client-connection"/)
  assert.deepEqual([...connectionClient.matchAll(/require\((['"])(.*?)\1\)/g)].map(match => match[2]), [])
  await assert.rejects(stat(path.join(PACKAGE, 'lib/client.css')), /ENOENT/)

  const sourceBefore = await stat(path.join(PACKAGE, '.generated/workspace-embed/src/client/federation.ts'))
  const second = runBuild()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /workspace embed reused/)
  const sourceAfter = await stat(path.join(PACKAGE, '.generated/workspace-embed/src/client/federation.ts'))
  assert.equal(sourceAfter.mtimeMs, sourceBefore.mtimeMs)
})

test('in-worktree output is patched in an isolated stage and mismatched source preserves last-known-good', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-package-embed-'))
  const output = path.join(PACKAGE, '.generated/test-output')
  try {
    const source = path.join(root, 'source')
    const fetched = spawnSync(process.execPath, [
      'scripts/fetch-rc2-workspace-source.mjs', '--output-dir', source,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.equal(fetched.status, 0, fetched.stderr)
    const sourceRoot = path.join(source, 'deepseek-harness-b150a551')
    const built = await buildWorkspaceEmbed({ sourceDir: sourceRoot, outputDir: output })
    assert.equal(built.reused, false)
    assert.match(await readFile(path.join(output, 'src/client/federation.ts'), 'utf8'), /Rc2WorkspaceNodeSection/)
    const sentinel = path.join(output, 'sentinel.txt')
    await writeFile(sentinel, 'last-known-good')
    await writeFile(
      path.join(sourceRoot, 'packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx'),
      `${await readFile(path.join(sourceRoot, 'packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx'), 'utf8')}\n// incompatible\n`,
    )
    await assert.rejects(
      buildWorkspaceEmbed({ sourceDir: sourceRoot, outputDir: output }),
      /workspace source src\/client\/WorkspaceBrowser\.tsx/,
    )
    assert.equal(await readFile(sentinel, 'utf8'), 'last-known-good')
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})
