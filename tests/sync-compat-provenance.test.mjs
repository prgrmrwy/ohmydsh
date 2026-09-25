// compatDependencies 的部署面 provenance 校验。
//
// 回归背景:本机实测发现 profile 里的四个 storage overlay 停在
// `0.1.2-rc.1-locus-atomic.1`(upstreamBase a66e4702),而 launcher 根已是
// `0.1.5-rc.2-locus-atomic.2`(fb2c4b9e) —— 整整落后一个版本族,且
// **没有任何机制会喊**。
//
// 根因:sync 的 compat 新鲜度判据是「名称 + 路径 + 源目录内容 hash」。
// 名称和路径天然不变(它们是声明的一部分),而内容 hash 只回答「源码自上次
// 记账以来有没有变」。当 ledger 记录存活、源产物却已针对新的上游 base 重建
// 过一次之后,两者会一致地认为「无变化」—— 于是部署副本可以无限期地停在旧
// 上游基线上。launcher 对自己那棵树恰恰做了 provenance 校验
// (build-launcher.cjs),profile 这条通道没有。
//
// 本文件钉住三条属性:
//   1. 部署副本与源产物 upstreamBase/patchSha256 不一致时必须重装;
//   2. 诊断必须点名 provenance 漂移(而非泛化成"artifact changed");
//   3. provenance 一致时不得误判 —— 连续 sync 仍是空操作。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 源产物的 provenance:被测的"真相"一侧。 */
const SOURCE_PROVENANCE = {
  replaces: '@deepseek-ai/demo-overlay@2.0.0',
  upstreamTag: 'demo-v2.0.0',
  upstreamBase: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  patchSha256: 'b'.repeat(64),
}

/** 旧代产物的 provenance:名称/路径/版本可以完全相同,只有来源不同。 */
const STALE_PROVENANCE = {
  ...SOURCE_PROVENANCE,
  upstreamBase: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  patchSha256: 'a'.repeat(64),
}

/**
 * 夹具:一个持有 compatDependencies 的 local package。
 *
 * 假 CLI 复刻 pnpm 的关键语义:`add` 把每个 file: spec 的源目录 package.json
 * 原样物化到 profile。这正是真实通道的形状 —— 部署副本携带源产物当时的
 * dsh_compat 块。
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-provenance-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const ownerDir = path.join(repo, 'packages', 'demo-owner')
  const overlayDir = path.join(ownerDir, 'compat', 'overlay')

  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(path.join(repo, 'node_modules'), { recursive: true })
  await mkdir(path.join(ownerDir, 'lib'), { recursive: true })
  await mkdir(overlayDir, { recursive: true })
  await mkdir(profile, { recursive: true })

  for (const rel of [
    ['scripts', 'sync.mjs'],
    ['scripts', 'lib', 'dsh-cli.mjs'],
    ['scripts', 'lib', 'dsh-host-runtime.mjs'],
    ['scripts', 'lib', 'manifest-overlay.mjs'],
  ]) await writeFile(path.join(repo, ...rel), await readFile(path.join(REPO, ...rel)))
  await symlink(path.join(REPO, 'node_modules', 'js-yaml'), path.join(repo, 'node_modules', 'js-yaml'), 'dir')

  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, type: 'module' }))
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2) + '\n')

  // owner:无 build 脚本,避免夹具依赖构建工具链。
  await writeFile(path.join(ownerDir, 'package.json'), JSON.stringify({
    name: 'demo-owner', version: '1.0.0', main: './lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n')
  await writeFile(path.join(ownerDir, 'lib', 'index.js'), 'export const v = 1\n')
  await writeFile(path.join(ownerDir, 'cordis.patch.yml'), '- insert: []\n')

  // compatibility 产物:版本恒定,只有 dsh_compat 会在测试中被改写。
  const writeOverlay = async (provenance) => writeFile(
    path.join(overlayDir, 'package.json'),
    JSON.stringify({
      name: '@deepseek-ai/demo-overlay', version: '2.0.0', main: './lib/index.js',
      dsh_compat: provenance,
    }, null, 2) + '\n',
  )
  await writeOverlay(SOURCE_PROVENANCE)
  await mkdir(path.join(overlayDir, 'lib'), { recursive: true })
  await writeFile(path.join(overlayDir, 'lib', 'index.js'), 'export const v = 2\n')

  await writeFile(path.join(repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7
dependencies: []
customizations:
  - id: demo-owner
    type: package
    source: local
    version: 1.0.0
    enabled: true
    compatDependencies:
      - name: '@deepseek-ai/demo-overlay'
        path: compat/overlay
`)

  const calls = path.join(root, 'calls.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
printf '%s\\n' "$*" >> "${calls}"
[[ "\${4:-}" == "add" ]] || exit 0
shift 4
for spec in "$@"; do
  src="\${spec#file:}"
  name=$(node -e "process.stdout.write(require('$src/package.json').name)")
  d="$profile/node_modules/$name"
  mkdir -p "$(dirname "$d")"
  # pnpm 的关键语义:一个 file: 依赖若已存在且 spec 字符串未变,视为已满足
  # 并跳过物化 —— 它不会为"源目录内容变了"而重新拷贝。真机上正是这条规则
  # 让原地重建的 compatibility 产物无法经由普通 add 更新。
  if [[ -d "$d" ]]; then continue; fi
  if [[ "\${FAKE_ADD_NOOP:-0}" == "1" ]]; then continue; fi
  mkdir -p "$d"
  cp -R "$src/." "$d/"
  node -e "
    const fs=require('fs');
    const p=JSON.parse(fs.readFileSync('$profile/package.json','utf8'));
    const m=JSON.parse(fs.readFileSync('$src/package.json','utf8'));
    p.dependencies=p.dependencies||{}; p.dependencies[m.name]='$spec';
    p.dsh=p.dsh||{profile:{bundles:[]}};
    fs.writeFileSync('$profile/package.json', JSON.stringify(p,null,2));
  "
done
`)
  await chmod(fake, 0o755)

  const run = (env = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, ...env },
  })
  const deployedOverlay = path.join(profile, 'node_modules', '@deepseek-ai', 'demo-overlay')
  const deployedProvenance = async () =>
    JSON.parse(await readFile(path.join(deployedOverlay, 'package.json'), 'utf8')).dsh_compat

  /** 把部署副本改写成"旧代产物":名称、路径、版本全不变,只有来源不同。 */
  const plantStaleDeployment = async () => {
    const pkg = JSON.parse(await readFile(path.join(deployedOverlay, 'package.json'), 'utf8'))
    pkg.dsh_compat = STALE_PROVENANCE
    await writeFile(path.join(deployedOverlay, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  }

  return { root, repo, profile, calls, run, deployedOverlay, deployedProvenance, plantStaleDeployment }
}

const addCalls = async (file) =>
  (await readFile(file, 'utf8')).split('\n').filter((l) => l.includes(' add ')).length

test('provenance 漂移:部署副本来自不同上游 base 时必须重新物化', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  assert.equal((await fx.deployedProvenance()).upstreamBase, SOURCE_PROVENANCE.upstreamBase, '前置:首次部署 provenance 正确')

  // 关键:只改来源,不改名称/路径/版本,也不碰源目录 —— 因此内容 hash 与
  // ledger 完全不变,这正是现网漂移能长期存活的条件。
  await fx.plantStaleDeployment()
  assert.equal((await fx.deployedProvenance()).upstreamBase, STALE_PROVENANCE.upstreamBase)

  const repaired = fx.run()
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.equal(
    (await fx.deployedProvenance()).upstreamBase,
    SOURCE_PROVENANCE.upstreamBase,
    '部署副本必须被重新物化为源产物的来源',
  )
})

test('逐出后仍未修复必须 fail closed,不得报告成功', async () => {
  // 真机回归:第一版实现把漂移接进 compatChanged 后直接 `add`,sync 正确
  // 报告了漂移、退出码 0,而部署副本纹丝不动 —— 问题还在,却已被当作修好。
  // 安装"成功"但副本仍是旧来源时,必须以非零码失败。
  const fx = await fixture()
  fx.run()
  await fx.plantStaleDeployment()

  const broken = fx.run({ FAKE_ADD_NOOP: '1' })
  assert.notEqual(broken.status, 0, '必须以非零码失败,不得报告成功')
  assert.match(broken.stdout + broken.stderr, /still report a different upstream base/)
})

test('诊断必须点名 provenance 漂移,而不是泛化成"artifact changed"', async () => {
  const fx = await fixture()
  fx.run()
  await fx.plantStaleDeployment()

  const repaired = fx.run()
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.match(repaired.stdout, /different upstream base/)
  assert.match(repaired.stdout, /@deepseek-ai\/demo-overlay/)
})

test('退役最后一个 override:允许并恢复官方包,但部分移除仍被拒绝', async () => {
  // 守卫的本意是挡住「丢掉一部分 override、留着另一部分」—— 那会让 owner 跑在
  // 半替换的依赖树上,拿到哪一半取决于安装顺序。
  //
  // 而「退役最后一个」性质不同:owner 已经完全不再请求 override,恢复官方包正是
  // 目的本身,也不存在混合树。机制下线时必须走得通,否则 compatDependencies 永远
  // 无法移除 —— 这正是本仓库 storage 自持后遇到的情况。
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  assert.ok(existsSync(fx.deployedOverlay), '前置:override 已部署')

  // 清空 compatDependencies(保留 owner 启用)
  const manifest = path.join(fx.repo, 'dsh.yaml')
  const before = await readFile(manifest, 'utf8')
  await writeFile(manifest, before.replace(/\n    compatDependencies:[\s\S]*$/, '\n'))

  const retired = fx.run()
  assert.equal(retired.status, 0, retired.stderr)
  assert.match(retired.stdout, /retired its compatibility overrides/)

  const again = fx.run()
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /no changes/, '退役后必须幂等')
})

test('provenance 一致不被误判:连续 sync 仍为空操作', async () => {
  const fx = await fixture()
  fx.run()
  const baseline = await addCalls(fx.calls)

  const again = fx.run()
  assert.equal(again.status, 0, again.stderr)
  assert.doesNotMatch(again.stdout, /different upstream base/)
  assert.equal(await addCalls(fx.calls), baseline, '不得因 provenance 校验而重复安装')
})
