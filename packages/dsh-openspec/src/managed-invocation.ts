import { isAbsolute, sep } from 'node:path'

export function quotePosixArgument(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value) || !isAbsolute(value)) throw new Error('block-unrenderable')
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function managedInvocation(input: { node: string; cli: string; telemetry: 'adapter-off' | 'official' }): string {
  const env = ['OPENSPEC_NO_UPDATE_CHECK=1']
  if (input.telemetry === 'adapter-off') env.push('OPENSPEC_TELEMETRY=0')
  const node = quotePosixArgument(input.node)
  const cli = quotePosixArgument(input.cli)
  return `env ${env.join(' ')} ${node} ${cli}`
}
