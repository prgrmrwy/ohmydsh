import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../scripts/jev-readiness.mjs', import.meta.url), 'utf8')

test('readiness probe reports presence and names without exposing credential values', () => {
  assert.match(source, /Boolean\(process\.env\.TYPESAFE_API_KEY\)/)
  assert.match(source, /valueInspected: false/)
  assert.match(source, /declaredVariables/)
  assert.doesNotMatch(source, /process\.stdout\.write[\s\S]*process\.env\.TYPESAFE_API_KEY/)
  assert.doesNotMatch(source, /envValue|credentialValue|keyValue/)
})

test('readiness probe only retains request-header tool names and skill-presence facts', () => {
  assert.match(source, /event\.type === 'request\/header'/)
  assert.match(source, /event\.data\?\.source\?\.kind === 'skill-catalog'/)
  assert.match(source, /jevTools:/)
  assert.match(source, /specSuperflowSkills:/)
  assert.doesNotMatch(source, /user\/message'[\s\S]*console\.log/)
  assert.doesNotMatch(source, /assistant\/message/)
})
