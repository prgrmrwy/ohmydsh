#!/usr/bin/env node
// ohmydsh autoupdate — 启动/构建前的 DSH 版本检测与 dsh.yaml 行级改写。
//
// 两个模式:
//   (默认)检测:读 dsh.yaml 的 dshVersion,直连 npm registry 取目标频道
//             dist-tag,用 semver 比较,stdout 输出 JSON。
//   --rewrite-to <version>:把 dsh.yaml 从当前 dshVersion 行级改写为目标版本,
//             并联动同族 @deepseek-ai/dsh-* 且 pin 等于旧运行体的条目
//             (顶层 dependencies 的 spec、package 定制条的 spec/version);
//             改写前写 dsh.yaml.bak。只做行/词的文本替换,不整文件 YAML 往返,
//             保留注释与结构(manifest 注释即真相源的一部分)。
//
// 频道解析优先级:--channel 参数 > 环境变量 DSH_UPDATE_CHANNEL > manifest
// autoUpdate.channel > 'latest'。registry 可用环境变量 DSH_REGISTRY 覆盖
// (默认 https://registry.npmjs.org/@deepseek-ai/dsh),便于镜像/离线演练。
//
// 检测失败 / 超时 → status=offline(bash 侧 fail-open,按当前 pin 继续);
// manifest 缺失或 dshVersion 非法 → 真正错误,exit 1。

import { readFileSync, writeFileSync, statSync, renameSync, rmSync } from "node:fs"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"
import semver from "semver"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST = path.resolve(SCRIPT_DIR, "..", "dsh.yaml")
const DEFAULT_REGISTRY = "https://registry.npmjs.org/@deepseek-ai/dsh"
const REGISTRY = process.env.DSH_REGISTRY || DEFAULT_REGISTRY
const TIMEOUT_MS = 5000

function parseArgs(argv) {
  const args = { manifest: DEFAULT_MANIFEST, channel: undefined, rewriteTo: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--manifest") { args.manifest = argv[++i]; continue }
    if (a === "--channel") { args.channel = argv[++i]; continue }
    if (a === "--rewrite-to") { args.rewriteTo = argv[++i]; continue }
    if (a === "--help" || a === "-h") {
      process.stderr.write(`usage: check-update.mjs [--channel latest|next] [--manifest <path>] [--rewrite-to <version>]\n`)
      process.exit(0)
    }
  }
  return args
}

function readManifest(file) {
  const raw = readFileSync(file, "utf8")
  const doc = yaml.load(raw)
  if (typeof doc !== "object" || doc === null || typeof doc.dshVersion !== "string" || doc.dshVersion === "") {
    throw new Error(`manifest ${file}: dshVersion missing or invalid`)
  }
  return { doc, raw }
}

function resolveChannel(args) {
  if (args.channel) return args.channel
  if (process.env.DSH_UPDATE_CHANNEL && process.env.DSH_UPDATE_CHANNEL.trim() !== "") {
    return process.env.DSH_UPDATE_CHANNEL.trim()
  }
  try {
    const { doc } = readManifest(args.manifest)
    const c = doc?.autoUpdate?.channel
    if (typeof c === "string" && c.trim() !== "") return c.trim()
  } catch { /* fall through to default */ }
  return "latest"
}

// GET registry, return parsed JSON or throw on network/timeout/invalid.
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "accept": "application/json", "user-agent": "ohmydsh-autoupdate" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`registry HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (c) => { body += c })
      res.on("end", () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(new Error(`registry invalid JSON: ${e.message}`)) }
      })
      res.on("error", reject)
    })
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(new Error("registry timeout")) })
    req.on("error", reject)
  })
}

// 开关解析:DSH_SKIP_UPDATE(非 0/空)或 manifest autoUpdate.enabled===false → false
function resolveEnabled(args) {
  const env = process.env.DSH_SKIP_UPDATE
  if (env !== undefined && env.trim() !== "" && env.trim() !== "0") return false
  try {
    const { doc } = readManifest(args.manifest)
    return doc?.autoUpdate?.enabled !== false
  } catch { return true }
}

async function check(args) {
  let current
  try {
    current = readManifest(args.manifest).doc.dshVersion
  } catch (e) {
    process.stderr.write(`[autoupdate] ERROR ${e.message}\n`)
    process.exit(1)
  }
  const channel = resolveChannel(args)
  const enabled = resolveEnabled(args)
  try {
    const doc = await fetchJson(REGISTRY)
    const latest = doc?.["dist-tags"]?.[channel]
    if (typeof latest !== "string" || latest === "") throw new Error(`dist-tag "${channel}" not found`)
    const status = semver.gt(latest, current) ? "update" : "no-update"
    process.stdout.write(JSON.stringify({ status, current, latest, channel, enabled }) + "\n")
  } catch (e) {
    process.stdout.write(JSON.stringify({ status: "offline", current, latest: null, channel, enabled, error: String(e.message ?? e) }) + "\n")
  }
}

// ---------- --rewrite-to: 行级改写 dsh.yaml ----------
// 规则(与 design D5/D6 一致):
//   - dshVersion 值替换为目标版本;
//   - 含 `@deepseek-ai/dsh-` 的行(dependencies spec / 定制 spec)直接替换旧→新;
//   - `version:` 行仅当所属定制条目(spec/name)引用 @deepseek-ai/dsh- 时才替换。
//   - 旧版本号不在目标行上出现(如刻意钉到别的版本)时自然不动。
const FAMILY_RE = /@deepseek-ai\/dsh-/i

function rewriteManifest(args) {
  const { raw } = readManifest(args.manifest)
  const newVersion = String(args.rewriteTo ?? "").trim()
  if (!semver.valid(newVersion)) {
    process.stderr.write(`[autoupdate] ERROR --rewrite-to: "${newVersion}" is not a valid version\n`)
    process.exit(1)
  }
  const m = raw.match(/^[ \t]*dshVersion:[ \t]*"?([^"#\s]+)/m)
  if (!m) {
    process.stderr.write(`[autoupdate] ERROR cannot locate dshVersion in ${args.manifest}\n`)
    process.exit(1)
  }
  const oldVersion = m[1]
  if (!semver.gt(newVersion, oldVersion)) {
    process.stderr.write(`[autoupdate] ERROR ${newVersion} is not newer than current ${oldVersion}\n`)
    process.exit(1)
  }

  const backup = args.manifest + ".bak"
  writeFileSync(backup, raw)
  const lines = raw.split("\n")
  const out = []
  let familyItem = false // 是否处于引用 @deepseek-ai/dsh-* 的定制条目内
  let changed = 0
  const isComment = (line) => /^[ \t]*#/.test(line)

  for (const line of lines) {
    if (/^[ \t]*- id:/.test(line)) familyItem = false
    const dsh = line.match(/^([ \t]*dshVersion:[ \t]*"?)([^"#\s]+)(.*)$/)
    let newLine
    if (dsh) {
      newLine = dsh[1] + newVersion + dsh[3]
    } else if (isComment(line)) {
      newLine = line // 注释绝不改写
    } else if (FAMILY_RE.test(line)) {
      // spec / dependencies / bundlesBrief 行:整体替换旧版本串
      // (旧版本与运行体不一致的刻意 pin 因为不含旧版本串而自然不动);
      // 命中即视为当前定制条目属于 @deepseek-ai/dsh-* 家族,后续 version: 行可联动。
      familyItem = true
      if (line.includes(`@${oldVersion}`) || line.includes(` ${oldVersion}`) || line.includes(`:${oldVersion}`)) {
        newLine = line.split(oldVersion).join(newVersion)
      } else {
        newLine = line
      }
    } else if (familyItem && /^[ \t]*version:[ \t]*/.test(line)) {
      // 所属定制为 @deepseek-ai/dsh-* 时的 version: 行
      if (line.includes(oldVersion)) {
        newLine = line.split(oldVersion).join(newVersion)
      } else {
        newLine = line
      }
    } else {
      // 进入/离开 family 上下文:item 的 spec/name 行声明家族身份
      if (familyItem === false && ((/^[ \t]*(spec|name):/.test(line)) && FAMILY_RE.test(line))) {
        familyItem = true
      }
      newLine = line
    }
    if (newLine !== line) {
      changed++
      process.stdout.write(`rewrite: ${line.trim().slice(0, 72)}  ->  ${newLine.trim().slice(0, 72)}\n`)
    }
    out.push(newLine)
  }

  if (changed === 0) {
    process.stderr.write(`[autoupdate] ERROR no lines changed for ${oldVersion} -> ${newVersion}\n`)
    process.exit(1)
  }
  writeFileSync(args.manifest, out.join("\n"))
  process.stdout.write(`[autoupdate] wrote ${args.manifest} (${oldVersion} -> ${newVersion}, backup: ${backup})\n`)
}

// ---------- main ----------
const args = parseArgs(process.argv.slice(2))
if (args.rewriteTo !== undefined) {
  rewriteManifest(args)
} else {
  check(args).catch((e) => {
    process.stdout.write(JSON.stringify({ status: "offline", current: null, latest: null, channel: resolveChannel(args), error: String(e.message ?? e) }) + "\n")
  })
}
