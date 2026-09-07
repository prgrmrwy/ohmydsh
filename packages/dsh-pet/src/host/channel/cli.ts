/** Shared lark-cli invocation policy for the Pet channel. */

/** Stable profile owned by Pet. */
export const PET_CLI_PROFILE = 'dsh-pet'

/**
 * Select Pet's profile explicitly for any command that consumes credentials.
 * Global flags precede the command so their meaning cannot drift by subcommand.
 */
export function petCliArgs(args: readonly string[], profile = PET_CLI_PROFILE): string[] {
  return ['--profile', profile, ...args]
}

/** Build current lark-cli config-init arguments for a named profile. */
export function petConfigInitArgs(args: readonly string[], profile = PET_CLI_PROFILE): string[] {
  return ['config', 'init', ...args, '--name', profile]
}
