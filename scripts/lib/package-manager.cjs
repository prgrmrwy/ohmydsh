// Builtin-only synchronous boundary shared by bootstrap and compat CJS callers.
const fs = require('node:fs')
const path = require('node:path')
const TOOLS = new Set(['npm', 'npx', 'pnpm', 'corepack'])

function envValue(env, name) {
  const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

function readableFile(file) {
  try {
    const real = fs.realpathSync(file)
    if (!fs.statSync(real).isFile()) return null
    fs.accessSync(real, fs.constants.R_OK)
    return real
  } catch { return null }
}

function packageEntry(prefix, name, relative) {
  if (!prefix) return null
  const root = path.join(prefix, 'node_modules', name)
  try {
    const realRoot = fs.realpathSync(root)
    if (JSON.parse(fs.readFileSync(path.join(realRoot, 'package.json'), 'utf8')).name !== name) return null
    const real = readableFile(path.join(realRoot, relative))
    if (!real || !real.startsWith(realRoot + path.sep)) return null
    return real
  } catch { return null }
}

function resolvePackageManager(tool, { env = process.env, nodePath = process.execPath, platform = process.platform } = {}) {
  if (!TOOLS.has(tool)) throw new Error(`unsupported package manager: ${tool}`)
  // POSIX executables preserve the existing PATH/testing contract without a shell.
  if (platform !== 'win32') return { command: tool, argsPrefix: [] }
  const nodeDir = path.dirname(nodePath)
  const npmPath = envValue(env, 'npm_execpath')
  let npmPrefix
  if (npmPath) {
    const real = readableFile(npmPath)
    if (real && path.basename(real) === 'npm-cli.js' && path.basename(path.dirname(real)) === 'bin') {
      const candidate = path.resolve(path.dirname(real), '../../..')
      if (packageEntry(candidate, 'npm', 'bin/npm-cli.js') === real) npmPrefix = candidate
    }
  }
  const prefixes = [...new Set([nodeDir, npmPrefix, envValue(env, 'npm_config_prefix')].filter(Boolean))]
  const asNode = file => ({ command: nodePath, argsPrefix: [file] })
  if (tool === 'npm' || tool === 'npx') {
    for (const prefix of prefixes) {
      const file = packageEntry(prefix, 'npm', `bin/${tool}-cli.js`)
      if (file) return asNode(file)
    }
  } else {
    if (tool === 'pnpm') {
      // A standalone pnpm.exe is a native executable; never inspect cmd/ps1 text.
      const search = String(envValue(env, 'PATH') ?? '')
      const delimiter = search.includes(';') ? ';' : path.delimiter
      for (const dir of search.split(delimiter).filter(Boolean)) {
        const exe = readableFile(path.join(dir, 'pnpm.exe'))
        if (exe) return { command: exe, argsPrefix: [] }
      }
      for (const prefix of prefixes) {
        const file = packageEntry(prefix, 'pnpm', 'bin/pnpm.cjs')
        if (file) return asNode(file)
      }
    }
    for (const prefix of prefixes) {
      const file = packageEntry(prefix, 'corepack', 'dist/corepack.js')
      if (file) return { command: nodePath, argsPrefix: [file, ...(tool === 'pnpm' ? ['pnpm'] : [])] }
    }
  }
  throw new Error(`Cannot resolve ${tool} without a shell. Use a Node installation with npm/bin JS entrypoints, a native pnpm.exe, or installed pnpm/Corepack JS. Unknown Volta/fnm or shim-only layouts are unsupported; no tool was installed.`)
}

function resolveExecutable(command, args = [], options = {}) {
  if (TOOLS.has(command)) {
    const resolved = resolvePackageManager(command, options)
    return { command: resolved.command, args: [...resolved.argsPrefix, ...args] }
  }
  if ((options.platform ?? process.platform) === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(command)) {
    throw new Error('Script shims cannot execute without a shell; use their real JS entrypoint or native exe')
  }
  return { command, args: [...args] }
}

function resolveDshCommand(bin, args = [], { platform = process.platform, nodePath = process.execPath, managed = false } = {}) {
  if (managed) return { command: nodePath, args: [bin, ...args] }
  if (platform !== 'win32') return { command: bin, args: [...args] }
  if (/\.(?:js|mjs|cjs)$/i.test(bin)) return { command: nodePath, args: [bin, ...args] }
  if (/\.exe$/i.test(bin)) return { command: bin, args: [...args] }
  throw new Error('Windows DSH_BIN must be one JS entrypoint (.js/.mjs/.cjs) or native .exe; cmd/bat/ps1 shims and command strings are unsupported')
}

module.exports = { resolvePackageManager, resolveExecutable, resolveDshCommand }
