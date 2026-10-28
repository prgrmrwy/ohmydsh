import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repo = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
test('freshly compiled Memex CLI entries print help through installed-style symlinks without authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memex-cli-entry-'))
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), 'junction')
  const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(repo, 'packages/dsh-memex/tsconfig.json'), '--outDir', join(root, 'lib'), '--declaration', 'false'], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.stderr + compiled.stdout)
  for (const name of ['eval-selftest', 'eval-report']) {
    const target = join(root, 'lib/cli', `${name}.js`)
    const link = join(root, `${name}.js`)
    await symlink(target, link)
    const direct = spawnSync(process.execPath, [target, '--help'], { encoding: 'utf8' })
    const linked = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' })
    assert.equal(direct.status, 0, direct.stderr)
    assert.equal(linked.status, 0, linked.stderr)
    assert.ok(direct.stdout.trim().length > 0)
    assert.equal(linked.stdout, direct.stdout)
    assert.equal(linked.stderr, '')
  }
})
