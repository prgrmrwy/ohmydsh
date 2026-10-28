import { writeRepository } from './fixtures.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { deriveScopeFromLocalPath } from '../scope/resolver.js'
import type { ScopeResolution, ScopeService } from '../scope/types.js'

export interface EvalAttempt { readonly cwd: string; readonly home: string; readonly scope: string; readonly condition: 'mem' | 'nomem' }

export function allocateAttempt(homeDir: string, condition: 'mem' | 'nomem'): EvalAttempt {
  const cwd = join(homeDir, '.dsh-memex-eval-runs', condition, `eval-${randomUUID()}`, 'repo')
  const scope = deriveScopeFromLocalPath(cwd, homeDir)
  return { cwd, home: join(homeDir, '.dsh-memex', scope), scope, condition }
}

export function materializeAttempt(files: ReadonlyMap<string, Buffer>, attempt: EvalAttempt): void {
  const select = (prefix: string): Map<string, Buffer> => new Map([...files]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, bytes]) => [path.slice(prefix.length), bytes]))
  writeRepository(select('repo/'), attempt.cwd)
  writeRepository(select('library/'), attempt.home)
}

export function verifyAttemptRoute(hostResolver: ScopeService, attempt: EvalAttempt): ScopeResolution {
  const route = hostResolver.resolve(attempt.cwd)
  if (route.fallback || route.personal.read || route.personal.write) throw new Error('Test route exposes personal fallback')
  if (route.scope !== attempt.scope || route.home !== attempt.home || route.source !== 'local'
    || route.publish !== 'external' || route.memory !== (attempt.condition === 'mem')
    || route.access.read.length !== 1 || route.access.read[0] !== attempt.scope
    || route.access.write.length !== 1 || route.access.write[0] !== attempt.scope) {
    throw new Error(`Host route mismatch: ${attempt.cwd}`)
  }
  return route
}
