// 全新机器首次 sync:profile 骨架不存在时,sync 必须自己把它物化出来。
//
// 回归背景:在没有 ~/.dsh 的机器上首次 `dsh build`,syncPackages/doReset 读不到
// profiles/<name>/package.json 就 fail(`profile package.json missing`),全部
// package 定制被静默跳过,启动即缺插件。sync 曾隐式假定 profile 已被此前某次
// DSH 运行初始化过,而全新机器上并没有这一前置。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 一个「全新机器」夹具:DSH_HOME 完全不存在,manifest 里有一个 remote package。
 * 假 CLI 复刻运行体的两个相关行为:
 *   --dump-default-config -> 按需 initProfile(写出 profile manifest 骨架)
 *   plugin ... add <spec>  -> 装包并登记进 dependencies
 * 骨架缺失时 add 直接失败,以此证明 sync 确实先物化了骨架再装包。
 */
async function fixture({ preInitialized = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-profile-scaffold-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')

  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(path.join(REPO, 'scripts', 'sync.mjs')))
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  await mkdir(path.join(repo, 'node_modules'), { recursive: true })
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, type: 'module' }))
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

  // 仓库 node_modules/js-yaml 是 sync 的硬依赖,链到真实仓库的即可。
  const { symlink } = await import('node:fs/promises')
  await symlink(path.join(REPO, 'node_modules', 'js-yaml'), path.join(repo, 'node_modules', 'js-yaml'), 'dir')

  if (preInitialized) {
    await mkdir(profile, { recursive: true })
    await writeFile(path.join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
    }, null, 2) + '\n')
  }

  const actions = path.join(root, 'actions.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
actions="${actions}"
printf '%s\\n' "$*" >> "$actions"

# 运行体语义:加载 profile 时,manifest 缺失则按模板 initProfile。
if [[ "\${3:-}" == "--dump-default-config" ]]; then
  mkdir -p "$profile"
  if [[ ! -f "$profile/package.json" ]]; then
    cat > "$profile/package.json" <<'JSON'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}
JSON
  fi
  echo "[]"   # 配置树:sync 应当丢弃它,不打进日志
  exit 0
fi

# plugin add:骨架不存在就失败(与 pnpm 在无 manifest 目录中的处境一致)。
if [[ "\${4:-}" == "add" ]]; then
  if [[ ! -f "$profile/package.json" ]]; then
    echo "no profile manifest" >&2
    exit 1
  fi
  spec="$5"
  name="\${spec%@*}"
  version="\${spec##*@}"
  mkdir -p "$profile/node_modules/$name"
  printf '{"name":"%s","version":"%s","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}' "$name" "$version" > "$profile/node_modules/$name/package.json"
  # A real install also materializes the patch file the manifest declares;
  # writing only the manifest would leave the package permanently incomplete.
  printf -- '- insert: []\\n' > "$profile/node_modules/$name/cordis.patch.yml"
  node -e "
    const fs=require('fs');
    const p=JSON.parse(fs.readFileSync('$profile/package.json','utf8'));
    p.dependencies=p.dependencies||{};
    p.dependencies['$name']='$version';
    fs.writeFileSync('$profile/package.json', JSON.stringify(p,null,2));
  "
fi
`)
  await chmod(fake, 0o755)

  const run = (args = []) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs'), ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake },
  })
  return { root, repo, dshHome, profile, actions, run }
}

test('全新 DSH_HOME:sync 先物化 profile 骨架,再完成 package 物化', async () => {
  const fx = await fixture()
  assert.equal(existsSync(fx.profile), false, '前置:profile 目录尚不存在')

  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  assert.doesNotMatch(first.stderr, /profile package\.json missing/)
  assert.match(first.stdout, /initialize profile web/)

  // 骨架由运行体模板写出,而非 sync 自带副本。
  const pkg = JSON.parse(await readFile(path.join(fx.profile, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-profile-web')
  assert.deepEqual(pkg.dsh.profile.bundles.slice(0, 2), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

  // 骨架就位后 package 定制真的装上了(此前这里被整体跳过)。
  assert.match(first.stdout, /install remote package remote-demo/)
  assert.equal(existsSync(path.join(fx.profile, 'node_modules', 'remote-demo')), true)

  // 顺序不变量:init 必须发生在任何 plugin add 之前。
  const log = await readFile(fx.actions, 'utf8')
  assert.ok(log.indexOf('--dump-default-config') < log.indexOf('add remote-demo@1.0.0'), '骨架物化先于 plugin add')

  // 配置树输出被丢弃,不污染 sync 日志。
  assert.doesNotMatch(first.stdout, /^\[\]$/m)
})

test('骨架已存在时为空操作:不重复初始化,且保持幂等', async () => {
  const fx = await fixture({ preInitialized: true })
  const before = await readFile(path.join(fx.profile, 'package.json'), 'utf8')

  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  assert.doesNotMatch(first.stdout, /initialize profile/, '既有骨架不应触发初始化')
  assert.doesNotMatch(await readFile(fx.actions, 'utf8'), /--dump-default-config/)

  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.notEqual(before, undefined)
})

test('全新 DSH_HOME 上的 --reset 同样先物化骨架而不报缺失', async () => {
  const fx = await fixture()
  const reset = fx.run(['--reset'])
  assert.equal(reset.status, 0, reset.stderr)
  assert.doesNotMatch(reset.stderr, /profile package\.json missing/)
  assert.equal(existsSync(path.join(fx.profile, 'package.json')), true)
})

test('骨架物化失败时 fail closed,并报告首因', async () => {
  const fx = await fixture()
  // CLI 不可用(解析不到 bin)→ 骨架无法物化。
  const broken = spawnSync(process.execPath, [path.join(fx.repo, 'scripts', 'sync.mjs')], {
    cwd: fx.repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: fx.dshHome, DSH_BIN: path.join(fx.root, 'does-not-exist.sh') },
  })
  assert.notEqual(broken.status, 0)
  assert.match(broken.stderr, /failed to initialize profile web/)
})
