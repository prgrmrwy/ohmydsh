import { describe, expect, it } from 'vitest'

import { apply, name } from '../src/index.js'

describe('dsh-memex package wiring', () => {
  it('declares the plugin name used by the bundle patch', () => {
    expect(name).toBe('dsh-memex')
  })

  it('listens for live Config edits before mounting the tool surface', () => {
    const calls: string[] = []
    const channels: string[] = []
    const ctx = {
      inject(services: string[], callback: (child: unknown) => void) { calls.push(`inject:${services.join(',')}`); callback(this) },
      get(service: string) {
        // Headless compositions have no connection; the channel then stays unmounted.
        return service === 'connection' ? { rpc: { handle: (channel: string) => { channels.push(channel); return () => undefined } } } : undefined
      },
      tools: { register: () => { calls.push('tool'); return () => undefined } },
      on: (event: string) => { calls.push(`on:${event}`); return () => undefined },
      logger: () => ({ warn: () => undefined }),
      skills: {},
      plugin: () => { calls.push('skills') },
      effect(callback: () => () => void) { calls.push('effect'); callback() },
    }
    expect(() => apply(ctx as never)).not.toThrow()
    // Config hooks sit on the plugin's own fiber (volatile updates are instance-local),
    // and the settings service is no longer a dependency.
    expect(calls.slice(0, 3)).toEqual(['on:internal/config', 'on:loader/volatile-update', 'inject:tools,skills'])
    expect(calls.filter(call => call === 'tool')).toHaveLength(8)
    expect(channels).toEqual(['/dsh-memex'])
  })

  it('mounts without a connection service', () => {
    const ctx = {
      inject(_services: string[], callback: (child: unknown) => void) { callback(this) },
      get: () => undefined,
      tools: { register: () => () => undefined },
      on: () => () => undefined,
      logger: () => ({ warn: () => undefined }),
      skills: {},
      plugin: () => undefined,
      effect(callback: () => () => void) { callback() },
    }
    expect(() => apply(ctx as never)).not.toThrow()
  })
})
