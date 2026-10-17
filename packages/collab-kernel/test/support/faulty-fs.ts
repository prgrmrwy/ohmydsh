import { promises as fs } from 'node:fs'
import type { FileStoreFs } from '../../src/store/file-store.js'

type Handle = Awaited<ReturnType<typeof fs.open>>
export function mockHandle(handle: Handle, overrides: Partial<Handle>): Handle {
  return new Proxy(handle, {
    get(target, property) {
      const value = Reflect.get(overrides, property) ?? Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function faultyFs(options: { shortWrite?: boolean; zeroWrite?: boolean; failSync?: boolean; failWriteAfter?: number | undefined; failDirectorySync?: boolean; syncs?: string[] } = {}): Partial<FileStoreFs> {
  return {
    open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] === 'wx') return handle
      const isLog = String(args[0]).endsWith('.jsonl')
      return mockHandle(handle, {
        write: (async (buffer: Uint8Array, offset: number, length: number, position?: number) => {
          if (options.zeroWrite) return { bytesWritten: 0, buffer }
          if (options.failWriteAfter !== undefined && offset >= options.failWriteAfter) throw new Error('injected write failure')
          return handle.write(buffer, offset, options.shortWrite ? Math.max(1, Math.floor(length / 2)) : length, position)
        }) as Handle['write'],
        sync: async () => {
          options.syncs?.push(isLog ? 'file' : 'directory')
          if ((options.failSync && isLog) || (options.failDirectorySync && !isLog)) throw new Error('injected sync failure')
          return handle.sync()
        },
      })
    }) as typeof fs.open,
  }
}
