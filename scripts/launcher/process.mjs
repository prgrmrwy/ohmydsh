import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const validPort = port => Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535
const positivePid = pid => Number.isSafeInteger(pid) && pid > 0
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function runPlatformCommand(command, args, { env = process.env, timeoutMs = 5_000 } = {}) {
  return new Promise(resolve => {
    execFile(command, args, { env, shell: false, windowsHide: true, timeout: Math.max(1, timeoutMs), maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout, stderr, error })
    })
  })
}

export function portReachable(port, { timeoutMs = 300 } = {}) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) })
    let settled = false
    const finish = value => { if (!settled) { settled = true; socket.destroy(); resolve(value) } }
    socket.setTimeout(Math.max(1, timeoutMs), () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

// MSVCRT backslash/quote rules; shell metacharacters have no special meaning.
export function parseWindowsCommandLine(commandLine) {
  const result = []; let i = 0
  while (i < commandLine.length) {
    while (/\s/.test(commandLine[i] ?? '') && i < commandLine.length) i++
    if (i >= commandLine.length) break
    let value = ''; let quoted = false
    while (i < commandLine.length) {
      if (!quoted && /\s/.test(commandLine[i])) break
      let slashes = 0
      while (commandLine[i] === '\\') { slashes++; i++ }
      if (commandLine[i] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2) value += '"'
        else if (quoted && commandLine[i + 1] === '"') { value += '"'; i++ }
        else quoted = !quoted
        i++
      } else {
        value += '\\'.repeat(slashes)
        if (i < commandLine.length && (quoted || !/\s/.test(commandLine[i]))) value += commandLine[i++]
      }
    }
    if (quoted) throw new Error('Unterminated Windows command-line quote')
    result.push(value)
  }
  return result
}

export function isDshWebProcess(record, port, { platform = process.platform } = {}) {
  if (!validPort(port) || !positivePid(record?.pid) || !record.created || !Array.isArray(record.argv)) return false
  const argv = record.argv
  if (argv.length < 4 || !argv.every(value => typeof value === 'string')) return false
  const executable = platform === 'win32' ? path.win32.basename(argv[0]).toLowerCase() : path.basename(argv[0])
  let currentNode = false
  try { currentNode = realpathSync(record.executable || argv[0]) === realpathSync(process.execPath) } catch {}
  if (!['node', 'node.exe'].includes(executable) && !currentNode) return false
  const entry = platform === 'win32' ? argv[1].replaceAll('\\', '/').toLowerCase() : argv[1]
  if (!/(?:\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js|\/node_modules\/\.bin\/dsh)$/.test(entry) || argv[2] !== 'web') return false
  const positions = argv.slice(3).flatMap((arg, index) => arg === '--port' ? [argv[index + 4]] : arg.startsWith('--port=') ? [arg.slice(7)] : [])
  return positions.length === 1 && /^\d+$/.test(positions[0] ?? '') && Number(positions[0]) === Number(port)
}

export function sameProcessIdentity(a, b) {
  return positivePid(a?.pid) && a.pid === b?.pid && typeof a.created === 'string' && a.created.length > 0 && a.created === b.created &&
    Array.isArray(a.argv) && a.argv.length > 0 && Array.isArray(b.argv) && a.argv.length === b.argv.length && a.argv.every((arg, index) => arg === b.argv[index]) &&
    (a.executable ?? '') === (b.executable ?? '')
}

export function classifyPort(records, reachable, port, options = {}) {
  if (!Array.isArray(records)) return { state: 'probe-error', processes: [], error: 'Invalid ownership records' }
  if (!records.length) return { state: reachable ? 'unknown' : 'empty', processes: [] }
  return { state: records.every(record => isDshWebProcess(record, port, options)) ? 'owned' : 'unknown', processes: records }
}

async function verifyEntry(record, platform) {
  if (!isDshWebProcess(record, record.port, { platform })) return false
  const entry = await realpath(record.argv[1])
  const pkg = JSON.parse(await readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8'))
  if (pkg.name !== '@deepseek-ai/dsh' || path.basename(entry) !== 'bin.js' || path.basename(path.dirname(entry)) !== 'lib') return false
  const executable = await realpath(record.executable || record.argv[0])
  return /^node(?:\.exe)?$/i.test(path.basename(executable)) || executable === await realpath(process.execPath)
}

async function posixRecord(pid, platform, run, options) {
  if (platform === 'linux') {
    const prefix = `/proc/${pid}`
    const [raw, stat, executable] = await Promise.all([readFile(`${prefix}/cmdline`), readFile(`${prefix}/stat`, 'utf8'), realpath(`${prefix}/exe`)])
    const suffix = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
    return { pid, parentPid: Number(suffix[1]), created: suffix[19], argv: raw.toString().split('\0').filter((value, index, all) => index < all.length - 1), executable }
  }
  const result = await run('ps', ['-ww', '-p', String(pid), '-o', 'ppid=', '-o', 'lstart=', '-o', 'command='], { ...options, env: { ...options.env, LC_ALL: 'C', LANG: 'C' } })
  if (result.status !== 0) throw new Error('ps could not read listener identity')
  const match = result.stdout.trim().match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/)
  if (!match) throw new Error('ps returned an unreadable listener identity')
  // ps does not escape argv. Recover only the known Node + DSH entry form;
  // ambiguous quoted/metacharacter command lines are unknown, never guessed.
  const command = match[3]
  const args = command.match(/^((?:.*\/)?(?:node|node\.exe|nodejs|node\d+))\s+(.+?\/node_modules\/(?:@deepseek-ai\/dsh\/lib\/bin\.js|\.bin\/dsh))\s+(web(?:\s+.*)?)$/)
  if (!args || /["'\\]/.test(args[3])) throw new Error('ps argv boundaries cannot be proven')
  // ps argv[0] may be the bare shebang name. lsof txt identifies the actual
  // process executable independently; never resolve a bare name via caller PATH.
  const text = await run('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], options)
  const executables = (text.stdout || '').split(/\r?\n/).filter(line => line.startsWith('n')).map(line => line.slice(1))
  const executable = executables.find(file => /^node(?:\.exe|js|\d+)?$/.test(path.basename(file)))
  if (text.status !== 0 || !executable) throw new Error('lsof could not prove listener executable')
  return { pid, parentPid: Number(match[1]), created: match[2], argv: [args[1], args[2], ...args[3].split(/\s+/)], executable }
}

function windowsQuery(port) {
  return `[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop';try { $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq ${Number(port)} });$records=@();foreach($id in @($listeners.OwningProcess | Sort-Object -Unique)){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction Stop;if(-not $p -or -not $p.CreationDate -or -not $p.CommandLine -or -not $p.ExecutablePath){throw 'Process identity unavailable'};$records+=@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');commandLine=$p.CommandLine;executable=$p.ExecutablePath}};ConvertTo-Json -Compress -Depth 5 -InputObject @{state='ok';processes=@($records)}} catch {ConvertTo-Json -Compress -InputObject @{state='probe-error';error='Windows listener/CIM query unavailable'};exit 1}`
}

export async function probePort(port, { platform = process.platform, env = process.env, deadline = Date.now() + 5_000, run = runPlatformCommand, connect = portReachable } = {}) {
  const error = message => ({ state: 'probe-error', processes: [], error: message })
  if (!validPort(port)) return error('Port must be an integer in 1..65535')
  if (Date.now() >= deadline) return error('Ownership probe deadline expired')
  const options = { env, timeoutMs: Math.min(5_000, Math.max(1, deadline - Date.now())) }
  try {
    let records
    if (platform === 'win32') {
      const encoded = Buffer.from(windowsQuery(port), 'utf16le').toString('base64')
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], options)
      if (result.status !== 0) return error('Windows ownership probe unavailable; requires PowerShell Get-NetTCPConnection and CIM access')
      const doc = JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
      if (doc.state !== 'ok' || !Array.isArray(doc.processes)) return error('Windows ownership probe returned invalid data')
      records = doc.processes.map(record => ({ ...record, argv: parseWindowsCommandLine(record.commandLine) }))
    } else {
      const result = await run('lsof', ['-nP', `-tiTCP:${Number(port)}`, '-sTCP:LISTEN'], options)
      if (result.status === 1 && !result.stdout?.trim() && !result.stderr?.trim()) records = []
      else if (result.status !== 0) return error('lsof is required for safe ownership queries; install lsof and ensure ps is available')
      else {
        const ids = [...new Set(result.stdout.trim().split(/\s+/).map(Number))]
        if (!ids.length || ids.some(pid => !positivePid(pid))) return error('lsof returned invalid listener PIDs')
        records = await Promise.all(ids.map(pid => posixRecord(pid, platform, run, { env, timeoutMs: Math.min(5_000, Math.max(1, deadline - Date.now())) })))
      }
    }
    const reachable = records.length ? true : await connect(Number(port), { timeoutMs: Math.min(300, Math.max(1, deadline - Date.now())) })
    const result = classifyPort(records, reachable, port, { platform })
    if (result.state === 'owned') {
      for (const record of records) {
        try { if (!await verifyEntry({ ...record, port }, platform)) return { state: 'unknown', processes: records, error: 'DSH entry package identity cannot be verified' } }
        catch { return { state: 'unknown', processes: records, error: 'DSH entry package identity cannot be verified' } }
      }
    }
    if (Date.now() > deadline) return error('Ownership probe exceeded its deadline')
    return result
  } catch {
    return error('Ownership query failed or returned unreadable process identity; refusing to infer an empty port')
  }
}

export async function stopServer(port, options = {}) {
  const { platform = process.platform, env = process.env, run = runPlatformCommand, connect = portReachable, signal = (pid, kind) => process.kill(pid, kind), warn = message => console.warn(message) } = options
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 20_000)
  const probe = options.probe ?? (() => probePort(port, { platform, env, run, connect, deadline: Math.min(deadline, Date.now() + 5_000) }))
  const fail = (state, error) => ({ ok: false, state, error })
  if (!validPort(port)) return fail('probe-error', 'Invalid port')
  let initial = await probe()
  if (initial.state === 'empty') return { ok: true, state: 'empty' }
  if (initial.state !== 'owned' || !initial.processes?.length) return fail(initial.state, initial.error || 'Listener is not provably DSH; refusing to kill')
  const originals = initial.processes
  const revalidate = current => current.state === 'owned' && current.processes?.length > 0 && current.processes.every(record => originals.some(original => sameProcessIdentity(original, record)))
  const send = async kind => {
    for (const original of originals) {
      if (Date.now() >= deadline) return fail('probe-error', 'Stop deadline expired')
      const current = await probe()
      if (current.state === 'empty') return { ok: true, state: 'empty' }
      if (!revalidate(current)) return fail(current.state === 'owned' ? 'unknown' : current.state, 'Listener identity changed; refusing to signal')
      const record = current.processes.find(item => item.pid === original.pid)
      if (!record) continue
      try {
        if (platform === 'win32') {
          warn('Windows: 强制停止已核验 DSH 进程树 (forced termination; no graceful flush guarantee)')
          const result = await run('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { env, timeoutMs: Math.max(1, Math.min(5_000, deadline - Date.now())) })
          if (result.status !== 0 && result.status !== 128) return fail('owned', 'taskkill failed')
          if (result.status === 128) {
            const after = await probe()
            if (after.state !== 'empty') return fail(after.state, 'taskkill could not find the verified process; port is not proven empty')
            return { ok: true, state: 'empty' }
          }
        } else await signal(record.pid, kind)
      } catch { return fail('unknown', 'Signal failed; ownership is no longer proven') }
    }
    return null
  }
  let result = await send('SIGTERM')
  if (result) return result
  const termDeadline = platform === 'win32' ? deadline : Math.min(deadline, Date.now() + 10_000)
  while (Date.now() < termDeadline && await connect(Number(port), { timeoutMs: Math.min(300, Math.max(1, termDeadline - Date.now())) })) await pause(Math.min(100, Math.max(1, termDeadline - Date.now())))
  let current = await probe()
  if (current.state === 'empty') return { ok: true, state: 'empty' }
  if (!revalidate(current)) return fail(current.state === 'owned' ? 'unknown' : current.state, 'Listener changed during stop')
  if (platform === 'win32') return fail(current.state, 'Verified Host did not stop within the deadline')
  result = await send('SIGKILL')
  if (result) return result
  while (Date.now() < deadline && await connect(Number(port), { timeoutMs: Math.min(300, Math.max(1, deadline - Date.now())) })) await pause(Math.min(100, Math.max(1, deadline - Date.now())))
  current = await probe()
  return current.state === 'empty' ? { ok: true, state: 'empty' } : fail(current.state, 'Port is not proven empty after stopping DSH')
}
