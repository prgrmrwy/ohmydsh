import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')

async function temporaryRepo(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-runtime-upgrade-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  await cp(path.join(ROOT, 'scripts'), path.join(repo, 'scripts'), { recursive: true })
  await symlink(path.join(ROOT, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  const builder = path.join(repo, 'packages/dsh-pet/compat/subagent/build-launcher.cjs')
  await mkdir(path.dirname(builder), { recursive: true })
  await writeFile(builder, '')
  return repo
}

function minimalManifest(version = '0.1.2-rc.1') {
  return [
    `dshVersion: ${version}`,
    'dependencies: []',
    'customizations:',
    '  - id: dsh-pet',
    '    type: package',
    '    source: local',
    '    version: 0.1.0',
    '    enabled: true',
    '    hostRuntimeCompatibility:',
    '      kind: pet-unified-locus-v1',
    '      supportedDshVersion: 0.1.2-rc.1',
    '',
  ].join('\n')
}

test('升级 rewrite 只改官方 dshVersion，不自动继承旧 compatibility pin', async t => {
  const repo = await temporaryRepo(t)
  const manifest = path.join(repo, 'dsh.yaml')
  await writeFile(manifest, minimalManifest())
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/check-update.mjs'), '--manifest', manifest, '--rewrite-to', '0.1.2'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const rewritten = await readFile(manifest, 'utf8')
  assert.match(rewritten, /^dshVersion: 0\.1\.2$/m)
  assert.match(rewritten, /^      supportedDshVersion: 0\.1\.2-rc\.1$/m)
})

test('sync 在任何 profile 副作用前拒绝 compatibility 版本 mismatch', async t => {
  const repo = await temporaryRepo(t)
  await writeFile(path.join(repo, 'dsh.yaml'), minimalManifest('0.1.2'))
  const dshHome = path.join(repo, 'dsh-home')
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/sync.mjs')], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, DSH_HOME: dshHome },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /supports DSH 0\.1\.2-rc\.1, but dshVersion is 0\.1\.2/)
  assert.equal(existsSync(path.join(dshHome, 'profiles/web')), false, 'mismatch 必须早于 profile scaffold')
})

test('launcher 的 auto-upgrade sync 失败分支恢复完整 manifest 并退出', async () => {
  const launcher = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.match(launcher, /if ! with_repo_registry node "\$REPO\/scripts\/sync\.mjs"; then/)
  assert.match(launcher, /cp "\$REPO\/dsh\.yaml\.bak" "\$REPO\/dsh\.yaml"/)
  assert.match(launcher, /rm -f "\$REPO\/dsh\.yaml\.bak"\s+exit 1/)
})
