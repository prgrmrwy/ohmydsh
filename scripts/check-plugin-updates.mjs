#!/usr/bin/env node
// ohmydsh plugin-update 检测:读 dsh.yaml 的 remote package 条目,对每个
// npm registry 插件输出「版本现状 + 与当前 DSH 的兼容性 + 稳定性」判定。
// 只读,不改 manifest;升级由人工确认后改 dsh.yaml + sync。
//
// 判定规则:
//   兼容性   - 插件声明的 @deepseek-ai/dsh-* / @deepseek-ai/cordis peer
//             版本范围须满足当前 dshVersion(仅检这两类核心范围,其余
//             peer 只列出,不判罪——它们由 DSH web 环境决定)。
//   稳定性   - latest 非 pre-release(rc/beta/alpha/next);
//             - 未被 npm 标记 deprecated;
//             - 最新版发布时间距今天 ≤ STALE_DAYS(默认 60 天,活跃维护)。
//   综合     - up-to-date / upgrade-ready / needs-review(附原因)。
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STALE_DAYS = 60
const REGISTRY = process.env.npm_config_registry || 'https://registry.npmjs.org'
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const CORDIS = '@deepseek-ai/cordis'

const manifest = yaml.load(readFileSync(path.join(REPO, 'dsh.yaml'), 'utf8'))
const current = String(manifest.dshVersion)

// ---------- 最小 semver(仅覆盖插件 peer 常见写法:精确 / ^ / ~ / * ) ----------
function parse(v) {
  const m = String(v).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
}
function nums(v) { return [v.major, v.minor, v.patch] }
function cmpPre(a, b) {
  if (a === b) return 0
  if (a === null) return 1 // 无 pre > 有 pre
  if (b === null) return -1
  const [x, y] = [a.split('.'), b.split('.')]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i], yi = y[i]
    if (xi === undefined) return -1
    if (yi === undefined) return 1
    const [xn, yn] = [+xi, +yi]
    const xnNum = Number.isInteger(xn), ynNum = Number.isInteger(yn)
    if (xnNum && ynNum) { if (xn !== yn) return xn < yn ? -1 : 1 }
    else if (xnNum) return -1 // 数字段 < 字母段
    else if (ynNum) return 1
    else { const c = xi < yi ? -1 : xi > yi ? 1 : 0; if (c) return c }
  }
  return 0
}
function compare(a, b) { // 返回 a-b
  const na = nums(a), nb = nums(b)
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] < nb[i] ? -1 : 1
  return cmpPre(a.pre, b.pre)
}
function satisfies(version, range) {
  const v = parse(version)
  if (!v) return null
  const r = String(range).trim()
  if (r === '*' || r === '') return true
  if (r.startsWith('^')) {
    const base = parse(r.slice(1))
    if (!base) return null
    let upper
    if (base.major > 0) upper = [base.major + 1, 0, 0]
    else if (base.minor > 0) upper = [0, base.minor + 1, 0]
    else upper = [0, 0, base.patch + 1]
    const low = nums(base), up = upper
    const lowOk = cmpWith(compare(v, { ...base }), 0) >= 0
    const upOk = cmpWith(compare(v, { major: up[0], minor: up[1], patch: up[2], pre: null }), 0) < 0
    return lowOk && upOk
  }
  if (r.startsWith('~')) {
    const base = parse(r.slice(1))
    if (!base) return null
    const low = nums(base), up = base.major > 0 ? [base.major, base.minor + 1, 0] : [0, base.minor, base.patch + 1]
    return compare(v, { ...base }) >= 0 && compare(v, { major: up[0], minor: up[1], patch: up[2], pre: null }) < 0
  }
  const exact = parse(r)
  return exact ? compare(v, exact) === 0 : null
}
function cmpWith(c) { return c < 0 ? -1 : c > 0 ? 1 : 0 }

function isPreRelease(v) { return /[-_.](rc|beta|alpha|next|pre|dev)\b/i.test(v) }

// ---------- registry ----------
async function registryPackage(name) {
  const url = `${REGISTRY}/${encodeURIComponent(name).replace('@', '%40')}`
  const res = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const doc = await res.json()
  const latest = doc['dist-tags']?.latest
  const latestEntry = doc.versions?.[latest]
  return {
    latest,
    deprecated: latestEntry?.deprecated,
    peers: latestEntry?.peerDependencies ?? {},
    publishedAt: doc.time?.[latest],
  }
}

function npmSpecOf(item) {
  const spec = String(item.spec ?? '')
  const m = spec.match(/^(@[^/]+\/[^@]+|[^@/]+)@/)
  return m ? { name: m[1] } : null
}

/**
 * 部署中的 cordis 版本:依次探测 profile 依赖树与当前运行体 npx 缓存树。
 * cordis 是独立版本线(4.x),与 dshVersion(0.1.x)不同步,不能用 dsh 版本判定。
 */
function deployedCordisVersion() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
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

/** 核心 peer 兼容性:@deepseek-ai/dsh-* 对 dshVersion,cordis 对部署 cordis 版本。 */
function peerCompatIssue(dshVersion, cordisVersion, peers) {
  for (const [pname, range] of Object.entries(peers)) {
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

async function main() {
  const cordisVersion = deployedCordisVersion()
  const rows = []
  for (const item of manifest.customizations ?? []) {
    if (item.source !== 'remote' || item.type !== 'package') continue
    const parsed = npmSpecOf(item)
    if (!parsed) { rows.push({ id: item.id, status: 'skipped', issues: [], reason: `非 npm registry spec(${item.spec}),跳过自动检测` }); continue }
    let info
    try { info = await registryPackage(parsed.name) } catch (e) {
      rows.push({ id: item.id, status: 'skipped', issues: [], reason: `registry 查询失败: ${e.message}` }); continue
    }
    const desired = `${parsed.name}@${item.version}`
    const issues = []
    if (info.latest !== item.version) {
      const compat = peerCompatIssue(current, cordisVersion, info.peers)
      if (compat) issues.push(compat)
      if (isPreRelease(info.latest)) issues.push(`${info.latest} 为 pre-release(尚不稳定)`)
      if (info.deprecated) issues.push('已被 npm 标记 deprecated')
      if (info.publishedAt && (Date.now() - Date.parse(info.publishedAt)) > STALE_DAYS * 864e5) {
        issues.push(`最新版发布于 ${info.publishedAt.slice(0, 10)},超过 ${STALE_DAYS} 天未更新(稳定性存疑)`)
      }
    }
    const unknownPeers = Object.keys(info.peers ?? {}).filter((p) => !p.startsWith(DSH_PEER_PREFIX) && p !== CORDIS)
    rows.push({
      id: item.id, current: item.version, latest: info.latest, desired,
      status: info.latest === item.version ? 'up-to-date' : issues.length ? 'needs-review' : 'upgrade-ready',
      issues, peerNote: unknownPeers.length ? `非核心 peer: ${unknownPeers.join(', ')}(${Object.entries(info.peers).filter(([p]) => unknownPeers.includes(p)).map(([p, r]) => `${p} ${r}`).join('; ')})` : '',
    })
  }
  console.log(`当前 DSH: ${current}(latest 频道)\n`)
  for (const r of rows) {
    console.log(`[${r.status}] ${r.id}${r.current ? `: ${r.current} → ${r.latest}` : ''}`)
    if (r.reason) console.log(`      · ${r.reason}`)
    for (const i of r.issues) console.log(`      - ${i}`)
    if (r.peerNote) console.log(`      · ${r.peerNote}`)
    if (r.status === 'needs-review') console.log(`      · 需人工复核后再升`)
  }
  const ready = rows.filter((r) => r.status === 'upgrade-ready')
  const review = rows.filter((r) => r.status === 'needs-review')
  console.log(`\n汇总: up-to-date ${rows.filter((r) => r.status === 'up-to-date').length} / upgrade-ready ${ready.length} / needs-review ${review.length} / skipped ${rows.filter((r) => r.status === 'skipped').length}`)
  if (ready.length) console.log('可升级: ' + ready.map((r) => `${r.id} ${r.current}→${r.latest}`).join(', '))
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })