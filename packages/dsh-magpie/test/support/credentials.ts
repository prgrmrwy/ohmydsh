import type { Credentials } from '../../src/host/runtime.js'
export function credentialsMock(initial?: string, writable = true) {
  let value = initial
  const writes: unknown[] = []
  let listener = () => {}
  const service: Credentials = {
    describe: async () => ({ configured: !!value, writable }),
    resolve: async () => value ? { value, source: writable ? 'file' : 'env' } : undefined,
    set: async (_ref, next) => { writes.push(next); value = next; listener() },
    unset: async () => { writes.push(null); value = undefined; listener() },
  }
  return { service, writes, change(next?: string, emit = false) { value = next; if (emit) listener() }, onChange(callback: () => void) { listener = callback } }
}
