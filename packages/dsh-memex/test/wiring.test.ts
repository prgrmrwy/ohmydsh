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

  it('routes eval endpoints through the existing channel to a fail-closed Host bridge', async () => {
    let handler: ((endpoint: string, params: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const ctx = {
      inject(_services: string[], callback: (child: unknown) => void) { callback(this) },
      get(service: string) {
        if (service === 'connection') return { rpc: { handle: (_channel: string, fn: typeof handler) => { handler = fn; return () => undefined } } }
        if (service === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fixture', model: 'before' }) }
        return undefined
      },
      tools: { register: () => () => undefined },
      on: () => () => undefined,
      logger: () => ({ warn: () => undefined }),
      skills: {},
      plugin: () => undefined,
      effect(callback: () => () => void) { callback() },
    }
    apply(ctx as never)
    const signal = new AbortController().signal
    expect(await handler!('eval/readDefaultModel', {}, signal)).toEqual({ ok: true, value: { provider: 'fixture', model: 'before' } })
    expect(await handler!('eval/restoreDefaultModel', {}, signal)).toMatchObject({ ok: false })
    expect(await handler!('eval/judgeItem', { round: 'round-00000000-0000-0000-0000-000000000000', item: 'know-mem', requestId: 'r' }, signal)).toMatchObject({ ok: false })
  })

  it('EVAL-032 (memex side): the eval bridge is reachable only through the Connection rpc handler, never its own listener', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p) } }
    walk(new URL('../src', import.meta.url).pathname)
    const listeners = files.filter(file => /createServer\(|\.listen\(|WebSocketServer/.test(readFileSync(file, 'utf8')))
    const clientTransport = readFileSync(new URL('../src/eval/http-transport.ts', import.meta.url), 'utf8')
    expect(clientTransport).toContain("import { request as httpRequest } from 'node:http'")
    expect(clientTransport).not.toMatch(/createServer|\.listen\(/)
    expect(listeners).toEqual([])
    const callers = files.filter(file => readFileSync(file, 'utf8').includes('createHostEvalDispatch(')).map(file => file.split('/src/')[1])
    expect(callers.sort()).toEqual(['eval/host-plugin.ts', 'index.ts'])
    // without the Connection service the bridge has no transport at all
    let handled = false
    const ctx = {
      inject(_services: string[], callback: (child: unknown) => void) { callback(this) },
      get: () => undefined,
      tools: { register: () => () => undefined }, on: () => () => undefined,
      logger: () => ({ warn: () => undefined }), skills: {}, plugin: () => undefined,
      effect(callback: () => () => void) { callback(); handled = true },
    }
    apply(ctx as never)
    expect(handled).toBe(true)
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
