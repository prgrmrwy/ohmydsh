import { describe, expect, it } from 'vitest'
import { NS, bindLocale, en, interpolate, resetLocale, t, zh } from '../src/client/locales.js'

describe('client locale dictionaries', () => {
  it('zh covers exactly the english key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('every label is non-empty and the namespace is the settings namespace', () => {
    for (const dict of [en, zh]) for (const value of Object.values(dict)) expect(value.trim()).not.toBe('')
    expect(NS).toBe('settings.magpie')
  })

  it('falls back to the Chinese reference set before a translator is bound', () => {
    resetLocale()
    expect(t('connection')).toBe('连接')
    expect(t('savedLine', { n: 2 })).toBe('已保存 · 当前线路 2')
  })

  it('binds the host translator and interpolates {placeholders}', () => {
    bindLocale(key => en[key])
    expect(t('connection')).toBe('Connection')
    expect(t('checkDiffCounts', { added: 2, removed: 1 })).toBe('2 extra · 1 missing')
    expect(interpolate('a {x} b', { x: 1 })).toBe('a 1 b')
    expect(interpolate('no placeholders')).toBe('no placeholders')
  })
})
