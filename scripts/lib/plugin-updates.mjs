// scripts/lib/plugin-updates.mjs — 远端插件升级检测核心(供
// scripts/check-plugin-updates.mjs 与 scripts/plugin-update.mjs 共用)。
//
// 判定(只读,不改 manifest):
//   兼容性 - @deepseek-ai/dsh-* peer 用当前 dshVersion;
//            @deepseek-ai/cordis peer 用部署 cordis 版本(独立版本线)。
//   稳定性 - 非 pre-release、未被 deprecated、最新版发布 ≤ STALE_DAYS。
//   状态   - up-to-date / upgrade-ready / needs-review / skipped。
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'

export const STALE_DAYS = 60
export const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
export const CORDIS = '@deepseek-ai/cordis'

// ---------- 最小 semver(覆盖插件 peer 常见写法:精确 / ^ / ~ / *) ----------
export function parseVersion(v) {
  const m = String(v).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
}
function cmpPre(a, b) {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const x = a.split('.'), y = b.split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i], yi = y[i]
    if (xi === undefined) return -1
    if (yi === undefined) return 1
    const xn = +xi, yn = +yi
    const xnNum = Number.isInteger(xn), ynNum = Number.isInteger(yn)
    if (xnNum && ynNum) { if (xn !== yn) return xn < yn ? -1 : 1 }
    else if (xnNum) return -1
    else if (ynNum) return 1
    else { const c = xi < yi ? -1 : xi > yi ? 1 : 0; if (c) return c }
  }
  return 0
}
export function compareVersions(a, b) {
  const na = [a.major, a.minor, a.patch], nb = [b.major, b.minor, b.patch]
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] < nb[i] ? -1 : 1
  return cmpPre(a.pre, b.pre)
}
export function satisfies(version, range) {
  const v = parseVersion(version)
  if (!v) return null
  const r = String(range).trim()
  if (r === '*' || r === '') return true
  if (r.startsWith('^')) {
    const base = parseVersion(r.slice(1))
    if (!base) return null
    const upper = base.major > 0 ? [base.major + 1, 0, 0] : base.minor > 0 ? [0, base.minor + 1, 0] : [0, 0, base.patch + 1]
    return compareVersions(v, base) >= 0 && compareVersions(v, { major: upper[0], minor: upper[1], patch: upper[2], pre: null }) < 0
  }
  if (r.startsWith('~')) {
    const base = parseVersion(r.slice(1))
    if (!base) return null
    const upper = base.major > 0 ? [base.major, base.minor + 1, 0] : [0, base.minor, base.patch + 1]
    return compareVersions(v, base) >= 0 && compareVersions(v, { major: upper[0], minor: upper[1], patch: upper[2], pre: null }) < 0
  }
  const exact = parseVersion(r)
  return exact ? compareVersions(v, exact) === 0 : null
}
export function isPreRelease(v) { return /[-_.](rc|beta|alpha|next|pre|dev)\b/i.test(v) }

/** 部署中的 cordis 版本(独立版本线,不能用 dshVersion 判定)。 */
export function deployedCordisVersion(dshHome) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const cands = [
    path.join(home, 'profiles', 'node_modules', CORDIS, 'package.json'),
    path.join(home, 'profiles', 'web', 'node_modules', CORDIS, 'package.json'),
    path.join(os.homedir(), '.npm', '_npx', 'de4831d60afe10da', 'node_modules', CORDIS, 'package.json'),
  ]
  for (const c of cands) if (existsSync(c)) {
    const v = JSON.parse(readFileSync(c, 'utf8')).version
    if (typeof v === 'string' && v.length) return v
  }
  return null
}

function peerCompatIssue(dshVersion, cordisVersion, peers) {
  for (const [pname, range] of Object.entries(peers ?? {})) {
    if (pname.startsWith(DSH_PEER_PREFIX)) {
      const ok = satisfies(dshVersion, range)
      if (ok === false) return `${pname} peer ${range} 不满足当前 DSH ${dshVersion}`
    } else if (pname === CORDIS) {
      if (cordisVersion === null) return `${pname} peer ${range}:无法确定部署 cordis 版本`
      const ok = satisfies(cordisVersion, range)
      if (ok === false) return `${pname} peer ${range} 不满足部署 cordis ${cordisVersion}`
    }
  }
  return null
}

async function registryPackage(name, registry) {
  const url = `${registry}/${encodeURIComponent(name).replace('@', '%40')}`
  const res = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const doc = await res.json()
  const latest = doc['dist-tags']?.latest
  const latestEntry = doc.versions?.[latest]
  return { latest, deprecated: latestEntry?.deprecated, peers: latestEntry?.peerDependencies ?? {}, publishedAt: doc.time?.[latest] }
}

/** npm spec 解析:'@scope/name@1.2.3' → { name } 非 npm spec → null。 */
export function npmSpecOf(item) {
  const spec = String(item.spec ?? '')
  const m = spec.match(/^(@[^/]+\/[^@]+|[^@/]+)@/)
  return m ? { name: m[1] } : null
}

/**
 * 检测 manifest 中所有 remote package 条目的更新状态。
 * @returns {Promise<Array<object>>} rows(见 check-plugin-updates 输出结构)。
 */
export async function detectRemotePluginUpdates({ manifestPath, registry = 'https://registry.npmjs.org', dshVersion, cordisVersion }) {
  const manifest = yaml.load(readFileSync(manifestPath, 'utf8'))
  const current = dshVersion ?? String(manifest.dshVersion)
  const rows = []
  for (const item of manifest.customizations ?? []) {
    if (item.source !== 'remote' || item.type !== 'package') continue
    const parsed = npmSpecOf(item)
    if (!parsed) { rows.push({ id: item.id, status: 'skipped', current: undefined, latest: undefined, issues: [], reason: `非 npm registry spec(${item.spec}),跳过自动检测`, peers: {} }); continue }
    let info
    try { info = await registryPackage(parsed.name, registry) } catch (e) {
      rows.push({ id: item.id, status: 'skipped', current: item.version, latest: undefined, issues: [], reason: `registry 查询失败: ${e.message}`, peers: {} }); continue
    }
    const issues = []
    if (info.latest !== item.version) {
      const compat = peerCompatIssue(current, cordisVersion, info.peers)
      if (compat) issues.push(compat)
      if (isPreRelease(info.latest)) issues.push(`${info.latest} 为 pre-release(尚不稳定)`)
      if (info.deprecated) issues.push('已被 npm 标记 deprecated')
      if (info.publishedAt && (Date.now() - Date.parse(info.publishedAt)) > STALE_DAYS * 864e5) issues.push(`最新版发布于 ${info.publishedAt.slice(0, 10)},超过 ${STALE_DAYS} 天未更新(稳定性存疑)`)
    }
    const unknownPeers = Object.keys(info.peers ?? {}).filter((p) => !p.startsWith(DSH_PEER_PREFIX) && p !== CORDIS)
    rows.push({
      id: item.id, current: item.version, latest: info.latest,
      name: parsed.name,
      status: info.latest === item.version ? 'up-to-date' : issues.length ? 'needs-review' : 'upgrade-ready',
      issues, peers: info.peers ?? {},
      peerNote: unknownPeers.length ? `非核心 peer: ${Object.entries(info.peers).filter(([p]) => unknownPeers.includes(p)).map(([p, r]) => `${p} ${r}`).join('; ')}` : '',
    })
  }
  return { rows, cordisVersion, dshVersion: current }
}