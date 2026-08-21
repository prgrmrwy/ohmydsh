/**
 * Provider/model → downloaded brand logo asset.
 *
 * No path in this file is hand-drawn. SVG sources are pinned and vendored in
 * `assets/` so the sidebar never fetches a CDN at runtime:
 * - DeepSeek/OpenAI/Anthropic/Grok/Kimi/GLM/MiniMax/Pi/OpenClaw/Hermes:
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

/** Badge side length for the injected SVG. */
export const BADGE_SIZE = 14
const UNKNOWN_FILL = '#8a9199'

export type BrandKey = 'deepseek' | 'openai' | 'opencode' | 'anthropic' | 'grok' | 'kimi' | 'glm' | 'minimax' | 'pi' | 'openclaw' | 'hermes'

/** Normalize opaque route/model ids without guessing display names. */
export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/^@[^/]+\//, '').replace(/^dsh[-_]?/i, '')
}

/**
 * Resolve a brand from the exact model selection. A recognized provider route
 * wins: `opencode-go/deepseek-v4-flash` is the OpenCode provider, not the
 * DeepSeek official provider. Model identity is only a fallback for generic or
 * otherwise unknown compatible routes.
 */
export function brandKeyOf(provider: string, model: string): BrandKey | undefined {
  const route = normalizeIdentity(provider)
  const picked = normalizeIdentity(model)
  if (route.includes('openclaw')) return 'openclaw'
  if (route.includes('hermes') || route.includes('hermas') || route.includes('nousresearch') || route === 'nous') return 'hermes'
  if (route.includes('opencode')) return 'opencode'
  if (route.includes('deepseek')) return 'deepseek'
  if (route.includes('anthropic') || route.includes('claude')) return 'anthropic'
  if (route.includes('grok') || route === 'xai') return 'grok'
  if (route.includes('openai') || route.includes('codex')) return 'openai'
  if (route.includes('kimi') || route.includes('moonshot')) return 'kimi'
  if (route.includes('z-ai') || route.includes('zai') || route.includes('zhipu') || route === 'glm') return 'glm'
  if (route.includes('minimax')) return 'minimax'
  if (route === 'pi' || route === 'pi-ai') return 'pi'
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
  return undefined
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
}

/** Normalize bundler text/data-url forms, then size without editing the downloaded path. */
function sizedSvg(imported: string): string {
  const raw = imported.startsWith('data:image/svg+xml,')
    ? decodeURIComponent(imported.slice('data:image/svg+xml,'.length))
    : imported
  return raw.replace(/<svg\b[^>]*>/, (tag) => {
    const withoutSize = tag
      .replace(/\s(?:width|height)=(?:"[^"]*"|'[^']*')/g, '')
      .replace(/\sstyle=(?:"[^"]*"|'[^']*')/g, '')
    return withoutSize.replace('<svg', `<svg width="${BADGE_SIZE}" height="${BADGE_SIZE}" aria-hidden="true" style="display:block;color:currentColor"`)
  })
}

/** Escape the one-character unknown-brand label before assigning innerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] ?? char))
}

/** Render downloaded brand SVG, or a neutral letter for a genuinely unknown route. */
export function badgeInnerHTML(provider: string, model: string): string {
  const key = brandKeyOf(provider, model)
  if (key !== undefined) return sizedSvg(LOGOS[key])
  const letter = normalizeIdentity(model || provider).slice(0, 1).toUpperCase() || '?'
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${BADGE_SIZE}px;height:${BADGE_SIZE}px;border-radius:4px;background:${UNKNOWN_FILL};color:#fff;font-size:9px;line-height:1;font-weight:600">${escapeHtml(letter)}</span>`
}

/** Human tooltip for the exact selector state. */
export function badgeTitle(provider: string, model: string): string {
  return model !== '' ? `${provider} · ${model}` : provider
}
