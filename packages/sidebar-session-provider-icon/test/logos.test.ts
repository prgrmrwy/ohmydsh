import { describe, expect, it } from 'vitest'
import { badgeInnerHTML, brandKeyOf } from '../src/client/logos.js'

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

  it('keeps a neutral fallback for genuinely unknown selections', () => {
    expect(brandKeyOf('custom-route', 'private-model')).toBeUndefined()
    expect(badgeInnerHTML('custom-route', 'private-model')).toContain('>P</span>')
    expect(badgeInnerHTML('custom-route', '<private-model')).toContain('>&lt;</span>')
  })
})
