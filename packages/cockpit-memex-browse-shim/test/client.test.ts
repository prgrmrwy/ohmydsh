import { describe, expect, it } from 'vitest'
import { browseHolder, inject } from '../src/client/index.ts'

describe('optional forwards adapter contract', () => {
  it('declares no top-level inject', () => expect(inject).toEqual([]))
  it('keys holders by device port and isolates replacement bindings', () => {
    expect(browseHolder(3940, 'a')).toBe('memex-browse-3940-a')
    expect(browseHolder(3940, 'a')).not.toBe(browseHolder(3940, 'b'))
    expect(browseHolder(3940, 'a')).not.toBe(browseHolder(3941, 'a'))
  })
})
