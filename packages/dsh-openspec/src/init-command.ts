import { quotePosixArgument } from './managed-invocation.js'

export type InitOptions = {
  cwd: string
  tools?: string
  profile?: string
  language?: string
  force?: boolean
  hasOpenSpecDir?: boolean
}
export class InitOptionsError extends Error {
  readonly code = 'invalid-init-options'
  constructor() { super('invalid-init-options'); this.name = 'InitOptionsError' }
}
const TOOLS = new Set(['none', 'claude', 'codex', 'cursor', 'opencode', 'windsurf', 'gemini', 'copilot'])
const PROFILES = new Set(['core', 'custom'])

export function buildInitCommand(options: InitOptions): string {
  if (!options.cwd || !options.cwd.startsWith('/')) throw new InitOptionsError()
  const tools = options.tools ?? 'none'
  const profile = options.profile
  if (!TOOLS.has(tools) || (profile !== undefined && !PROFILES.has(profile))) throw new InitOptionsError()
  if (options.language !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(options.language)) throw new InitOptionsError()
  const args = ['init', quotePosixArgument(options.cwd), '--tools', tools]
  if (profile) args.push('--profile', profile)
  args.push('--no-copilot-cloud', '--no-animation')
  if (options.language) args.push('--language', options.language)
  const command = `env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 node "$DSH_OPENSPEC_CLI" ${args.join(' ')}`
  return options.hasOpenSpecDir ? `${command}\nWarning: init may update the official global config when project OpenSpec artifacts already exist and no profile is configured in the global config.` : command
}
