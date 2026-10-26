import { describe, expect, it } from 'vitest'
import { badgeBrands, badgeInnerHTML, brandKeyOf } from '../src/client/logos.js'

describe('downloaded brand logo mapping', () => {
  it('spec Scenario "DeepSeek/OpenAI/OpenCode 显示正确品牌"', () => {
    expect(brandKeyOf('deepseek-official', 'deepseek-v4-flash')).toBe('deepseek')
    expect(brandKeyOf('codex', 'gpt-5.6-sol')).toBe('openai')
    expect(brandKeyOf('opencode', 'opencode-go')).toBe('opencode')
  })

  it('spec Scenario "Kimi/GLM/MiniMax/Pi 显示正确品牌"', () => {
    expect(brandKeyOf('moonshotai-cn', 'kimi-k2-thinking')).toBe('kimi')
    expect(brandKeyOf('kimi-coding', 'kimi-for-coding')).toBe('kimi')
    expect(brandKeyOf('zai-coding-cn', 'glm-5')).toBe('glm')
    expect(brandKeyOf('z-ai', 'glm-5.3')).toBe('glm')
    expect(brandKeyOf('minimax-cn', 'MiniMax-M3')).toBe('minimax')
    expect(brandKeyOf('pi-ai', 'pi')).toBe('pi')
  })

  it('spec Scenario "OpenClaw/Hermes 显示正确品牌"', () => {
    expect(brandKeyOf('openclaw', 'openclaw-agent')).toBe('openclaw')
    expect(brandKeyOf('hermes-agent', 'hermes-4')).toBe('hermes')
    expect(brandKeyOf('hermas', 'custom')).toBe('hermes')
    expect(brandKeyOf('nousresearch', 'hermes-3')).toBe('hermes')
  })

  it('spec Scenario "OpenCode route 不被模型名误判"', () => {
    expect(brandKeyOf('opencode-go', 'deepseek-v4-flash')).toBe('opencode')
    expect(brandKeyOf('deepseek-official', 'gpt-compatible')).toBe('deepseek')
    expect(brandKeyOf('opencode-go', 'glm-5.3')).toBe('opencode')
  })

  it('spec Scenario "未知兼容 route 使用 model fallback"', () => {
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

  it('spec Scenario "Trae route 显示 Trae 品牌"', () => {
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
  it('spec Scenario "OpenCode 目录模型族得到品牌"', () => {
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

  it('spec Scenario "TraeX 目录模型族得到品牌"', () => {
    expect(badgeBrands('opencode-go', 'deepseek-v4-flash')).toEqual({ primary: 'opencode', secondary: 'deepseek' })
    expect(badgeBrands('opencode-go', 'deepseek-v4-flash-vision-exp')).toEqual({ primary: 'opencode', secondary: 'deepseek' })
    expect(badgeBrands('opencode-go', 'minimax-m3')).toEqual({ primary: 'opencode', secondary: 'minimax' })
    expect(badgeBrands('traex', 'GPT-5.6-Sol[1m]')).toEqual({ primary: 'trae', secondary: 'openai' })
    expect(badgeBrands('traex', 'DeepSeek-V4-Flash')).toEqual({ primary: 'trae', secondary: 'deepseek' })
    expect(badgeBrands('traex', 'Gemini-3.1-Pro-Preview')).toEqual({ primary: 'trae', secondary: 'gemini' })
    expect(badgeBrands('traex', 'openrouter-3o[1m]')).toEqual({ primary: 'trae', secondary: 'openrouter' })
    expect(badgeBrands('traex', 'Seed-2.1-Pro-0915')).toEqual({ primary: 'trae', secondary: 'bytedance' })
    expect(badgeBrands('traex', 'Seed-Evolving')).toEqual({ primary: 'trae', secondary: 'bytedance' })
  })

  it('renders the newly vendored TraeX catalog marks', () => {
    expect(badgeInnerHTML('traex', 'openrouter-3o')).toContain('<title>OpenRouter</title>')
    expect(badgeInnerHTML('traex', 'Seed-Code')).toContain('<title>ByteDance</title>')
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

describe('dsh-magpie current-spec regressions', () => {
  const routes = ['dsh-magpie', 'dsh-magpie-connect']
  it('spec Scenario "Magpie route 显示 Magpie 品牌"', () => {
    for (const route of [...routes, 'magpie', 'magpie-home']) expect(brandKeyOf(route, 'codex/gpt-6-luna')).toBe('magpie')
  })
  it('spec Scenario "Magpie 只按精确名或前缀匹配"', () => {
    expect(brandKeyOf('not-magpie', 'gpt-5')).toBe('openai')
  })
  it('spec Scenario "相似但不同的 route 名不被识别"', () => {
    expect(brandKeyOf('dsh-magpie2', 'gpt-5')).toBe('openai')
    expect(brandKeyOf('dsh-magpie2', 'private-model')).toBeUndefined()
  })
  it('spec Scenario "网关模型 id 按上游 provider 段识别"', () => {
    for (const route of routes) expect(badgeBrands(route, 'opencode-go/private-model')).toEqual({ primary: 'magpie', secondary: 'opencode', transit: undefined })
  })
  it('spec Scenario "上游段无法识别时退回模型名"', () => {
    for (const route of routes) {
      expect(badgeBrands(route, 'auto/claude-haiku-5.5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
      expect(badgeBrands(route, 'group/deepseek-v4-flash')).toEqual({ primary: 'magpie', secondary: 'deepseek', transit: undefined })
    }
  })
  it('spec Scenario "网关小图标取模型厂商而不是上游平台"', () => {
    for (const route of routes) {
      expect(badgeBrands(route, 'opencode-go/deepseek-v4.1-flash')).toEqual({ primary: 'magpie', secondary: 'deepseek', transit: 'opencode' })
      expect(badgeBrands(route, 'claude/claude-haiku-5-5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
      expect(badgeBrands(route, 'codex/gpt-6-luna')).toEqual({ primary: 'magpie', secondary: 'openai', transit: undefined })
    }
  })
  it('spec Scenario "模型名优先于上游段"', () => {
    for (const route of routes) expect(badgeBrands(route, 'opencode-go/glm-5.3-flash').secondary).toBe('glm')
  })
  it('spec Scenario "网关中转层单独识别"', () => {
    for (const route of routes) {
      expect(badgeBrands(route, 'opencode-go/deepseek-v4.1-flash').transit).toBe('opencode')
      expect(badgeBrands(route, 'opencode-go/glm-5.3-flash').transit).toBe('opencode')
    }
  })
  it('spec Scenario "上游段不是品牌时没有中转层"', () => {
    for (const route of routes) for (const model of ['auto/claude-haiku-5.5', 'group/deepseek-v4-flash', 'custom/omen-alpha']) {
      expect(badgeBrands(route, model).transit).toBeUndefined()
      expect(badgeInnerHTML(route, model)).not.toContain('data-transit-brand')
    }
  })
})

describe('Magpie gateway route', () => {
  it('recognizes the plugin route and magpie routes by exact name or prefix only', () => {
    expect(brandKeyOf('dsh-magpie-connect', 'claude/claude-haiku-5-5')).toBe('magpie')
    expect(brandKeyOf('magpie', 'codex/gpt-6-luna')).toBe('magpie')
    expect(brandKeyOf('magpie-home', 'x/y')).toBe('magpie')
    // A substring elsewhere in the route is not Magpie; the model decides.
    expect(brandKeyOf('not-magpie', 'gpt-5')).toBe('openai')
  })

  it('reads the model name of a gateway model id as the model vendor', () => {
    // No transit layer when the upstream segment is not a brand, or when it
    // matches the vendor (a gateway over the vendor's own API).
    expect(badgeBrands('dsh-magpie-connect', 'claude/claude-haiku-5-5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
    expect(badgeBrands('dsh-magpie-connect', 'codex/gpt-6-luna')).toEqual({ primary: 'magpie', secondary: 'openai', transit: undefined })
    // A platform segment distinct from the vendor earns its own corner.
    expect(badgeBrands('dsh-magpie-connect', 'opencode-go/deepseek-v4.1-flash')).toEqual({ primary: 'magpie', secondary: 'deepseek', transit: 'opencode' })
    expect(badgeBrands('dsh-magpie-connect', 'opencode-go/glm-5.3-flash')).toEqual({ primary: 'magpie', secondary: 'glm', transit: 'opencode' })
    expect(badgeBrands('dsh-magpie-connect', 'deepseek/deepseek-flash')).toEqual({ primary: 'magpie', secondary: 'deepseek', transit: undefined })
    // OpenRouter is a model brand here, not a route brand, so its segment falls
    // through to the model name after it.
    expect(badgeBrands('dsh-magpie-connect', 'openrouter/anthropic/claude-haiku-5.5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
  })

  it('falls back to the upstream provider segment when the model name is no brand', () => {
    // The fallback already fills the model corner, so the same brand never
    // repeats in the transit corner.
    expect(badgeBrands('dsh-magpie-connect', 'opencode-go/private-model')).toEqual({ primary: 'magpie', secondary: 'opencode', transit: undefined })
    expect(badgeBrands('dsh-magpie-connect', 'auto/claude-haiku-5.5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
    expect(badgeBrands('dsh-magpie-connect', 'group/deepseek-v4-flash')).toEqual({ primary: 'magpie', secondary: 'deepseek', transit: undefined })
    expect(badgeBrands('dsh-magpie-connect', 'custom/omen-alpha')).toEqual({ primary: 'magpie', secondary: undefined, transit: undefined })
    expect(badgeBrands('dsh-magpie-connect', 'claude-haiku-5-5')).toEqual({ primary: 'magpie', secondary: 'anthropic', transit: undefined })
  })

  it('leaves the upstream-segment reading off for every other route', () => {
    // A slash in a non-gateway model id keeps the old whole-id model reading.
    expect(badgeBrands('opencode-go', 'claude/x')).toEqual({ primary: 'opencode', secondary: 'anthropic', transit: undefined })
    expect(badgeBrands('traex', 'codex/x')).toEqual({ primary: 'trae', secondary: 'openai', transit: undefined })
  })

  it('never spends the model corner on the upstream platform the primary replaced', () => {
    const routed = badgeInnerHTML('dsh-magpie-connect', 'opencode-go/deepseek-v4.1-flash')
    expect(routed).toContain('data-sub-brand="deepseek"')
    expect(routed).not.toContain('data-sub-brand="opencode"')
    // The direct route still shows OpenCode as the primary.
    expect(badgeBrands('opencode-go', 'deepseek-v4.1-flash')).toEqual({ primary: 'opencode', secondary: 'deepseek', transit: undefined })
  })

  it('draws the transit platform in the mirrored corner for a three-layer route', () => {
    const html = badgeInnerHTML('dsh-magpie-connect', 'opencode-go/deepseek-v4.1-flash')
    expect(html).toContain('data-transit-brand="opencode"')
    expect(html).toContain('data-sub-brand="deepseek"')
    // The transit corner mirrors the model corner: same offset, opposite side.
    expect(html).toMatch(/data-transit-brand="opencode" style="[^"]*left:-4px;bottom:-4px/)
    expect(html).toMatch(/data-sub-brand="deepseek" style="[^"]*right:-4px;bottom:-4px/)
    // The primary still leads, and the footprint stays a single badge wide.
    expect(html).toMatch(/width:14px;height:14px/)
    expect(html).toMatch(/viewBox=['"]0 0 44 44['"]/) // Magpie primary
  })

  it('draws no transit corner when there is no third identity', () => {
    for (const model of ['claude/claude-haiku-5-5', 'codex/gpt-6-luna', 'opencode-go/private-model', 'auto/claude-haiku-5.5', 'custom/omen-alpha']) {
      expect(badgeInnerHTML('dsh-magpie-connect', model)).not.toContain('data-transit-brand', model)
    }
    // A direct route never has a transit layer either.
    expect(badgeInnerHTML('opencode-go', 'deepseek-v4.1-flash')).not.toContain('data-transit-brand')
  })

  it('renders the vendored Magpie mark in the theme colour, with no external URL', () => {
    const single = badgeInnerHTML('dsh-magpie-connect', 'custom/omen-alpha')
    expect(single).not.toContain('data-composite')
    const root = single.match(/<svg\b[^>]*>/)?.[0] ?? ''
    expect(root).toContain('fill="currentColor"')
    // Quote style differs between tsdown's text loader and Vite's inline form.
    expect(root).toMatch(/viewBox=["']0 0 44 44["']/)
    expect(single).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    const composite = badgeInnerHTML('dsh-magpie-connect', 'claude/claude-haiku-5-5')
    expect(composite).toContain('data-sub-brand="anthropic"')
    expect(composite.match(/fill="currentColor"/g)?.length).toBeGreaterThanOrEqual(1)
    // Only Magpie's root gains a fill; another brand's markup is unchanged.
    expect(badgeInnerHTML('deepseek-official', 'deepseek-v4')).not.toMatch(/<svg[^>]*fill="currentColor"/)
  })
})
