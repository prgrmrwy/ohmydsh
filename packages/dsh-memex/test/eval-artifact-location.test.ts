import { expect, it } from 'vitest'
import { locateRegisteredArtifact } from '../src/eval/artifact-location.js'
it('derives only current rc2 JSONL generation from explicit trusted backend config and registered metadata', () => {
  expect(locateRegisteredArtifact({ name: 'session-persistence-jsonl', version: '0.2.0-rc.2', root: '/state/sessions', compression: 'zstd' }, { id: 'session-123', cwd: '/tmp/eval run/repo' })).toEqual({ path: '/state/sessions/--tmp-eval~0020run-repo--/session-123/session.v4.jsonl.zstd', encoding: 'zstd' })
})
it('refuses unsupported backend, version and unsafe identity rather than scanning logs', () => {
  const config = { name: 'session-persistence-jsonl', version: '0.2.0-rc.2', root: '/state/sessions', compression: 'zstd' }
  for (const patch of [{ name: 'sqlite' }, { version: 'future' }, { root: 'relative' }, { compression: 'unknown' }]) expect(() => locateRegisteredArtifact({ ...config, ...patch }, { id: 'session-123', cwd: '/tmp/repo' })).toThrow()
  expect(() => locateRegisteredArtifact(config, { id: '../daily', cwd: '/tmp/repo' })).toThrow()
})
