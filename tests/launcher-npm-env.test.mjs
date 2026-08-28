// 启动器 npm 环境边界契约(capability: launcher-npm-environment)。
//
// 回归背景:启动器曾用 `export npm_config_registry=<repo .npmrc>` 让自己的
// npm 操作对齐仓库源,并用 `npx -y @deepseek-ai/dsh@<ver> web` 拉起 server。
// 两者叠加的后果是:npx 把解析后的完整 npm 配置烘焙成一批 npm_* 变量交给
// server,server 再透传给每个 agent shell —— 而环境变量优先级高于所有
// .npmrc,于是用户在**任意**仓库执行 npm/pnpm/rush 都被仓库配置劫持(内网
// 镜像用户表现为拉内网包 404;engine-strict 泄漏则让第三方仓库安装硬失败)。
//
// 测试策略:跑**真实的 bin/dsh**,只把最终那条 server exec 换成打印自身
// 环境的探针。断言因此作用在实现本身,而不是测试内的逻辑副本 —— 后者对
// bin/dsh 的改动不敏感,起不到回归保护作用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverBinFrom } from '../scripts/lib/dsh-cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// npx 烘焙进长期进程的那批变量(实测形态),用作污染基线。
const BAKED = {
  npm_config_registry: 'https://baked.example/',
  npm_config_engine_strict: 'true',
  npm_config_yes: 'true',
  npm_config_cache: '/baked/cache',
  npm_config_local_prefix: '/baked/prefix',
  npm_lifecycle_event: 'npx',
  npm_package_name: 'ohmydsh',
  npm_command: 'exec',
  npm_execpath: '/baked/npm-cli.js',
  npm_node_execpath: '/baked/node',
}

/**
 * 真实启动器沙箱:保留 bin/dsh 全部逻辑,只替换两处外部副作用 ——
 *  1. CLI 解析(会联网安装)→ 固定回显一个 .bin/dsh 路径;
 *  2. server exec → 打印子进程实际拿到的 npm_* 环境(JSON)。
 */
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-npmenv-'))
  await mkdir(path.join(dir, 'bin'), { recursive: true })
  await cp(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true })
  await cp(path.join(ROOT, 'dsh.yaml'), path.join(dir, 'dsh.yaml'))
  await cp(path.join(ROOT, '.npmrc'), path.join(dir, '.npmrc'))
  await cp(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, dereference: false })

  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  let patched = src

  // CLI 解析桩:不联网。刻意在标记行之前混入一行安装噪声,复现冷启动时
  // 安装器(stdio:'inherit')与结果共用 stdout 的真实形态。
  const before = patched
  patched = patched.replace(
    /if ! resolve_out="\$\(DSH_CLI_VERSION="\$VER" with_repo_registry node "\$REPO\/scripts\/dsh-server-bin\.mjs"\)"; then/,
    'if ! resolve_out="$(printf \'0.0.0-installer-noise\\nDSH_SERVER_BIN=%s\\n\' "$REPO/node_modules/.bin/dsh")"; then',
  )
  assert.notEqual(patched, before, 'CLI 解析调用未被替换,测试桩与实现已漂移')

  // 前台 exec 桩:打印子进程真实环境。保留 "${env_args[@]}" 前缀不动,
  // 这样断言覆盖的就是实现构造出的那份环境。
  const beforeFg = patched
  patched = patched.replace(
    /"\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" --no-open \$\{PASSTHRU\[@\]\+"\$\{PASSTHRU\[@\]\}"\} &/,
    `"\${env_args[@]}" node -e 'const l=Object.keys(process.env).filter(k=>/^npm_/.test(k)).sort();console.log("PROBE:"+JSON.stringify({leaked:l,registry:process.env.npm_config_registry??null,bin:process.argv[1]??null}))' "$server_bin"; exit 0`,
  )
  assert.notEqual(patched, beforeFg, '前台 server 启动未被替换,测试桩与实现已漂移')

  const bin = path.join(dir, 'bin/dsh')
  await writeFile(bin, patched)
  await chmod(bin, 0o755)
  return { dir, bin }
}

/**
 * 以 --foreground 跑一次真实启动器,返回探针观测到的 server 环境。
 * @param {object} sb 沙箱
 * @param {object} extraEnv 额外注入启动器自身的环境(模拟用户 shell 状态)
 */
function probeServerEnv(sb, extraEnv = {}) {
  const r = spawnSync('bash', [sb.bin, '--foreground', '--no-open', '-p', '39931'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: sb.dir,
      DSH_SKIP_UPDATE: '1',
      DSH_HOME: path.join(sb.dir, 'dsh-home'),
      ...extraEnv,
    },
  })
  const line = r.stdout.split('\n').find((l) => l.startsWith('PROBE:'))
  assert.ok(line, `未捕获到 server 环境探针输出\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  return JSON.parse(line.slice('PROBE:'.length))
}

test('server 环境剥离了 npm exec 烘焙的整批变量', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // 模拟启动器自身是从被污染的环境里起来的(如经 npx / npm run)。
  const { leaked, registry } = probeServerEnv(sb, BAKED)
  assert.deepEqual(leaked, [], `server 环境不得残留 npm_*,实际残留:${leaked.join(',')}`)
  assert.equal(registry, null, '未显式覆盖时 server 不得带 registry')
})

test('仓库 registry 不进入 server 环境(不得因解析而泄漏)', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // 干净启动:仓库 .npmrc 有 registry,但它只服务于启动器自身的 npm 调用。
  const { leaked, registry } = probeServerEnv(sb)
  assert.equal(registry, null, '仓库 registry 不得随 server 传播给 agent')
  assert.deepEqual(leaked, [], '干净启动时 server 环境不得有 npm_*')
})

test('用户显式设置的 registry 在剥离后被保留(逃生门)', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // 用户从自己的 shell 调用:`npm_config_registry=… dsh`。没有 npm_command,
  // 因为不是包管理器发起的调用。
  const { leaked, registry } = probeServerEnv(sb, { npm_config_registry: 'https://user.example/' })
  assert.equal(registry, 'https://user.example/', '用户显式覆盖必须透传进 server')
  assert.deepEqual(leaked, ['npm_config_registry'], '除用户 registry 外不得保留其他 npm_*')
})

test('启动器被包管理器调用时,烘焙的 registry 不得冒充用户意图', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // `npm run dsh` 场景:入口环境已被烘焙,npm_command 是其可靠旁证。
  // 此时 npm_config_registry 无法归因于用户,spec 要求保守剥离。
  const { leaked, registry } = probeServerEnv(sb, { ...BAKED, npm_command: 'run' })
  assert.equal(registry, null, '无法归因于用户的 registry 必须按隐式处理并剥离')
  assert.deepEqual(leaked, [], 'server 环境不得残留任何 npm_*')
})

test('NPM_CONFIG_REGISTRY 大写拼写同样被识别为用户意图', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const { registry } = probeServerEnv(sb, { NPM_CONFIG_REGISTRY: 'https://upper.example/' })
  assert.equal(registry, 'https://upper.example/', '大写拼写也必须被保留')
})

test('启动器不得导出 npm_config_registry 到自身进程环境', async () => {
  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.doesNotMatch(
    src,
    /^\s*export npm_config_registry=/m,
    '进程级 export 会沿进程树传播到 server 与 agent,必须改为单次调用注入',
  )
  assert.match(src, /with_repo_registry\(\)/, '必须提供单次调用注入的辅助函数')
})

test('前台与后台启动路径共用同一份剥离后的环境', async () => {
  const src = await readFile(ROOT + '/bin/dsh', 'utf8')
  assert.match(src, /^\s*"\$\{env_args\[@\]\}" node "\$server_bin" web /m, '前台路径必须使用剥离后的 env_args')
  assert.match(src, /^\s*nohup "\$\{env_args\[@\]\}" node "\$server_bin" web /m, '后台路径必须使用剥离后的 env_args')
  assert.equal(src.match(/env_args=\(env /g)?.length, 1, 'env_args 必须只构造一次,避免两条路径漂移')
  assert.match(src, /strip\+?=?\(.*server_env_strip_args\)|server_env_strip_args\)/, '必须实际应用剥离清单')
})

test('冷启动时安装器输出不得污染 server bin 路径', async (t) => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // 沙箱桩在标记行前混入了一行安装噪声(复现真实冷启动:安装器用
  // stdio:'inherit',与结果共用 stdout)。启动器必须只取标记行。
  const { bin } = probeServerEnv(sb)
  assert.equal(bin, path.join(sb.dir, 'node_modules/.bin/dsh'), '必须按标记行提取路径,不得把安装输出当成路径')
  assert.ok(!bin.includes('installer-noise'), '安装噪声不得混入 server bin 路径')
})

test('server bin 解析为 .bin/dsh 符号链接,保持 dsh stop 的归属证明可用', () => {
  const cases = [
    { kind: 'npx-cache', bin: '/c/_npx/abc/node_modules/@deepseek-ai/dsh/lib/bin.js' },
    { kind: 'pnpm-cache', bin: '/c/ohmydsh/dsh-cli/1.0.0/node_modules/@deepseek-ai/dsh/lib/bin.js' },
  ]
  for (const c of cases) {
    const serverBin = serverBinFrom(c)
    assert.ok(serverBin.endsWith('/node_modules/.bin/dsh'), `${c.kind}: 必须解析为 .bin/dsh,实际 ${serverBin}`)
    // is_dsh_web_pid() 的判定模式:argv 必须含 /node_modules/.bin/dsh web
    const argv = `node ${serverBin} web --port 3080 --no-open`
    assert.ok(argv.includes('/node_modules/.bin/dsh web'), `${c.kind}: argv 必须命中归属门`)
  }
  // DSH_BIN 显式指定时原样返回,由用户自负其责。
  assert.equal(serverBinFrom({ kind: 'env', bin: '/custom/dsh' }), '/custom/dsh')
})
