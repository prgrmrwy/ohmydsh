import { credentialsMock, type CredentialsMockOptions } from './credentials.js'
import { SettingsStore, type AccessMode, type LineSettings } from '../../src/host/settings.js'
import { MagpieRuntime, lineCredentialRefs, type RuntimeOptions } from '../../src/host/runtime.js'

/** Fixed, format-valid id used by single-line fixtures. */
export const LINE_ID = 'a1b2c3d4'
export const LINE_ID_2 = '9f0e7d6c'

export const line = (baseUrl = '', id = LINE_ID, accessMode: AccessMode = 'direct'): LineSettings => ({ id, baseUrl, accessMode })
export const refs = (id = LINE_ID) => lineCredentialRefs(id)

export function memoryStore(lines: LineSettings[] = []): SettingsStore {
  const store = new SettingsStore()
  store.value.lines = lines.map(entry => ({ ...entry }))
  return store
}

/** Credentials double whose default key is seeded on the fixture line's derived ref. */
export function lineCredentials(key?: string, options: CredentialsMockOptions = {}, id = LINE_ID) {
  const credentials = credentialsMock(undefined, true, options)
  if (key !== undefined) credentials.setRef(refs(id).key as unknown as string, key)
  return credentials
}

export function seedKey(credentials: ReturnType<typeof credentialsMock>, value: string, id = LINE_ID) {
  credentials.setRef(refs(id).key as unknown as string, value)
}
export function seedAccess(credentials: ReturnType<typeof credentialsMock>, id = LINE_ID, clientId = 'cf-id', secret = 'cf-secret') {
  credentials.setRef(refs(id).accessClientId as unknown as string, clientId)
  credentials.setRef(refs(id).accessClientSecret as unknown as string, secret)
}

/** Store with one configured line, runtime and credentials seeded on its derived ref. */
export function singleLine(baseUrl: string, options: { key?: string; accessMode?: AccessMode; id?: string; runtime?: RuntimeOptions } = {}) {
  const id = options.id ?? LINE_ID
  const accessMode = options.accessMode ?? 'direct'
  const credentials = lineCredentials(options.key ?? 'mk-placeholder', {}, id)
  const store = memoryStore([line(baseUrl, id, accessMode)])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, options.runtime)
  return { runtime, credentials, store, id }
}
