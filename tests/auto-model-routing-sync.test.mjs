import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, symlink, readFile, readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture, REPO } from './helpers/overlay-fixture.mjs'

const manifest = (legacy = false, enabled = true) => `dshVersion: 0.2.0-rc.2
customizations:
  - id: auto-model-routing
    type: package
    source: local
    version: 0.5.2
    enabled: ${enabled}
${legacy ? '  - id: subagent-model-routing\n    type: skill\n    enabled: true\n' : ''}`

async function migrated() {
  const fx = await overlayFixture({ externalRoot: false, manifest: manifest(true) })
  const target = path.join(fx.repo, 'packages/auto-model-routing')
  await cp(path.join(REPO, 'packages/auto-model-routing'), target, { recursive: true, filter: source => !source.split(path.sep).includes('node_modules') })
  await symlink(path.join(REPO, 'packages/auto-model-routing/node_modules'), path.join(target, 'node_modules'), 'dir')
  await cp(path.join(target, 'skills/subagent-model-routing'), path.join(fx.repo, 'skills/subagent-model-routing'), { recursive: true })
  const old = fx.sync()
  assert.equal(old.status, 0, old.stderr)
  const oldSkill = path.join(fx.dshHome, 'skills/subagent-model-routing/SKILL.md')
  await access(oldSkill)
  await fx.putPublic('dsh.yaml', manifest())
  const { writeFile, mkdir } = await import('node:fs/promises')
  const privateSkill = path.join(fx.dshHome, 'skills/user-custom/SKILL.md')
  await mkdir(path.dirname(privateSkill), { recursive: true })
  await writeFile(privateSkill, 'untouched')
  const state = path.join(fx.dshHome, 'state/auto-model-routing/sessions/demo.json')
  await mkdir(path.dirname(state), { recursive: true })
  await writeFile(state, '{"mode":"MANUAL"}')
  const first = fx.sync()
  assert.equal(first.status, 0, first.stderr)
  await assert.rejects(access(oldSkill), { code: 'ENOENT' })
  const deployed = path.join(fx.profile, 'node_modules/dsh-auto-model-routing')
  assert.match(await readFile(path.join(deployed, 'lib/index.js'), 'utf8'), /auto-model-routing/)
  assert.match(await readFile(path.join(deployed, 'lib/client.js'), 'utf8'), /__ModuleLoader__/)
  const pkg = JSON.parse(await readFile(path.join(deployed, 'package.json'), 'utf8'))
  assert.equal(pkg.exports?.['./client'], './lib/client.js')
  assert.equal(pkg.exports?.['.']?.default, './lib/index.js')
  assert.match(await readFile(path.join(deployed, 'skills/subagent-model-routing/SKILL.md'), 'utf8'), /reasoning_effort/)
  const bundle = await readFile(path.join(deployed, 'cordis.patch.yml'), 'utf8')
  assert.match(bundle, /providerName: auto-model-routing-plugin/)
  assert.match(bundle, /includeDefaultRoots: false/)
  return { fx, deployed, state, privateSkill }
}

test('spec Scenario "旧部署迁移无重复来源"', async () => {
  const { fx, deployed, state } = await migrated()
  const skills = await readdir(path.join(deployed, 'skills'))
  assert.deepEqual(skills.filter(name => name === 'subagent-model-routing'), ['subagent-model-routing'])
  const second = fx.sync()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.equal(await readFile(state, 'utf8'), '{"mode":"MANUAL"}')
})

test('spec Scenario "插件禁用撤销 skill 与工具"', async () => {
  const { fx, deployed, state, privateSkill } = await migrated()
  await fx.putPublic('dsh.yaml', manifest(false, false))
  const disabled = fx.sync()
  assert.equal(disabled.status, 0, disabled.stderr)
  await assert.rejects(access(path.join(deployed, 'package.json')), { code: 'ENOENT' })
  await assert.rejects(access(path.join(fx.dshHome, 'skills/subagent-model-routing/SKILL.md')), { code: 'ENOENT' })
  assert.equal(await readFile(state, 'utf8'), '{"mode":"MANUAL"}')
  assert.equal(await readFile(privateSkill, 'utf8'), 'untouched')
})
