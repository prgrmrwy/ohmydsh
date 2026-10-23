import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, symlink, readFile } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture, REPO } from './helpers/overlay-fixture.mjs'

test('routing bundle and skill materialize together and second isolated sync is noop', async () => {
  const fx = await overlayFixture({ externalRoot: false, manifest: `dshVersion: 0.2.0-rc.2
customizations:
  - id: auto-model-routing
    type: package
    source: local
    version: 0.2.0
    enabled: true
  - id: subagent-model-routing
    type: skill
    enabled: true
` })
  const target = path.join(fx.repo, 'packages/auto-model-routing')
  await cp(path.join(REPO, 'packages/auto-model-routing'), target, { recursive: true, filter: source => !source.split(path.sep).includes('node_modules') })
  await symlink(path.join(REPO, 'packages/auto-model-routing/node_modules'), path.join(target, 'node_modules'), 'dir')
  await cp(path.join(REPO, 'skills/subagent-model-routing'), path.join(fx.repo, 'skills/subagent-model-routing'), { recursive: true })
  const first = fx.sync()
  assert.equal(first.status, 0, first.stderr)
  const deployed = path.join(fx.profile, 'node_modules/dsh-auto-model-routing')
  assert.match(await readFile(path.join(deployed, 'lib/index.js'), 'utf8'), /auto-model-routing/)
  assert.match(await readFile(path.join(deployed, 'lib/client.js'), 'utf8'), /__ModuleLoader__/)
  // The web runtime loads the declared client through the `./client` subpath; without it the chip never appears.
  const pkg = JSON.parse(await readFile(path.join(deployed, 'package.json'), 'utf8'))
  assert.equal(pkg.exports?.['./client'], './lib/client.js')
  assert.equal(pkg.exports?.['.']?.default, './lib/index.js')
  assert.match(await readFile(path.join(fx.dshHome, 'skills/subagent-model-routing/SKILL.md'), 'utf8'), /reasoning_effort/)
  const second = fx.sync()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  // Keep the test-owned directory for failed-run inspection; no live DSH_HOME is used.
})
