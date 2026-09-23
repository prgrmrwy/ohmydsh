/**
 * Long-lived kernel browse services, one process per library.
 *
 * Deliberately NOT built on {@link runKernel}: that runner is "run to
 * completion or die" — bounded timeout, SIGTERM on expiry, stdout collected
 * only at exit. A browse server must outlive the call that started it, and its
 * only useful output arrives *while* it runs.
 *
 * Four kernel behaviours are load-bearing here; all four were read out of
 * `@touchskyer/memex` `dist/cli.js`, not inferred from `--help`:
 *
 * 1. A library with a configured remote redirects to the hosted site and
 *    `return null`s WITHOUT creating a local server unless `--local` is passed.
 *    So the flag is not cosmetic: without it there is no service at all, and
 *    an internal library's cards would be pointed at a third party.
 * 2. The kernel opens a browser itself unless `MEMEX_NO_OPEN` is set — on the
 *    machine running the Host, which is the wrong machine whenever the user's
 *    browser is elsewhere.
 * 3. The listening port drifts: `EADDRINUSE` retries `port + 1` up to ten
 *    times, and the real port is only ever stated on stdout.
 * 4. One process serves exactly one library (`MEMEX_HOME`), which is also the
 *    isolation guarantee this module relies on.
 *
 * @module dsh-memex/run/browse-service
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError } from './types.js'
import { resolveMemexInstallation } from './installation.js'

/** How long to wait for the kernel to announce its listening address. */
const READY_TIMEOUT_MS = 20_000
/** Grace period between SIGTERM and giving up on a service process. */
const STOP_GRACE_MS = 2_000
/**
 * How long stdout must stay quiet before its last readiness line is trusted.
 *
 * The kernel emits one bogus "running at" line per attempted port before the
 * real one (see {@link parseReadyPort}); they are written back-to-back, so a
 * short settle window is enough to see the whole burst without adding
 * meaningful startup latency.
 */
const QUIET_MS = 120

/**
 * The kernel's readiness line, e.g. `memex is running at http://localhost:3939`.
 *
 * Parsing stdout is the ONLY way to learn the real port (constraint 3). Like
 * the existing `sync --status` parsing this is pinned to the kernel version and
 * must be re-checked on upgrade; a parse miss is treated as a startup failure
 * rather than a guess, so the failure is loud instead of pointing a browser at
 * an unrelated service.
 *
 * Global on purpose — see {@link parseReadyPort}.
 */
const READY_LINE = /running at https?:\/\/[^\s:]+:(\d{1,5})/gi

export interface BrowseService {
  /** Absolute library directory this service serves (one library per process). */
  readonly home: string
  /** Port the kernel actually bound, as reported by the kernel itself. */
  readonly port: number
  /** Stop the process and release it from the registry. */
  stop(): Promise<void>
}

export interface StartBrowseServiceOptions {
  readonly home: string
  /** Preferred port; the kernel may bind a different one (constraint 3). */
  readonly port?: number
  /** Test-only spawn override. */
  readonly spawnProcess?: typeof spawn
  /** Test-only executable override; production resolves the pinned package. */
  readonly executable?: string
  readonly readyTimeoutMs?: number
}

/**
 * Extract the bound port from an accumulated stdout buffer.
 *
 * Takes the LAST readiness line, not the first. The kernel attaches a fresh
 * `listen` callback per retry to the SAME server object without removing the
 * previous ones, so when a bind finally succeeds every accumulated callback
 * fires and it prints one "running at" line per port it ever tried:
 *
 *     Port 3939 in use, trying 3940...
 *     Port 3940 in use, trying 3941...
 *     memex is running at http://localhost:3939   <- never bound
 *     memex is running at http://localhost:3940   <- never bound
 *     memex is running at http://localhost:3941   <- the real one
 *
 * Only the last line names the port actually listening. Reading the first one
 * hands out a port owned by ANOTHER library's service — which looks like
 * success and silently shows the wrong library's cards.
 */
export function parseReadyPort(output: string): number | undefined {
  let port: number | undefined
  // Fresh lastIndex per call: the regex is global and module-scoped, so
  // reusing it statefully across calls would skip matches.
  READY_LINE.lastIndex = 0
  for (const match of output.matchAll(READY_LINE)) {
    const candidate = Number(match[1])
    if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 65535) port = candidate
  }
  return port
}

/**
 * Start one library's browse service and resolve once it reports its address.
 *
 * Rejects rather than resolving optimistically: a process that exits during
 * startup is exactly what constraint 1 produces (the hosted-site redirect ends
 * the process), and treating "spawned" as "ready" would hand out a port nobody
 * is listening on.
 */
export async function startBrowseService(options: StartBrowseServiceOptions): Promise<BrowseService> {
  const cardsDir = join(options.home, 'cards')
  if (!existsSync(cardsDir)) {
    throw new KernelError('missing', `Memex library is missing cards/: ${options.home}`)
  }

  let executable: string
  try {
    executable = options.executable ?? resolveMemexInstallation().cli
  } catch (error) {
    throw new KernelError('missing', error instanceof Error ? error.message : 'Pinned memex installation not found')
  }

  const spawnProcess = options.spawnProcess ?? spawn
  const args = ['serve', '--local']
  if (options.port !== undefined) args.push('--port', String(options.port))

  const child = spawnProcess(executable, args, {
    env: {
      ...process.env,
      MEMEX_HOME: options.home,
      // Constraint 2: never open a browser on the Host's machine.
      MEMEX_NO_OPEN: '1',
      // Same reason as runKernel: the kernel matches English strings, and a
      // localized environment silently breaks those judgements.
      LC_ALL: 'C',
      LANG: 'C',
    },
    // Constraint from docs/notes/dsh-plugin-integration-pitfalls.md §2: a
    // long-lived child must get a pipe it never writes to and never closes.
    // 'ignore' gives it an immediately-EOF stdin, which makes it exit 0 right
    // after start — a failure that looks like success.
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return await new Promise<BrowseService>((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    /** Debounce handle for "stdout has gone quiet"; see the data handler. */
    let quiet: ReturnType<typeof setTimeout> | undefined

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      if (quiet !== undefined) clearTimeout(quiet)
      child.kill('SIGTERM')
      reject(new KernelError('timeout', `memex serve did not report a listening address within ${options.readyTimeoutMs ?? READY_TIMEOUT_MS}ms`))
    }, options.readyTimeoutMs ?? READY_TIMEOUT_MS)

    const finishOk = (port: number): void => {
      settled = true
      clearTimeout(timer)
      if (quiet !== undefined) clearTimeout(quiet)
      resolve({
        home: options.home,
        port,
        stop: () => stopChild(child),
      })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      stdout += chunk
      const port = parseReadyPort(stdout)
      if (port === undefined) return
      // Those bogus readiness lines (see parseReadyPort) can arrive in the
      // same chunk or in separate ones, so the first line seen is not
      // necessarily the last line coming. Settle only once stdout has gone
      // quiet briefly, and re-read the whole buffer at that point.
      clearTimeout(quiet)
      quiet = setTimeout(() => {
        if (settled) return
        const settledPort = parseReadyPort(stdout)
        if (settledPort !== undefined) finishOk(settledPort)
      }, QUIET_MS)
    })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })

    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (quiet !== undefined) clearTimeout(quiet)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new KernelError('missing', 'memex CLI not found in PATH. Install @touchskyer/memex.'))
      } else reject(error)
    })

    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (quiet !== undefined) clearTimeout(quiet)
      // Reached whenever the kernel decided not to serve locally at all — the
      // hosted-site redirect path exits cleanly, so a zero code is still a
      // failure for our purposes.
      const detail = (stderr.trim() || stdout.trim() || `exit ${code ?? 'unknown'}`).slice(0, 500)
      reject(new KernelError('failed', `memex serve exited before reporting a listening address: ${detail}`))
    })

    // Hold stdin open without writing: see the stdio note above.
    child.stdin?.on('error', () => { /* the process owns its own lifetime */ })
  })
}

/** SIGTERM, then resolve once the child is gone (or the grace period ends). */
function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>(resolve => {
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, STOP_GRACE_MS)
    child.once('close', done)
    try {
      child.kill('SIGTERM')
    } catch {
      done()
    }
  })
}
