import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_SCRIPT = path.join(REPO, 'scripts', 'sync.mjs')

test('reinstalls a same-version local package when its source content changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-local-package-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const source = path.join(repo, 'packages', 'local-demo')
  await mkdir(path.join(repo, 'scripts'), { recursive: true })
  await mkdir(path.join(source, 'lib'), { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(SYNC_SCRIPT))
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(path.join(source, 'package.json'), JSON.stringify({
    name: 'dsh-local-demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(path.join(source, 'cordis.patch.yml'), '- insert: []\n')
  await writeFile(path.join(source, 'lib', 'index.js'), 'export const value = "first"\n')
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2))
  await writeFile(path.join(repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n  - id: local-demo\n    type: package\n    source: local\n    version: 1.0.0\n    enabled: true\n`)

  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
action="$4"
value="$5"
if [[ "$action" == add ]]; then
  src="\${value#file:}"
  name=$(node -p "require('$src/package.json').name")
  rm -rf "$profile/node_modules/$name"
  mkdir -p "$profile/node_modules"
  cp -R "$src" "$profile/node_modules/$name"
elif [[ "$action" == remove ]]; then
  rm -rf "$profile/node_modules/$value"
fi
`)
  await chmod(fake, 0o755)
  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake },
  })

  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const installed = path.join(profile, 'node_modules', 'dsh-local-demo', 'lib', 'index.js')
  assert.match(await readFile(installed, 'utf8'), /first/)
  assert.match(first.stdout, /install local package/)

  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)

  await writeFile(path.join(source, 'lib', 'index.js'), 'export const value = "second"\n')
  const third = run()
  assert.equal(third.status, 0, third.stderr)
  assert.match(third.stdout, /content changed, reinstalling/)
  assert.match(await readFile(installed, 'utf8'), /second/)

  const fourth = run()
  assert.equal(fourth.status, 0, fourth.stderr)
  assert.match(fourth.stdout, /no changes/)
})
