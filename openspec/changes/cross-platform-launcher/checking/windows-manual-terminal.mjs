// Human-confirmed actual terminal closure acceptance, full ordinary Windows profile.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
if (process.platform !== 'win32') throw Error('Native Windows required')
const repo = 'D:\\opensource\\ohmydsh'
const receipt = new URL('./baselines/windows-manual-terminal-state.json', import.meta.url)
const mode = process.argv[2] || 'prepare'
const { loadEnvironment } = await import(pathToFileURL(path.join(repo, 'scripts/launcher/environment.mjs')))
const { probePort, sameProcessIdentity, stopServer } = await import(pathToFileURL(path.join(repo, 'scripts/launcher/process.mjs')))
const caller = { ...process.env, DSH_SKIP_UPDATE: '1' }; delete caller.DSH_BIN
const { npmEnv: env, home } = loadEnvironment(repo, caller)
const keys = Object.keys(env).filter(k => k.toLowerCase() === 'path'), inherited = env[keys[0]] || ''
for (const k of keys) delete env[k]
env.PATH = [path.dirname(process.execPath), path.join(repo, 'node_modules/.launcher-tools/node_modules/.bin'), inherited].join(path.delimiter)
env.npm_config_prefix = path.join(repo, 'node_modules/.launcher-tools')
env.DSH_SKIP_UPDATE = '1'
const ps = code => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { env, encoding: 'utf8', timeout: 15000, windowsHide: true })
if (mode === 'worker') {
  const [root, portText] = process.argv.slice(3), port = Number(portText)
  if (!path.isAbsolute(root) || !Number.isInteger(port) || port === 3080 || (await probePort(port, { env })).state !== 'empty') throw Error('Unsafe manual port')
  const r = spawnSync(process.execPath, [path.join(repo, 'bin/dsh.mjs'), '--no-open', '--port', portText], { cwd: repo, env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 })
  if (r.status !== 0) { await fs.writeFile(path.join(root, 'failure.txt'), String(r.stderr).slice(-5000)); throw Error('Manual launcher failed') }
  const owner = await probePort(port, { env })
  if (owner.state !== 'owned' || owner.processes.length !== 1) throw Error('Manual Host ownership not proven')
  await fs.writeFile(path.join(root, 'ready.json'), JSON.stringify({ owner: owner.processes[0], port }))
  console.log('HOST READY. Close ONLY this window when asked in the browser.')
} else if (mode === 'prepare') {
  const previous = await fs.readFile(receipt, 'utf8').catch(() => null)
  if (previous) throw Error('Existing manual receipt; verify before another attempt')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-manual-terminal-'))
  const server = net.createServer().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const port = server.address().port; await new Promise(r => server.close(r))
  if (port === 3080 || (await probePort(port, { env })).state !== 'empty') throw Error('Unsafe manual port')
  const title = 'DSH MANUAL CLOSE TEST - PORT ' + port
  const shellFile = path.join(root, 'shell.json'), eventFile = path.join(root, 'console-event')
  const single = x => "'" + String(x).replaceAll("'", "''") + "'"
  const csharp = 'using System;using System.IO;using System.Runtime.InteropServices;public static class ManualClose{public delegate bool Handler(uint k);static Handler h;[DllImport("kernel32.dll")]static extern bool SetConsoleCtrlHandler(Handler h,bool add);public static void Register(string file){h=delegate(uint k){File.WriteAllText(file,k.ToString());return false;};if(!SetConsoleCtrlHandler(h,true))throw new Exception("Console handler registration failed");}}'
  const code = `$ErrorActionPreference='Stop';$Host.UI.RawUI.WindowTitle=${single(title)};Add-Type -TypeDefinition ${single(csharp)};[ManualClose]::Register(${single(eventFile)});[IO.File]::WriteAllText(${single(shellFile)},('{"pid":'+$PID+',"startedTicks":"'+(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks+'"}'));& ${single(process.execPath)} ${single(import.meta.filename)} worker ${single(root)} ${port};if($LASTEXITCODE -ne 0){throw 'Test preparation failed'};Write-Host ${single(title)};Write-Host 'WAIT FOR BROWSER INSTRUCTION, THEN CLOSE THIS WINDOW USING X.';while($true){Start-Sleep -Seconds 1}`
  const encoded = Buffer.from(code, 'utf16le').toString('base64')
  const opened = ps(`$p=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand','${encoded}') -WorkingDirectory '${repo}' -PassThru;[pscustomobject]@{started=$p.Id}|ConvertTo-Json -Compress`)
  if (opened.status !== 0) throw Error(opened.stderr)
  // Persist immediately, even if preparation fails, so owned cleanup remains possible.
  await fs.writeFile(receipt, JSON.stringify({ root, port, title, home, opened: JSON.parse(opened.stdout) }))
  let ready
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    ready = await fs.readFile(path.join(root, 'ready.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (ready) break
    if (await fs.readFile(path.join(root, 'failure.txt'), 'utf8').catch(() => null)) throw Error('Worker failed; diagnostic retained')
    await new Promise(r => setTimeout(r, 250))
  }
  if (!ready) throw Error('Visible terminal not ready within budget; receipt retained')
  const shell = JSON.parse(await fs.readFile(shellFile, 'utf8'))
  await fs.writeFile(receipt, JSON.stringify({ root, port, title, home, shell, owner: ready.owner }))
  console.log(JSON.stringify({ stage: 'AWAITING_HUMAN_CLOSE', title, port, shellPid: shell.pid, hostPid: ready.owner.pid, root }))
} else if (mode === 'verify') {
  const state = JSON.parse(await fs.readFile(receipt, 'utf8'))
  const event = await fs.readFile(path.join(state.root, 'console-event'), 'utf8').catch(() => '<absent>')
  const check = ps(`$p=Get-Process -Id ${state.shell.pid} -ErrorAction SilentlyContinue;[pscustomobject]@{sameShell=([bool]$p -and ($p.StartTime.ToUniversalTime().Ticks.ToString() -eq '${state.shell.startedTicks}'))}|ConvertTo-Json -Compress`)
  if (check.status !== 0) throw Error(check.stderr)
  const sameShell = JSON.parse(check.stdout).sameShell
  const after = await probePort(state.port, { env })
  const sameHost = after.state === 'owned' && after.processes.length === 1 && sameProcessIdentity(after.processes[0], state.owner)
  console.log(JSON.stringify({ event: event.trim(), sameShell, sameHost, port: state.port, hostPid: state.owner.pid }))
  if (sameShell || event.trim() !== '2' || !sameHost) throw Error('Manual closure acceptance not proven; keep evidence and owned cleanup receipt')
  const stopped = await stopServer(state.port, { env, warn: () => {} })
  if (!stopped.ok || (await probePort(state.port, { env })).state !== 'empty') throw Error('Manual test Host cleanup failed')
  console.log('MANUAL_REAL_TERMINAL_CLOSE_SAME_HOST_AND_STOP_PASS')
} else throw Error('Unknown mode')
