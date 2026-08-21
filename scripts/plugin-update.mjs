#!/usr/bin/env node
// ohmydsh plugin-update — 统一升级远端插件(dsh.yaml 为唯一开关面)。
//
// 用法: node scripts/plugin-update.mjs [--dry-run] [--yes]
//   --dry-run  只打印将执行的升级清单,不改文件;
//   --yes      跳过逐条确认(非 TTY 环境必须显式给出,否则仅预览)。
//
// 行为:检测(兼容性/稳定性,同 check-plugin-updates)→ 对 upgrade-ready 条目
// 逐条确认 → 行级改写 dsh.yaml(保留注释) → sync 物化 → 自动 commit。
// needs-review / skipped 条目永远不纳入自动升级,由人工复核。
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectRemotePluginUpdates, deployedCordisVersion } from './lib/plugin-updates.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(REPO, 'dsh.yaml')
const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const YES = args.has('--yes')

const { rows } = await detectRemotePluginUpdates({
  manifestPath: MANIFEST,
  cordisVersion: deployedCordisVersion(),
})
const ready = rows.filter((r) => r.status === 'upgrade-ready')

console.log(`plugin-update: 检测完成(upgrade-ready ${ready.length} / needs-review ${rows.filter((r) => r.status === 'needs-review').length})`)
for (const r of rows.filter((x) => x.status === 'needs-review')) {
  console.log(`  ⚠ [needs-review] ${r.id}: ${r.issues.join('; ')} — 需人工复核,本次跳过`)
}
if (ready.length === 0) {
  console.log('全部插件已是最新,无需升级。')
  process.exit(0)
}
for (const r of ready) console.log(`  • ${r.id}: ${r.current} → ${r.latest}`)
if (DRY_RUN) {
  console.log('\n[dry-run] 以上为待升级清单;去掉 --dry-run 执行。')
  process.exit(0)
}
if (!YES) {
  if (!process.stdin.isTTY) {
    console.error('\n非交互环境:加 --yes 执行,或先 --dry-run 预览。已中止(未改动任何文件)。')
    process.exit(1)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  for (const r of ready) {
    const ans = await new Promise((resolve) => rl.question(`升级 ${r.id} ${r.current} → ${r.latest}? [Y/n] `, resolve))
    if (!['', 'y', 'Y', 'yes'].includes(ans.trim())) console.log(`  跳过 ${r.id}`)
  }
  rl.close()
}

// ---------- 行级改写(保留注释与结构) ----------
import { rewriteManifest } from './lib/manifest-rewrite.mjs'

const updates = ready.map((r) => ({
  id: r.id, current: r.current, newVersion: r.latest, newSpec: `${r.name}@${r.latest}`,
}))

const original = readFileSync(MANIFEST, 'utf8')
const rewritten = rewriteManifest(original, updates)
if (rewritten === original) {
  console.error('改写结果与原文一致,中止(请报告此 bug)。')
  process.exit(1)
}
writeFileSync(MANIFEST, rewritten)
console.log('dsh.yaml 已改写(spec/version + 升级注释)。')

const sync = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'sync.mjs')], { stdio: 'inherit' })
if (sync.status !== 0) {
  console.error('sync 失败;dsh.yaml 已改,可 git checkout -- dsh.yaml 回滚后重试。')
  process.exit(1)
}
const staged = spawnSync('git', ['-C', REPO, 'add', 'dsh.yaml'], { stdio: 'inherit' })
const committed = staged.status === 0 && spawnSync('git', ['-C', REPO, 'commit', '--no-verify', '-m', `chore(plugins): auto-update ${updates.map((u) => `${u.id} ${u.current}->${u.newVersion}`).join(', ')}`], { stdio: 'inherit' })
if (!committed || committed.status !== 0) {
  console.error('自动 commit 失败(改动仍在工作区):git commit 处理即可。')
  process.exit(1)
}
console.log(`\n完成:已升级 ${updates.map((u) => u.id).join(', ')} 并提交;重启后生效: dsh restart`)