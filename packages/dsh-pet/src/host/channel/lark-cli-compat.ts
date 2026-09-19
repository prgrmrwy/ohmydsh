import { createHash } from 'node:crypto'
import { accessSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PET_LARK_CLI_UPSTREAM_VERSION = '1.0.94' as const
export const PET_LARK_CLI_UPSTREAM_COMMIT = 'f065bf5b645af381f9b7475ce721451e6ca36a23' as const
export const PET_LARK_CLI_PATCH_SHA256 = '3c8b66745b20f44d2f88e86342df15294e13779eeb0d78ceddcb2511419aea7c' as const

export interface PetLarkCliCompat {
  readonly binary: string
  readonly supportsBoundedFdDownload: true
  readonly upstreamVersion: typeof PET_LARK_CLI_UPSTREAM_VERSION
}

interface PetLarkCliProvenance {
  readonly upstreamVersion: string
  readonly upstreamCommit: string
  readonly patchSha256: string
  readonly platform: string
  readonly arch: string
  readonly supportsBoundedFdDownload: boolean
  readonly binarySha256: string
}

/** Stable fail-closed diagnostic for a missing or stale Pet-only lark-cli build. */
export class PetLarkCliCompatUnavailableError extends Error {
  readonly code = 'pet-lark-cli-compat-unavailable' as const

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PetLarkCliCompatUnavailableError'
  }
}

function packageRoot(): string {
  // Works from both src/host/channel during tests and lib/host/channel after tsc.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}

/**
 * Resolve the package-owned fixed-source lark-cli used only by Pet media.
 * Never consults PATH and never falls back to the user's global lark-cli.
 */
export function resolvePetLarkCliCompat(rootOverride = packageRoot()): PetLarkCliCompat {
  if (process.platform === 'win32') {
    throw new PetLarkCliCompatUnavailableError('bounded inherited-fd download is unavailable on non-POSIX hosts')
  }
  const root = path.join(rootOverride, 'compat', 'lark-cli', 'artifact')
  const binary = path.join(root, 'lark-cli')
  const provenanceFile = path.join(root, 'provenance.json')
  let provenance: PetLarkCliProvenance
  try {
    provenance = JSON.parse(readFileSync(provenanceFile, 'utf8')) as PetLarkCliProvenance
    const info = lstatSync(binary)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('binary is not a regular owned file')
    const canonicalRoot = realpathSync(root)
    const canonicalBinary = realpathSync(binary)
    if (path.dirname(canonicalBinary) !== canonicalRoot) throw new Error('binary resolves outside the artifact root')
    accessSync(binary, constants.X_OK)
  } catch (cause) {
    throw new PetLarkCliCompatUnavailableError('Pet media lark-cli compatibility artifact is missing or not executable; rebuild dsh-pet', { cause })
  }
  if (
    provenance.upstreamVersion !== PET_LARK_CLI_UPSTREAM_VERSION
    || provenance.upstreamCommit !== PET_LARK_CLI_UPSTREAM_COMMIT
    || provenance.patchSha256 !== PET_LARK_CLI_PATCH_SHA256
    || provenance.platform !== process.platform
    || provenance.arch !== process.arch
    || provenance.supportsBoundedFdDownload !== true
    || !/^[a-f0-9]{64}$/.test(provenance.binarySha256)
    || provenance.binarySha256 !== createHash('sha256').update(readFileSync(binary)).digest('hex')
  ) {
    throw new PetLarkCliCompatUnavailableError('Pet media lark-cli compatibility artifact provenance or capability does not match this package')
  }
  return {
    binary,
    supportsBoundedFdDownload: true,
    upstreamVersion: PET_LARK_CLI_UPSTREAM_VERSION,
  }
}
