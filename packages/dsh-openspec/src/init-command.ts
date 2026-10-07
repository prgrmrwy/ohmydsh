import { quotePosixArgument } from './managed-invocation.js'

export type InitOptions = {
  cwd: string
  tools?: string
  profile?: string
  language?: string
  force?: boolean
  hasOpenSpecDir?: boolean
  /** Official tool ids of the pinned release. Defaults to the historical conservative set used by pure-builder callers. */
  allowedTools?: ReadonlySet<string>
  /** Full managed invocation (env + node + cli) from the selected generation. Defaults to the legacy shell placeholder. */
  invocation?: string
}
export class InitOptionsError extends Error {
  readonly code = 'invalid-init-options'
  /** Names the offending argument so the user can fix it; never echoes the raw value. */
  constructor(readonly argument: 'cwd' | 'tools' | 'profile' | 'language' | 'option' = 'option') {
    super(`invalid-init-options: ${argument}`); this.name = 'InitOptionsError'
  }
}
const FALLBACK_TOOLS = new Set(['none', 'claude', 'codex', 'cursor', 'opencode', 'windsurf', 'gemini', 'copilot'])
const PROFILES = new Set(['core', 'custom'])
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export type ParsedInitArgs = { tools?: string; profile?: string; language?: string }

/**
 * Parse the raw slash argument string. Only `--tools|--profile|--language <value>` are accepted, each at most once.
 * Everything else (including `--force`, shell syntax and unknown flags) is rejected naming the argument; nothing is
 * dropped silently and nothing reaches a shell.
 */
export function parseInitArgs(raw: string): ParsedInitArgs {
  const tokens = raw.trim() === '' ? [] : raw.trim().split(/\s+/)
  const result: ParsedInitArgs = {}
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index]!
    const value = tokens[index + 1]
    if (flag !== '--tools' && flag !== '--profile' && flag !== '--language') throw new InitOptionsError('option')
    const key = flag.slice(2) as 'tools' | 'profile' | 'language'
    if (value === undefined || value.startsWith('--') || key in result) throw new InitOptionsError(key)
    result[key] = value
  }
  return result
}

export function buildInitCommand(options: InitOptions): string {
  if (!options.cwd || !options.cwd.startsWith('/')) throw new InitOptionsError('cwd')
  const allowed = options.allowedTools ?? FALLBACK_TOOLS
  const tools = options.tools ?? 'none'
  const profile = options.profile
  if (tools !== 'none' && !allowed.has(tools)) throw new InitOptionsError('tools')
  if (profile !== undefined && !PROFILES.has(profile)) throw new InitOptionsError('profile')
  if (options.language !== undefined && !LANGUAGE.test(options.language)) throw new InitOptionsError('language')
  const args = ['init', quotePosixArgument(options.cwd), '--tools', tools]
  if (profile) args.push('--profile', profile)
  args.push('--no-copilot-cloud', '--no-animation')
  if (options.language) args.push('--language', options.language)
  const prefix = options.invocation ?? 'env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 node "$DSH_OPENSPEC_CLI"'
  const command = `${prefix} ${args.join(' ')}`
  return options.hasOpenSpecDir ? `${command}\nWarning: init may update the official global config when project OpenSpec artifacts already exist and no profile is configured in the global config.` : command
}
