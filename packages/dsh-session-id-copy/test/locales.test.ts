import { describe, expect, it } from 'vitest'
import { NS, en, zh } from '../src/client/locales.js'

describe('locale dictionaries', () => {
  it('zh covers exactly the english key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('every label is non-empty and the namespace is a stable id', () => {
    for (const dict of [en, zh]) for (const value of Object.values(dict)) expect(value.trim()).not.toBe('')
    expect(NS).toBe('sessionIdCopy')
  })
})
