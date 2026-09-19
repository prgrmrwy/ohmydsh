/** Caller-bound physical-path guard for the four Locus project-read tools. */

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const PROJECT_READ_TOOLS = new Set(['read', 'read_image', 'glob', 'grep'])
export const LOCUS_PROJECT_READ_DENIAL = 'locus-project-read-outside-confirmed-workspace'

export interface LocusProjectReadGuardInput {
  /** Exact child Session cwd, read by the Host rather than supplied by the model. */
  readonly childCwd: string
  /** Exact parent Session cwd, read by the Host rather than supplied by the model. */
  readonly parentCwd: string
  /** Sandbox-policy workspace root resolved for the exact child Session. */
  readonly workspaceRoot: string
  readonly deniedRoots: readonly string[]
}

interface CanonicalProjectReadPolicy {
  readonly base: string
  readonly allowedRoots: readonly string[]
  readonly deniedRoots: readonly string[]
}

function canonicalExistingDirectory(path: string): string {
  if (!isAbsolute(path)) throw new Error('project-read root must be absolute')
  const canonical = realpathSync(path)
  if (!statSync(canonical).isDirectory()) throw new Error('project-read root must be a directory')
  return canonical
}

function physicallyContained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function compilePolicy(input: LocusProjectReadGuardInput): CanonicalProjectReadPolicy {
  const childCwd = canonicalExistingDirectory(input.childCwd)
  const parentCwd = canonicalExistingDirectory(input.parentCwd)
  const workspaceRoot = canonicalExistingDirectory(input.workspaceRoot)
  const deniedRoots = input.deniedRoots.map(canonicalExistingDirectory)
  // The current Locus contract creates the child at its exact parent's project
  // cwd and resolves that same directory as the sandbox workspace root. Treat a
  // mismatch as unavailable rather than unioning roots and accidentally making
  // a broad parent cwd (for example `/`) an authorization grant.
  if (childCwd !== parentCwd || childCwd !== workspaceRoot) {
    throw new Error('child, parent, and sandbox project roots do not agree')
  }
  const allowedRoots = [workspaceRoot]
  if (deniedRoots.some(denied =>
    physicallyContained(denied, workspaceRoot) || physicallyContained(workspaceRoot, denied))) {
    throw new Error('confirmed workspace overlaps or contains a denied runtime root')
  }
  return { base: childCwd, allowedRoots, deniedRoots }
}

function requestedPath(exec: Readonly<ToolExecution>): string | undefined {
  if (!PROJECT_READ_TOOLS.has(exec.name)) return undefined
  const args = typeof exec.arguments === 'object' && exec.arguments !== null
    ? exec.arguments as Record<string, unknown>
    : undefined
  const value = exec.name === 'read' || exec.name === 'read_image'
    ? args?.['file_path']
    : args?.['path']
  return typeof value === 'string' && value.trim() !== '' ? value : ''
}

function denial(policy: CanonicalProjectReadPolicy, exec: Readonly<ToolExecution>): string | undefined {
  const path = requestedPath(exec)
  if (path === undefined) return undefined
  if (path === '') return LOCUS_PROJECT_READ_DENIAL
  let canonical: string
  try {
    canonical = realpathSync(isAbsolute(path) ? path : resolve(policy.base, path))
  } catch {
    return LOCUS_PROJECT_READ_DENIAL
  }
  if (policy.deniedRoots.some(root => physicallyContained(root, canonical))) return LOCUS_PROJECT_READ_DENIAL
  return policy.allowedRoots.some(root => physicallyContained(root, canonical))
    ? undefined
    : LOCUS_PROJECT_READ_DENIAL
}

/**
 * Install both the extensible early gate and the final monotonic guard on one
 * child scope. Construction canonicalizes every Host-proven root synchronously;
 * any missing root vetoes Agent publication.
 */
export function installLocusProjectReadGuard(scope: Context, input: LocusProjectReadGuardInput): void {
  const policy = compilePolicy(input)
  const tools = scope.get('tools') as { guard(guard: (exec: Readonly<ToolExecution>) => string | undefined): () => void } | undefined
  if (tools === undefined) throw new Error('locus project-read guard requires tools')
  scope.effect(
    () => tools.guard(exec => denial(policy, exec)),
    'dsh-pet: locus canonical project-read guard',
  )
  scope.effect(
    () => scope.on('tools/pre-execute', async (exec, next) => {
      const reason = denial(policy, exec)
      return reason === undefined ? next() : { kind: 'deny' as const, reason }
    }),
    'dsh-pet: locus canonical project-read pre-execute gate',
  )
}
