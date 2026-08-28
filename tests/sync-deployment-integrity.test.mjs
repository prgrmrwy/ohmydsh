// 部署面完整性:sync 必须按 manifest 承诺的入口文件核验已部署 package,
// 而不是只看 metadata。
//
// 回归背景:devbox 上 DSH 启动报 ERR_MODULE_NOT_FOUND —— 部署副本里
// package.json 齐全但 lib/ 整个缺失(被中断的 pnpm add 留下的中间态)。
// 而 sync 的全部新鲜度判据都是元数据(deployed version / 源码内容哈希 /
// 记录的 install spec),没有一条会去看 manifest 指向的字节是否真的到位,
// 于是它稳定地报告 `up-to-date` / `no changes`,永远不修。
//
// 本文件同时钉住三条安全属性:
//   1. 检测并自愈(local 与 remote 同等对待);
//   2. 修复失败绝不留下比原先更差的部署面(不得把"残缺"变成"消失");
//   3. 源头本身残缺的包必须 fail closed 且幂等(不能每次 sync 都重装)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 夹具:一个 remote package + 一个假 CLI。假 CLI 复刻 pnpm 的关键语义 ——
 * `add` 会物化 package.json、cordis.patch.yml 与 main 指向的 lib/index.js。
 * 通过 BREAK_INSTALL 环境变量可让它模拟"装出来仍然残缺"的发布物。
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-integrity-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(path.join(repo, 'node_modules'), { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(path.join(REPO, 'scripts', 'sync.mjs')))
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  await symlink(path.join(REPO, 'node_modules', 'js-yaml'), path.join(repo, 'node_modules', 'js-yaml'), 'dir')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, type: 'module' }))
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2) + '\n')
  await writeFile(path.join(repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7
dependencies: []
customizations:
  - id: remote-demo
    type: package
    source: remote
    spec: remote-demo@1.0.0
    version: 1.0.0
    enabled: true
`)

  const calls = path.join(root, 'calls.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
printf '%s\\n' "$*" >> "${calls}"
[[ "\${4:-}" == "add" ]] || exit 0
spec="$5"; name="\${spec%@*}"; version="\${spec##*@}"
d="$profile/node_modules/$name"
mkdir -p "$d"
printf '{"name":"%s","version":"%s","main":"./lib/index.js","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}' "$name" "$version" > "$d/package.json"
printf -- '- insert: []\\n' > "$d/cordis.patch.yml"
if [[ "\${FAKE_INSTALL_FAILS:-0}" == "1" ]]; then exit 1; fi
if [[ "\${BREAK_INSTALL:-0}" != "1" ]]; then
  mkdir -p "$d/lib"; printf 'export const v=1\\n' > "$d/lib/index.js"
fi
node -e "
  const fs=require('fs');
  const p=JSON.parse(fs.readFileSync('$profile/package.json','utf8'));
  p.dependencies=p.dependencies||{}; p.dependencies['$name']='$version';
  p.dsh=p.dsh||{profile:{bundles:[]}};
  if(!p.dsh.profile.bundles.includes('$name')) p.dsh.profile.bundles.push('$name');
  fs.writeFileSync('$profile/package.json', JSON.stringify(p,null,2));
"
`)
  await chmod(fake, 0o755)
  const run = (env = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, ...env },
  })
  const deployed = path.join(profile, 'node_modules', 'remote-demo')
  return { root, repo, dshHome, profile, deployed, calls, run }
}

const callCount = async (file) =>
  (await readFile(file, 'utf8')).split('\n').filter((l) => l.includes(' add ')).length

test('检测并自愈:部署副本缺失 manifest 承诺的入口文件时,sync 重装修复', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  assert.ok(existsSync(path.join(fx.deployed, 'lib', 'index.js')), '前置:首次部署完整')

  // 模拟被中断的安装:package.json 尚在,入口文件没了。
  await rm(path.join(fx.deployed, 'lib'), { recursive: true })

  const repaired = fx.run()
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.match(repaired.stdout, /incomplete deployment remote-demo: missing lib\/index\.js/)
  assert.ok(existsSync(path.join(fx.deployed, 'lib', 'index.js')), '入口文件已恢复')
})

test('自愈后保持幂等:后续 sync 不再重装', async () => {
  const fx = await fixture()
  fx.run()
  await rm(path.join(fx.deployed, 'lib'), { recursive: true })
  fx.run()
  const afterRepair = await callCount(fx.calls)

  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.equal(await callCount(fx.calls), afterRepair, '不得再发起安装')
})

test('健康部署不被误判:完整部署面连续 sync 为空操作', async () => {
  const fx = await fixture()
  fx.run()
  const baseline = await callCount(fx.calls)
  const again = fx.run()
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /no changes/)
  assert.doesNotMatch(again.stdout, /incomplete deployment/)
  assert.equal(await callCount(fx.calls), baseline)
})

test('修复失败不得摧毁既有部署面:残缺的包必须原样保留,不能变成消失', async () => {
  const fx = await fixture()
  fx.run()
  // 留下一个"残缺但存在"的部署面:入口没了,其余文件还在。
  await rm(path.join(fx.deployed, 'lib'), { recursive: true })
  const before = (await readFile(path.join(fx.deployed, 'package.json'), 'utf8'))

  // 修复期间安装失败(网络中断等)。
  const failed = fx.run({ FAKE_INSTALL_FAILS: '1' })
  assert.notEqual(failed.status, 0, '必须失败退出')

  // 关键不变量:降级 ≠ 删除。package 目录与其 manifest 必须仍在。
  assert.ok(existsSync(fx.deployed), '部署目录不得被删除')
  assert.equal(await readFile(path.join(fx.deployed, 'package.json'), 'utf8'), before)
  assert.equal(existsSync(`${fx.deployed}.ohmydsh-recovering`), false, '不得留下隔离目录')
})

test('源头本身残缺:fail closed 且幂等 —— 报错但不每次重装', async () => {
  const fx = await fixture()
  // 发布物永远缺 lib/:重装多少次都修不好。
  const first = fx.run({ BREAK_INSTALL: '1' })
  assert.notEqual(first.status, 0)
  const afterFirst = await callCount(fx.calls)

  const second = fx.run({ BREAK_INSTALL: '1' })
  assert.notEqual(second.status, 0, '仍须报错')
  assert.match(second.stderr, /cannot be repaired by reinstalling/)
  assert.equal(await callCount(fx.calls), afterFirst, '已知无法修复者不得再重装(避免每次 sync 空转)')
})
