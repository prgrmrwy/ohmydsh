#!/usr/bin/env node
// ohmydsh plugin-update 检测(只读):读 dsh.yaml 的 remote package 条目,
// 输出每个插件的版本现状 + 与当前 DSH/cordis 的兼容性 + 稳定性判定。
// 升级请用 `dsh plugin-update`(或 node scripts/plugin-update.mjs)。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectRemotePluginUpdates, deployedCordisVersion } from './lib/plugin-updates.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { rows, dshVersion } = await detectRemotePluginUpdates({
  manifestPath: path.join(REPO, 'dsh.yaml'),
  cordisVersion: deployedCordisVersion(),
})

console.log(`当前 DSH: ${dshVersion}(latest 频道)`)
console.log()
for (const r of rows) {
  console.log(`[${r.status}] ${r.id}${r.current && r.latest ? `: ${r.current} → ${r.latest}` : ''}`)
  if (r.reason) console.log(`      · ${r.reason}`)
  for (const i of r.issues) console.log(`      - ${i}`)
  if (r.peerNote) console.log(`      · ${r.peerNote}`)
  if (r.status === 'needs-review') console.log('      · 需人工复核后再升')
}
const ready = rows.filter((r) => r.status === 'upgrade-ready')
console.log(`\n汇总: up-to-date ${rows.filter((r) => r.status === 'up-to-date').length} / upgrade-ready ${ready.length} / needs-review ${rows.filter((r) => r.status === 'needs-review').length} / skipped ${rows.filter((r) => r.status === 'skipped').length}`)
if (ready.length) console.log(`可升级: ${ready.map((r) => `${r.id} ${r.current}→${r.latest}`).join(', ')}`)
