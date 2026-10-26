import { spawn } from '../lib/child-process.mjs'
import { appendFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { runPlatformCommand } from './process.mjs'

const QUIT_APP = `on run argv
  set appName to item 1 of argv
  tell application "System Events"
    if exists process appName then
      tell application appName to quit
    end if
  end tell
end run`
const CLOSE_TABS = `on run argv
  set targetPrefix to "http://127.0.0.1:" & (item 1 of argv) & "/"
  if application "Google Chrome" is running then
    tell application "Google Chrome"
      repeat with w in windows
        repeat with i from (count of tabs of w) to 1 by -1
          set t to tab i of w
          if (URL of t starts with targetPrefix) then close t
        end repeat
      end repeat
    end tell
  end if
end run`

export function shouldOpenUi(doc, flags = {}) {
  if (flags.noOpen) return false
  if (flags.open) return true
  return doc?.web?.open !== false
}

function loopbackUrl(port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid UI port; expected integer in 1..65535')
  return `http://127.0.0.1:${Number(port)}`
}

async function uiLog(env, event) {
  if (!env.DSH_HOME) return
  try { await appendFile(path.join(env.DSH_HOME, 'dsh-ui.log'), `[${new Date().toISOString()}] UI ${event}\n`, { mode: 0o600 }) } catch { /* Diagnostic logging cannot take down a healthy Host. */ }
}

async function findPwa(env) {
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const found = []
  for (const dir of [path.join(home, 'Applications/Chrome Apps.localized'), path.join(home, 'Applications')]) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) if (entry.isDirectory() && /DeepSeek Harness\.app$/i.test(entry.name)) found.push(path.join(dir, entry.name))
    } catch (error) { if (error.code !== 'ENOENT') return '' }
  }
  return found.length === 1 ? found[0] : ''
}

async function invoke(run, command, args, env, timeoutMs = 3_000) {
  try { return await run(command, args, { env, timeoutMs }) }
  catch { return { status: null } }
}

// zx is confined to a fixed PowerShell opener with one validated loopback URL.
// All app names/paths and AppleScript data remain native executable argv.
async function windowsOpen(url, env) {
  const { $, within, usePowerShell } = await import('zx')
  return within(async () => {
    usePowerShell()
    const output = await $({ env, quiet: true, nothrow: true, timeout: 3_000 })`Start-Process -ErrorAction Stop ${url}`
    return { status: output.exitCode }
  })
}

export async function openUi({ port, platform = process.platform, env = process.env, run = runPlatformCommand, warn = message => console.warn(message), doc, flags = {} } = {}) {
  const url = loopbackUrl(port)
  if (!shouldOpenUi(doc, flags)) {
    await uiLog(env, 'suppressed(--no-open / web.open=false)')
    return { opened: false, url, suppressed: true }
  }
  let result
  if (platform === 'darwin') {
    const app = env.DSH_OPEN_APP || await findPwa(env)
    if (app) {
      const isBundle = /\.app$/i.test(app) && await stat(app).then(info => info.isDirectory()).catch(() => false)
      result = await invoke(run, 'open', isBundle ? [app] : ['-a', app, url], env)
      if (result.status === 0) {
        await uiLog(env, `open ${isBundle ? 'pwa' : 'app'} ${app}`)
        return { opened: true, url, app }
      }
      warn('打开 PWA/application 失败，回退默认浏览器')
    }
    result = await invoke(run, 'open', [url], env)
  } else if (platform === 'win32') {
    if (env.DSH_OPEN_APP) warn('DSH_OPEN_APP is macOS-only; using the default URL opener')
    if (run === runPlatformCommand) {
      try { result = await windowsOpen(url, env) } catch { result = { status: null } }
    } else {
      const script = `$ErrorActionPreference='Stop';Start-Process -ErrorAction Stop '${url}'`
      result = await invoke(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], env)
    }
  } else {
    if (env.DSH_OPEN_APP) warn('DSH_OPEN_APP is macOS-only; using the default URL opener')
    if (run !== runPlatformCommand) result = await invoke(run, 'xdg-open', [url], env)
    else result = await new Promise(resolve => {
      // xdg-open may remain alive until a cold browser exits. A successful
      // spawn hands off the URL; do not impose a browser-lifetime deadline.
      const child = spawn('xdg-open', [url], { env, shell: false, detached: true, stdio: 'ignore' })
      child.once('error', () => resolve({ status: null }))
      child.once('spawn', () => { child.unref(); resolve({ status: 0 }) })
    })
  }
  const opened = result.status === 0
  if (!opened) warn(`UI opener unavailable or failed; open ${url} manually`)
  await uiLog(env, `${opened ? 'open browser' : 'print url(opener unavailable)'} ${url}`)
  return { opened, url }
}

export async function closeUi({ port, platform = process.platform, env = process.env, run = runPlatformCommand, warn = message => console.warn(message) } = {}) {
  loopbackUrl(port)
  if (platform !== 'darwin') {
    warn('请手动关闭浏览器标签 (close browser tabs manually); no browser process was stopped')
    return { closed: false }
  }
  const app = env.DSH_OPEN_APP || await findPwa(env)
  let appClosed = false
  const name = /\.app$/i.test(app) ? path.basename(app, path.extname(app)) : app
  const wholeBrowser = /^(?:Google Chrome(?: Canary)?|Chromium|Safari|Firefox|Microsoft Edge|Brave Browser|Opera)$/i.test(name)
  if (app && !wholeBrowser) {
    const result = await invoke(run, 'osascript', ['-e', QUIT_APP, name], env)
    appClosed = result.status === 0
    if (!appClosed) warn('PWA cleanup unavailable or timed out; no unknown UI process was signaled')
  }
  if (wholeBrowser) warn('Refusing to quit a whole browser; only same-port tabs are eligible for cleanup')
  const tabs = await invoke(run, 'osascript', ['-e', CLOSE_TABS, String(Number(port))], env)
  if (tabs.status !== 0) warn('Chrome tab cleanup unavailable or timed out; close same-port tabs manually')
  await uiLog(env, `cleanup app=${appClosed} tabs=${tabs.status === 0} port=${Number(port)}`)
  return { closed: appClosed, tabsClosed: tabs.status === 0 }
}
