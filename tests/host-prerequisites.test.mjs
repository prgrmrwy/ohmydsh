// 本机运行前提(capability: host-prerequisites)。
//
// 回归背景:dsh-memex 的存储内核 `@touchskyer/memex` 只存在于全局 npm root。
// `dsh build` 不装它、个人同步清单不带它、记忆库里也没有它 —— 换机器/换账号/
// 重建 DSH home/恢复记忆库都会把卡片带过来而把内核落下,表现为设置页「远端
// 不可用 / 详情 missing」且召回与写卡一起失败,而恢复只能靠人记得 README 里
// 那条 npm install -g。
//
// 测试策略:跑**真实的** scripts/host-prerequisites.mjs 与 scripts/sync.mjs,
// 只把两个外部副作用换成探针 —— PATH 首位的假 `npm`(记录 argv、按 spec 造包)
// 与假全局 root。断言因此作用在实现本身,而不是测试内的逻辑副本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { overlayFixture, localPackageJson } from './helpers/overlay-fixture.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FAKE_NPM = `#!${process.execPath}
const fs = require('fs')
const path = require('path')
const argv = process.argv.slice(2)
const log = process.env.FAKE_NPM_LOG
const root = process.env.FAKE_GLOBAL_ROOT
if (log) fs.appendFileSync(log, argv.join(' ') + '\\n')
if (argv[0] === 'root' && argv[1] === '-g') { process.stdout.write(root + '\\n'); process.exit(0) }
if (argv[0] === 'install') {
  if (process.env.FAKE_NPM_SLEEP) { const end = Date.now() + Number(process.env.FAKE_NPM_SLEEP); while (Date.now() < end) {} }
  if (process.env.FAKE_NPM_FAIL === '1') { process.stderr.write('npm ERR! simulated registry failure\\n'); process.exit(1) }
  const spec = argv[2]
  const at = spec.lastIndexOf('@')
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  const dir = path.join(root, ...name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }))
  process.exit(0)
}
process.exit(0)
`

const entry = (extra = '', id = 'dsh-memex') =>
  `  - id: ${id}\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: true\n${extra}`

const manifestWith = (body) => `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n${body}`

const kernelEntry = (extra = '', id = 'dsh-memex') =>
  entry(`    hostPrerequisites:\n      - kind: npm-global\n        package: "@touchskyer/memex"\n        version: "0.4.1"\n${extra}`, id)

/**
 * Fixture with a fake global npm: PATH 首位的假 npm + 独立全局 root + 调用日志。
 *
 * @param {object} t - node:test context (for cleanup).
 * @param {object} options
 * @param {string} options.manifestBody - customizations 正文。
 * @param {string} [options.npmrc] - 仓库 .npmrc 内容。
 * @param {Record<string,string>} [options.globalPackages] - 预置在全局 root 的包版本。
 */
async function sandbox(t, { manifestBody, npmrc, globalPackages = {} }) {
  const fx = await overlayFixture({ manifest: manifestWith(manifestBody), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))

  const bin = path.join(fx.root, 'fake-bin')
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, 'npm'), FAKE_NPM)
  await chmod(path.join(bin, 'npm'), 0o755)

  const globalRoot = path.join(fx.root, 'global-root')
  await mkdir(globalRoot, { recursive: true })
  for (const [name, version] of Object.entries(globalPackages)) {
    const dir = path.join(globalRoot, ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }))
  }
  if (npmrc !== undefined) await writeFile(path.join(fx.repo, '.npmrc'), npmrc)

  const log = path.join(fx.root, 'npm.log')
  const childEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    FAKE_GLOBAL_ROOT: globalRoot,
    FAKE_NPM_LOG: log,
    // npm 生命周期会给测试进程烘焙一批 npm_config_*,它们比 .npmrc 优先级高;
    // 显式清空,让 registry 断言只反映被测代码自己的解析顺序。
    npm_config_registry: '',
    NPM_CONFIG_REGISTRY: '',
  }
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  return {
    fx,
    globalRoot,
    calls,
    run: (args = [], extra = {}) => fx.runScript('host-prerequisites.mjs', args, { ...childEnv, ...extra }),
    installs: () => calls().filter((line) => line.startsWith('install')),
  }
}

// ---------- manifest 校验(sync) ----------

test('sync 拒绝非精确版本的本机前提', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith(entry('    hostPrerequisites:\n      - kind: npm-global\n        package: "@touchskyer/memex"\n        version: "^0.4.1"\n')), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /hostPrerequisites/)
  assert.match(result.stderr, /exact version/)
})

test('sync 拒绝未知的 kind,不静默忽略', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith(entry('    hostPrerequisites:\n      - kind: homebrew\n        package: "memex"\n        version: "0.4.1"\n')), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unsupported kind/)
})

test('sync 拒绝同一前提被两个条目声明,并指出两个 owner', async (t) => {
  const body = `${kernelEntry()}\n${kernelEntry('', 'other-entry')}`
  const fx = await overlayFixture({ manifest: manifestWith(body), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /dsh-memex/)
  assert.match(result.stderr, /other-entry/)
})

test('sync 拒绝非 package 条目声明本机前提', async (t) => {
  const patch = '  - id: demo-p\n    type: patch\n    enabled: true\n    hostPrerequisites:\n      - kind: npm-global\n        package: "memex"\n        version: "0.4.1"\n'
  const fx = await overlayFixture({ manifest: manifestWith(patch), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /only valid on type package/)
})

test('合法声明通过校验,且 sync 不因它安装任何全局包', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith(kernelEntry()), externalRoot: false })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await fx.putPublic('packages/dsh-memex/package.json', localPackageJson('dsh-memex'))
  await fx.putPublic('packages/dsh-memex/index.js', 'export const value = 1\n')
  const result = fx.sync()
  assert.equal(result.status, 0, result.stderr)
  // sync 只物化 profile;本机前提由启动器在启动前 provision。
  assert.equal(existsSync(path.join(fx.dshHome, 'profiles', 'web', 'node_modules', '@touchskyer')), false)
})

// ---------- 自愈行为 ----------

test('缺失时安装声明的精确版本与 registry', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry('        registry: "https://registry.npmjs.org/"\n') })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.installs(), ['install -g @touchskyer/memex@0.4.1 --registry=https://registry.npmjs.org/'])
  assert.match(result.stdout, /已安装/)
  const installed = JSON.parse(await readFile(path.join(box.globalRoot, '@touchskyer', 'memex', 'package.json'), 'utf8'))
  assert.equal(installed.version, '0.4.1')
})

test('已就绪时不执行任何安装', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry(), globalPackages: { '@touchskyer/memex': '0.4.1' } })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.installs(), [])
  assert.match(result.stdout, /已就绪/)
  // 只探测,不安装:日志里最多只有 `root -g`。
  assert.deepEqual(box.calls(), ['root -g'])
})

test('版本不符时安装声明版本,而不是当成已满足', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry(), globalPackages: { '@touchskyer/memex': '0.4.0' } })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(box.installs().length, 1)
  assert.match(box.installs()[0], /@touchskyer\/memex@0\.4\.1/)
  assert.doesNotMatch(box.installs()[0], /\^|~|latest/)
  const installed = JSON.parse(await readFile(path.join(box.globalRoot, '@touchskyer', 'memex', 'package.json'), 'utf8'))
  assert.equal(installed.version, '0.4.1')
})

test('定制被禁用时既不检查也不安装', async (t) => {
  const disabled = `  - id: dsh-memex\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: false\n    hostPrerequisites:\n      - kind: npm-global\n        package: "@touchskyer/memex"\n        version: "0.4.1"\n`
  const box = await sandbox(t, { manifestBody: disabled })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.calls(), [])
})

test('enabledEnv 关闭时不安装(与 sync 同一判定)', async (t) => {
  const withEnv = entry(`    enabledEnv: DSH_DEMO_PREREQ\n    hostPrerequisites:\n      - kind: npm-global\n        package: "@touchskyer/memex"\n        version: "0.4.1"\n`)
  const box = await sandbox(t, { manifestBody: withEnv })
  const result = box.run([], { DSH_DEMO_PREREQ: '0' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.calls(), [])
})

test('没有任何声明时不 spawn npm', async (t) => {
  const box = await sandbox(t, { manifestBody: entry() })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.calls(), [])
  assert.match(result.stdout, /没有声明/)
})

test('安装失败时非零退出并给出可操作信息,不抛栈', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry('        registry: "https://registry.npmjs.org/"\n') })
  const result = box.run([], { FAKE_NPM_FAIL: '1' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /@touchskyer\/memex@0\.4\.1/)
  assert.match(result.stderr, /安装失败/)
  assert.doesNotMatch(result.stderr, /at Object\.|node:internal/)
})

test('安装超时被终止并如实报告', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry() })
  const result = box.run(['--timeout-ms', '400'], { FAKE_NPM_SLEEP: '5000' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /超时/)
})

test('--check 只读:不改动全局 root,未满足时非零退出', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry() })
  const before = await readdir(box.globalRoot)
  const result = box.run(['--check'])
  assert.equal(result.status, 1)
  assert.deepEqual(box.installs(), [])
  assert.deepEqual(await readdir(box.globalRoot), before)
  assert.match(result.stderr, /--check 不安装/)
})

test('--json 输出机器可读记录', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry(), globalPackages: { '@touchskyer/memex': '0.4.1' } })
  const result = box.run(['--json'])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.deepEqual(payload.problems, [])
  assert.equal(payload.records.length, 1)
  assert.deepEqual(
    { id: payload.records[0].id, package: payload.records[0].package, version: payload.records[0].version, state: payload.records[0].state },
    { id: 'dsh-memex', package: '@touchskyer/memex', version: '0.4.1', state: 'ok' },
  )
})

test('逃生门跳过自愈且不 spawn npm', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry() })
  const result = box.run([], { DSH_SKIP_HOST_PREREQUISITES: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(box.calls(), [])
})

// ---------- registry 解析顺序 ----------

test('registry 优先级:条目 > 调用方环境 > 仓库 .npmrc', async (t) => {
  const withRegistry = kernelEntry('        registry: "https://entry.example/"\n')
  const box = await sandbox(t, { manifestBody: withRegistry, npmrc: 'registry=https://npmrc.example/\n' })
  const result = box.run([], { npm_config_registry: 'https://env.example/' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(box.installs()[0], /--registry=https:\/\/entry\.example\//)
})

test('调用方 registry 覆盖仓库 .npmrc', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry(), npmrc: 'registry=https://npmrc.example/\n' })
  const result = box.run([], { npm_config_registry: 'https://env.example/' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(box.installs()[0], /--registry=https:\/\/env\.example\//)
})

test('都不设置时退回仓库 .npmrc 的 registry', async (t) => {
  const box = await sandbox(t, { manifestBody: kernelEntry(), npmrc: 'registry=https://npmrc.example/\n' })
  const result = box.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(box.installs()[0], /--registry=https:\/\/npmrc\.example\//)
})

// ---------- 声明与消费方不得漂移 ----------

test('dsh.yaml 声明的内核版本与 dsh-memex 生成物里的 KERNEL_VERSION 一致', async () => {
  const yaml = (await import('js-yaml')).default
  const { parseHostPrerequisites } = await import('../scripts/lib/host-prerequisites.mjs')

  const doc = yaml.load(readFileSync(path.join(REPO, 'dsh.yaml'), 'utf8'))
  const memex = doc.customizations.find((item) => item.id === 'dsh-memex')
  assert.ok(memex, 'dsh.yaml 缺少 dsh-memex 条目')

  const parsed = parseHostPrerequisites(memex, 'dsh-memex')
  assert.ok(Array.isArray(parsed) && parsed.length === 1, 'dsh-memex 必须声明它的存储内核前提')
  assert.equal(parsed[0].kind, 'npm-global')
  assert.equal(parsed[0].package, '@touchskyer/memex')

  // 内核 pin 的唯一真相源是生成物(它来自内核自身);manifest 必须与它一致,
  // 否则自愈会装一个插件 resolver 拒绝接受的版本 —— 那正是最坏的结果:
  // 包"装上了",工具依然全部失败。
  const generated = readFileSync(path.join(REPO, 'packages', 'dsh-memex', 'src', 'tools', 'descriptions.generated.ts'), 'utf8')
  const kernel = generated.match(/export const KERNEL_VERSION = "([^"]+)"/)
  assert.ok(kernel, 'KERNEL_VERSION 未在生成物中找到')
  assert.equal(
    parsed[0].version,
    kernel[1],
    `manifest 声明 ${parsed[0].version} 与 KERNEL_VERSION ${kernel[1]} 漂移；两处必须同步`,
  )
})
