#!/usr/bin/env node
// Host prerequisite provisioning: make sure this machine has what the enabled
// customizations declare they need (`hostPrerequisites` in dsh.yaml).
//
// Why this exists: a declaration like `@touchskyer/memex@0.4.1` is a *global npm
// install*. `dsh build` materializes profile dependencies and never touches it;
// the personal sync list carries repositories and config, not global packages;
// the memory libraries themselves hold cards, not the kernel. So every rebuild
// of a machine (second machine, second account, fresh DSH home, restored
// library) keeps the data and loses the tool — and the only warning is a
// settings page that no longer has facts to show.
//
// Two entry points, one implementation:
//   - bin/dsh runs this before start/build/restart (best effort, never blocks).
//   - `dsh doctor [--check]` runs it on demand.
//
// Check, then install only what is missing or on the wrong version; reinstall
// nothing that is already correct. Never install anything sync did not declare.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBoundedProvision } from './lib/dsh-cli.mjs'
import { applyEnvLocal, enabledEnvNames, isCustomizationEnabled } from './lib/env-local.mjs'
import { loadManifestWithOverlay, OVERLAY_PATH_ENV } from './lib/manifest-overlay.mjs'
import { parseHostPrerequisites } from './lib/host-prerequisites.mjs'

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000
const PROBE_TIMEOUT_MS = 20_000

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

if (has('--help') || has('-h')) {
  console.log(`用法: node scripts/host-prerequisites.mjs [--check] [--json] [--repo <path>] [--timeout-ms <n>]

检查并（默认）补齐 manifest 中启用定制的 hostPrerequisites。
  --check        只检查，不安装任何东西
  --json         机器可读输出
  --repo <path>  manifest 所在仓库根（默认脚本上一级）
  --timeout-ms   单次安装的超时上限（默认 ${DEFAULT_INSTALL_TIMEOUT_MS}）

退出码: 0 = 全部满足（或无事可做）; 1 = 有前提未满足或存在问题`)
  process.exit(0)
}

const REPO = path.resolve(valueOf('--repo') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const CHECK_ONLY = has('--check')
const AS_JSON = has('--json')
const INSTALL_TIMEOUT_MS = Number(valueOf('--timeout-ms') ?? DEFAULT_INSTALL_TIMEOUT_MS)

const problems = []
const records = []

/** Report a line in the shape the caller asked for. */
const note = (message) => { if (!AS_JSON) console.log(`[prereq] ${message}`) }
const warn = (message) => { if (!AS_JSON) console.error(`[prereq] ${message}`) }

/**
 * The registry an install must use, most specific source first.
 *
 * A global install can ignore the repository `.npmrc`, so the value is passed
 * explicitly rather than inherited from the working directory. The caller's own
 * registry override wins over the repository default, exactly like bin/dsh's
 * `with_repo_registry`.
 *
 * @param declaration - one normalized prerequisite.
 * @returns the registry URL, or `undefined` to let npm decide.
 */
function registryFor(declaration) {
  if (declaration.registry !== undefined) return declaration.registry
  const fromEnv = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  const npmrc = path.join(REPO, '.npmrc')
  if (!existsSync(npmrc)) return undefined
  for (const line of readFileSync(npmrc, 'utf8').split('\n')) {
    const match = line.match(/^\s*registry\s*=\s*"?([^"\s]+)"?\s*$/)
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}

/** The global npm root of the node/npm this process would install with. */
function globalRoot() {
  const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
  if (result.error !== undefined && result.error !== null) throw new Error(`npm root -g 失败: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`npm root -g 退出码 ${result.status ?? 'null'}`)
  const root = String(result.stdout ?? '').trim()
  if (root === '') throw new Error('npm root -g 没有输出全局目录')
  return root
}

/** The version installed under `root`, or `undefined` when the package is absent. */
function installedVersion(root, pkg) {
  const candidate = path.join(root, ...pkg.split('/'))
  let real
  try {
    real = realpathSync(candidate)
  } catch {
    return undefined
  }
  try {
    const manifest = JSON.parse(readFileSync(path.join(real, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    // A directory that exists but is not a readable package is not "satisfied":
    // the consumer resolves the same path and would refuse it too.
    return undefined
  }
}

/** One declaration's current state, read fresh each time (install changes it). */
function inspect(root, declaration) {
  const version = installedVersion(root, declaration.package)
  if (version === undefined) return { state: 'missing', version }
  if (version !== declaration.version) return { state: 'mismatch', version }
  return { state: 'ok', version }
}

/**
 * Install exactly the declared pin, bounded, with an explicit registry.
 * @returns `{ ok, detail }` — never throws: a failed install is a diagnostic,
 *   not a crash, because the launcher's start path must survive it.
 */
function install(declaration) {
  const spec = `${declaration.package}@${declaration.version}`
  const registry = registryFor(declaration)
  const argv = ['install', '-g', spec, ...(registry !== undefined ? [`--registry=${registry}`] : [])]
  note(`${declaration.id}: 安装 ${spec}${registry !== undefined ? ` （registry ${registry}）` : ''}`)
  const result = runBoundedProvision('npm', argv, {
    cwd: REPO,
    timeoutMs: INSTALL_TIMEOUT_MS,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.timedOut) return { ok: false, detail: `安装超时（${INSTALL_TIMEOUT_MS}ms），已终止` }
  if (!result.ok) {
    const detail = String(result.stderr ?? '').trim().split('\n').slice(-3).join(' | ')
    return { ok: false, detail: `安装失败（退出码 ${result.status ?? 'null'}）${detail === '' ? '' : `: ${detail}`}` }
  }
  return { ok: true, detail: '' }
}

// ---------- collect what this machine must have ----------
let wanted = []
try {
  // Mirror sync's load order: the overlay path decides which entries (and thus
  // which enabledEnv names) exist at all; both come from the same .env.local.
  applyEnvLocal({ repo: REPO, names: [OVERLAY_PATH_ENV], env: process.env, strict: true })
  const { doc } = loadManifestWithOverlay({ manifestPath: path.join(REPO, 'dsh.yaml'), repo: REPO, env: process.env, strict: true })
  applyEnvLocal({ repo: REPO, names: enabledEnvNames(doc), env: process.env, strict: true })
  for (const item of Array.isArray(doc.customizations) ? doc.customizations : []) {
    let enabled
    try {
      enabled = isCustomizationEnabled(item, process.env)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
      continue
    }
    if (!enabled || item?.type !== 'package') continue
    try {
      for (const declaration of parseHostPrerequisites(item, `customizations (${item.id})`) ?? []) {
        wanted.push({ id: item.id, ...declaration })
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
} catch (error) {
  problems.push(`manifest 读取失败: ${error instanceof Error ? error.message : String(error)}`)
}
wanted = wanted.sort((a, b) => (a.id === b.id ? a.package.localeCompare(b.package) : a.id.localeCompare(b.id)))

// ---------- check, then heal ----------
const skipped = process.env.DSH_SKIP_HOST_PREREQUISITES
const skipRequested = typeof skipped === 'string' && ['1', 'true', 'yes', 'on'].includes(skipped.trim().toLowerCase())
if (skipRequested) note('DSH_SKIP_HOST_PREREQUISITES 已设置：本次跳过自愈')

let root
if (wanted.length > 0 && !skipRequested) {
  try {
    root = globalRoot()
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }
}

for (const declaration of wanted) {
  const record = {
    id: declaration.id,
    package: declaration.package,
    version: declaration.version,
    registry: registryFor(declaration),
    state: 'unknown',
    installed: undefined,
  }
  if (skipRequested || root === undefined) {
    record.state = 'skipped'
    records.push(record)
    continue
  }
  let state = inspect(root, declaration)
  if (state.state === 'ok') {
    note(`${declaration.id}: ${declaration.package}@${declaration.version} 已就绪`)
    record.state = 'ok'
    record.installed = state.version
    records.push(record)
    continue
  }
  note(`${declaration.id}: ${declaration.package} ${state.state === 'missing' ? '未安装' : `版本不符（当前 ${state.version ?? '未知'}）`}，需要 ${declaration.version}`)
  if (CHECK_ONLY) {
    // Read-only mode still answers the question it was asked: an unsatisfied
    // prerequisite is a failure for the caller, not a silent observation.
    problems.push(`${declaration.package}@${declaration.version}: 未满足（当前 ${state.version ?? '未检测到'}）；--check 不安装`)
    record.state = state.state
    record.installed = state.version
    records.push(record)
    continue
  }
  const result = install(declaration)
  if (!result.ok) {
    warn(`${declaration.id}: ${result.detail}`)
    problems.push(`${declaration.package}@${declaration.version}: ${result.detail}`)
    record.state = 'failed'
    records.push(record)
    continue
  }
  state = inspect(root, declaration)
  if (state.state !== 'ok') {
    const detail = `安装后仍不满足（当前 ${state.version ?? '未检测到'}）`
    warn(`${declaration.id}: ${detail}`)
    problems.push(`${declaration.package}@${declaration.version}: ${detail}`)
    record.state = 'failed'
    records.push(record)
    continue
  }
  note(`${declaration.id}: ${declaration.package}@${declaration.version} 已安装`)
  record.state = 'installed'
  record.installed = state.version
  records.push(record)
}

if (records.length === 0 && problems.length === 0) note('没有声明任何本机运行前提')

if (AS_JSON) {
  console.log(JSON.stringify({ repo: REPO, check: CHECK_ONLY, skipped: skipRequested, records, problems }, null, 2))
  process.exit(problems.length === 0 ? 0 : 1)
}

for (const problem of problems) console.error(`[prereq] ${problem}`)
process.exit(problems.length === 0 ? 0 : 1)
