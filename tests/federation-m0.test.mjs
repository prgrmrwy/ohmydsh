import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANGE = path.join(REPO, 'openspec/changes/federated-dsh-control-plane/checking')

async function json(relative) {
  return JSON.parse(await readFile(path.join(CHANGE, relative), 'utf8'))
}

test('rc.2 route inventory includes every federation identity carrier', async () => {
  const inventory = await json('protocol/rc2-route-inventory.json')
  const routes = new Set([
    ...inventory.unaryRoutes.map((entry) => entry.path),
    ...inventory.nonUnaryRoutes.map((entry) => entry.path.split('?')[0]),
  ])
  for (const path of [
    '/api/session.list',
    '/api/session.search',
    '/api/session.create',
    '/api/session.history',
    '/api/session.models',
    '/api/session.selectModel',
    '/api/session.rename',
    '/api/session.fork',
    '/api/session.prompt',
    '/api/session.attachment',
    '/api/session.updateQueue',
    '/api/session.cancel',
    '/api/workspace.list',
    '/api/workspace.create',
    '/api/workspace.rename',
    '/api/workspace.delete',
    '/api/workspace.insertBefore',
    '/api/workspace.insertSessionBefore',
    '/api/workspace.archiveSession',
    '/api/respond',
    '/api/events.mux',
    '/api/events.host',
    '/api/session.export',
  ]) assert.ok(routes.has(path), `missing ${path}`)
})

test('checked-in rc.2 protocol fixture is synthetic and secret-free', async () => {
  const fixture = await json('protocol/rc2-synthetic-frames.json')
  assert.equal(fixture.fixturePolicy.syntheticOnly, true)
  assert.equal(fixture.fixturePolicy.containsCredentials, false)
  assert.equal(fixture.fixturePolicy.containsRealPaths, false)
  assert.equal(fixture.fixturePolicy.containsUserHistory, false)
  const serialized = JSON.stringify(fixture)
  assert.doesNotMatch(serialized, /\/Users\/|\/home\/[A-Za-z0-9._-]+\//)
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]+/i)
})

test('workspace source manifest pins complete rc.2 client source and license blobs', async () => {
  const manifest = await json('upstream/rc2-workspace-source-manifest.json')
  assert.equal(manifest.releaseCommit, 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e')
  assert.equal(manifest.archive.sha256, 'a94d9b561d366f4d630ee5bc30a8b37eb8dd58ee284bb16bdde0409ecdfa84d6')
  assert.equal(manifest.license.spdx, 'MIT')
  const byPath = new Map(manifest.blobs.map((entry) => [entry.path, entry]))
  assert.equal(byPath.get('packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx')?.gitBlob, '08f22ed400ac3a80852df186e5a899bc8ba53c33')
  assert.ok(byPath.has('packages/client/ui-workspace/src/client/rows/Rows.tsx'))
  assert.ok(byPath.has('packages/client/ui-workspace/src/client/stores.ts'))
  assert.ok(byPath.has('packages/client/ui-workspace/src/client/tree.ts'))
  assert.ok(byPath.has('LICENSE'))
  assert.equal(new Set(manifest.blobs.map((entry) => entry.gitBlob)).size, manifest.blobs.length)
})

test('workspace source fetcher fails closed on offline cache miss', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-source-test-'))
  try {
    const result = spawnSync(process.execPath, [
      'scripts/fetch-rc2-workspace-source.mjs',
      '--offline',
      '--cache-dir', path.join(root, 'cache'),
      '--output-dir', path.join(root, 'output'),
    ], { cwd: REPO, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /offline workspace source cache miss or corruption/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace embed patch is pinned and exports only the build-time federation seam', async () => {
  const manifest = await json('upstream/rc2-workspace-source-manifest.json')
  const patch = await readFile(path.join(CHANGE, 'upstream', manifest.patch.path), 'utf8')
  assert.equal(manifest.patch.sha256, '1a5338a83523a705b9357293a5ee2d2d7833971e3cff800c52c095a7f007860d')
  assert.match(patch, /export function Rc2WorkspaceNodeSection/)
  assert.match(patch, /<Rc2WorkspaceNodeSection/)
  assert.match(patch, /src\/client\/federation\.ts/)
  assert.match(patch, /performs no slot registration/)
  assert.doesNotMatch(patch, /export function apply/)
  assert.deepEqual(manifest.patch.outputs.map(output => output.path), [
    'src/client/WorkspaceBrowser.tsx',
    'src/client/rows/Rows.tsx',
    'src/client/federation.ts',
  ])
})

test('rc.2 SlotCore inspection retains an untyped component but exposes no public re-render operation', async () => {
  const core = new SlotCore()
  const Component = () => null
  core.register({ name: 'root', registrant: 'synthetic-fixture' }, Component)
  const entry = core.entries('root')[0]
  assert.equal(entry.component, Component)
  assert.deepEqual(Object.keys(entry).sort(), ['component', 'options', 'registrant'])
  assert.equal(typeof core.render, 'undefined')
  assert.equal(typeof core.renderEntry, 'undefined')
  assert.equal(typeof core.renderSlot, 'undefined')

  const slotsTypes = await readFile(path.join(REPO, 'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts'), 'utf8')
  assert.match(slotsTypes, /export interface StoredEntry[\s\S]*?component: unknown;/)
  assert.match(slotsTypes, /inject\?: \(\(\.\.\.args: never\[\]\) => Record<string, unknown>\)/)
  const runtimeTypes = await readFile(path.join(REPO, 'node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/slots.d.ts'), 'utf8')
  assert.match(runtimeTypes, /renderSlot<[\s\S]*?ReturnType<SlotRenderer\['renderRoot'\]>/)
  assert.match(runtimeTypes, /entries\(key:[\s\S]*?readonly StoredEntry\[\]/)
  assert.doesNotMatch(runtimeTypes, /renderEntry\(/)
})

test('the extraction guard keeps full Browser shell ownership outside NodeSection', async () => {
  const manifest = await json('upstream/rc2-workspace-source-manifest.json')
  const patch = await readFile(path.join(CHANGE, 'upstream', manifest.patch.path), 'utf8')
  const nodeSectionStart = patch.indexOf('+export function Rc2WorkspaceNodeSection')
  const browserStart = patch.indexOf(' export function WorkspaceBrowser')
  assert.ok(nodeSectionStart > 0)
  assert.ok(browserStart > nodeSectionStart)
  const nodeSectionDiff = patch.slice(nodeSectionStart, browserStart)
  assert.doesNotMatch(nodeSectionDiff, /searchSessions|WorkspacePickFlow|renderSlot|expandSidebar|sectionHeader|ViewOptionsMenu/)
  assert.match(patch, /<Rc2WorkspaceNodeSection/)
  assert.match(patch, /nodeKey="official-local"/)
  assert.match(patch, /data-rc2-workspace-node-section=\{nodeKey\}/)
  assert.match(patch, /overlayNamespace/)
})

test('workspace embed builder refuses a changed target before replacing a good artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-embed-test-'))
  try {
    const fetched = spawnSync(process.execPath, [
      'scripts/fetch-rc2-workspace-source.mjs',
      '--cache-dir', path.join(root, 'cache'),
      '--output-dir', path.join(root, 'source'),
    ], { cwd: REPO, encoding: 'utf8' })
    assert.equal(fetched.status, 0, fetched.stderr)
    const source = path.join(root, 'source', 'deepseek-harness-b150a551')
    const output = path.join(root, 'embed')
    const first = spawnSync(process.execPath, [
      'scripts/build-rc2-workspace-embed.mjs',
      '--source-dir', source,
      '--output-dir', output,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    const sentinel = path.join(output, 'sentinel.txt')
    await writeFile(sentinel, 'last-known-good', 'utf8')

    const changed = path.join(root, 'changed')
    await mkdir(path.join(changed, 'packages/client'), { recursive: true })
    const sourcePackage = path.join(source, 'packages/client/ui-workspace')
    const changedPackage = path.join(changed, 'packages/client/ui-workspace')
    const copied = spawnSync('cp', ['-R', sourcePackage, changedPackage], { encoding: 'utf8' })
    assert.equal(copied.status, 0, copied.stderr)
    await writeFile(
      path.join(changedPackage, 'src/client/WorkspaceBrowser.tsx'),
      `${await readFile(path.join(changedPackage, 'src/client/WorkspaceBrowser.tsx'), 'utf8')}\n// incompatible\n`,
      'utf8',
    )
    const rejected = spawnSync(process.execPath, [
      'scripts/build-rc2-workspace-embed.mjs',
      '--source-dir', changed,
      '--output-dir', output,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /workspace source src\/client\/WorkspaceBrowser\.tsx/)
    assert.equal(await readFile(sentinel, 'utf8'), 'last-known-good')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
