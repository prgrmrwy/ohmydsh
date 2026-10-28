import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from '../lib/child-process.mjs'
import yaml from 'js-yaml'
import { parseArgs, isOfficialInvocation, trustedHostArgs, HELP } from './args.mjs'
import { loadEnvironment } from './environment.mjs'
import { run as defaultRun } from './runner.mjs'
import { autoUpdate, appendEvent, ensurePrerequisites } from './maintenance.mjs'
import { probePort, stopServer } from './process.mjs'
import { isolatedHome, readPreview, writePreview, matchesPreview, stopPreview, previewPorts } from './preview.mjs'
import { openUi, closeUi } from './ui.mjs'
import packageManager from '../lib/package-manager.cjs'

export function canConnect(port, timeoutMs = 300) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = result => { socket.destroy(); resolve(result) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

function manifestAt(repo) {
  const doc = yaml.load(fs.readFileSync(path.join(repo, 'dsh.yaml'), 'utf8'))
  if (!doc || typeof doc.dshVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(doc.dshVersion)) throw new Error('dshVersion missing or not exact in dsh.yaml')
  return doc
}

export async function runLauncher(argv, options = {}) {
  const { repo, env: caller = process.env, log = console.log, warn = console.error, run = defaultRun, probe = probePort, stop = stopServer, platform = process.platform } = options
  const official = isOfficialInvocation(argv)
  // Validate all local arguments before configuration or any side effect.
  const flags = official ? {} : parseArgs(argv)
  if (flags.help) { log(HELP); return 0 }
  const environment = loadEnvironment(repo, caller, { platform, warn })
  const { env, npmEnv, hostEnv, home } = environment
  const runScript = (name, args = [], extra = {}) => run(process.execPath, [path.join(repo, 'scripts', name), ...args], { env: npmEnv, ...extra })
  const context = { ...environment, repo, runScript, run, log, warn }
  const getManifest = () => manifestAt(repo)
  if (official) {
    const doc = getManifest()
    return (await runScript('dsh-cli.mjs', argv, { env: { ...npmEnv, DSH_CLI_VERSION: doc.dshVersion } })).status
  }
  const preview = (options.isolatedHome ?? isolatedHome)(repo, home)
  if (preview) {
    // OpenSpec schema installation uses XDG rather than DSH_HOME.
    for (const target of [env, npmEnv, hostEnv]) target.XDG_DATA_HOME = path.join(home, 'xdg-data')
  }
  flags.port ??= Number(env.DSH_PORT ?? 3080)
  if (!Number.isInteger(flags.port) || flags.port < 1 || flags.port > 65535) throw new Error('DSH_PORT must be an integer in 1..65535')
  const hostAction = !flags.buildOnly && !flags.history && !flags.doctor && !flags.reset && !flags.pluginUpdate
  if (preview && hostAction && flags.port === 3080) throw new Error('隔离环境禁止操作 3080；请先 ws prepare-preview')
  const previewRecord = preview && hostAction ? readPreview(home) : undefined
  if (preview && !flags.portExplicit && previewRecord && hostAction) flags.port = previewRecord.port
  if (preview && (flags.buildOnly || flags.build)) log(`隔离构建 → ${home}（日常 GUI 未更新）`)
  const announcePreview = () => { if (preview) { log(`隔离预览环境 home=${home} port=${flags.port}`); log(`DSH_PREVIEW ${JSON.stringify({ url: `http://127.0.0.1:${flags.port}`, port: flags.port, home })}`) } }
  const uiOptions = { port: flags.port, platform, env, warn, ...(options.run ? { run } : {}) }
  const showPlugins = async () => {
    const result = await runScript('plugin-list.mjs', [], { capture: true })
    log(result.stdout.trim() ? `加载的 plugins:\n${result.stdout.trim().split(/\r?\n/).map(line => `  - ${line}`).join('\n')}` : '加载的 plugins:(无法读取 profile 清单)')
  }
  const ui = async doc => {
    if (flags.noOpen || (!flags.open && doc.web?.open === false)) {
      return (await openUi({ ...uiOptions, doc, flags })).opened
    }
    const result = await openUi({ ...uiOptions, doc, flags })
    return result.opened
  }
  const doStop = async () => {
    if (preview) {
      if (flags.portExplicit && previewRecord?.port !== flags.port) { log('no recorded preview on this port'); return }
      await stopPreview(home, { env, probe, stop, warn })
      log('preview stopped or no matching preview is running')
      return
    }
    const result = await stop(flags.port, { env, warn })
    await closeUi(uiOptions)
    if (!result.ok) throw new Error(result.error || `port ${flags.port} listener is not provably DSH; refusing to kill`)
    log(result.state === 'empty' ? `no dsh server found on port ${flags.port}` : `dsh server stopped(port ${flags.port})`)
  }
  if (flags.stop) { await doStop(); return 0 }
  if (flags.history) {
    const file = path.join(home, 'dsh-startup.log')
    log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-20).join('\n') : 'no startup history yet (run dsh to start one)')
    return 0
  }
  if (flags.doctor) return (await runScript('host-prerequisites.mjs', flags.check ? ['--check'] : [])).status
  if (flags.reset) return (await runScript('sync.mjs', ['--reset'])).status
  if (flags.pluginUpdate) return (await runScript('plugin-update.mjs', [...(flags.dryRun ? ['--dry-run'] : []), ...(flags.yes ? ['--yes'] : [])])).status
  let current
  if (!flags.buildOnly) {
    current = await probe(flags.port, { env })
    if (preview) {
      if (previewRecord && matchesPreview(current, previewRecord)) current = { ...current, state: 'owned' }
      else if (!flags.portExplicit) current = { state: 'empty' }
      else if (current.state !== 'empty') throw new Error('Explicit preview port is occupied by another process')
    }
    if (!['empty', 'owned'].includes(current.state)) throw new Error(current.error || `port ${flags.port} listener is not provably DSH; refusing start`)
  }
  if (flags.buildOnly || flags.build || flags.restart || current.state === 'empty') {
    const updated = await autoUpdate(context)
    await ensurePrerequisites(context)
    if ((flags.buildOnly || flags.build) && !updated) {
      const build = await runScript('sync.mjs')
      if (build.status !== 0) return build.status
    }
  }
  if (flags.buildOnly) return 0
  let doc = getManifest()
  // restart 停机前先校验,写错的 DSH_TRUSTED_HOSTS 不能让健康 Host 被停掉后起不来。
  const hostTrustArgs = trustedHostArgs(env)
  let prepared
  const prepare = async () => {
    doc = getManifest()
    const result = await runScript('dsh-server-bin.mjs', [], { env: { ...npmEnv, DSH_CLI_VERSION: doc.dshVersion, DSH_REPO_ROOT: repo }, capture: true })
    if (result.stderr) warn(result.stderr.trimEnd())
    if (result.status !== 0) throw new Error('无法解析 DSH Host runtime')
    const fields = Object.fromEntries(result.stdout.split(/\r?\n/).filter(line => /^DSH_(?:SERVER_BIN|RUNTIME_\w+)=/.test(line)).map(line => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)] }))
    if (!fields.DSH_SERVER_BIN) throw new Error('Host runtime 解析未返回 bin 路径')
    return fields
  }
  if (flags.restart) { prepared = await prepare(); await doStop(); current = { state: 'empty' } }
  if (current.state === 'owned') {
    announcePreview()
    await ui(doc)
    log(`dsh 已在运行: http://127.0.0.1:${flags.port} (未自动打开 UI 时可 dsh --open)`)
    await showPlugins()
    return 0
  }
  prepared ??= await prepare()
  const ports = preview ? previewPorts(flags.port, flags.portExplicit) : [flags.port]
  for (const port of ports) {
    flags.port = port
    uiOptions.port = port
    if (preview && (await probe(port, { env })).state !== 'empty') continue
    const resolved = packageManager.resolveDshCommand(prepared.DSH_SERVER_BIN, ['web', '--port', String(flags.port), '--no-open', ...hostTrustArgs, ...flags.passthrough], { platform, nodePath: process.execPath, managed: prepared.DSH_RUNTIME_KIND !== 'env' })
    fs.mkdirSync(home, { recursive: true })
    const fd = flags.foreground ? undefined : fs.openSync(path.join(home, 'dsh.log'), 'a')
    let child
    try {
      child = (options.spawn ?? spawn)(resolved.command, resolved.args, { env: hostEnv, cwd: process.cwd(), shell: false, detached: !flags.foreground, windowsHide: true, stdio: flags.foreground ? 'inherit' : ['ignore', fd, fd] })
    } finally { if (fd !== undefined) fs.closeSync(fd) }
    let childError
    const closed = new Promise(resolve => {
      child.once('error', error => { childError = error })
      child.once('close', (status, signal) => resolve({ status, signal }))
    })
    const deadline = Date.now() + 30_000
    let ready = false
    let racedOwner = false
    let readyIdentity
    while (Date.now() < deadline) {
      if (childError || child.exitCode !== null || child.signalCode !== null) break
      if (await (options.connect ?? canConnect)(flags.port)) {
        const candidate = await probe(flags.port, { env, deadline })
        ready = candidate.state === 'owned' && candidate.processes.some(record => record.pid === child.pid)
        racedOwner = candidate.state === 'owned' && !ready
        if (ready) readyIdentity = candidate.processes.find(record => record.pid === child.pid)
        if (ready || candidate.state !== 'empty') break
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) {
      // The native ChildProcess handle belongs to this launch; never kill a PID
      // inferred from a reachable port. Reclaim only while our child is alive.
      if (child.exitCode === null && child.signalCode === null && !childError) {
        if (platform === 'win32') {
          try {
            const killed = await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { capture: true, timeoutMs: 5_000 })
            if (killed.status !== 0) warn(`Failed to reclaim this launch’s Windows child PID ${child.pid}; inspect dsh.log and the owned child manually`)
          } finally { child.unref() }
        } else {
          // The detached group was created by this exact ChildProcess. Reclaim
          // it before returning; an ignored TERM must not keep dsh alive forever.
          const signal = kind => { try { process.kill(flags.foreground ? child.pid : -child.pid, kind) } catch (error) { if (error.code !== 'ESRCH') warn(error.message) } }
          signal('SIGTERM')
          await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 500))])
          if (child.exitCode === null && child.signalCode === null) signal('SIGKILL')
          await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 500))])
          child.unref()
        }
      }
      if (preview) continue
      if (racedOwner || child.exitCode !== null) {
        const winner = await probe(flags.port, { env })
        if (winner.state === 'owned') {
          await ui(doc)
          log(`dsh 已在运行: http://127.0.0.1:${flags.port} (another verified launcher won startup)`)
          await showPlugins()
          return 0
        }
      }
      warn(`error: server ${childError ? 'cannot start' : child.exitCode !== null ? 'exited early' : 'readiness failed (ownership unknown or 30s deadline)'} — see ${path.join(home, 'dsh.log')}`)
      return child.exitCode || 1
    }
    if (preview) {
      if (!readyIdentity?.created) throw new Error('Preview listener creation identity missing')
      writePreview(home, { port, pid: child.pid, created: readyIdentity.created })
      announcePreview()
    }
    const pluginNames = await runScript('plugin-list.mjs', ['--names'], { capture: true })
    appendEvent(home, `dshVersion=${doc.dshVersion} runtime=${prepared.DSH_RUNTIME_KIND} owner=${prepared.DSH_RUNTIME_OWNER || 'none'} compat=${prepared.DSH_RUNTIME_COMPAT || 'none'} fingerprint=${prepared.DSH_RUNTIME_FINGERPRINT || 'none'} port=${flags.port} plugins=[${pluginNames.status === 0 ? pluginNames.stdout.trim() : ''}]`)
    log(`Host runtime: ${prepared.DSH_RUNTIME_KIND}${prepared.DSH_RUNTIME_OWNER ? ` (${prepared.DSH_RUNTIME_OWNER})` : ''}`)
    await ui(doc)
    log(`dsh 已启动: http://127.0.0.1:${flags.port} (dshVersion=${doc.dshVersion};未自动打开 UI 时可 dsh --open)`)
    await showPlugins()
    if (!flags.foreground) { child.unref(); return 0 }
    const signal = () => child.kill('SIGTERM')
    process.once('SIGINT', signal); process.once('SIGTERM', signal)
    try { const result = await closed; return result.status ?? 1 } finally { process.off('SIGINT', signal); process.off('SIGTERM', signal) }
  }
  throw new Error('Preview startup failed: exhausted candidate ports; stop unused preview Hosts or ws clean')
}
