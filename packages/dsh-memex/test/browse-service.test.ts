/**
 * Browse-service startup, where four kernel behaviours are load-bearing.
 *
 * Each case below encodes one of them; a regression in any single one is a
 * silent failure in production (a service that never started, a browser opened
 * on the wrong machine, a port nobody listens on, or a process that exits
 * right after spawn).
 */
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseReadyPort, startBrowseService } from '../src/run/browse-service.js'
import { createBrowseRegistry } from '../src/run/browse-registry.js'

/** Minimal stand-in for a spawned kernel process. */
class FakeChild extends EventEmitter {
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  readonly stdin = new Writable({ write(_c, _e, cb) { cb() } })
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly signals: string[] = []

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }

  say(text: string): void { this.stdout.push(text) }
  fail(text: string, code = 1): void {
    this.stderr.push(text)
    setTimeout(() => { this.exitCode = code; this.emit('close', code) }, 0)
  }
}

const homes: string[] = []

function libraryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'memex-browse-'))
  mkdirSync(join(home, 'cards'), { recursive: true })
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe('parseReadyPort', () => {
  it('reads the port the kernel actually bound, not the one requested', () => {
    // The kernel retries port+1 on EADDRINUSE and only ever states the real
    // port on stdout; assuming request === actual hands out a dead address.
    expect(parseReadyPort('memex is running at http://localhost:3944\n')).toBe(3944)
    expect(parseReadyPort('memex is running at http://127.0.0.1:51000')).toBe(51000)
  })

  it('returns undefined for output that does not state an address', () => {
    expect(parseReadyPort('')).toBeUndefined()
    expect(parseReadyPort('Cards synced to git@example.com:me/cards.git\nOpening https://example.invalid...')).toBeUndefined()
    expect(parseReadyPort('memex is running at http://localhost:99999')).toBeUndefined()
  })
})

describe('startBrowseService', () => {
  it('forces local mode, suppresses the kernel browser, and pins the library', async () => {
    const child = new FakeChild()
    let seenArgs: readonly string[] = []
    let seenEnv: Record<string, string | undefined> = {}
    let seenStdio: unknown
    const home = libraryHome()

    const pending = startBrowseService({
      home,
      executable: '/fake/memex',
      spawnProcess: ((_exe: string, args: readonly string[], opts: { env: Record<string, string>; stdio: unknown }) => {
        seenArgs = args
        seenEnv = opts.env
        seenStdio = opts.stdio
        return child
      }) as never,
    })
    child.say('memex is running at http://localhost:3939\n')
    const service = await pending

    // Constraint 1: without --local a library with a remote redirects to the
    // hosted site and never creates a local server at all.
    expect(seenArgs).toContain('--local')
    // Constraint 2: the kernel would otherwise open a browser on the Host.
    expect(seenEnv.MEMEX_NO_OPEN).toBe('1')
    // Constraint 4: one process serves exactly one library.
    expect(seenEnv.MEMEX_HOME).toBe(home)
    expect(seenEnv.LC_ALL).toBe('C')
    // A long-lived child must not get an immediately-EOF stdin.
    expect(seenStdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(service.port).toBe(3939)

    await service.stop()
    expect(child.signals).toContain('SIGTERM')
  })

  it('reports the drifted port rather than the requested one', async () => {
    const child = new FakeChild()
    const pending = startBrowseService({
      home: libraryHome(),
      port: 3939,
      executable: '/fake/memex',
      spawnProcess: (() => child) as never,
    })
    child.say('Port 3939 in use, trying 3940...\nmemex is running at http://localhost:3940\n')
    const service = await pending
    expect(service.port).toBe(3940)
    await service.stop()
  })

  it('treats an exit before the ready line as a failure, even with code 0', async () => {
    // This is exactly the hosted-site redirect path: the kernel prints, then
    // returns without serving. "Spawned" must never be read as "ready".
    const child = new FakeChild()
    const pending = startBrowseService({
      home: libraryHome(),
      executable: '/fake/memex',
      spawnProcess: (() => child) as never,
    })
    child.stdout.push('Cards synced to a remote\nOpening the hosted site...\n')
    setTimeout(() => { child.exitCode = 0; child.emit('close', 0) }, 0)
    await expect(pending).rejects.toThrow(/exited before reporting a listening address/)
  })

  it('refuses a library that has no cards directory, without spawning', async () => {
    const home = mkdtempSync(join(tmpdir(), 'memex-empty-'))
    homes.push(home)
    let spawned = false
    await expect(startBrowseService({
      home,
      executable: '/fake/memex',
      spawnProcess: (() => { spawned = true; return new FakeChild() }) as never,
    })).rejects.toThrow(/missing cards/)
    expect(spawned).toBe(false)
  })

  it('fails loudly when the kernel never reports an address', async () => {
    const child = new FakeChild()
    await expect(startBrowseService({
      home: libraryHome(),
      executable: '/fake/memex',
      readyTimeoutMs: 20,
      spawnProcess: (() => child) as never,
    })).rejects.toThrow(/did not report a listening address/)
    expect(child.signals).toContain('SIGTERM')
  })
})

describe('browse registry', () => {
  const service = (home: string, port: number) => ({
    home,
    port,
    stopped: false,
    async stop() { this.stopped = true },
  })

  it('serves one process per library and reuses it', async () => {
    const started: string[] = []
    const registry = createBrowseRegistry({
      start: async ({ home }) => { started.push(home); return service(home, 4000 + started.length) },
    })

    const a1 = await registry.ensure('/lib/a')
    const a2 = await registry.ensure('/lib/a')
    const b = await registry.ensure('/lib/b')

    expect(a2).toBe(a1)
    expect(started).toEqual(['/lib/a', '/lib/b'])
    expect(b.port).not.toBe(a1.port)
    await registry.stopAll()
  })

  it('shares one in-flight start, so a double click cannot double-spawn', async () => {
    let starts = 0
    const registry = createBrowseRegistry({
      start: async ({ home }) => {
        starts += 1
        await new Promise(resolve => setTimeout(resolve, 5))
        return service(home, 4100)
      },
    })
    const [first, second] = await Promise.all([registry.ensure('/lib/a'), registry.ensure('/lib/a')])
    expect(starts).toBe(1)
    expect(second).toBe(first)
    await registry.stopAll()
  })

  it('does not cache a failed start', async () => {
    let attempts = 0
    const registry = createBrowseRegistry({
      start: async ({ home }) => {
        attempts += 1
        if (attempts === 1) throw new Error('kernel busy')
        return service(home, 4200)
      },
    })
    await expect(registry.ensure('/lib/a')).rejects.toThrow('kernel busy')
    await expect(registry.ensure('/lib/a')).resolves.toMatchObject({ port: 4200 })
    await registry.stopAll()
  })

  it('stops every service and refuses to start new ones afterwards', async () => {
    const made: { stopped: boolean }[] = []
    const registry = createBrowseRegistry({
      start: async ({ home }) => {
        const entry = service(home, 4300 + made.length)
        made.push(entry)
        return entry
      },
    })
    await registry.ensure('/lib/a')
    await registry.ensure('/lib/b')
    await registry.stopAll()

    expect(made.every(entry => entry.stopped)).toBe(true)
    expect(registry.running()).toHaveLength(0)
    await expect(registry.ensure('/lib/c')).rejects.toThrow(/stopped/)
  })

  it('stops a service that finishes starting after stopAll', async () => {
    // The plugin can be torn down while a start is still in flight; the
    // process must not survive the fiber that owns it.
    let release: (() => void) | undefined
    const entry = { home: '/lib/a', port: 4400, stopped: false, async stop() { this.stopped = true } }
    const registry = createBrowseRegistry({
      start: async () => {
        await new Promise<void>(resolve => { release = resolve })
        return entry
      },
    })
    const pending = registry.ensure('/lib/a')
    const stopping = registry.stopAll()
    release?.()
    await expect(pending).rejects.toThrow(/stopped/)
    await stopping
    expect(entry.stopped).toBe(true)
  })
})
