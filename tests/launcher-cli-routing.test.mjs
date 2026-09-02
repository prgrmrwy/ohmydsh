// 启动器参数路由契约。
//
// 回归背景:`dsh` 同时是本仓库启动器(bin/dsh)与官方 @deepseek-ai/dsh CLI 的
// 名字,而用户 PATH 里通常只有 ~/.local/bin/dsh。官方调用形式落到启动器时,
// 旧实现把不认识的参数塞进 PASSTHRU 拼到 `dsh web` 之后 —— web 子命令没有
// --profile,冷启动直接死在 `error: unknown option '--profile'`,且错误只写进
// dsh.log。本测试锁住三件事:官方调用被转交、启动器命令不被误吞、未知参数
// 明确失败而不是静默污染 web argv。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 搭一个隔离沙箱:真实 bin/dsh + scripts,但把官方 CLI 换成记录 argv 的桩,
 * 并把 start_server 的 npx 调用替换为回显,从而在不联网、不起真实服务的
 * 前提下断言最终 argv。
 */
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-routing-'))
  await mkdir(path.join(dir, 'bin'), { recursive: true })
  await cp(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true })
  await cp(path.join(ROOT, 'dsh.yaml'), path.join(dir, 'dsh.yaml'))
  await cp(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, dereference: false })

  // 官方 CLI 桩:把收到的 argv 逐行打印,供断言比对。
  const stub = path.join(dir, 'cli-stub.mjs')
  await writeFile(stub, `for (const a of process.argv.slice(2)) console.log('CLI_ARG:' + a)\n`)

  // 启动器:把真实 server 启动替换成回显,其余逻辑保持原样。
  const src = await import('node:fs/promises').then((fs) => fs.readFile(path.join(ROOT, 'bin/dsh'), 'utf8'))
  const patched = src.replace(
    /nohup "\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" --no-open \$\{PASSTHRU\[@\]\+"\$\{PASSTHRU\[@\]\}"\} >>"\$DSH_HOME\/dsh\.log" 2>&1 &/,
    'for a in web --port "$PORT" --no-open ${PASSTHRU[@]+"${PASSTHRU[@]}"}; do echo "WEB_ARG:$a"; done; exit 0',
  )
  assert.notEqual(patched, src, 'start_server 的 server 启动调用未被替换,测试桩与实现已漂移')
  const bin = path.join(dir, 'bin/dsh')
  await writeFile(bin, patched)
  await chmod(bin, 0o755)
  return { dir, bin, stub }
}

function run({ bin, stub, dir }, args) {
  return spawnSync('bash', [bin, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_SKIP_UPDATE: '1',
      DSH_BIN: `${process.execPath} ${stub}`, // 经 dsh-cli.mjs 的 env 通道直连桩
      DSH_HOME: path.join(dir, 'dsh-home'),
      HOME: dir,
    },
  })
}

// DSH_BIN 走 spawnSync 的直接命令形式,不支持内嵌空格;改用可执行包装脚本。
async function withStubBin(sb) {
  const wrapper = path.join(sb.dir, 'dsh-stub')
  await writeFile(wrapper, `#!/usr/bin/env bash\nexec "${process.execPath}" "${sb.stub}" "$@"\n`)
  await chmod(wrapper, 0o755)
  return { ...sb, stub: wrapper }
}

test('官方 plugin 子命令被原样转交给 CLI,不再污染 web argv', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = spawnSync('bash', [sb.bin, 'plugin', '--profile', 'web', 'add', 'dsh-foo'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_SKIP_UPDATE: '1', DSH_BIN: sb.stub, DSH_HOME: path.join(sb.dir, 'h'), HOME: sb.dir },
  })
  assert.equal(r.status, 0, r.stderr)
  const args = r.stdout.split('\n').filter((l) => l.startsWith('CLI_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(args, ['plugin', '--profile', 'web', 'add', 'dsh-foo'])
  assert.ok(!r.stdout.includes('WEB_ARG:'), '不得退化为 web 启动')
})

test('官方顶层 --profile / --dump-config 被转交,而不是拼到 web 之后', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = spawnSync('bash', [sb.bin, '--profile', 'web', '--dump-config'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_SKIP_UPDATE: '1', DSH_BIN: sb.stub, DSH_HOME: path.join(sb.dir, 'h'), HOME: sb.dir },
  })
  assert.equal(r.status, 0, r.stderr)
  const args = r.stdout.split('\n').filter((l) => l.startsWith('CLI_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(args, ['--profile', 'web', '--dump-config'])
})

test('plugin-update 是本仓库命令,不得被官方 plugin 判定截走', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  // 只断言"未被转交";plugin-update 自身会联网检测,这里不关心其结果,
  // 故用 --dry-run 并容忍任意退出码,仅检查没有走进官方 CLI 桩。
  const r = spawnSync('bash', [sb.bin, 'plugin-update', '--dry-run'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DSH_SKIP_UPDATE: '1', DSH_BIN: sb.stub, DSH_HOME: path.join(sb.dir, 'h'), HOME: sb.dir },
  })
  assert.ok(!r.stdout.includes('CLI_ARG:'), 'plugin-update 不应转交官方 CLI')
})

test('dsh web 别名被吸收,不再拼成多余位置参数', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = run(sb, ['web', '--no-open', '-p', '39990'])
  const webArgs = r.stdout.split('\n').filter((l) => l.startsWith('WEB_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(webArgs, ['web', '--port', '39990', '--no-open'], 'web 之后不得出现多余位置参数,且官方 opener 必须关闭')
})

test('--open 强制打开标志被接受,且不污染 web argv', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = run(sb, ['--open', '-p', '39991'])
  assert.equal(r.status, 0, r.stderr)
  const webArgs = r.stdout.split('\n').filter((l) => l.startsWith('WEB_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(webArgs, ['web', '--port', '39991', '--no-open'], '--open 由本启动器处理,官方 opener 仍必须关闭')
})

test('manifest web.open: false 时默认 dsh 启动不报错(冷启动由启动桩接管)', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = run(sb, ['-p', '39992'])
  assert.equal(r.status, 0, r.stderr)
  const webArgs = r.stdout.split('\n').filter((l) => l.startsWith('WEB_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(webArgs, ['web', '--port', '39992', '--no-open'])
})

test('未知参数明确失败,不静默污染 web argv', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = run(sb, ['--frobnicate'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /无法识别的参数/)
  assert.ok(!r.stdout.includes('WEB_ARG:--frobnicate'), '未知参数不得进入 web argv')
})

test('官方 web 参数 --host/--trusted-host 仍原样透传', async (t) => {
  const sb = await withStubBin(await sandbox())
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const r = run(sb, ['--host', '127.0.0.1', '--no-open', '-p', '39990'])
  const webArgs = r.stdout.split('\n').filter((l) => l.startsWith('WEB_ARG:')).map((l) => l.slice(8))
  assert.deepEqual(webArgs, ['web', '--port', '39990', '--no-open', '--host', '127.0.0.1'])
})

test('前台与后台官方启动路径都强制 --no-open,保证只有启动器负责 UI', async () => {
  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.match(src, /"\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" --no-open[^\n]* &/)
  assert.match(src, /nohup "\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" --no-open[^\n]* >>"\$DSH_HOME\/dsh\.log" 2>&1 &/)
  assert.doesNotMatch(src, /(?:^|\n)\s*(?:nohup )?"\$\{env_args\[@\]\}" node "\$server_bin" web --port "\$PORT" (?!--no-open)/)
})

test('server 不再经 npx 拉起:npx 会把 npm_config_* 烘焙给长期进程', async () => {
  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.doesNotMatch(src, /npx -y "@deepseek-ai\/dsh@\$VER" web/, 'server 启动必须走 node 直连,否则 npm 环境会泄漏给 agent')
})

test('stop 在 autoUpdate 与运行体解析之前短路，restart 只进入一次 start_server', async () => {
  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  const stopBranch = src.indexOf('if [[ $STOP -eq 1 ]]')
  const autoupdateBlock = src.indexOf('# ---------- autoUpdate:')
  assert.ok(stopBranch > 0 && stopBranch < autoupdateBlock, 'stop 必须在版本检测/运行体解析前退出')
  const restartBody = src.match(/do_restart\(\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.doesNotMatch(restartBody, /resolveCliBin|dsh-server-bin|start_server/, 'restart stop 阶段不得解析/启动运行体')
  assert.equal((src.match(/^start_server$/gm) ?? []).length, 1, 'launcher 最终只能进入一次 start_server')
})

test('macOS UI AppleScript 清理有界，不得让 stop/restart 永久等待 Chrome', async () => {
  const src = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.match(src, /run_osascript_bounded\(\)/)
  assert.match(src, /run_osascript_bounded 3 -e "tell application/)
  assert.match(src, /run_osascript_bounded 3 - "\$PORT"/)
  assert.doesNotMatch(src, /^\s+osascript - "\$PORT"/m)
})

test('stop 在无 server 时不调用 npm/npx/pnpm provision', async t => {
  const sb = await sandbox()
  t.after(() => rm(sb.dir, { recursive: true, force: true }))
  const toolDir = path.join(sb.dir, 'tools')
  const calls = path.join(sb.dir, 'package-manager-calls')
  await mkdir(toolDir)
  for (const name of ['npm', 'npx', 'pnpm']) {
    const tool = path.join(toolDir, name)
    await writeFile(tool, `#!/usr/bin/env bash\necho ${name} >> "${calls}"\nexit 97\n`)
    await chmod(tool, 0o755)
  }
  const r = spawnSync('bash', [sb.bin, 'stop', '--port', '39989'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toolDir}:${process.env.PATH}`,
      DSH_HOME: path.join(sb.dir, 'dsh-home'),
      HOME: sb.dir,
    },
  })
  assert.equal(r.status, 0, r.stderr)
  await assert.rejects(readFile(calls), { code: 'ENOENT' })
})
