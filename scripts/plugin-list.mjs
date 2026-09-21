#!/usr/bin/env node
// Print the plugins this profile actually loads, one per line: "name  // desc".
//
// 真相源不是 profile package.json 的 dsh.profile.bundles 一处,而是 DSH 的
// **整个 patch 栈**(见 @deepseek-ai/dsh/profile-boot 的 composeProfile):
//
//   1. bundle 层   —— dsh.profile.bundles 顺序展开的各包自带 patch
//   2. profile 层  —— $DSH_HOME/profiles/<profile>/cordis.patch.yml(本仓库 sync 生成)
//   3. home 层     —— $DSH_HOME/cordis.patch.yml(本机偏好,跨 profile)
//
// 只读 bundles 会漏掉「没有 dsh.bundle、靠 patch insert 行接线」的插件:
// dsh-width-tiers 就是这种——它只声明 dsh.client,`dsh plugin add` 把它装成
// 普通依赖,由 patches/width-tiers-wiring.yml 插入 loader 行才被真正加载,
// 于是启动 msg 里长期看不到它。这里补齐 2/3 两层接线的行。
//
// patch 层有**两种**接线形态,两种都要报,否则同样会「做了事却看不见」:
//
//   - `insert` 行 —— 往 loader 表里新增行(上面的 width-tiers);
//   - 覆盖式行 —— 顶层 `{id, name}`,按 id 重新接线一个已存在的行。
//     DSH 0.1.5 的 `patches/connection-webserver.yml` 就是这种:它把官方
//     connection 行的 `inject` 补上 `webServer`,从而修好所有 Connection RPC
//     channel 的注册;但按 id 覆盖不产生新行,只看 insert 会让它完全隐身。
//
// desc 来源:ohmydsh manifest 的 brief/note(按 npm 名匹配)> 已安装包
// package.json 的 description。
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * patch 文件允许 `!!js <expr>` 表达式(由 DSH loader 求值)。列举清单只关心
 * 结构,不需要也不应该执行它们,因此用一个把 `!!js` 读成 undefined 的宽松
 * schema——否则 js-yaml 会在 "unknown tag !<tag:yaml.org,2002:js>" 上抛错,
 * 整个 patch 层被静默丢弃(即又回到只列 bundles 的老缺陷)。
 */
const JS_TAG_KINDS = ["scalar", "sequence", "mapping"]
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  JS_TAG_KINDS.map((kind) => new yaml.Type("tag:yaml.org,2002:js", {
    kind,
    resolve: () => true,
    construct: () => undefined,
  })),
)

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

function readPatchList(file) {
  if (!existsSync(file)) return []
  try {
    const doc = yaml.load(readFileSync(file, "utf8"), { schema: PATCH_SCHEMA })
    return Array.isArray(doc) ? doc : []
  } catch {
    return []
  }
}

/**
 * manifest 的 brief/note,按 npm 包名索引(外加出厂 bundle 的显式短备注)。
 * @returns {Map<string, string>}
 */
export function manifestNotes(manifestPath = path.join(REPO, "dsh.yaml"), repo = REPO) {
  const notes = new Map()
  let doc
  try {
    doc = yaml.load(readFileSync(manifestPath, "utf8"))
  } catch {
    return notes // manifest 不可读 → 只用包自身 description
  }
  for (const [name, brief] of Object.entries(doc?.bundlesBrief ?? {})) {
    if (brief) notes.set(name, brief)
  }
  for (const item of doc?.customizations ?? []) {
    if (item?.type !== "package") continue
    let name
    if (item.source === "local") {
      name = readJson(path.join(repo, "packages", item.id, "package.json"))?.name
    } else if (item.spec) {
      // explicit `name` (required for non-npm specs like github/tarball) wins;
      // otherwise derive it from an npm `name@version` spec
      if (typeof item.name === "string" && item.name !== "") {
        name = item.name
      } else {
        const m = String(item.spec).match(/^(@[^/@]+\/[^/@]+|[^/@]+)@/)
        name = m ? m[1] : item.spec
      }
    }
    if (name && (item.brief || item.note)) notes.set(name, item.brief ?? item.note)
  }
  return notes
}

/**
 * 递归收集一个 patch insert 数组里的 loader 行。group 行的 config 是嵌套
 * 条目列表(DSH applyEntryPatches 的 buildMap 同样递归进去),所以嵌套插入的
 * 插件一样是真正被加载的插件。
 */
function collectInserted(entries, out) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== "object") continue
    if (entry.disabled === true) continue
    if (typeof entry.name === "string" && entry.name !== "") {
      out.push({ name: entry.name, id: typeof entry.id === "string" ? entry.id : undefined })
    }
    if (entry.group && Array.isArray(entry.config)) collectInserted(entry.config, out)
  }
}

/**
 * 这个 profile 实际会加载的插件清单,按加载顺序:bundle 层 → profile patch
 * 层 → home patch 层。
 * @returns {Array<{name: string, source: 'bundle'|'patch'}>}
 */
export function collectLoadedPlugins({ dshHome, profile }) {
  const profileDir = path.join(dshHome, "profiles", profile)
  const bundles = readJson(path.join(profileDir, "package.json"))?.dsh?.profile?.bundles ?? []

  const rows = bundles.map((name) => ({ name, source: "bundle" }))
  const seen = new Set(bundles)

  const patchFiles = [path.join(profileDir, "cordis.patch.yml"), path.join(dshHome, "cordis.patch.yml")]

  // patch 层接线的包,按遇到顺序。两种形态都算(见文件头注释):`insert` 行新增
  // loader 行;覆盖式行(顶层 `{id, name}`,无 `insert`)按 id 重新接线一个已存在
  // 的行——它不新增行,但同样证明 patch 层参与了这个包的加载/接线。
  const wired = []
  for (const file of patchFiles) {
    for (const patch of readPatchList(file)) {
      if (patch === null || typeof patch !== "object") continue
      if (patch.insert !== undefined) {
        collectInserted(patch.insert, wired)
        continue
      }
      if (
        patch.disabled !== true &&
        typeof patch.id === "string" &&
        typeof patch.name === "string" &&
        patch.name !== ""
      ) {
        wired.push({ name: patch.name, id: patch.id })
      }
    }
  }
  // 后续 patch 行可以按 id 停用先前接线的行;停用者不算「已加载」。
  const disabledIds = new Set()
  for (const file of patchFiles) {
    for (const patch of readPatchList(file)) {
      if (patch === null || typeof patch !== "object") continue
      if (patch.insert === undefined && typeof patch.id === "string" && patch.disabled === true) {
        disabledIds.add(patch.id)
      }
    }
  }

  for (const entry of wired) {
    if (entry.id !== undefined && disabledIds.has(entry.id)) continue
    if (seen.has(entry.name)) continue // bundle 层已经加载过同一个包
    seen.add(entry.name)
    rows.push({ name: entry.name, source: "patch" })
  }
  return rows
}

const cut = (s, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s)

function main(argv) {
  const namesOnly = argv.includes("--names")
  const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh")
  const profile = process.env.DSH_PROFILE ?? "web"

  const roots = [
    path.join(dshHome, "profiles", profile, "node_modules"),
    path.join(dshHome, "profiles", "node_modules"),
  ]
  if (process.env.DSH_PLUGIN_ROOTS) roots.push(...process.env.DSH_PLUGIN_ROOTS.split(":").filter(Boolean))

  const rows = collectLoadedPlugins({ dshHome, profile })
  if (namesOnly) {
    console.log(rows.map((r) => r.name).join(", "))
    return
  }

  const notes = manifestNotes()
  for (const row of rows) {
    let desc = notes.get(row.name) ?? ""
    if (!desc) {
      for (const root of roots) {
        desc = readJson(path.join(root, ...row.name.split("/"), "package.json"))?.description ?? ""
        if (desc) break
      }
    }
    // patch 接线的插件不在 dsh.profile.bundles 里,标注出来,避免下次又被当成
    // 「没装」而重复排查。
    const tag = row.source === "patch" ? " [patch]" : ""
    console.log(row.name + tag + (desc ? "  // " + cut(desc) : ""))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
