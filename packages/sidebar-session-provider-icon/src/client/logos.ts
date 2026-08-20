/**
 * Provider → logo badge markup. The badge is an inline SVG snippet injected
 * as a standalone span before a session row's title. Known providers map to
 * their official logo; unknown providers get a neutral first-letter badge so
 * the sidebar never mislabels an unhandled route.
 *
 * @module dsh-sidebar-session-provider-icon/client/logos
 */

/** Badge side length for the injected SVG (matches the official status slot width). */
export const BADGE_SIZE = 14

/** Fallback color used for unknown providers (neutral slate, no brand implication). */
const UNKNOWN_FILL = '#8a9199'

/**
 * Normalize a provider id for matching: lowercase, strip common name-space
 * decorations (`@scope/` prefixes, `-` separators), so `@deepseek-ai/dsh-…`
 * adapter ids and `dsh-plugin-subscriptions` route ids both land on the same
 * brand key.
 * @param provider - raw provider id from the projection.
 * @returns normalized provider id (already trimmed/lowercased).
 */
export function normalizeProviderId(provider: string): string {
  const trimmed = provider.trim().toLowerCase().replace(/^@[^/]+\//, '')
  // Strip a leading known runtime-family prefix so adapter package ids reduce
  // to the brand (e.g. "dsh-llm-deepseek" → "deepseek").
  return trimmed.replace(/^dsh[-_]?/i, '')
}

/** Find the brand key for a raw provider id, or undefined when unknown. */
function brandKeyOf(provider: string): string | undefined {
  const norm = normalizeProviderId(provider)
  if (norm.includes('codex') || norm.includes('openai') || norm.includes('gpt')) return 'codex'
  if (norm.includes('claude') || norm.includes('anthropic')) return 'claude'
  if (norm.includes('grok')) return 'grok'
  if (norm.includes('deepseek')) return 'deepseek'
  return undefined
}

/** Inline SVG viewBox fragments (24×24, scaled by the badge host). */
const LOGO_SVGS: Record<string, string> = {
  // Anthropic Claude — stylized starburst.
  claude: '<path fill="%fill%" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Zm0 3.2 1.6 4.4L18 11l-4.4 1.4L12 16l-1.6-4.4L6 11l4.4-1.4L12 5.2Z" fill-rule="evenodd"/>',
  // OpenAI codex/gpt — six-point rosette.
  codex: '<path fill="%fill%" d="M6 6 2 12l4 6h12l4-6-4-6H6Zm6 3.2 1.4 3.6 3.6 1.4-3.6 1.4L12 19.2l-1.4-3.6-3.6-1.4 3.6-1.4L12 9.2Z" fill-rule="evenodd"/>',
  // xAI grok — angular bolt.
  grok: '<path fill="%fill%" d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill-rule="evenodd"/>',
  // DeepSeek — whale tail.
  deepseek: '<path fill="%fill%" d="M12 3c-4 0-7 2.4-8 6 .5-1 1.6-1.6 3-1.6H9C8 5.6 9.2 4.6 12 4.6s4 1 3 2.8h2c1.4 0 2.5.6 3 1.6-1-3.6-4-6-8-6Z" fill-rule="evenodd"/>',
}

/** Brand → brand color (official-ish, hardcoded; no assets shipped). */
const BRAND_COLORS: Record<string, string> = {
  claude: '#cc785c',
  codex: '#10a37f',
  grok: '#8b5cf6',
  deepseek: '#4d6bfe',
}

/**
 * Render the badge innerHTML for a provider/model pair. Unknown providers get
 * a neutral first-letter badge (no brand implication) with a `title` tooltip
 * carrying the raw provider/model so the identity stays transparent.
 * @param provider - raw provider id.
 * @param model - raw model id (or empty).
 * @returns innerHTML string for a 14px inline-flex badge span.
 */
export function badgeInnerHTML(provider: string, model: string): string {
  const key = brandKeyOf(provider)
  if (key !== undefined) {
    const fill = BRAND_COLORS[key] ?? UNKNOWN_FILL
    return `<svg width="${BADGE_SIZE}" height="${BADGE_SIZE}" viewBox="0 0 24 24" aria-hidden="true" style="display:block">${LOGO_SVGS[key].replace(/%fill%/g, fill)}</svg>`
  }
  const letter = normalizeProviderId(provider).slice(0, 1).toUpperCase() || '?'
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${BADGE_SIZE}px;height:${BADGE_SIZE}px;border-radius:4px;background:${UNKNOWN_FILL};color:#fff;font-size:9px;line-height:1;font-weight:600">${letter}</span>`
}

/** Human tooltip for the badge (shown when the row hovers). */
export function badgeTitle(provider: string, model: string): string {
  return model !== '' ? `${provider} · ${model}` : provider
}
