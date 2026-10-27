import { KEY_REF, type Credentials } from '../../src/host/runtime.js'
export function credentialsMock(initial?: string, writable = true) {
  let value = initial
  const writes: unknown[] = []
  let listener = () => {}
  const extra = new Map<unknown, string>()
  const get = (ref: unknown) => ref === KEY_REF ? value : extra.get(ref)
  const service: Credentials = {
    describe: async ref => ({ configured: !!get(ref), writable }),
    resolve: async ref => get(ref) ? { value: get(ref)!, source: writable ? 'file' : 'env' } : undefined,
    set: async (ref, next) => { writes.push(next); if (ref === KEY_REF) value = next; else extra.set(ref, next); listener() },
    unset: async ref => { writes.push(null); if (ref === KEY_REF) value = undefined; else extra.delete(ref); listener() },
  }
  return { service, writes, change(next?: string, emit = false) { value = next; if (emit) listener() }, onChange(callback: () => void) { listener = callback } }
}
