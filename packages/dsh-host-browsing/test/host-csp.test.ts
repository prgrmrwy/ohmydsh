import { describe, expect, it } from 'vitest'
import { addNonceToCsp } from '../src/host/csp.js'
import { stripFrameAncestors } from '../src/host/redirect.js'
import { scanInsertionPoint } from '../src/host/html-inject.js'

/** Extra (non-ledger) unit coverage for the CSP and HTML-scanner rules in the spec's HTML injection requirement. */
describe('addNonceToCsp', () => {
  const N = 'NNN'
  it.each([
    ["script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline'"],
    ["script-src 'self'", "script-src 'self' 'nonce-NNN'"],
    ["script-src 'unsafe-inline' 'nonce-old'", "script-src 'unsafe-inline' 'nonce-old' 'nonce-NNN'"],
    ["script-src 'unsafe-inline' 'strict-dynamic'", "script-src 'unsafe-inline' 'strict-dynamic' 'nonce-NNN'"],
    ["script-src 'unsafe-inline' 'sha256-abc='", "script-src 'unsafe-inline' 'sha256-abc=' 'nonce-NNN'"],
    // effective directive precedence: script-src-elem > script-src > default-src
    ["script-src-elem 'self'; script-src 'unsafe-inline'", "script-src-elem 'self' 'nonce-NNN'; script-src 'unsafe-inline'"],
    ["script-src-elem 'unsafe-inline'; script-src 'self'", "script-src-elem 'unsafe-inline'; script-src 'self'"],
    ["default-src 'self'", "default-src 'self' 'nonce-NNN'"],
    ["default-src 'unsafe-inline'", "default-src 'unsafe-inline'"],
    ["default-src 'self'; script-src 'unsafe-inline'", "default-src 'self'; script-src 'unsafe-inline'"],
    // no effective script directive → untouched
    ["img-src 'self'", "img-src 'self'"],
    // case-insensitive directive and keyword names
    ["SCRIPT-SRC 'SELF' 'Unsafe-Inline'", "SCRIPT-SRC 'SELF' 'Unsafe-Inline'"],
    // multiple policies: every policy is handled on its own
    ["script-src 'self', script-src 'unsafe-inline'", "script-src 'self' 'nonce-NNN', script-src 'unsafe-inline'"],
  ])('%s', (input, expected) => {
    expect(addNonceToCsp(input, N)).toBe(expected)
  })
})

describe('stripFrameAncestors', () => {
  it.each([
    ["default-src 'self'; frame-ancestors 'none'", "default-src 'self'"],
    ["FRAME-ANCESTORS 'self'; img-src *", 'img-src *'],
    ["frame-ancestors 'self'", undefined],
    ["script-src 'self', frame-ancestors 'none'", "script-src 'self'"],
  ])('%s', (input, expected) => {
    expect(stripFrameAncestors(input)).toBe(expected)
  })
})

describe('scanInsertionPoint', () => {
  const at = (text: string, final = true) => scanInsertionPoint(Buffer.from(text, 'utf8'), final)
  it('inserts before the first tag after doctype/comments, not inside <header> text', () => {
    expect(at('<!doctype html><header>')).toEqual({ kind: 'insert', index: '<!doctype html>'.length })
    expect(at('<!DOCTYPE html>\n<!--x--> <html>')).toEqual({ kind: 'insert', index: '<!DOCTYPE html>\n<!--x--> '.length })
  })
  it('skips a BOM', () => {
    expect(at('\uFEFF<html>')).toEqual({ kind: 'insert', index: 3 })
  })
  it('streaming: an unfinished leading token is held back, finished prefix is releasable', () => {
    expect(at('<!doctype html><!-- unfinished', false)).toEqual({ kind: 'more', safe: '<!doctype html>'.length })
    expect(at('<!doc', false)).toEqual({ kind: 'more', safe: 0 })
    expect(at('<!-', false)).toEqual({ kind: 'more', safe: 0 })
    expect(at('<h', false)).toEqual({ kind: 'insert', index: 0 })
  })
  it('final with only skippable content appends at the end', () => {
    expect(at('<!doctype html> ')).toEqual({ kind: 'insert', index: '<!doctype html> '.length })
    expect(at('')).toEqual({ kind: 'insert', index: 0 })
  })
})
