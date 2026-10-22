import { describe, expect, it } from 'vitest'
import { resumeModelFor } from '../src/host/inquiry/resume-model.js'

const hostDefault = { provider: 'host-default', model: 'host-model' }

describe('cold inquiry resume keeps the session model', () => {
  it('uses the model the session last ran on, not the current Host default', () => {
    expect(resumeModelFor({ lastUsed: { provider: 'deepseek', model: 'deepseek-v4' }, pending: null }, hostDefault))
      .toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
  })
  it('prefers an explicit pending pick over the last used model', () => {
    expect(resumeModelFor({ lastUsed: { provider: 'a', model: 'old' }, pending: { provider: 'b', model: 'picked' } }, hostDefault))
      .toEqual({ provider: 'b', model: 'picked' })
  })
  it('reads the wire view shape (next) as well', () => {
    expect(resumeModelFor({ lastUsed: null, next: { provider: 'c', model: 'wire' } }, hostDefault))
      .toEqual({ provider: 'c', model: 'wire' })
  })
  it('falls back to the Host default only for a session that never ran or a malformed projection', () => {
    expect(resumeModelFor({ lastUsed: null, pending: null }, hostDefault)).toEqual(hostDefault)
    expect(resumeModelFor(undefined, hostDefault)).toEqual(hostDefault)
    expect(resumeModelFor({ lastUsed: { provider: '', model: 'x' } }, hostDefault)).toEqual(hostDefault)
  })
})
