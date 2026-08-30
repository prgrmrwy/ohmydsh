// scripts/lib/dsh-cli.mjs — CLI 实例解析与执行(upgrade-cli-provisioning)。
//
// 背景:升级链(sync 物化)对目标版本 @deepseek-ai/dsh CLI 的原调用方式为
// 每次 `npx -y @deepseek-ai/dsh@<version> …`。新版本首次使用需全新安装,
// libnpmexec 对同一 npx 缓存 key 持有安装锁(等待超时即报 ECOMPROMISED),
// 升级链内连续多次调用时后续调用必撞锁 → sync 失败 → 升级回滚。
// 本模块把调用收敛为「解析 bin 路径 → node 直连执行」:首次就绪后不再
// 经过 npx,从机制上消除安装锁竞争面;并保留 DSH_BIN 优先与失败语义。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/**
 * npm 11 libnpmexec 的 npx 缓存目录 key:对 packages 数组(排序后以
 * '\n' 连接)取 sha512 摘要前 16 位 hex。来源:
 *   npm/node_modules/libnpmexec/lib/index.js — `exec()` 的 installDir 计算。
 * 复刻而非引包,保持零新增依赖;若未来 npm 变更此算法,key 错配只会让
 * 就绪探测 miss → 走 npx 安装通道(npx 自身按新算法落位),退化为现状
 * 行为,不产生错误结果。
 * @param {string[]} packages - 与 npx 命令行一致的包 spec 列表。
 * @returns {string} 16 位 hex 目录名。
 */
export function computeNpxCacheKey(packages) {
  const input = [...packages].sort((a, b) => a.localeCompare(b, 'en')).join('\n')
  return crypto.createHash('sha512').update(input).digest('hex').slice(0, 16)
}

/** npx 缓存根目录:${npm cache}/_npx(跟随 npm_config_cache 环境变量)。 */
export function npxCacheDirOf(env = process.env) {
  const cache = env.npm_config_cache || path.join(os.homedir(), '.npm')
  return path.join(cache, '_npx')
}

/** dsh CLI 入口在任一安装目录内的路径(node 直跑 lib/bin.js)。 */
export function dshBinOf(dir) {
  return path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * 返回长期 web server 使用的真实 JS 入口。
 *
 * npm 在 POSIX 上通常把 `.bin/dsh` 生成为指向 lib/bin.js 的符号链接,
 * 但 pnpm 会生成 shell shim。启动器固定用 `node <serverBin>` 拉起服务,
 * 因此不能把 `.bin/dsh` 当作可由 Node 解析的 JavaScript。直接沿用解析出的
 * lib/bin.js 对 npm/npx/pnpm 三种安装布局都成立。DSH_BIN 显式指定时仍
 * 原样返回,由用户保证它是 Node 可执行的入口。
 * @param {{kind: string, bin: string}} resolved
 * @returns {string}
 */
export function serverBinFrom(resolved) {
  return resolved.bin
}

/** npx 缓存内目标版本 CLI 的 bin 路径。 */
export function npxBinPathOf(spec, npxCacheDir) {
  return path.join(npxCacheDir, computeNpxCacheKey([spec]), dshBinOf('.'))
}

/** pnpm 直装通道的固定目录(design D3):$XDG_CACHE_HOME 或 ~/.cache。 */
export function pnpmCliBaseOf(env = process.env) {
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'ohmydsh', 'dsh-cli')
}

/**
 * 就绪安装用的环境:显式注入 npmjs registry,避免调用方 cwd 不在仓库时
 * 落到用户级 ~/.npmrc(如内网镜像)导致安装慢/错源;调用方已显式设置
 * npm_config_registry(命令行/环境)时原样尊重。
 */
function installEnv() {
  if (process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY) return process.env
  return { ...process.env, npm_config_registry: 'https://registry.npmjs.org/' }
}

/** 通道 A:单次串行 npx 安装就绪(libnpmexec 自持锁,无并发竞争)。 */
function probeNpxInstall(spec) {
  const r = spawnSync('npx', ['-y', spec, '--version'], { stdio: 'inherit', env: installEnv() })
  return r.status === 0
}

/** 通道 B:pnpm 直装到固定目录,不经 npx(libnpmexec 安装不可靠时兜底)。 */
function probePnpmInstall(spec, dir) {
  if (existsSync(path.join(dir, 'node_modules'))) return existsSync(dshBinOf(dir))
  mkdirSync(dir, { recursive: true })
  const r = spawnSync('pnpm', ['add', spec, '--reporter=append-only'], { cwd: dir, stdio: 'inherit', env: installEnv() })
  return r.status === 0 && existsSync(dshBinOf(dir))
}

/**
 * 按 D1 顺序解析可执行的 CLI bin:
 *   1. 环境显式 DSH_BIN → 直接使用,不做就绪检查;
 *   2. npx 缓存内目标版本 bin 存在 → 直连;
 *   3. pnpm 直装目录已就绪 → 直连(复用,不触发安装);
 *   4. 皆缺失 → 通道 A(npx 单次就绪)后重新探测;
 *   5. 通道 A 失败 → 通道 B(pnpm 直装固定目录)后直连;
 *   6. 皆失败 → null(调用方按失败语义处理)。
 * @param {object} opts
 * @param {string} opts.spec - 如 '@deepseek-ai/dsh@0.1.1-rc.2'
 * @param {string} [opts.version] - 语义版本号(通道 B 目录名用)
 * @param {string} [opts.dshBinEnv] - DSH_BIN 环境值
 * @param {string} [opts.npxCacheDir] - 默认 npxCacheDirOf(process.env)
 * @param {string} [opts.pnpmCacheBase] - 默认 pnpmCliBaseOf(process.env)
 * @param {boolean} [opts.installProbe] - 是否允许触发安装通道(测试用 false)
 * @returns {null | {kind: 'env'|'npx-cache'|'pnpm-cache', bin: string}}
 */
export function resolveCliBin({ spec, version, dshBinEnv, npxCacheDir, pnpmCacheBase, installProbe = true }) {
  if (dshBinEnv) return { kind: 'env', bin: dshBinEnv }
  const npxRoot = npxCacheDir ?? npxCacheDirOf()
  let npxBin = npxBinPathOf(spec, npxRoot)
  if (existsSync(npxBin)) return { kind: 'npx-cache', bin: npxBin }
  const pnpmBase = pnpmCacheBase ?? pnpmCliBaseOf()
  const pnpmDir = version ? path.join(pnpmBase, version) : pnpmBase
  const pnpmBin = dshBinOf(pnpmDir)
  if (existsSync(pnpmBin)) return { kind: 'pnpm-cache', bin: pnpmBin }
  if (!installProbe) return null
  if (probeNpxInstall(spec)) {
    npxBin = npxBinPathOf(spec, npxRoot)
    if (existsSync(npxBin)) return { kind: 'npx-cache', bin: npxBin }
  }
  if (existsSync(pnpmBin) || (probePnpmInstall(spec, pnpmDir) && existsSync(pnpmBin))) {
    return { kind: 'pnpm-cache', bin: pnpmBin }
  }
  return null
}

/**
 * 执行一次 dsh CLI 调用:解析 bin 后以 node 直连(env 来源则按原义直接
 * spawn 该命令),退出码 0 返回 true,否则 false。失败不重试安装。
 * `opts.stdio` 透传给 spawnSync(默认 'inherit'):把 CLI 当作副作用执行
 * (如用 --dump-default-config 物化 profile 骨架)时传 'ignore',避免把
 * 整棵配置树打进 sync 日志。
 */
export function runDshCli(args, opts = {}) {
  const resolved = resolveCliBin(opts)
  if (!resolved) return false
  const stdio = opts.stdio ?? 'inherit'
  const r = resolved.kind === 'env'
    ? spawnSync(resolved.bin, args, { stdio })
    : spawnSync(process.execPath, [resolved.bin, ...args], { stdio })
  return r.status === 0
}
