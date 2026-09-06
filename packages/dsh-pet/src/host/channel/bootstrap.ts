/**
 * Bot binding: creating a new Lark app, or connecting an existing one.
 *
 * Both paths delegate to `lark-cli config init`, which already implements the
 * Lark app-registration flow and owns credential storage. Pet orchestrates and
 * reads back an App ID; it never handles a token and only ever passes a secret
 * THROUGH to the CLI on stdin.
 *
 * Everything lands in a Pet-owned lark-cli profile so the user's existing app,
 * its tokens and its identity policy are untouched — and so two consumers can
 * never end up competing for one app's events.
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** lark-cli profile Pet keeps its own bot in. */
export const PET_CLI_PROFILE = 'dsh-pet'

/** Progress of a create-new-bot flow. */
export type BootstrapPhase = 'idle' | 'awaiting-authorization' | 'bound' | 'failed'

/** Snapshot of the binding flow, safe to surface in the UI. */
export interface BootstrapState {
  readonly phase: BootstrapPhase
  /**
   * Where the user completes authorization.
   *
   * Not a secret: it is a one-time onboarding link the user must open anyway.
   */
  readonly verificationUrl?: string
  /** Bound app id, once the flow completes. */
  readonly appId?: string
  /** Human-readable failure cause when the phase is `failed`. */
  readonly diagnostic?: string
}

/** Injectable process spawn, for tests. */
export type SpawnLike = (command: string, args: readonly string[]) => ChildProcess

/** Options shared by both binding paths. */
export interface BootstrapOptions {
  /** lark-cli executable. */
  readonly binary?: string
  /** Profile name; defaults to {@link PET_CLI_PROFILE}. */
  readonly profile?: string
  /** Injectable spawn, for tests. */
  readonly spawnProcess?: SpawnLike
  /** Notified whenever the state changes. */
  readonly onState?: (state: BootstrapState) => void
}

/**
 * Extract the verification URL lark-cli prints while it waits.
 *
 * Matched loosely on purpose: the surrounding wording is a CLI presentation
 * detail that may change, while the URL itself is what the user needs.
 * @param text - A chunk of CLI output.
 * @returns the URL, or `undefined`.
 */
export function findVerificationUrl(text: string): string | undefined {
  const match = /https?:\/\/\S+/.exec(text)
  if (match === null) return undefined
  // Trim trailing punctuation the CLI may place after the link.
  return match[0].replace(/[),.;'"]+$/, '')
}

/**
 * Extract the App ID lark-cli reports once binding succeeds.
 * @param text - A chunk of CLI output.
 * @returns the app id, or `undefined`.
 */
export function findAppId(text: string): string | undefined {
  const match = /\b(cli_[A-Za-z0-9]+)\b/.exec(text)
  return match?.[1]
}

/**
 * Drives one `lark-cli config init` run to completion.
 *
 * The create path BLOCKS until the user finishes in the browser, so this is a
 * long-lived object rather than a promise-returning function: the UI needs the
 * verification URL while the process is still running.
 */
export class BotBootstrap {
  private child: ChildProcess | undefined
  private state: BootstrapState = { phase: 'idle' }
  private output = ''

  /**
   * @param options - Binding inputs.
   */
  constructor(private readonly options: BootstrapOptions = {}) {}

  /** Current state, safe to read at any time. */
  get current(): BootstrapState {
    return this.state
  }

  /**
   * Start creating a brand-new Lark app.
   *
   * Resolves when the flow settles; the verification URL arrives earlier
   * through {@link BootstrapOptions.onState}.
   * @returns the terminal state.
   */
  async createNew(): Promise<BootstrapState> {
    return this.run(['config', 'init', '--new', '--profile', this.profile])
  }

  /**
   * Connect an existing app by id and secret.
   *
   * The secret is written to the child's STDIN and never appears in `argv`:
   * process listings are readable by other local processes, so a secret passed
   * as an argument is effectively disclosed.
   * @param appId - Existing Lark app id.
   * @param appSecret - Its secret; consumed, never stored by Pet.
   * @returns the terminal state.
   */
  async connectExisting(appId: string, appSecret: string): Promise<BootstrapState> {
    if (appId.trim() === '') {
      return this.settle({ phase: 'failed', diagnostic: 'App ID is required.' })
    }
    if (appSecret.trim() === '') {
      return this.settle({ phase: 'failed', diagnostic: 'App Secret is required.' })
    }
    return this.run(
      ['config', 'init', '--app-id', appId, '--app-secret-stdin', '--profile', this.profile],
      appSecret,
    )
  }

  /** Abort an in-flight flow. */
  cancel(): void {
    const child = this.child
    this.child = undefined
    if (child !== undefined && child.exitCode === null) child.kill('SIGTERM')
    this.settle({ phase: 'idle' })
  }

  /** Profile this instance binds into. */
  private get profile(): string {
    return this.options.profile ?? PET_CLI_PROFILE
  }

  /** Publish a state and return it. */
  private settle(state: BootstrapState): BootstrapState {
    this.state = state
    this.options.onState?.(state)
    return state
  }

  /** Spawn lark-cli, optionally feeding a secret on stdin, and await it. */
  private run(args: readonly string[], stdinPayload?: string): Promise<BootstrapState> {
    const binary = this.options.binary ?? 'lark-cli'
    const spawnProcess =
      this.options.spawnProcess ??
      ((command: string, commandArgs: readonly string[]) =>
        spawn(command, [...commandArgs], { stdio: ['pipe', 'pipe', 'pipe'] }))

    this.output = ''
    this.settle({ phase: 'awaiting-authorization' })

    let child: ChildProcess
    try {
      child = spawnProcess(binary, args)
    } catch (error) {
      return Promise.resolve(
        this.settle({
          phase: 'failed',
          diagnostic: `Could not start ${binary}: ${describe(error)}`,
        }),
      )
    }
    this.child = child

    if (stdinPayload !== undefined) {
      // Written once and the stream closed immediately: the CLI reads a single
      // secret and Pet keeps no reference to it afterwards.
      child.stdin?.end(stdinPayload)
    }

    const absorb = (chunk: string): void => {
      this.output += chunk
      if (this.state.phase !== 'awaiting-authorization') return
      const url = findVerificationUrl(chunk)
      // Surface the link as soon as it appears; the process keeps running
      // until the user finishes in the browser.
      if (url !== undefined && this.state.verificationUrl === undefined) {
        this.settle({ phase: 'awaiting-authorization', verificationUrl: url })
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', absorb)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', absorb)

    return new Promise<BootstrapState>(resolve => {
      child.on('error', error =>
        resolve(this.settle({ phase: 'failed', diagnostic: describe(error) })),
      )
      child.on('exit', code => {
        this.child = undefined
        const captured = this.output
        // Never retain the output: for the connect path it was fed a secret,
        // and the CLI may echo parts of its input on error.
        this.output = ''
        if (code !== 0) {
          resolve(
            this.settle({
              phase: 'failed',
              diagnostic: summarizeFailure(captured, code),
            }),
          )
          return
        }
        const appId = findAppId(captured)
        if (appId === undefined) {
          // Exit code says success but nothing identifies the app: reporting
          // "bound" here would leave a configuration Pet cannot describe.
          resolve(
            this.settle({
              phase: 'failed',
              diagnostic: 'lark-cli reported success but no App ID could be read from its output.',
            }),
          )
          return
        }
        resolve(this.settle({ phase: 'bound', appId }))
      })
    })
  }
}

/**
 * Reduce CLI output to a short, non-secret failure line.
 * @param output - Captured output.
 * @param code - Exit code.
 * @returns the diagnostic.
 */
function summarizeFailure(output: string, code: number | null): string {
  // Only lines that look like messages, and only a couple of them: the raw
  // stream may contain fragments of whatever was piped in.
  const line = output
    .split('\n')
    .map(entry => entry.trim())
    .filter(entry => entry !== '' && !entry.startsWith('{'))
    .at(-1)
  return line !== undefined && line !== ''
    ? `lark-cli exited with code ${code}: ${line}`
    : `lark-cli exited with code ${code}.`
}

/**
 * Render an unknown thrown value.
 * @param error - The thrown value.
 * @returns a readable description.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
