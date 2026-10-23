/**
 * Owner-imported mascot animation storage.
 *
 * The active animation is a FILE, not a configuration row: `active.lottie.json`
 * under the Pet state root. Its presence is the whole state — there is no
 * pointer, no metadata sidecar and no database write, so a plugin/profile
 * rebuild cannot lose it and the owner can inspect or replace it directly.
 *
 * Everything that reaches the renderer passes {@link validateLottieSource}
 * first. Validation is deliberately structural and bounded: a Lottie file is
 * an arbitrary JSON graph, and the renderer expands `refId` precomps into real
 * DOM, so a small file can otherwise become a huge render tree (or recurse
 * forever). The same validator runs on import and on every read, so a file
 * damaged by hand fails closed to `corrupt` instead of reaching lottie.
 */

import { Buffer } from 'node:buffer'
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PetError } from './errors.js'
import { OWNER_ONLY_DIR_MODE, type PetPaths } from './paths.js'
import {
  MAX_EXPRESSION_DIMENSION,
  MAX_EXPRESSION_LAYER_DEPTH,
  MAX_EXPRESSION_LAYERS,
  MAX_EXPRESSION_SOURCE_BYTES,
  type PetExpressionView,
} from '../wire.js'

/** File name of the active source inside {@link PetPaths.expressionsRoot}. */
export const EXPRESSION_FILE = 'active.lottie.json'

/** File name of the most recently removed source. */
export const EXPRESSION_BACKUP = 'active.lottie.json.removed'

/** A Lottie JSON object. */
type JsonObject = Record<string, unknown>

/** Embedded raster data URI; SVG is refused because it is a document format. */
const BITMAP_DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,/i

/** Safe font family: no quotes/braces/semicolons that could escape CSS. */
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 _.-]{1,64}$/

/**
 * Reject one import with a stable, client-visible error.
 * @param message - Diagnostic safe to show in Settings.
 * @param field - Optional field path for `INVALID_EXPRESSION.fields`.
 * @returns never.
 */
function reject(message: string, field?: string): never {
  const fields = field === undefined ? undefined : { field }
  throw new PetError('INVALID_EXPRESSION', `动画表情不合规：${message}`, fields)
}

/** Whether a value is a plain JSON object (not null, not an array). */
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decode one bitmap data URI and prove its magic bytes match the MIME type. */
function checkBitmapDataUri(value: string, field: string): void {
  const match = BITMAP_DATA_URI.exec(value)
  if (match === null) {
    reject('内嵌图片只允许 PNG/JPEG/WebP/GIF 的 base64 data URI', field)
  }
  const kind = match[1]?.toLowerCase() ?? ''
  const payload = value.slice(value.indexOf(',') + 1).replace(/\s+/g, '')
  const decoded = Buffer.from(payload, 'base64')
  if (decoded.length < 12) reject('内嵌图片 base64 无法解码或过短', field)

  const startsWith = (bytes: readonly number[]): boolean =>
    bytes.every((byte, index) => decoded[index] === byte)
  const valid =
    kind === 'png'
      ? startsWith([0x89, 0x50, 0x4e, 0x47])
      : kind === 'gif'
        ? startsWith([0x47, 0x49, 0x46, 0x38])
        : kind === 'webp'
          ? startsWith([0x52, 0x49, 0x46, 0x46]) &&
            decoded.subarray(8, 12).toString('ascii') === 'WEBP'
          : startsWith([0xff, 0xd8, 0xff])
  if (!valid) reject('内嵌图片的实际格式与声明的 MIME 不匹配', field)
}

/**
 * Validate the declared width/height of one composition.
 *
 * Both are optional in Lottie (a precomp may omit them), but when present they
 * must be usable pixel dimensions rather than an arbitrary object.
 */
function checkDimensions(comp: JsonObject, field: string): void {
  for (const key of ['w', 'h'] as const) {
    const value = comp[key]
    if (value === undefined) continue
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > MAX_EXPRESSION_DIMENSION
    ) {
      reject(`${field}.${key} 必须是 0 到 ${MAX_EXPRESSION_DIMENSION} 之间的正数`, `${field}.${key}`)
    }
  }
}

/**
 * Count the layers one composition renders, expanding `refId` precomps.
 *
 * Counting JSON arrays is not enough: lottie instantiates every `refId`
 * reference, so a 43-layer file can expand to millions of elements and a
 * reference cycle recurses forever. `memo` keeps the cost per precomp to one
 * traversal; `visiting` turns a cycle into a validation failure.
 * @param comp - Composition to walk.
 * @param assets - All assets keyed by id (only precomps have `layers`).
 * @param depth - Current composition nesting depth.
 * @param visiting - Asset ids on the current path, for cycle detection.
 * @param memo - Already computed precomp costs.
 * @returns layers this composition contributes, references included.
 */
function countRenderedLayers(
  comp: JsonObject,
  assets: ReadonlyMap<string, JsonObject>,
  depth: number,
  visiting: Set<string>,
  memo: Map<string, number>,
): number {
  if (depth > MAX_EXPRESSION_LAYER_DEPTH) {
    reject(`precomp 引用深度超过 ${MAX_EXPRESSION_LAYER_DEPTH}`, 'layers')
  }
  checkDimensions(comp, 'composition')
  const layers = comp['layers']
  if (!Array.isArray(layers) || layers.length === 0) {
    reject('layers 必须是非空数组', 'layers')
  }
  let total = 0
  for (const [index, rawLayer] of layers.entries()) {
    if (!isObject(rawLayer)) reject(`layers[${index}] 必须是对象`, `layers[${index}]`)
    if (typeof rawLayer['ty'] !== 'number' || !Number.isFinite(rawLayer['ty'])) {
      reject(`layers[${index}] 缺少数字 ty`, `layers[${index}].ty`)
    }
    total += 1
    const refId = rawLayer['refId']
    if (typeof refId === 'string' && refId !== '') {
      const asset = assets.get(refId)
      if (asset === undefined) {
        reject(`layers[${index}].refId 引用了不存在的 asset '${refId}'`, `layers[${index}].refId`)
      }
      const isPrecomp = Array.isArray(asset['layers'])
      // Lottie's layer type decides what a refId may point at: a precomp layer
      // (ty 0) must resolve to an asset WITH layers, an image layer (ty 2) to an
      // image/footage asset without layers. Accepting either direction silently
      // would let a precomp reference be treated as a leaf (bypassing the
      // expansion cap) or render nothing for an image layer.
      if (rawLayer['ty'] === 0) {
        if (!isPrecomp) {
          reject(
            `layers[${index}] 是 precomp 层但 refId '${refId}' 指向非 precomp asset`,
            `layers[${index}].refId`,
          )
        }
        if (visiting.has(refId)) {
          reject(`precomp '${refId}' 的 refId 引用成环`, `layers[${index}].refId`)
        }
        let cost = memo.get(refId)
        if (cost === undefined) {
          visiting.add(refId)
          try {
            cost = countRenderedLayers(asset, assets, depth + 1, visiting, memo)
          } finally {
            visiting.delete(refId)
          }
          memo.set(refId, cost)
        }
        total += cost
      } else if (rawLayer['ty'] === 2) {
        if (isPrecomp) {
          reject(
            `layers[${index}] 是 image 层但 refId '${refId}' 指向 precomp asset`,
            `layers[${index}].refId`,
          )
        }
      } else {
        reject(
          `layers[${index}] 的 ty ${String(rawLayer['ty'])} 不允许携带 refId`,
          `layers[${index}].refId`,
        )
      }
    }
    if (total > MAX_EXPRESSION_LAYERS) {
      reject(`渲染层数超过 ${MAX_EXPRESSION_LAYERS}`, 'layers')
    }
  }
  return total
}

/**
 * Validate one asset's resource references.
 *
 * `p`/`u` become URLs (or CSS) in the renderer, so anything except an empty
 * value or a decodable bitmap data URI is refused. Non-string values are a
 * bypass: the renderer coerces arrays/objects to strings and would fetch them.
 */
function checkAssetRefs(asset: JsonObject, field: string): void {
  for (const key of ['p', 'u'] as const) {
    const value = asset[key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      reject(`${field}.${key} 必须是字符串`, `${field}.${key}`)
    }
    if (value === '') continue
    checkBitmapDataUri(value, `${field}.${key}`)
  }
}

/** Validate the optional `fonts` table: no remote fonts, no CSS injection. */
function checkFonts(fonts: unknown): void {
  if (fonts === undefined) return
  if (!isObject(fonts)) reject('fonts 必须是对象', 'fonts')
  const list = fonts['list']
  if (list === undefined) return
  if (!Array.isArray(list)) reject('fonts.list 必须是数组', 'fonts.list')
  for (const [index, rawFont] of list.entries()) {
    if (!isObject(rawFont)) reject(`fonts.list[${index}] 必须是对象`, `fonts.list[${index}]`)
    const fontPath = rawFont['fPath']
    if (fontPath !== undefined && fontPath !== '') {
      reject('不允许从远程或本地字体文件加载字体', `fonts.list[${index}].fPath`)
    }
    const family = rawFont['fFamily']
    if (family !== undefined && (typeof family !== 'string' || !SAFE_FONT_FAMILY.test(family))) {
      reject('fFamily 只能包含字母、数字、空格与 _.-', `fonts.list[${index}].fFamily`)
    }
  }
}

/**
 * Validate one Lottie source.
 *
 * Throws {@link PetError} with `INVALID_EXPRESSION` on any violation; returns
 * normally when the source is safe to store and render.
 * @param content - Raw pasted JSON text.
 */
export function validateLottieSource(content: string): void {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_EXPRESSION_SOURCE_BYTES) {
    reject(`体积 ${bytes} 字节超过 ${MAX_EXPRESSION_SOURCE_BYTES} 字节上限`, 'content')
  }
  // A string that does not survive a UTF-8 round trip contains an unpaired
  // surrogate; persisting it would silently replace the character, so the
  // stored bytes could never equal what the owner pasted.
  if (Buffer.from(content, 'utf8').toString('utf8') !== content) {
    reject('内容包含无法按 UTF-8 编码的字符', 'content')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    reject('不是合法 JSON', 'content')
  }
  if (!isObject(parsed)) reject('顶层必须是 JSON 对象', 'content')
  if (typeof parsed['v'] !== 'string') reject('缺少字符串字段 v', 'v')

  const assets = parsed['assets']
  const assetMap = new Map<string, JsonObject>()
  if (assets !== undefined) {
    if (!Array.isArray(assets)) reject('assets 必须是数组', 'assets')
    for (const [index, rawAsset] of assets.entries()) {
      if (!isObject(rawAsset)) reject(`assets[${index}] 必须是对象`, `assets[${index}]`)
      const id = rawAsset['id']
      if (typeof id !== 'string' || id === '') {
        reject(`assets[${index}].id 必须是非空字符串`, `assets[${index}].id`)
      }
      if (assetMap.has(id)) reject(`assets 的 id '${id}' 重复`, `assets[${index}].id`)
      assetMap.set(id, rawAsset)
      if (rawAsset['layers'] !== undefined) {
        if (!Array.isArray(rawAsset['layers'])) {
          reject(`assets[${index}].layers 必须是数组`, `assets[${index}].layers`)
        }
      } else {
        checkAssetRefs(rawAsset, `assets[${index}]`)
      }
    }
  }

  countRenderedLayers(parsed, assetMap, 0, new Set(), new Map())
  // Assets without layers are images/footage: their refs are checked above.
  // Assets WITH layers are precomps: their dimensions were checked by the
  // recursive walk only if referenced. Validate every precomp's dimensions so
  // an unreferenced-but-present precomp cannot carry absurd values.
  for (const [id, asset] of assetMap) {
    if (Array.isArray(asset['layers'])) checkDimensions(asset, `assets['${id}']`)
  }
  checkFonts(parsed['fonts'])
}

/** Absolute paths the expression store uses. */
function expressionPaths(paths: PetPaths): {
  readonly root: string
  readonly active: string
  readonly backup: string
} {
  return {
    root: paths.expressionsRoot,
    active: path.join(paths.expressionsRoot, EXPRESSION_FILE),
    backup: path.join(paths.expressionsRoot, EXPRESSION_BACKUP),
  }
}

/**
 * Replace `target` with `source`, keeping the previous file if the final
 * rename fails.
 *
 * POSIX `rename` is an atomic replace. On Windows an occupied target can fail,
 * so the fallback first moves the old file to a unique name (never deleting it
 * up front) and restores it if the new file cannot be moved in.
 * @param source - Temporary file holding the new content.
 * @param target - Final file name.
 */
async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
    return
  } catch {
    // Fall through to the platform fallback below.
  }
  const displaced = `${target}.displaced-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await rename(target, displaced).catch(() => undefined)
  try {
    await rename(source, target)
  } catch (error) {
    await rename(displaced, target).catch(() => undefined)
    throw error
  }
  await rm(displaced, { force: true }).catch(() => undefined)
}

/**
 * Validate and atomically store one source as the active expression.
 * @param paths - Resolved Pet paths.
 * @param content - Raw pasted Lottie JSON.
 * @returns the stored byte length.
 */
export async function saveExpression(
  paths: PetPaths,
  content: string,
): Promise<{ readonly bytes: number }> {
  validateLottieSource(content)
  await mkdir(paths.expressionsRoot, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const { root, active } = expressionPaths(paths)
  const temporary = path.join(
    root,
    `${EXPRESSION_FILE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await replaceFile(temporary, active)
    return { bytes: Buffer.byteLength(content, 'utf8') }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/**
 * Read the active expression, validating what actually sits on disk.
 * @param paths - Resolved Pet paths.
 * @returns the projection handed to the Web client.
 */
export async function readExpression(paths: PetPaths): Promise<PetExpressionView> {
  const { active } = expressionPaths(paths)
  const info = await stat(active).catch(() => undefined)
  if (info === undefined) return { state: 'none' }
  if (!info.isFile()) {
    return { state: 'corrupt', diagnostic: '生效动画路径不是普通文件' }
  }
  if (info.size > MAX_EXPRESSION_SOURCE_BYTES) {
    return {
      state: 'corrupt',
      diagnostic: `文件 ${info.size} 字节，超过 ${MAX_EXPRESSION_SOURCE_BYTES} 字节上限`,
    }
  }
  let content: string
  try {
    content = await readFile(active, 'utf8')
  } catch (error) {
    return {
      state: 'corrupt',
      diagnostic: `读取失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  try {
    validateLottieSource(content)
  } catch (error) {
    return {
      state: 'corrupt',
      diagnostic: error instanceof Error ? error.message : String(error),
    }
  }
  return { state: 'ok', content, bytes: info.size, importedAt: Math.trunc(info.mtimeMs) }
}

/**
 * Deactivate the current expression, keeping one backup.
 *
 * Idempotent: no active file means "already removed". The owner's pasted
 * source is renamed, never deleted, so an accidental remove is recoverable.
 * @param paths - Resolved Pet paths.
 */
export async function removeExpression(paths: PetPaths): Promise<void> {
  const { active, backup } = expressionPaths(paths)
  const info = await lstat(active).catch(() => undefined)
  if (info === undefined) return
  try {
    await rename(active, backup)
  } catch {
    // An existing backup or a Windows lock can make the replace fail: drop the
    // older backup (the active file is still the owner's current source) and
    // retry once.
    await rm(backup, { force: true }).catch(() => undefined)
    await rename(active, backup)
  }
}
