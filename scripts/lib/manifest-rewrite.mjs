// scripts/lib/manifest-rewrite.mjs — dsh.yaml 行级改写(保留注释与结构)。
// 仅替换 remote package 条目的 spec/version 行,并在 version 行后追加一条
// 升级记录注释;引号风格跟随原值。纯函数,供 scripts/plugin-update.mjs 与测试使用。
export function rewriteManifest(text, updates) {
  const lines = text.split('\n')
  const out = [...lines]
  const extraComments = []
  let currentId = null
  const entry = new Map() // id -> { indent, specIdx, versionIdx, specRaw }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const idm = line.match(/^(\s*)- id:\s*(\S+)/)
    if (idm) {
      currentId = idm[2]
      entry.set(currentId, { indent: idm[1].length, specIdx: null, versionIdx: null, specRaw: null })
      continue
    }
    if (!currentId) continue
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (line.trim().startsWith('-')) continue
    const e = entry.get(currentId)
    const indent = line.match(/^(\s*)\S/)?.[1]?.length ?? 0
    if (indent <= e.indent) { currentId = null; continue } // 条目结束
    if (e.specIdx === null) {
      const sm = line.match(/^(\s*)spec:\s*(.*)$/)
      if (sm && sm[1].length > e.indent) { e.specIdx = i; e.specRaw = sm[2] }
    }
    if (e.versionIdx === null) {
      const vm = line.match(/^(\s*)version:\s*(.*)$/)
      if (vm && vm[1].length > e.indent) e.versionIdx = i
    }
  }
  for (const u of updates) {
    const e = entry.get(u.id)
    if (!e) throw new Error(`manifest 中未找到条目 ${u.id}`)
    if (e.specIdx === null || e.versionIdx === null) throw new Error(`条目 ${u.id} 缺 spec/version 行`)
    const raw = e.specRaw.trim()
    const newSpec = raw.startsWith("'") ? `'${u.newSpec.replace(/'/g, "\\'")}'` : raw.startsWith('"') ? `"${u.newSpec.replace(/"/g, '\\"')}"` : u.newSpec
    out[e.specIdx] = `${lines[e.specIdx].replace(/spec:.*$/, '')}spec: ${newSpec}`
    out[e.versionIdx] = `${lines[e.versionIdx].replace(/version:.*$/, '')}version: ${u.newVersion}`
    extraComments.push({ at: e.versionIdx, text: `${' '.repeat(e.indent + 4)}# [${new Date().toISOString().slice(0, 10)}] plugin-update: ${u.id} ${u.current} -> ${u.newVersion}(release notes 见 registry;审查记录请补进 note)` })
  }
  for (const { at, text } of extraComments.sort((a, b) => b.at - a.at)) out.splice(at + 1, 0, text)
  return out.join('\n')
}