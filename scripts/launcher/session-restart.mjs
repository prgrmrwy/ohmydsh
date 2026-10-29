import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'

// A DSH bash tool or terminal runs inside a range the Host owns; Host disposal
// kills that range, so a restart launched from it dies after stopping the Host
// and never starts the replacement. Such restarts re-exec this launcher outside
// the range and hand over through files in the state directory.
export const MANAGED_RANGE = /dsh-(?:subprocess|terminal)-\d+-[0-9a-f]+\.scope/
export const READY_TIMEOUT_MS = 10_000
export const GO_TIMEOUT_MS = 30_000
export const GRACE_MS = 3_000
const SESSION_MARKERS = ['DSH_SHELL', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_PTY_SESSION_ID']

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined } }

/** Why this process runs inside a DSH session, or undefined when it does not. */
export function sessionEvidence({ platform = process.platform, env = process.env, readCgroup = () => fs.readFileSync('/proc/self/cgroup', 'utf8') } = {}) {
  // Launcher suites spawn real launchers from DSH sessions; only node --test may opt out.
  if (env.NODE_TEST_CONTEXT && env.DSH_RESTART_CONTEXT === 'external') return undefined
  if (platform === 'linux') {
    try { const range = readCgroup().match(MANAGED_RANGE)?.[0]; if (range) return { kind: 'cgroup', detail: range } } catch {}
  }
  if (env.DSH_SHELL === '1') return { kind: 'marker', detail: 'DSH_SHELL=1' }
  for (const name of ['DSH_SESSION_ID', 'DSH_PTY_SESSION_ID']) if (env[name]) return { kind: 'marker', detail: name }
  return undefined
}

/** Session markers and the internal protocol never reach the replacement Host or its scripts. */
export function withoutSessionMarkers(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SESSION_MARKERS.includes(key) && !key.startsWith('DSH_RESTART_')))
}

/** The detached re-exec: a fresh systemd scope where the Host owns a scope, a new session elsewhere. */
export function detachCommand({ evidence, execPath, script, argv, restartId }) {
  const launcher = [execPath, script, ...argv]
  if (evidence.kind === 'cgroup') return ['systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=dsh-restart-${restartId}`, '--', ...launcher]]
  return [launcher[0], launcher.slice(1)]
}

export function receiptPath(home) { return path.join(home, 'dsh-restart.log') }

export function appendReceipt(home, event) {
  fs.mkdirSync(home, { recursive: true })
  fs.appendFileSync(receiptPath(home), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 })
}

/** Session side: start the orchestrator, wait for its ack, release it and return before the Host stops. */
export async function scheduleRestart({ argv, repo, home, caller, evidence, platform, log, warn, spawn = nodeSpawn, readyTimeoutMs = READY_TIMEOUT_MS }) {
  if (platform === 'win32') throw new Error('Windows 不支持在 DSH 会话内重启；请在外部终端执行 dsh restart')
  const restartId = `${new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15)}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`
  const nonce = crypto.randomBytes(16).toString('hex')
  const dir = path.join(home, 'state', 'dsh-restart', restartId)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, restartId, nonce, home, evidence: evidence.detail, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
  appendReceipt(home, { restartId, phase: 'scheduling', evidence: evidence.detail })
  const [command, args] = detachCommand({ evidence, execPath: process.execPath, script: path.join(repo, 'bin', 'dsh.mjs'), argv, restartId })
  const env = { ...caller, DSH_RESTART_ORCHESTRATED: '1', DSH_RESTART_DIR: dir, DSH_RESTART_NONCE: nonce }
  let exited
  const child = spawn(command, args, { env, cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true })
  child.once('error', error => { exited = error.message })
  child.once('exit', (status, signal) => { exited = `exited ${signal ?? status}` })
  child.unref()
  const deadline = Date.now() + readyTimeoutMs
  while (Date.now() < deadline && !exited && readJson(path.join(dir, 'ready'))?.nonce !== nonce) await sleep(50)
  if (readJson(path.join(dir, 'ready'))?.nonce !== nonce) {
    try { fs.writeFileSync(path.join(dir, 'abort'), JSON.stringify({ restartId, nonce, phase: 'abort' }), { flag: 'wx' }) } catch {}
    // A live orchestrator reads abort and removes the directory itself.
    if (exited) fs.rmSync(dir, { recursive: true, force: true })
    const reason = exited ? `orchestrator ${exited}` : 'no-ack'
    appendReceipt(home, { restartId, phase: 'failed', failedPhase: 'schedule', reason })
    warn(`error: 未能排程会话外重启（${reason}）；当前 Host 未停止。请在外部终端执行 dsh restart`)
    return 1
  }
  fs.writeFileSync(path.join(dir, 'go'), JSON.stringify({ restartId, nonce, phase: 'go' }), { flag: 'wx' })
  log(`已排程会话外重启 restartId=${restartId}（会话语境：${evidence.detail}）`)
  log(`约 ${GRACE_MS / 1000}s 后停止当前 Host 并启动新 Host，本次会话将断开。`)
  log(`返回 0 只表示已排程；重连后用 dsh history 查看结果（receipt: ${receiptPath(home)}）`)
  return 0
}

/** Orchestrator side: validate the handoff, ack, wait for go, then run the ordinary restart. */
export async function orchestrateRestart(caller, launch, { waitGoMs = GO_TIMEOUT_MS, graceMs = GRACE_MS } = {}) {
  const dir = caller.DSH_RESTART_DIR
  const nonce = caller.DSH_RESTART_NONCE
  const meta = dir && readJson(path.join(dir, 'meta.json'))
  if (!meta || !nonce || meta.nonce !== nonce || meta.version !== 1) throw new Error('invalid internal restart handoff; refusing to stop the Host')
  const { restartId, home } = meta
  const receipt = event => { try { appendReceipt(home, { restartId, pid: process.pid, ...event }) } catch {} }
  const sink = path.join(home, 'dsh.log')
  const write = line => { try { fs.appendFileSync(sink, `[restart ${restartId}] ${line}\n`) } catch {} }
  let phase = 'orchestrator-ready'
  try {
    fs.writeFileSync(path.join(dir, 'ready'), JSON.stringify({ restartId, nonce, phase: 'ready', pid: process.pid }), { flag: 'wx' })
    receipt({ phase })
    const marker = name => readJson(path.join(dir, name))?.nonce === nonce
    const deadline = Date.now() + waitGoMs
    while (!marker('abort') && !marker('go') && Date.now() < deadline) await sleep(50)
    // abort wins over a concurrent go; either way the Host stays up.
    if (marker('abort') || !marker('go')) {
      receipt({ phase: 'failed', failedPhase: 'schedule', reason: marker('abort') ? 'aborted' : 'go-timeout', hostStopped: false })
      return 1
    }
    await sleep(graceMs)
    let hostStopped = false
    const onPhase = (next, detail = {}) => { phase = next; if (next === 'stopped') hostStopped = true; receipt({ phase: next, ...detail }) }
    try {
      const rc = await launch({ env: withoutSessionMarkers(caller), log: write, warn: write, orchestrated: true, onPhase })
      receipt(rc === 0 ? { phase: 'ready' } : { phase: 'failed', failedPhase: phase, rc, hostStopped })
      return rc
    } catch (error) {
      write(`error: ${error.message}`)
      receipt({ phase: 'failed', failedPhase: phase, reason: error.message, hostStopped })
      return 1
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The latest restart run from the receipt, as history lines. */
export function restartHistory(home, { maxBytes = 64 * 1024 } = {}) {
  let text
  try {
    const fd = fs.openSync(receiptPath(home), 'r')
    try {
      const size = fs.fstatSync(fd).size
      const buffer = Buffer.alloc(Math.min(size, maxBytes))
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length)
      text = buffer.toString('utf8')
    } finally { fs.closeSync(fd) }
  } catch { return [] }
  const events = text.split('\n').map(line => { try { return JSON.parse(line) } catch { return undefined } }).filter(event => event?.restartId)
  const latest = events.at(-1)?.restartId
  if (!latest) return []
  const run = events.filter(event => event.restartId === latest)
  const detail = ({ ts, phase, restartId, ...rest }) => `${ts} ${phase}${Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''}`
  const terminal = run.some(event => event.phase === 'ready' || event.phase === 'failed')
  return [`最近一次会话内重启 restartId=${latest}${terminal ? '' : '（未结束：进行中，或编排进程在完成前退出；必要时在外部终端执行 dsh）'}`, ...run.map(event => `  ${detail(event)}`)]
}
