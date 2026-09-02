/**
 * Bounded external command execution for Pet's side-effect tools.
 *
 * Every organization-specific effect runs through here so the blast radius is
 * explicit: a fixed argv array (never a shell string), a timeout, bounded
 * output capture, and no inherited stdin. Arguments are passed as separate
 * argv entries, so a value containing shell metacharacters is data — it can
 * never become another command.
 *
 * The model never supplies an argv entry directly: callers build argv from
 * trusted snapshot facts and validated bindings.
 */

import { execFile } from 'node:child_process'
import { PetError } from './errors.js'

/** Hard bounds applied to every external command. */
export const COMMAND_LIMITS = {
  /** Wall-clock budget for one command. */
  timeoutMs: 120_000,
  /** Maximum captured stdout/stderr bytes. */
  maxOutputBytes: 1024 * 1024,
} as const

/** Result of one bounded command. */
export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs one bounded command; substituted by deterministic fakes in tests. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<CommandResult>

/**
 * Execute one external command with bounded time and output.
 *
 * Uses `execFile`, never a shell: `args` are argv entries, so quoting and
 * metacharacters cannot alter what runs.
 * @param file - Executable name resolved on PATH.
 * @param args - Exact argv entries.
 * @param options - Optional working directory.
 * @returns the captured result; a non-zero exit is returned, not thrown.
 */
export const runBoundedCommand: CommandRunner = async (file, args, options = {}) =>
  new Promise<CommandResult>(resolve => {
    execFile(
      file,
      [...args],
      {
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        timeout: COMMAND_LIMITS.timeoutMs,
        maxBuffer: COMMAND_LIMITS.maxOutputBytes,
        // Never inherit stdin: a prompt would hang the Host.
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })

/**
 * Require a command to succeed, raising a bounded diagnostic otherwise.
 * @param label - Operator-facing operation name.
 * @param result - The captured result.
 * @returns the stdout of a successful command.
 * @throws PetError with a truncated diagnostic on failure.
 */
export function requireSuccess(label: string, result: CommandResult): string {
  if (result.code === 0) return result.stdout
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 600)
  throw new PetError('INTERNAL', `${label} failed (exit ${result.code}): ${detail}`)
}

/**
 * Probe whether an executable is available on this machine.
 *
 * Availability is COMPUTED, never assumed: an absent internal CLI disables
 * the capability with a diagnostic instead of breaking Pet.
 * @param file - Executable name.
 * @param runner - Command runner.
 * @returns whether the executable resolved.
 */
export async function isCommandAvailable(
  file: string,
  runner: CommandRunner = runBoundedCommand,
): Promise<boolean> {
  const result = await runner('command', ['-v', file]).catch(() => undefined)
  if (result !== undefined && result.code === 0) return true
  // `command` is a shell builtin on some systems; fall back to `which`.
  const fallback = await runner('which', [file]).catch(() => undefined)
  return fallback !== undefined && fallback.code === 0
}
