import { describe, expect, it } from 'vitest'
import { badgeBrands, badgeInnerHTML, brandKeyOf } from '../src/client/logos.js'

describe('downloaded brand logo mapping', () => {
  it('maps the expected DeepSeek/OpenAI/OpenCode brands', () => {
    expect(brandKeyOf('deepseek-official', 'deepseek-v4-flash')).toBe('deepseek')
    expect(brandKeyOf('codex', 'gpt-5.6-sol')).toBe('openai')
    expect(brandKeyOf('opencode', 'opencode-go')).toBe('opencode')
  })

  it('maps Kimi, GLM, MiniMax, and Pi provider routes', () => {
    expect(brandKeyOf('moonshotai-cn', 'kimi-k2-thinking')).toBe('kimi')
    expect(brandKeyOf('kimi-coding', 'kimi-for-coding')).toBe('kimi')
    expect(brandKeyOf('zai-coding-cn', 'glm-5')).toBe('glm')
    expect(brandKeyOf('z-ai', 'glm-5.3')).toBe('glm')
    expect(brandKeyOf('minimax-cn', 'MiniMax-M3')).toBe('minimax')
    expect(brandKeyOf('pi-ai', 'pi')).toBe('pi')
  })

  it('maps OpenClaw and Hermes routes, including the requested Hermas alias', () => {
    expect(brandKeyOf('openclaw', 'openclaw-agent')).toBe('openclaw')
    expect(brandKeyOf('hermes-agent', 'hermes-4')).toBe('hermes')
    expect(brandKeyOf('hermas', 'custom')).toBe('hermes')
    expect(brandKeyOf('nousresearch', 'hermes-3')).toBe('hermes')
  })

  it('keeps known provider identity ahead of a cross-brand model name', () => {
    expect(brandKeyOf('opencode-go', 'deepseek-v4-flash')).toBe('opencode')
    expect(brandKeyOf('deepseek-official', 'gpt-compatible')).toBe('deepseek')
    expect(brandKeyOf('opencode-go', 'glm-5.3')).toBe('opencode')
  })

  it('uses model identity only when the provider route is generic or unknown', () => {
    expect(brandKeyOf('generic-compatible', 'deepseek-v4')).toBe('deepseek')
    expect(brandKeyOf('private-proxy', 'gpt-5')).toBe('openai')
  })

  it('uses actual downloaded SVG markup rather than the old hand-drawn paths', () => {
    const deepseek = badgeInnerHTML('deepseek-official', 'deepseek-v4')
    expect(deepseek).toContain('<title>DeepSeek</title>')
    expect(deepseek.match(/\bwidth=/g)).toHaveLength(1)
    expect(deepseek.match(/\bheight=/g)).toHaveLength(1)
    expect(badgeInnerHTML('codex', 'gpt-5')).toContain('<title>OpenAI</title>')
    expect(badgeInnerHTML('opencode', 'opencode-go')).toContain('M8.40005 17.4')
    expect(badgeInnerHTML('moonshotai', 'kimi-k2')).toContain('<title>Kimi</title>')
    expect(badgeInnerHTML('zai', 'glm-5')).toContain('<title>Zhipu</title>')
    expect(badgeInnerHTML('minimax', 'MiniMax-M2.7')).toContain('<title>Minimax</title>')
    expect(badgeInnerHTML('pi-ai', 'pi')).toContain('<title>Pi</title>')
    expect(badgeInnerHTML('openclaw', 'openclaw-agent')).toContain('<title>OpenClaw</title>')
  })

  it('maps Trae routes by exact name or traex prefix, never by substring or model', () => {
    expect(brandKeyOf('traex', 'GPT-5.6-Sol[1m]')).toBe('trae')
    expect(brandKeyOf('trae', 'DeepSeek-V4-Flash')).toBe('trae')
    expect(brandKeyOf('extraeval', 'private-model')).toBeUndefined()
    expect(brandKeyOf('custom-route', 'trae-model')).toBeUndefined()
    expect(badgeInnerHTML('traex', 'custom')).toContain('<title>TRAE</title>')
  })

  it('keeps a neutral fallback for genuinely unknown selections', () => {
    expect(brandKeyOf('custom-route', 'private-model')).toBeUndefined()
    expect(badgeInnerHTML('custom-route', 'private-model')).toContain('>P</span>')
    expect(badgeInnerHTML('custom-route', '<private-model')).toContain('>&lt;</span>')
  })
})

describe('OpenCode catalog model brands', () => {
  it('recognizes every model family in the OpenCode Go/Zen catalogs that has a vendored mark', () => {
    const cases: Array<[string, string]> = [
      ['qwen3.8-flash', 'qwen'], ['qwen3.7-max', 'qwen'],
      ['hy3', 'hunyuan'], ['hy4-preview', 'hunyuan'],
      ['longcat-2.0', 'longcat'],
      ['mimo-v2.5', 'mimo'], ['mimo-v2.5-pro', 'mimo'],
      ['gemini-3.5-flash', 'gemini'], ['gemini-3.1-pro', 'gemini'],
      ['nemotron-3-ultra-free', 'nvidia'],
      ['muse-spark-1.3-contributor', 'meta'],
      ['ling-3.0-flash-fin-free', 'antgroup'],
      ['glm-5.3-flash', 'glm'], ['kimi-k2.7-code', 'kimi'], ['minimax-m2.7', 'minimax'],
      ['deepseek-v4-pro', 'deepseek'], ['gpt-5.6-luna', 'openai'], ['grok-4.6', 'grok'],
      ['grok-build-0.1', 'grok'], ['claude-opus-5', 'anthropic'],
    ]
    for (const [model, brand] of cases) {
      expect(badgeBrands('opencode-go', model), model).toEqual({ primary: 'opencode', secondary: brand })
    }
  })

  it('leaves models without a recognizable vendor as a single OpenCode logo', () => {
    for (const model of ['omen-alpha', 'big-pickle']) {
      expect(badgeBrands('opencode-go', model)).toEqual({ primary: 'opencode', secondary: undefined })
    }
  })

  it('maps the matching provider routes to the new brands', () => {
    expect(brandKeyOf('qwen-token-plan-cn', 'x')).toBe('qwen')
    expect(brandKeyOf('xiaomi-token-plan-cn', 'x')).toBe('mimo')
    expect(brandKeyOf('google', 'x')).toBe('gemini')
    expect(brandKeyOf('nvidia', 'x')).toBe('nvidia')
    expect(brandKeyOf('ant-ling', 'x')).toBe('antgroup')
    expect(badgeBrands('qwen-token-plan', 'qwen3.7-max')).toEqual({ primary: 'qwen', secondary: undefined })
  })
})

describe('composite provider + model badge', () => {
  it('stays a single logo when provider and model are the same brand', () => {
    expect(badgeBrands('claude', 'claude-opus-5')).toEqual({ primary: 'anthropic', secondary: undefined })
    expect(badgeBrands('codex', 'gpt-6-luna')).toEqual({ primary: 'openai', secondary: undefined })
    expect(badgeBrands('deepseek-official', 'deepseek-v4-pro')).toEqual({ primary: 'deepseek', secondary: undefined })
  })

  it('adds the model brand as a sub-icon for aggregator routes', () => {
    expect(badgeBrands('opencode-go', 'deepseek-v4-flash')).toEqual({ primary: 'opencode', secondary: 'deepseek' })
    expect(badgeBrands('opencode-go', 'deepseek-v4-flash-vision-exp')).toEqual({ primary: 'opencode', secondary: 'deepseek' })
    expect(badgeBrands('opencode-go', 'minimax-m3')).toEqual({ primary: 'opencode', secondary: 'minimax' })
    expect(badgeBrands('traex', 'GPT-5.6-Sol[1m]')).toEqual({ primary: 'trae', secondary: 'openai' })
    expect(badgeBrands('traex', 'DeepSeek-V4-Flash')).toEqual({ primary: 'trae', secondary: 'deepseek' })
  })

  it('does not add a sub-icon for an unrecognized model under a known route', () => {
    expect(badgeBrands('opencode-go', 'private-model')).toEqual({ primary: 'opencode', secondary: undefined })
    expect(badgeInnerHTML('opencode-go', 'private-model')).not.toContain('data-composite')
  })

  it('keeps an unknown route as a single model-brand logo', () => {
    expect(badgeBrands('private-proxy', 'gpt-5')).toEqual({ primary: 'openai', secondary: undefined })
    expect(badgeBrands('custom-route', 'private-model')).toEqual({ primary: undefined, secondary: undefined })
  })

  it('renders a fixed 14px composite with a bare 10px sub-icon and no external URL', () => {
    const html = badgeInnerHTML('opencode-go', 'deepseek-v4-flash')
    expect(html).toContain('data-composite=""')
    expect(html).toContain('width:14px;height:14px')
    expect(html).toContain('data-sub-brand="deepseek"')
    expect(html.match(/<svg[^>]*width="14" height="14"/g)).toHaveLength(1)
    expect(html.match(/<svg[^>]*width="10" height="10"/g)).toHaveLength(1)
    // Bare glyph: no backing plate, ring, or padding around the sub-icon.
    expect(html).not.toMatch(/border-radius|box-shadow|background|padding/)
    expect(html).toContain('<title>DeepSeek</title>')
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(badgeInnerHTML('claude', 'claude-opus-5')).not.toContain('data-composite')
  })

  it('suffixes internal SVG ids inside the sub-icon only', () => {
    const html = badgeInnerHTML('opencode-go', 'minimax-m3')
    const sub = html.slice(html.indexOf('data-sub-brand'))
    const ids = [...sub.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1])
    const refs = [...sub.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id.endsWith('-sub'))).toBe(true)
    expect(refs.every((ref) => ids.includes(ref))).toBe(true)
    // The primary single logo keeps the downloaded ids untouched.
    expect(badgeInnerHTML('minimax', 'MiniMax-M3')).toMatch(/id=["']lobe-icons-minimax-_R_0_["']/)
  })
})
