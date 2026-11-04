// 自定义 Host 运行体（hostRuntimeCompatibility / compat）机制已退役。
//
// 不变量：Host 始终使用官方精确 dshVersion 运行体；manifest 若再出现
// hostRuntimeCompatibility（公开 manifest 或 overlay），必须当作已退役字段
// fail closed 并给出明确信息，不得静默忽略。
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { npxBinPathOf } from '../scripts/lib/dsh-cli.mjs'
import { loadManifestWithOverlay, parseOverlay } from '../scripts/lib/manifest-overlay.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const VERSION = '0.2.0-rc.2'
const RETIRED = /hostRuntimeCompatibility.*已退役|已退役.*hostRuntimeCompatibility/s

const retiredEntry = [
  '  - id: dsh-pet',
  '    type: package',
  '    source: local',
  '    version: 0.1.0',
  '    enabled: true',
  '    hostRuntimeCompatibility:',
  '      kind: pet-unified-locus-v1',
  `      supportedDshVersion: ${VERSION}`,
  '',
].join('\n')

async function temporaryRepo(t, { manifest, overlay } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-compat-retired-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  await cp(path.join(ROOT, 'scripts'), path.join(repo, 'scripts'), { recursive: true })
  await symlink(path.join(ROOT, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(path.join(repo, 'dsh.yaml'), manifest ?? `dshVersion: ${VERSION}\ndependencies: []\ncustomizations:\n${retiredEntry}`)
  if (overlay !== undefined) await writeFile(path.join(repo, 'dsh.yaml.local'), overlay)
  return repo
}

function runSync(repo) {
  const dshHome = path.join(repo, 'dsh-home')
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/sync.mjs')], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, DSH_HOME: dshHome, DSH_LOCAL_MANIFEST: '' },
  })
  return { ...result, dshHome }
}

test('公开 manifest 出现 hostRuntimeCompatibility：sync 在任何 profile 写入前以“已退役”报错', async t => {
  const repo = await temporaryRepo(t)
  const result = runSync(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, RETIRED)
  assert.match(result.stderr, /dsh-pet/)
  assert.equal(existsSync(path.join(result.dshHome, 'profiles')), false, '必须早于 profile scaffold')
})

test('overlay 条目出现 hostRuntimeCompatibility：与公开 manifest 同路径 fail closed', async t => {
  const repo = await temporaryRepo(t, {
    manifest: `dshVersion: ${VERSION}\ndependencies: []\ncustomizations: []\n`,
    overlay: `customizations:\n${retiredEntry}`,
  })
  const result = runSync(repo)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, RETIRED)
  assert.equal(existsSync(path.join(result.dshHome, 'profiles')), false)
})

test('parseOverlay 与 loadManifestWithOverlay 把该字段当作已退役字段，而非静默忽略或普通未知字段', async t => {
  assert.throws(() => parseOverlay(`customizations:\n${retiredEntry}`, '/tmp/overlay.yaml'), RETIRED)

  const repo = await temporaryRepo(t)
  assert.throws(
    () => loadManifestWithOverlay({ manifestPath: path.join(repo, 'dsh.yaml'), repo, env: { DSH_LOCAL_MANIFEST: path.join(repo, 'none.yaml') }, strict: true }),
    RETIRED,
  )
})

test('dsh-server-bin 在原 Pet 声明下解析官方精确运行体（npx-cache），不读 manifest、不进 compat', async t => {
  const repo = await temporaryRepo(t)
  // A builder that would be picked up by the retired mechanism must be ignored.
  const builder = path.join(repo, 'packages/dsh-pet/compat/subagent/build-launcher.cjs')
  await mkdir(path.dirname(builder), { recursive: true })
  await writeFile(builder, "throw new Error('retired compat builder must never run')\n")

  const cacheRoot = path.join(repo, 'npm-cache')
  const bin = npxBinPathOf(`@deepseek-ai/dsh@${VERSION}`, path.join(cacheRoot, '_npx'))
  await mkdir(path.dirname(bin), { recursive: true })
  await writeFile(bin, '')

  const env = { ...process.env, DSH_CLI_VERSION: VERSION, DSH_REPO_ROOT: repo, npm_config_cache: cacheRoot }
  delete env.DSH_BIN
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/dsh-server-bin.mjs')], { encoding: 'utf8', cwd: repo, env })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`^DSH_SERVER_BIN=${bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  assert.match(result.stdout, /^DSH_RUNTIME_KIND=npx-cache$/m)
  assert.doesNotMatch(result.stdout, /DSH_RUNTIME_(OWNER|COMPAT|FINGERPRINT)/)
  assert.doesNotMatch(result.stderr, /customization Host runtime|compatibility/i)
})

test('DSH_BIN 显式覆盖仍是 dsh-server-bin 的最高优先级', async t => {
  const repo = await temporaryRepo(t)
  const env = { ...process.env, DSH_CLI_VERSION: VERSION, DSH_REPO_ROOT: repo, DSH_BIN: '/explicit/dsh' }
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/dsh-server-bin.mjs')], { encoding: 'utf8', cwd: repo, env })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^DSH_RUNTIME_KIND=env$/m)
})

test('仓库不再保留 compat 运行体：manifest 无声明，机制文件与 team-membership 补丁已删除', async () => {
  const manifest = yaml.load(await readFile(path.join(ROOT, 'dsh.yaml'), 'utf8'))
  for (const item of manifest.customizations) {
    assert.equal(Object.hasOwn(item, 'hostRuntimeCompatibility'), false, `${item.id} 仍声明 hostRuntimeCompatibility`)
  }
  const pet = manifest.customizations.find(item => item.id === 'dsh-pet')
  assert.match(pet.note, /已无 compat 运行体/)
  assert.match(pet.note, /team-membership.*退役/)
  for (const gone of [
    'scripts/lib/dsh-host-runtime.mjs',
    'packages/dsh-pet/compat/subagent/team-membership.patch',
    'packages/dsh-pet/compat/subagent/build-launcher.cjs',
    'packages/dsh-pet/compat/subagent/build.mjs',
    'packages/dsh-pet/test/team-membership-builder.test.cjs',
  ]) assert.equal(existsSync(path.join(ROOT, gone)), false, `${gone} 应已删除`)
})
