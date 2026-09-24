import { describe, expect, it } from 'vitest'
import { basenameOf, resolveProducedPath } from '../src/client/open-produced.js'

describe('resolveProducedPath', () => {
  it('resolves cwd-relative paths against the session workspace', () => {
    expect(resolveProducedPath('/Users/me/repo', 'src/a.ts')).toBe('/Users/me/repo/src/a.ts')
    expect(resolveProducedPath('/Users/me/repo/', './src/a.ts')).toBe('/Users/me/repo/./src/a.ts')
  })
  it('keeps absolute paths and home-relative paths untouched', () => {
    expect(resolveProducedPath('/Users/me/repo', '/etc/hosts')).toBe('/etc/hosts')
    expect(resolveProducedPath('/Users/me/repo', '~/x')).toBe('~/x')
  })
  it('returns the path verbatim when no cwd is known', () => {
    expect(resolveProducedPath(undefined, 'src/a.ts')).toBe('src/a.ts')
  })
})

describe('basenameOf', () => {
  it('takes the last segment for either separator', () => {
    expect(basenameOf('/a/b/c.ts')).toBe('c.ts')
    expect(basenameOf('C:\\a\\b\\c.ts')).toBe('c.ts')
    expect(basenameOf('solo')).toBe('solo')
  })
})
