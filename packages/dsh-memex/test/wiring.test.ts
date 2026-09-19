import { describe, expect, it } from 'vitest'

import { apply, name } from '../src/index.js'

describe('dsh-memex package wiring', () => {
  it('declares the plugin name used by the bundle patch', () => {
    expect(name).toBe('dsh-memex')
  })

  it('registers settings before mounting the tool surface', () => {
    const calls: string[] = []
    const settingsScope = {
      get: () => ({ autoDerive: true, scopes: [], bindings: [] }),
      watch: () => () => undefined,
    }
    const ctx = {
      inject(_services: string[], callback: (child: unknown) => void) { calls.push('inject'); callback(this) },
      settings: { register: () => { calls.push('settings'); return settingsScope } },
      tools: { register: () => { calls.push('tool'); return () => undefined } },
      on: () => { calls.push('listener'); return () => undefined },
      logger: () => ({ warn: () => undefined }),
      skills: {},
      plugin: () => { calls.push('skills') },
      effect(callback: () => () => void) { calls.push('effect'); callback() },
    }
    expect(() => apply(ctx as never)).not.toThrow()
    expect(calls.slice(0, 2)).toEqual(['inject', 'settings'])
    expect(calls.filter(call => call === 'tool')).toHaveLength(8)
  })
})
