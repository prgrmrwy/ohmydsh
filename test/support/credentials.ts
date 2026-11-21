import { type Credentials } from '../../src/host/runtime.js'
import { lineCredentialRefs } from '../../src/host/runtime.js'

/** Legacy-convenience ref used by old fixtures; new fixtures use lineCredentialRefs. */
export const LEGACY_KEY_REF = 'MAGPIE_API_KEY'
const FIXTURE_LINE_ID = 'a1b2c3d4'

export interface CredentialsMockOptions {
  readonlyRefs?: string[]
  failSet?: string[]
  failUnset?: string[]
}

/**
 * Credentials service double keyed by reference name. Legacy call sites
 * (`credentialsMock(key, writable)`) keep operating on `KEY_REF`. Multi-line
 * suites add per-line refs via `setRef` / `markReadonly` / `failOn`, and can
 * make one `set`/`unset` fail to exercise pending paths.
 */
export function credentialsMock(initial?: string, writable = true, options: CredentialsMockOptions = {}) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(lineCredentialRefs(FIXTURE_LINE_ID).key as unknown as string, initial)
  const writes: unknown[] = []
  const readonlyRefs = new Set(options.readonlyRefs ?? [])
  const failSet = new Set(options.failSet ?? [])
  const failUnset = new Set(options.failUnset ?? [])
  const failMessages = new Map<string, string>()
  let listener = () => {}
  let resolveCount = 0
  let gate: (() => Promise<void>) | undefined
  let setGate: (() => Promise<void>) | undefined
  const name = (ref: unknown) => ref as string
  const get = (ref: unknown) => values.get(name(ref))
  const failureMessage = (operation: 'set' | 'unset', ref: string) => failMessages.get(`${operation}:${ref}`) ?? `${operation} failed: ${ref}`
  const service: Credentials = {
    describe: async ref => ({ configured: values.has(name(ref)), writable: writable && !readonlyRefs.has(name(ref)) }),
    resolve: async ref => {
      resolveCount++
      if (gate) await gate()
      const value = get(ref)
      return value === undefined ? undefined : { value, source: writable && !readonlyRefs.has(name(ref)) ? 'file' : 'env' }
    },
    set: async (ref, next) => {
      if (setGate) await setGate()
      if (failSet.has(name(ref))) throw new Error(failureMessage('set', name(ref)))
      writes.push(next); values.set(name(ref), next); listener()
    },
    unset: async ref => {
      if (failUnset.has(name(ref))) throw new Error(failureMessage('unset', name(ref)))
      writes.push(null); values.delete(name(ref)); listener()
    },
  }
  return {
    service,
    writes,
    values,
    change(next?: string, emit = false) {
      const ref = lineCredentialRefs(FIXTURE_LINE_ID).key as unknown as string
      if (next === undefined) values.delete(ref)
      else values.set(ref, next)
      if (emit) listener()
    },
    /** Legacy alias: resolve the fixture line's derived key ref. */
    keyRef: lineCredentialRefs(FIXTURE_LINE_ID).key as unknown as string,
    onChange(callback: () => void) { listener = callback },
    /** Pause every `resolve` until the gate promise settles (line-check admission tests). */
    setResolveGate(next?: () => Promise<void>) { gate = next },
    /** Pause every `set` (holds the runtime inside its saving window). */
    setWriteGate(next?: () => Promise<void>) { setGate = next },
    get resolveCount() { return resolveCount },
    setRef(ref: string, value: string, emit = false) { values.set(ref, value); if (emit) listener() },
    removeRef(ref: string, emit = false) { values.delete(ref); if (emit) listener() },
    markReadonly(ref: string) { readonlyRefs.add(ref) },
    /** Fail one operation; an explicit message reproduces a real provider error (e.g. a file-mode guard). */
    failOn(operation: 'set' | 'unset', ref: string, message?: string) {
      ;(operation === 'set' ? failSet : failUnset).add(ref)
      if (message !== undefined) failMessages.set(`${operation}:${ref}`, message)
    },
    clearFailure(operation?: 'set' | 'unset', ref?: string) {
      if (operation === undefined) { failSet.clear(); failUnset.clear(); failMessages.clear(); return }
      ;(operation === 'set' ? failSet : failUnset).delete(ref!)
      failMessages.delete(`${operation}:${String(ref)}`)
    },
  }
}
