/**
 * Provider/model → downloaded brand logo asset.
 *
 * No path in this file is hand-drawn. SVG sources are pinned and vendored in
 * `assets/` so the sidebar never fetches a CDN at runtime:
 * - DeepSeek/OpenAI/Anthropic/Grok/Kimi/GLM/MiniMax/Pi/OpenClaw/Hermes/Trae/
 *   Qwen/Hunyuan/LongCat/MiMo/Gemini/Nvidia/Meta/AntGroup/OpenRouter/ByteDance:
 *   @lobehub/icons-static-svg 1.94.0 (MIT)
 * - OpenCode: anomalyco/opencode commit 5e75e5e… (MIT)
 *
 * @module dsh-sidebar-session-provider-icon/client/logos
 */
import anthropicSvg from './assets/anthropic.svg'
import deepseekSvg from './assets/deepseek.svg'
import glmSvg from './assets/glm.svg'
import grokSvg from './assets/grok.svg'
import hermesSvg from './assets/hermes.svg'
import kimiSvg from './assets/kimi.svg'
import minimaxSvg from './assets/minimax.svg'
import openaiSvg from './assets/openai.svg'
import openclawSvg from './assets/openclaw.svg'
import opencodeSvg from './assets/opencode.svg'
import piSvg from './assets/pi.svg'
import traeSvg from './assets/trae.svg'
import qwenSvg from './assets/qwen.svg'
import hunyuanSvg from './assets/hunyuan.svg'
import longcatSvg from './assets/longcat.svg'
import mimoSvg from './assets/mimo.svg'
import geminiSvg from './assets/gemini.svg'
import nvidiaSvg from './assets/nvidia.svg'
import metaSvg from './assets/meta.svg'
import antgroupSvg from './assets/antgroup.svg'
import openrouterSvg from './assets/openrouter.svg'
import bytedanceSvg from './assets/bytedance.svg'

/** Badge side length for the injected SVG (also the composite footprint). */
export const BADGE_SIZE = 14
/** Composite sub-icon glyph size (bare glyph: no plate, ring, or padding). */
export const SUB_ICON_SIZE = 10
/** How far the sub-icon overhangs the primary logo's bottom-right corner. */
const SUB_ICON_OFFSET = -4
const UNKNOWN_FILL = '#8a9199'

export type BrandKey = 'deepseek' | 'openai' | 'opencode' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'minimax' | 'pi' | 'openclaw' | 'hermes' | 'trae'
  | 'qwen' | 'hunyuan' | 'longcat' | 'mimo' | 'gemini' | 'nvidia' | 'meta' | 'antgroup' | 'openrouter' | 'bytedance'

/** Normalize opaque route/model ids without guessing display names. */
export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/^@[^/]+\//, '').replace(/^dsh[-_]?/i, '')
}

/**
 * Brand of the provider route alone. Routes are matched before any model
 * hint: `opencode-go/deepseek-v4-flash` is served by OpenCode, not DeepSeek.
 * Trae is matched exactly/by prefix because `trae` is a common substring.
 */
export function providerBrandOf(provider: string): BrandKey | undefined {
  const route = normalizeIdentity(provider)
  if (route.includes('openclaw')) return 'openclaw'
  if (route.includes('hermes') || route.includes('hermas') || route.includes('nousresearch') || route === 'nous') return 'hermes'
  if (route.includes('opencode')) return 'opencode'
  if (route === 'trae' || route === 'trae-ai' || route.startsWith('traex')) return 'trae'
  if (route.includes('deepseek')) return 'deepseek'
  if (route.includes('anthropic') || route.includes('claude')) return 'anthropic'
  if (route.includes('grok') || route === 'xai') return 'grok'
  if (route.includes('openai') || route.includes('codex')) return 'openai'
  if (route.includes('kimi') || route.includes('moonshot')) return 'kimi'
  if (route.includes('z-ai') || route.includes('zai') || route.includes('zhipu') || route === 'glm') return 'glm'
  if (route.includes('minimax')) return 'minimax'
  if (route === 'pi' || route === 'pi-ai') return 'pi'
  if (route.includes('qwen') || route.includes('dashscope') || route.includes('bailian')) return 'qwen'
  if (route.includes('hunyuan') || route.includes('tencent')) return 'hunyuan'
  if (route.includes('longcat') || route.includes('meituan')) return 'longcat'
  if (route.includes('xiaomi') || route.includes('mimo')) return 'mimo'
  if (route.includes('gemini') || route === 'google' || route.startsWith('google-')) return 'gemini'
  if (route.includes('nvidia')) return 'nvidia'
  if (route === 'meta' || route === 'meta-ai' || route.startsWith('meta-llama')) return 'meta'
  if (route === 'ant-ling' || route.includes('inclusionai') || route.includes('antgroup')) return 'antgroup'
  return undefined
}

/** Brand of the model id alone (Trae is a provider, never a model vendor). */
export function modelBrandOf(model: string): BrandKey | undefined {
  const picked = normalizeIdentity(model)
  if (picked.includes('openclaw')) return 'openclaw'
  if (picked.includes('hermes') || picked.includes('hermas') || picked.includes('nousresearch')) return 'hermes'
  if (picked.includes('opencode')) return 'opencode'
  if (picked.includes('deepseek')) return 'deepseek'
  if (picked.includes('anthropic') || picked.includes('claude')) return 'anthropic'
  if (picked.includes('grok')) return 'grok'
  if (picked.includes('gpt') || picked.includes('codex')) return 'openai'
  if (picked.includes('kimi') || picked.includes('moonshot')) return 'kimi'
  if (picked.includes('glm')) return 'glm'
  if (picked.includes('minimax')) return 'minimax'
  if (picked === 'pi' || picked.startsWith('pi-')) return 'pi'
  if (picked.includes('qwen') || picked.startsWith('qwq')) return 'qwen'
  if (picked.includes('hunyuan') || /^hy\d/.test(picked)) return 'hunyuan'
  if (picked.includes('longcat')) return 'longcat'
  if (picked.includes('mimo')) return 'mimo'
  if (picked.includes('gemini') || picked.startsWith('gemma')) return 'gemini'
  if (picked.includes('nemotron')) return 'nvidia'
  if (picked.startsWith('openrouter-')) return 'openrouter'
  if (picked.startsWith('seed-')) return 'bytedance'
  if (picked.startsWith('muse-spark') || picked.includes('llama')) return 'meta'
  if (/^(?:ling|ring)-/.test(picked)) return 'antgroup'
  return undefined
}

/**
 * Primary brand of the selection: a recognized provider route wins; model
 * identity is only a fallback for generic or otherwise unknown routes.
 */
export function brandKeyOf(provider: string, model: string): BrandKey | undefined {
  return providerBrandOf(provider) ?? modelBrandOf(model)
}

/** Primary logo plus the optional bottom-right model sub-icon. */
export interface BadgeBrands {
  readonly primary: BrandKey | undefined
  readonly secondary: BrandKey | undefined
}

/**
 * Decide single vs composite. A sub-icon appears only when the route is a
 * known brand AND the model is a different known brand; an unknown route has
 * no second identity to show, so it stays a single model-brand logo.
 */
export function badgeBrands(provider: string, model: string): BadgeBrands {
  const route = providerBrandOf(provider)
  const picked = modelBrandOf(model)
  if (route === undefined) return { primary: picked, secondary: undefined }
  return { primary: route, secondary: picked !== undefined && picked !== route ? picked : undefined }
}

const LOGOS: Record<BrandKey, string> = {
  deepseek: deepseekSvg,
  openai: openaiSvg,
  opencode: opencodeSvg,
  anthropic: anthropicSvg,
  grok: grokSvg,
  kimi: kimiSvg,
  glm: glmSvg,
  minimax: minimaxSvg,
  pi: piSvg,
  openclaw: openclawSvg,
  hermes: hermesSvg,
  trae: traeSvg,
  qwen: qwenSvg,
  hunyuan: hunyuanSvg,
  longcat: longcatSvg,
  mimo: mimoSvg,
  gemini: geminiSvg,
  nvidia: nvidiaSvg,
  meta: metaSvg,
  antgroup: antgroupSvg,
  openrouter: openrouterSvg,
  bytedance: bytedanceSvg,
}

/**
 * Normalize bundler text/data-url forms, then size without editing the
 * downloaded paths. `idSuffix` renames internal gradient/clip ids (and their
 * `url(#…)` references) so a nested copy never resolves another copy's defs.
 */
function sizedSvg(imported: string, size: number = BADGE_SIZE, idSuffix: string = ''): string {
  let raw = imported.startsWith('data:image/svg+xml,')
    ? decodeURIComponent(imported.slice('data:image/svg+xml,'.length))
    : imported
  if (idSuffix !== '') {
    // Quote style varies: the bundler's text loader keeps `"`, while Vite's
    // inline data-url form (used under vitest) rewrites attributes to `'`.
    raw = raw
      .replace(/\sid=(["'])([^"']+)\1/g, (_m, q: string, id: string) => ` id=${q}${id}${idSuffix}${q}`)
      .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${id}${idSuffix})`)
  }
  return raw.replace(/<svg\b[^>]*>/, (tag) => {
    const withoutSize = tag
      .replace(/\s(?:width|height)=(?:"[^"]*"|'[^']*')/g, '')
      .replace(/\sstyle=(?:"[^"]*"|'[^']*')/g, '')
    return withoutSize.replace('<svg', `<svg width="${size}" height="${size}" aria-hidden="true" style="display:block;color:currentColor"`)
  })
}

/** Escape the one-character unknown-brand label before assigning innerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] ?? char))
}

/**
 * Primary logo with the model brand as a bare sub-icon overhanging the
 * bottom-right corner. No plate, ring, or padding: at sidebar scale any
 * chrome eats the few pixels the glyph has. The outer box stays BADGE_SIZE
 * square so the row layout is identical to a single logo; the overhang is
 * visible because neither the badge nor its row clip overflow.
 */
function compositeHTML(primary: BrandKey, secondary: BrandKey): string {
  const sub = `position:absolute;right:${SUB_ICON_OFFSET}px;bottom:${SUB_ICON_OFFSET}px;line-height:0`
  return `<span data-composite="" style="position:relative;display:block;width:${BADGE_SIZE}px;height:${BADGE_SIZE}px">${sizedSvg(LOGOS[primary])}<span data-sub-brand="${secondary}" style="${sub}">${sizedSvg(LOGOS[secondary], SUB_ICON_SIZE, '-sub')}</span></span>`
}

/** Render downloaded brand SVG(s), or a neutral letter for a genuinely unknown route. */
export function badgeInnerHTML(provider: string, model: string): string {
  const { primary, secondary } = badgeBrands(provider, model)
  if (primary !== undefined && secondary !== undefined) return compositeHTML(primary, secondary)
  if (primary !== undefined) return sizedSvg(LOGOS[primary])
  const letter = normalizeIdentity(model || provider).slice(0, 1).toUpperCase() || '?'
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${BADGE_SIZE}px;height:${BADGE_SIZE}px;border-radius:4px;background:${UNKNOWN_FILL};color:#fff;font-size:9px;line-height:1;font-weight:600">${escapeHtml(letter)}</span>`
}

/** Human tooltip for the exact selector state. */
export function badgeTitle(provider: string, model: string): string {
  return model !== '' ? `${provider} · ${model}` : provider
}
