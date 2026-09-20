import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The official lark-cli version whose `--output` contract Pet reviewed. */
export const PET_LARK_CLI_PINNED_VERSION = '1.0.94' as const

const VERSION_TIMEOUT_MS = 10_000
const MAX_VERSION_CHARS = 64
const VERSION_PATTERN = /\b(\d+\.\d+\.\d+)\b/

/** The resolved official binary plus the only directory media may be written to. */
export interface PetLarkCliCompat {
  readonly binary: string
  readonly pinnedVersion: typeof PET_LARK_CLI_PINNED_VERSION
  /** Pet-owned 0700 spool; the locus child's read guard refuses this tree. */
  readonly spoolRoot: string
}

/** What the resolver needs to prove before media is allowed to touch disk. */
export interface PetLarkCliCompatInput {
  /** Pet's media spool directory, created by `ensurePetDirectories`. */
  readonly spoolRoot: string
  /** Binary to probe; defaults to the same `lark-cli` every other Pet call uses. */
  readonly binary?: string
  /** Version probe seam, for tests that must not spawn a real binary. */
  readonly probe?: (binary: string) => Promise<string>
}

/** Stable fail-closed diagnostic for an unproven lark-cli. */
export class PetLarkCliCompatUnavailableError extends Error {
  readonly code = 'pet-lark-cli-compat-unavailable' as const

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PetLarkCliCompatUnavailableError'
  }
}

function sanitize(text: string): string {
  return text.replace(/[\r\n\0]/g, ' ').trim().slice(0, MAX_VERSION_CHARS)
}

async function probeVersion(binary: string): Promise<string> {
  const result = await run(binary, ['--version'], { timeout: VERSION_TIMEOUT_MS, maxBuffer: 4096 })
  return typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '')
}

/**
 * Resolve the official `lark-cli` Pet downloads media with.
 *
 * Two facts are required, and neither is inferred: the binary must run, and the
 * version it reports must be the pinned one, because that version is the
 * contract for `--output`'s allowed roots and denylist. Media stays unavailable
 * otherwise — a version Pet has not reviewed must not decide where bytes land.
 * @param input - Spool directory plus optional binary/probe overrides.
 * @returns the resolved binary, pinned version and spool root.
 * @throws PetLarkCliCompatUnavailableError when either fact cannot be proven.
 */
export async function resolvePetLarkCliCompat(input: PetLarkCliCompatInput): Promise<PetLarkCliCompat> {
  if (input.spoolRoot.trim() === '') {
    throw new PetLarkCliCompatUnavailableError('Pet media spool directory is not configured')
  }
  const binary = (input.binary ?? 'lark-cli').trim()
  if (binary === '') {
    throw new PetLarkCliCompatUnavailableError('Pet media downloader has no lark-cli to resolve')
  }
  const probe = input.probe ?? probeVersion
  let reported: string
  try {
    reported = await probe(binary)
  } catch (cause) {
    throw new PetLarkCliCompatUnavailableError(`lark-cli ${binary} could not be probed`, { cause })
  }
  const version = VERSION_PATTERN.exec(reported)?.[1]
  if (version === undefined) {
    throw new PetLarkCliCompatUnavailableError(
      `lark-cli ${binary} reported no version (${sanitize(reported) || 'empty output'})`,
    )
  }
  if (version !== PET_LARK_CLI_PINNED_VERSION) {
    throw new PetLarkCliCompatUnavailableError(
      `lark-cli ${binary} is ${version}, but Pet media requires ${PET_LARK_CLI_PINNED_VERSION}`,
    )
  }
  return { binary, pinnedVersion: PET_LARK_CLI_PINNED_VERSION, spoolRoot: input.spoolRoot }
}
