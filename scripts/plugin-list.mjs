#!/usr/bin/env node
// Print the profile's loaded plugin bundles, one per line: "name  // desc".
// desc 来源:mydsh manifest 的 note(按 npm 名匹配)> 已安装包 package.json 的 description。
import { readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh")
const PROFILE = process.env.DSH_PROFILE ?? "web"

const roots = [
  path.join(DSH_HOME, "profiles", PROFILE, "node_modules"),
  path.join(DSH_HOME, "profiles", "node_modules"),
]
if (process.env.DSH_PLUGIN_ROOTS) roots.push(...process.env.DSH_PLUGIN_ROOTS.split(":").filter(Boolean))

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

// manifest notes keyed by npm package name, plus explicit base-bundle briefs
const notes = new Map()
try {
  const doc = yaml.load(readFileSync(path.join(REPO, "dsh.yaml"), "utf8"))
  for (const [name, brief] of Object.entries(doc?.bundlesBrief ?? {})) {
    if (brief) notes.set(name, brief)
  }
  for (const item of doc?.customizations ?? []) {
    if (item?.type !== "package") continue
    let name
    if (item.source === "local") {
      name = readJson(path.join(REPO, "packages", item.id, "package.json"))?.name
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
} catch {
  // manifest unreadable → fall back to package descriptions only
}

const profilePkg = readJson(path.join(DSH_HOME, "profiles", PROFILE, "package.json"))
const bundles = profilePkg?.dsh?.profile?.bundles ?? []

const cut = (s, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s)

for (const name of bundles) {
  let desc = notes.get(name) ?? ""
  if (!desc) {
    for (const root of roots) {
      desc = readJson(path.join(root, ...name.split("/"), "package.json"))?.description ?? ""
      if (desc) break
    }
  }
  console.log(name + (desc ? "  // " + cut(desc) : ""))
}
