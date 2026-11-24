/** Page-side cookie / Storage views per target (design D4). Compatibility layer, NOT a security boundary. */

/** `document.cookie`: only `<prefix>*` cookies are visible (prefix stripped); writes get the prefix and `Path=/`. */
export function installCookieView(prefix: string): void {
  const native = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  if (native?.get === undefined || native.set === undefined) throw new Error('document.cookie accessor not found')
  const get = native.get
  const set = native.set
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    enumerable: true,
    get(this: Document): string {
      return get.call(this).split('; ').filter((c: string) => c.startsWith(prefix)).map((c: string) => c.slice(prefix.length)).join('; ')
    },
    set(this: Document, value: string) {
      const stripped = String(value).replace(/;\s*(path|domain)\s*=[^;]*/gi, '')
      set.call(this, `${prefix}${stripped}; Path=/`)
    },
  })
}

/** A Storage-shaped Proxy confined to keys starting with `prefix`. */
export function wrapStorage(real: Storage, prefix: string): Storage {
  const ownKeys = (): string[] => {
    const keys: string[] = []
    for (let i = 0; i < real.length; i++) {
      const key = real.key(i)
      if (key !== null && key.startsWith(prefix)) keys.push(key.slice(prefix.length))
    }
    return keys
  }
  const methods: Record<string, unknown> = {
    getItem: (key: string) => real.getItem(prefix + String(key)),
    setItem: (key: string, value: string) => real.setItem(prefix + String(key), String(value)),
    removeItem: (key: string) => real.removeItem(prefix + String(key)),
    key: (index: number) => ownKeys()[Number(index)] ?? null,
    clear: () => { for (const key of ownKeys()) real.removeItem(prefix + key) },
  }
  return new Proxy({}, {
    get(_t, p) {
      if (typeof p === 'symbol') return p === Symbol.toStringTag ? 'Storage' : undefined
      if (p === 'length') return ownKeys().length
      if (p in methods) return methods[p]
      return real.getItem(prefix + p) ?? undefined
    },
    set(_t, p, value) {
      if (typeof p === 'string') real.setItem(prefix + p, String(value))
      return true
    },
    deleteProperty(_t, p) {
      if (typeof p === 'string') real.removeItem(prefix + p)
      return true
    },
    has(_t, p) {
      return typeof p === 'string' && (p in methods || p === 'length' || real.getItem(prefix + p) !== null)
    },
    ownKeys: () => ownKeys(),
    getOwnPropertyDescriptor(_t, p) {
      if (typeof p !== 'string') return undefined
      const value = real.getItem(prefix + p)
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true }
    },
  }) as Storage
}

export function installStorageViews(prefix: string, local: Storage, session: Storage): void {
  const wrapLocal = wrapStorage(local, prefix)
  const wrapSession = wrapStorage(session, prefix)
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => wrapLocal })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => wrapSession })
  Object.defineProperty(window, 'cookieStore', { configurable: true, value: undefined })
}
