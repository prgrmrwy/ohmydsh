import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import yaml from 'js-yaml'

export const SEED_FILES = [
  'plugins/subscriptions/auth.json', 'plugins/subscriptions/models.json',
  'plugins/subscriptions/model-defaults.json', 'plugins/subscriptions/provider-settings.json',
  'plugins/dsh-auto-model-routing/config.json',
  // Gateway lines only; their keys travel with .credentials.yaml.
  'plugins/dsh-magpie-connector/settings.json',
]
export const PATCH_IDS = ['agent-default-model', 'llm-deepseek', 'llm-pi-ai', 'subagent-model-selection-settings', 'permission', 'dsh-memex']
export const PATCH_ANCHOR = '- insert: [] # ohmydsh: anchor keeps rows the runtime appends below the generated region'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const browser = 'client-connection/browser-session'
const read = async file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error })

export async function noLinks(root, file) {
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Preview path escapes its managed root')
  let current = root
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Preview destination contains a symbolic link') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
export async function previewContext(env = process.env, repo = REPO) {
  for (const key of ['WS_WORKTREE', 'WS_GIT_COMMON_DIR', 'WS_DSH_HOME', 'WS_SOURCE_DSH_HOME', 'WS_OPERATION_ID']) {
    if (!env[key] || !path.isAbsolute(env[key]) && key !== 'WS_OPERATION_ID') throw new Error(`Missing or invalid ${key}`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(env.WS_OPERATION_ID) || env.WS_OPERATION_ID.includes('..')) throw new Error('Invalid operation identity')
  const worktree = await fs.realpath(env.WS_WORKTREE)
  if (worktree !== await fs.realpath(repo)) throw new Error('WS_WORKTREE is not this repository root')
  const common = await fs.realpath(env.WS_GIT_COMMON_DIR)
  const expected = path.join(common, 'ws/dsh-home', env.WS_OPERATION_ID)
  if (path.resolve(env.WS_DSH_HOME) !== expected) throw new Error('WS_DSH_HOME is not the operation-owned isolated home')
  await noLinks(common, expected)
  const home = await fs.realpath(expected)
  const source = await fs.realpath(env.WS_SOURCE_DSH_HOME)
  if (home === source) throw new Error('Preview home must differ from source home')
  return { worktree, common, home, source, operationId: env.WS_OPERATION_ID }
}
function patchParts(text) {
  const index = text.indexOf(PATCH_ANCHOR)
  if (index < 0) throw new Error('Profile patch anchor missing; run dsh build before prepare-preview')
  const end = index + PATCH_ANCHOR.length
  return { prefix: text.slice(0, end), tail: text.slice(end) }
}
function rows(text) {
  // Keep raw YAML blocks: runtime tags such as !!js must not be evaluated or rewritten.
  return text.split(/(?=^- (?:id|insert):)/m).filter(Boolean)
}
export function mergePatch(target, source) {
  const dst = patchParts(target), src = patchParts(source)
  const idOf = block => block.match(/^- id:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]
  const incoming = new Map(rows(src.tail).filter(block => PATCH_IDS.includes(idOf(block))).map(block => [idOf(block), block]))
  const replaced = new Set()
  const output = rows(dst.tail).map(block => {
    const id = idOf(block)
    if (!incoming.has(id)) return block
    if (replaced.has(id)) return ''
    replaced.add(id)
    return incoming.get(id)
  })
  return `${dst.prefix}${output.join('')}${[...incoming].filter(([id]) => !replaced.has(id)).map(([, block]) => block).join('')}`
}
export async function seedPreview({ env = process.env, repo = REPO, log = console.log } = {}) {
  const ctx = await previewContext(env, repo)
  const { home, source, worktree, operationId } = ctx
  await noLinks(home, path.join(home, 'profiles/web/package.json'))
  if (await read(path.join(home, 'profiles/web/package.json')) === undefined) throw new Error('Please run dsh build in this worktree before ws prepare-preview')
  const plan = []
  const queue = async (relative, content) => {
    const file = path.join(home, relative)
    await noLinks(home, file)
    if (await read(file) !== content) plan.push({ file, content })
  }
  const skipped = []
  for (const relative of SEED_FILES) {
    const content = await read(path.join(source, relative))
    if (content === undefined) { skipped.push(relative); continue }
    await queue(relative, content)
    if (relative.endsWith('/auth.json')) {
      const auth = JSON.parse(content)
      for (const [provider, accounts] of Object.entries(auth)) {
        const entries = accounts?.accounts ?? accounts
        const list = Array.isArray(entries) ? entries : typeof entries === 'object' && entries ? Object.values(entries) : []
        for (const account of list) if (account && typeof account === 'object' && 'expiresAt' in account) {
          const expiry = typeof account.expiresAt === 'number' ? account.expiresAt : Date.parse(account.expiresAt)
          log(`subscription ${provider}: expires in ${Math.floor((expiry - Date.now()) / 60_000)} minutes`)
        }
      }
      log('订阅登录已原样复制；预览刷新 codex token 可能导致日常 GUI 需重新登录。不要打印凭据。')
    }
  }
  const creds = await read(path.join(source, '.credentials.yaml'))
  if (creds !== undefined) {
    await noLinks(home, path.join(home, '.credentials.yaml'))
    const dst = yaml.load(await read(path.join(home, '.credentials.yaml')) || '{}') || {}
    const src = yaml.load(creds) || {}
    const merged = { ...dst, version: src.version ?? dst.version, refs: { ...dst.refs, ...src.refs }, records: { ...dst.records, ...Object.fromEntries(Object.entries(src.records || {}).filter(([key]) => key !== browser)) } }
    await queue('.credentials.yaml', yaml.dump(merged, { lineWidth: -1, noRefs: true }))
  } else skipped.push('.credentials.yaml')
  const patch = 'profiles/web/cordis.patch.yml'
  await noLinks(home, path.join(home, patch))
  const dstPatch = await read(path.join(home, patch))
  if (dstPatch === undefined) throw new Error('Missing profile patch; run dsh build first')
  patchParts(dstPatch)
  const srcPatch = await read(path.join(source, patch))
  if (srcPatch !== undefined) {
    const sourceTail = patchParts(srcPatch).tail
    for (const id of PATCH_IDS) if (!new RegExp(`^- id: ${id}\\s*$`, 'm').test(sourceTail)) skipped.push(`patch:${id}`)
    await queue(patch, mergePatch(dstPatch, srcPatch))
  } else skipped.push(patch)
  const npmrc = 'profiles/web/.npmrc'
  const srcNpm = await read(path.join(source, npmrc))
  if (srcNpm !== undefined) {
    await noLinks(home, path.join(home, npmrc))
    const registry = /^\s*((?:@[\w.-]+:)?registry)\s*=.*$/
    const incoming = new Map(srcNpm.split(/\r?\n/).filter(line => registry.test(line)).map(line => [line.match(registry)[1], line]))
    const current = (await read(path.join(home, npmrc)) || '').split(/\r?\n/)
    const output = current.map(line => {
      const key = line.match(registry)?.[1]
      if (!incoming.has(key)) return line
      const replacement = incoming.get(key); incoming.delete(key); return replacement
    })
    await queue(npmrc, `${[...output, ...incoming.values()].join('\n').trimEnd()}\n`)
  } else skipped.push(npmrc)
  const envFile = path.join(worktree, '.env.local')
  await noLinks(worktree, envFile)
  const existing = await read(envFile) || ''
  const match = existing.match(/^DSH_PORT=["']?(\d+)["']?\s*$/m)
  const port = match ? Number(match[1]) : 3180 + createHash('sha256').update(operationId).digest().readUInt32BE(0) % 100
  if (!Number.isInteger(port) || port < 3180 || port > 3279) throw new Error('Preview DSH_PORT must be in 3180..3279')
  const block = `# BEGIN ws-preview managed\nDSH_PORT=${port}\n# END ws-preview managed`
  const content = /# BEGIN ws-preview managed[\s\S]*?# END ws-preview managed/.test(existing) ? existing.replace(/# BEGIN ws-preview managed[\s\S]*?# END ws-preview managed/, block) : `${existing.trimEnd()}\n${block}\n`
  if (content !== existing) plan.push({ file: envFile, content })
  // Validate every destination before the first write. Never follow preview-local links.
  for (const item of plan) {
    await fs.mkdir(path.dirname(item.file), { recursive: true, mode: 0o700 })
    const temp = `${item.file}.${randomUUID()}.tmp`
    try { await fs.writeFile(temp, item.content, { mode: 0o600, flag: 'wx' }); await fs.rename(temp, item.file) }
    finally { await fs.rm(temp, { force: true }) }
  }
  log(`prepare-preview: ${plan.length} writes; skipped: ${skipped.join(', ') || 'none'}; preferred port=${port}`)
  log('memex 与日常环境共享真实记忆库，预览写卡也会写入真实库。下一步执行 dsh；改代码后先 dsh build 再 dsh restart。实际地址以 DSH_PREVIEW 为准。')
  return { writes: plan.length, skipped, port }
}
