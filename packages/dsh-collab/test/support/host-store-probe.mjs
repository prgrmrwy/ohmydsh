import { promises as fs } from 'node:fs'
import { pathToFileURL } from 'node:url'

// This fixture owns only a FileStore and its disposer. Signals and the 5s
// budget belong entirely to the unmodified released DSH CLI, never this file.
export const name = 'collab-host-store-probe'
export async function apply(ctx, config) {
  let store
  let keepalive
  ctx.effect(() => async () => {
    await fs.writeFile(config.disposing, 'started')
    await store?.close('probe')
    clearInterval(keepalive)
    await fs.writeFile(config.closed, 'closed')
  })
  {
    const { FileStore } = await import(pathToFileURL(config.kernel).href)
    const barrierFs = config.mode === 'budget' ? { open: async (...args) => {
      const handle = await fs.open(...args)
      if (args[1] !== 'a') return handle
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync') return async () => {
          await fs.writeFile(config.blocked, 'commit reached fsync')
          await new Promise(() => {})
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    } } : undefined
    store = new FileStore(config.dataDir, { fs: barrierFs })
    await store.open('probe')
    keepalive = setInterval(() => {}, 60000)
    const record = { kind: 'completion', seq: 1, events: [{ type: 'dispatch/completed', deliveryId: 'fixture', outcome: 'succeeded', messageRef: 'fixture', actor: 'system:dispatch' }] }
    if (config.mode === 'budget') {
      void store.commit('probe', record, 0).catch(error => { console.error(error); process.exitCode = 1 })
    } else await store.commit('probe', record, 0)
    ctx.get('appReady').onReady(() => { void fs.writeFile(config.ready, 'official appReady') })
  }
}
