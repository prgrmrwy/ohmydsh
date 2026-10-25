import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnvLocal } from '../scripts/lib/env-local.mjs'

const strict = text => Object.fromEntries(parseEnvLocal(text, { mode: 'strictLauncher', file: 'fixture.env' }).map(({ name, value }) => [name, value]))

// These assertions are implementation-independent and deliberately exercise the
// existing allow-list lexer before strictLauncher is implemented.
test('test_literal_environment_parity', () => {
  assert.deepEqual(strict('\ufeff# comment\r\nexport A=first\r\nA=last\r\nEMPTY=\r\nSPACE="two words"\r\nPATH_VALUE=\'C:\\dir\\\'\r\n'), {
    A: 'last', EMPTY: '', SPACE: 'two words', PATH_VALUE: 'C:\\dir\\',
  })
})

test('test_reject_shell_without_secret_leak', () => {
  const secret = 'secret-sentinel-never-print'
  for (const text of [`OK=yes\nBAD=$(echo ${secret})`, `OK=yes\nBAD=\`echo ${secret}\``, `OK=yes\necho ${secret}`, `BAD='${secret}$HOME'`, 'BAD="unterminated']) {
    assert.throws(() => strict(text), error => {
      assert.match(error.message, /fixture\.env:\d+/)
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.match(error.message, /literal|键值|赋值|quote|格式|syntax|expansion/)
      return true
    })
  }
})

test('test_reject_bare_operators_and_whitespace', () => {
  for (const value of ['a b', 'a;b', 'a&b', 'a|b', 'a<b', 'a>b', 'a(b)']) {
    assert.throws(() => strict(`KEY=${value}`), undefined, value)
    assert.equal(strict(`KEY='${value}'`).KEY, value)
    assert.equal(strict(`KEY="${value}"`).KEY, value)
  }
})

test('test_reject_legacy_inline_comment', () => {
  assert.throws(() => strict('KEY=a #note'))
  assert.throws(() => strict("KEY='a' #note"))
  assert.equal(strict("# note\nKEY='a #note'").KEY, 'a #note')
})

test('test_reject_bare_tilde_and_backslash', () => {
  for (const value of ['~/x', 'C:\\dir', 'a\\ b']) assert.throws(() => strict(`KEY=${value}`))
  assert.equal(strict("KEY='C:\\dir\\'").KEY, 'C:\\dir\\')
})

test('test_decode_double_quotes_preserve_single_quote_backslash', () => {
  assert.deepEqual(strict(String.raw`DOUBLE="a\\b\"c\z"
SINGLE='C:\dir\'
`), { DOUBLE: 'a\\b"c\\z', SINGLE: 'C:\\dir\\' })
  assert.throws(() => strict("KEY='one'two'"))
  assert.throws(() => strict('KEY="one"two'))
})

test('test_strict_and_allowlist_entry_boundary', () => {
  const text = 'DSH_OPEN_APP="$HOME/Applications/X.app"\nDSH_LOCAL_MANIFEST=\'/absolute/overlay.yaml\'\n'
  const entries = parseEnvLocal(text)
  assert.equal(entries.find(entry => entry.name === 'DSH_LOCAL_MANIFEST').value, '/absolute/overlay.yaml')
  assert.throws(() => strict(text))
  // The compatibility lexer retains its historical inline comment and caller
  // policy inputs; whole-file strict validation cannot spread into bare sync.
  assert.equal(parseEnvLocal('KEY=a #note')[0].value, 'a')
})
