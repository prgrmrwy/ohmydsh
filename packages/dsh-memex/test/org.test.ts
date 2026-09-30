import { describe, expect, it } from 'vitest'
import { internalDomainPattern, internalRemotePattern, parseOrgProfile } from '../src/org.js'

describe('organization profile', () => {
  it('is empty when the row carries no config', () => {
    for (const input of [undefined, null, {}]) {
      expect(parseOrgProfile(input as never)).toMatchObject({ internalHosts: [], internalDomains: [], problems: [] })
    }
    expect(internalRemotePattern(parseOrgProfile(undefined))).toBeUndefined()
    expect(internalDomainPattern(parseOrgProfile(undefined))).toBeUndefined()
  })
  it('normalizes case, dots and duplicates', () => {
    expect(parseOrgProfile({ internalHosts: ['Git.Corp.Example', 'git.corp.example.'], internalDomains: ['.corp.example'] }))
      .toMatchObject({ internalHosts: ['git.corp.example'], internalDomains: ['corp.example'], problems: [] })
  })
  it('drops and reports unusable entries instead of guessing', () => {
    const profile = parseOrgProfile({ internalHosts: ['ok.example', 'has space', 42, 'https://x.example'], internalDomains: 'corp.example' })
    expect(profile.internalHosts).toEqual(['ok.example'])
    expect(profile.internalDomains).toEqual([])
    expect(profile.problems).toEqual([
      'internalHosts[1] is not a host name',
      'internalHosts[2] is not a host name',
      'internalHosts[3] is not a host name',
      'internalDomains must be a list of host names',
    ])
  })
  it('escapes host names so a dot never matches any character', () => {
    const remote = internalRemotePattern(parseOrgProfile({ internalHosts: ['git.corp.example'] }))!
    expect(remote.test('git@gitxcorp.example:team/acme.git')).toBe(false)
    expect(remote.test('git@git.corp.example:team/acme.git')).toBe(true)
  })
})
