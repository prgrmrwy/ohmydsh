export const evalPhases = ['round', 'execute', 'retire', 'collect', 'score'] as const
export type EvalPhase = typeof evalPhases[number]
const reasons = {
  'Test owner inbox not empty after retirement': 'root-inbox-pending',
  'Test owner identity or resource evidence unhealthy': 'root-identity-unproven',
  'Registered test root unavailable; release proof missing': 'root-unavailable',
  'Registered evidence has no durable checkpoint listener': 'checkpoint-unavailable',
  'Actual evidence backend mismatch': 'backend-mismatch',
  'Actual evidence backend configuration mismatch': 'backend-config-mismatch',
  'Registered persisted metadata unavailable': 'persisted-metadata-unavailable',
  'Invalid evidence artifact': 'invalid-artifact',
  'Evidence changed during collection': 'artifact-changed',
  'Stored evidence identity mismatch': 'evidence-identity-mismatch',
  'Continuous owned Host handles missing from memory; resume refused': 'resume-owner-missing',
  'Continuous same-Host execution unavailable; resume refused': 'resume-owner-missing',
  'Prior resume proof failed; retained resource evidence requires manual inspection': 'resume-proof-failed',
  'Retained identity/registry evidence changed; resume refused': 'resume-evidence-changed',
  'Test session readback mismatch; question not sent': 'session-readback-mismatch',
} as const
const codes = [...Object.values(reasons), 'release-unproven', 'resume-not-retryable', 'unexpected-host-error'] as const
const fsCodes = ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR', 'ELOOP'] as const
const files = ['release', 'runtime-services', 'host-retirement', 'host-retirer', 'host-reader', 'storage-reader', 'artifact-location', 'evidence-log', 'collection', 'managed-round', 'host-round', 'host-item', 'host', 'host-plugin', 'host-jobs', 'tracking', 'descendants', 'controller', 'executor']
export interface EvalFailure { phase: EvalPhase; code: string; systemCode?: string; frames: { file: string; line: number }[]; causes: EvalFailure[] }

export class EvalPhaseFailure extends Error {
  constructor(readonly phase: EvalPhase, cause: unknown) { super(cause instanceof Error ? cause.message : 'Eval operation failed', { cause }) }
}

/** Never persist or return arbitrary exception messages, stack paths, prompts or credentials. */
export function safeEvalFailure(error: unknown, fallback: EvalPhase = 'round', depth = 0): EvalFailure {
  const value = error instanceof Error ? error : undefined
  const message = value?.message ?? ''
  const code = (Object.hasOwn(reasons, message) ? reasons[message as keyof typeof reasons] : undefined) ?? (message.startsWith('Resource release unproven:') ? 'release-unproven' : message.startsWith('No proven retired ordinary failure to resume') ? 'resume-not-retryable' : 'unexpected-host-error')
  const systemCode = (value as NodeJS.ErrnoException | undefined)?.code
  const phase = value instanceof EvalPhaseFailure ? value.phase : fallback
  const stack = value?.stack, header = value ? `${value.name}${message ? `: ${message}` : ''}\n` : ''
  // Strip the complete message, including embedded newlines, before recognizing frames.
  const frameText = typeof stack === 'string' && stack.startsWith(header) ? stack.slice(header.length, header.length + 65_536) : ''
  const frames = [...frameText.matchAll(/[/\\]eval[/\\]([a-z-]+)\.(?:js|ts):(\d+):\d+/g)]
    .filter(match => files.includes(match[1]!) && Number(match[2]) <= 1_000_000).slice(0, 8)
    .map(match => ({ file: match[1]!, line: Number(match[2]) }))
  const nested = value instanceof AggregateError ? value.errors : value?.cause === undefined ? [] : [value.cause]
  return { phase, code, ...(fsCodes.includes(systemCode as typeof fsCodes[number]) ? { systemCode: systemCode! } : {}), frames,
    causes: depth < 3 ? nested.slice(0, 4).map(cause => safeEvalFailure(cause, phase, depth + 1)) : [] }
}

export function checkedEvalFailure(value: unknown, depth = 0): EvalFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) throw new Error('Invalid eval failure diagnostic')
  const v = value as EvalFailure
  if (Object.keys(v).some(key => !['phase', 'code', 'systemCode', 'frames', 'causes'].includes(key)) || !evalPhases.includes(v.phase)
    || !codes.includes(v.code as typeof codes[number]) || (v.systemCode !== undefined && !fsCodes.includes(v.systemCode as typeof fsCodes[number]))
    || !Array.isArray(v.frames) || v.frames.length > 8 || v.frames.some(f => !f || Object.keys(f).sort().join() !== 'file,line' || !files.includes(f.file) || !Number.isSafeInteger(f.line) || f.line < 0 || f.line > 1_000_000)
    || !Array.isArray(v.causes) || v.causes.length > 4) throw new Error('Invalid eval failure diagnostic')
  v.causes.forEach(cause => checkedEvalFailure(cause, depth + 1))
  return v
}
