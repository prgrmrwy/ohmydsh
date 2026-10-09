// 启动器 × 本机运行前提(capability: host-prerequisites)。
//
// 回归背景:内核类前提(如 @touchskyer/memex)是机器本地状态,dsh build 不装、
// 个人同步清单不带,环境重建后必然缺失;缺失的表现是插件静默降级。启动器必须在
// 启动/构建/重启前补一次,而且**装不上也不能挡住启动** —— 一个装不上的包不应该
// 让人连 DSH 都起不来。
//
// 测试策略:跑真实 bin/dsh(只把 server 启动换成回显),把 scripts/host-prerequisites.mjs
// 换成记录 argv 与退出码的探针。断言作用在启动器本身,而不是测试里的逻辑副本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PROBE = `import { appendFileSync } from 'node:fs'
appendFileSync(process.env.PREREQ_PROBE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
console.log('[prereq] probe ran')
process.exit(Number(process.env.PREREQ_PROBE_STATUS ?? '0'))
`

/**
 * 沙箱:真实 bin/dsh + scripts,server 启动换成回显,自愈脚本换成探针。
 * @param {object} t - node:test context.
 * @param {object} [options]
 * @param {string} [options.yaml] - 沙箱 dsh.yaml 内容。
 */
async function sandbox(t, { yaml } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-prereq-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'bin'), { recursive: true })
  await cp(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true })
  await writeFile(path.join(dir, 'dsh.yaml'), yaml ?? await readFile(path.join(ROOT, 'dsh.yaml'), 'utf8'))
  await writeFile(path.join(dir, 'scripts', 'host-prerequisites.mjs'), PROBE)
  // 运行体解析链会 import scripts/lib 里的模块(js-yaml 等),与既有启动器测试一样
  // 用符号链接复用仓库依赖,避免每次拷贝整棵 node_modules。
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'prereq-fixture', private: true, type: 'module' }))

  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  const patched = src.replace(
    /nohup "\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" --no-open \$\{PASSTHRU\[@\]\+"\$\{PASSTHRU\[@\]\}"\} >>"\$DSH_HOME\/dsh\.log" 2>&1 &/,
    'for a in web --port "$PORT" --no-open ${PASSTHRU[@]+"${PASSTHRU[@]}"}; do echo "WEB_ARG:$a"; done; exit 0',
  )
  assert.notEqual(patched, src, 'start_server 的 server 启动调用未被替换,测试桩与实现已漂移')
  const bin = path.join(dir, 'bin/dsh')
  await writeFile(bin, patched)
  await chmod(bin, 0o755)

  // 运行体解析走 DSH_BIN 直连(不联网、不装 npx 缓存)。
  const runtimeStub = path.join(dir, 'runtime-stub')
  await writeFile(runtimeStub, `#!${process.execPath}\nfor (const a of process.argv.slice(2)) console.log('RUNTIME_ARG:' + a)\n`)
  await chmod(runtimeStub, 0o755)

  const probeLog = path.join(dir, 'prereq.log')
  const dshHome = path.join(dir, 'dsh-home')
  // 固定端口会让测试撞上本机正在运行的 DSH(那会走"已在运行"分支,闸口根本不执行);
  // 取一个大概率空闲的高位端口,让启动路径真正跑起来。
  const port = String(34000 + Math.floor(Math.random() * 2000))
  const run = (args, extraEnv = {}) => spawnSync('bash', [bin, '-p', port, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_SKIP_UPDATE: '1',
      DSH_BIN: runtimeStub,
      DSH_HOME: dshHome,
      HOME: dir,
      PREREQ_PROBE_LOG: probeLog,
      ...extraEnv,
    },
  })
  const probeCalls = () => (existsSync(probeLog) ? readFileSync(probeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
  const startupLog = () => (existsSync(path.join(dshHome, 'dsh-startup.log')) ? readFileSync(path.join(dshHome, 'dsh-startup.log'), 'utf8') : '')
  return { dir, run, probeCalls, startupLog }
}

test('启动前执行自愈,且不影响启动', async (t) => {
  const sb = await sandbox(t)
  const result = sb.run([])
  assert.equal(sb.probeCalls().length, 1, '启动路径必须执行一次自愈')
  assert.deepEqual(sb.probeCalls()[0], [])
  assert.match(result.stdout, /WEB_ARG:web/, '自愈之后 server 仍要启动')
})

test('自愈失败只告警,启动继续,并留下启动日志', async (t) => {
  const sb = await sandbox(t)
  const result = sb.run([], { PREREQ_PROBE_STATUS: '1' })
  assert.match(result.stdout, /WEB_ARG:web/, '自愈失败不得挡住启动')
  assert.match(result.stderr, /warn: 本机运行前提未全部满足/)
  assert.match(result.stderr, /dsh doctor/)
  assert.match(sb.startupLog(), /hostPrerequisites: failed/)
})

test('逃生门跳过自愈且不执行脚本', async (t) => {
  const sb = await sandbox(t)
  const result = sb.run([], { DSH_SKIP_HOST_PREREQUISITES: '1' })
  assert.deepEqual(sb.probeCalls(), [])
  assert.match(result.stdout, /跳过/)
  assert.match(result.stdout, /WEB_ARG:web/)
})

test('doctor 手动执行自愈,并把退出码如实反映', async (t) => {
  const sb = await sandbox(t)
  const ok = sb.run(['doctor'])
  assert.equal(ok.status, 0)
  assert.deepEqual(sb.probeCalls(), [[]])

  const bad = sb.run(['doctor'], { PREREQ_PROBE_STATUS: '1' })
  assert.equal(bad.status, 1)
})

test('doctor --check 透传只读标志', async (t) => {
  const sb = await sandbox(t)
  sb.run(['doctor', '--check'])
  assert.deepEqual(sb.probeCalls(), [['--check']])
})

test('--check 只属于 doctor,单独使用直接报错', async (t) => {
  const sb = await sandbox(t)
  const result = sb.run(['--check'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /doctor/)
  assert.deepEqual(sb.probeCalls(), [])
})
