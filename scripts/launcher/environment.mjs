import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseEnvLocal } from '../lib/env-local.mjs'

const keyOf = (env, name) => Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())
export function loadEnvironment(repo, caller = process.env, { platform = process.platform, warn = console.error } = {}) {
  const env = { ...caller }
  const file = path.join(repo, '.env.local')
  const entries = existsSync(file) ? parseEnvLocal(readFileSync(file, 'utf8'), { mode: 'strictLauncher', file }) : []
  const callerBinKey = platform === 'win32' ? keyOf(caller, 'DSH_BIN') : 'DSH_BIN'
  const callerBin = caller[callerBinKey]
  const assigned = new Map()
  for (const { name, value } of entries) {
    const key = platform === 'win32' ? keyOf(env, name) ?? name : name
    env[key] = value
    assigned.set(name.toLowerCase(), value)
  }
  if (platform === 'win32') {
    for (const name of ['DSH_BIN', 'DSH_HOME', 'DSH_PROFILE', 'DSH_OPEN_APP']) {
      const key = keyOf(env, name)
      if (key && key !== name) { env[name] = env[key]; delete env[key] }
    }
  }
  if (callerBin !== undefined) env.DSH_BIN = callerBin
  else {
    const legacy = path.join(repo, 'packages/dsh-pet/compat/subagent/.launcher/node_modules/.bin/dsh')
    const normalize = value => platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value
    if (env.DSH_BIN && normalize(env.DSH_BIN) === normalize(legacy)) {
      delete env.DSH_BIN
      warn('info: 忽略 .env.local 中旧 dsh-pet DSH_BIN；Host runtime 现由 dsh.yaml 声明管理')
    }
  }
  const get = name => env[platform === 'win32' ? keyOf(env, name) : name]
  const explicitRegistry = assigned.get('npm_config_registry') ?? (get('npm_command') ? '' : get('npm_config_registry') || get('NPM_CONFIG_REGISTRY') || '')
  let repoRegistry = ''
  try { repoRegistry = readFileSync(path.join(repo, '.npmrc'), 'utf8').match(/^\s*registry\s*=\s*"?([^"\s]+)"?\s*$/m)?.[1] ?? '' } catch (error) { if (error.code !== 'ENOENT') throw error }
  const registry = explicitRegistry || repoRegistry
  const npmEnv = { ...env }
  if (registry) {
    for (const name of Object.keys(npmEnv)) if (name.toLowerCase() === 'npm_config_registry') delete npmEnv[name]
    npmEnv.npm_config_registry = registry
  }
  const hostEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_(?:config_|lifecycle_|package_|command$|execpath$|node_execpath$)/i.test(key)))
  if (explicitRegistry) hostEnv.npm_config_registry = explicitRegistry
  return { env, npmEnv, hostEnv, explicitRegistry, home: env.DSH_HOME || path.join(os.homedir(), '.dsh'), profile: env.DSH_PROFILE || 'web' }
}
